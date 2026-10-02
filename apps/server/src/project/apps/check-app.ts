// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Checking an app in a project folder, with no database and no server.
 *
 * The manifest is put together and run through the same validator an install
 * runs, so what passes here is what an upload accepts. Around it: that the
 * app runs on this Adminium, that every screen the manifest declares has its
 * code and every folder of code is declared, that the sample data fits the
 * tables — and, in words, what the customer side is allowed to reach.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isAddOnManifest,
  locateIssue,
  sampleBundleIssues,
  sampleBundleSchema,
  validateManifest,
  type AppManifest,
} from '@adminium/manifest';

import { meetsMinimum } from '../../apps/catalog.js';
import { roleIssues } from '../../apps/manifest-roles.js';
import { serverCodeSources } from '../build-shared.js';
import { MANIFEST_FILE, MANIFEST_PARTS_DIR, SIDES, appPath, readAppFolder, sideEntry, type AppFolder, type AppProblem, type AppSide } from './read-app.js';

export interface AppFinding extends AppProblem {
  level: 'error' | 'warn' | 'note';
}

export interface AppCheck {
  key: string;
  folder: AppFolder;
  /** The validated manifest, or null when it has errors. */
  manifest: AppManifest | null;
  findings: AppFinding[];
  /** What the customer side may do, one sentence per table; empty when it reaches nothing. */
  access: string[];
  /** The sides that have code to build. */
  sides: AppSide[];
}

/** `a`, `a and b`, `a, b and c`. */
function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] as string}`;
}

/**
 * What the app's customers may do, read off `publicAccess` — the only thing
 * the customer side can reach, whatever tables the app has.
 */
export function accessInWords(manifest: AppManifest): string[] {
  return (manifest.publicAccess ?? []).map((entry) => {
    const does: string[] = [];
    const columns = (list: readonly string[] | undefined): string => (list === undefined || list.length === 0 ? '' : ` (${list.join(', ')})`);
    if (entry.kind === 'availability') does.push('see when it is free');
    else if (entry.methods.includes('GET')) does.push(`read${columns(entry.select)}`);
    if (entry.methods.includes('POST')) does.push(`add a row${columns(entry.writable)}`);
    if (entry.methods.includes('PATCH')) does.push(`change${columns(entry.writable)}`);
    const own = entry.claim !== undefined || entry.claimedBy !== undefined ? ', its own rows only' : '';
    return `${entry.table}: ${listed(does)}${own}`;
  });
}

const error = (file: string, path: string, message: string): AppFinding => ({ level: 'error', file, path, message });

/** Check `apps/<key>/`. `version` is the Adminium doing the checking. */
export function checkApp(root: string, key: string, opts: { version: string }): AppCheck {
  const folder = readAppFolder(root, key);
  const findings: AppFinding[] = folder.problems.map((problem) => ({ ...problem, level: 'error' as const }));
  const sides = SIDES.filter((side) => sideEntry(root, key, side) !== null);
  const result = (manifest: AppManifest | null, access: string[] = []): AppCheck => ({ key, folder, manifest, findings, access, sides });
  if (folder.document === null) return result(null);

  /** A validator path, said against the file it is written in. */
  const at = (issuePath: string): { file: string; path: string } => {
    if (folder.origin === null) return { file: appPath(key, MANIFEST_FILE), path: issuePath };
    const located = locateIssue(folder.origin, issuePath);
    return { file: appPath(key, MANIFEST_PARTS_DIR, located.file), path: located.path };
  };

  const validated = validateManifest(folder.document, { allowLocalPublisher: true });
  for (const warning of validated.warnings) findings.push({ level: 'warn', ...at(warning.path), message: warning.message });
  if (!validated.ok) {
    for (const issue of validated.issues) findings.push({ level: 'error', ...at(issue.path), message: issue.message });
    return result(null);
  }
  if (isAddOnManifest(validated.manifest)) {
    findings.push(error(at('kind').file, 'kind', 'is an add-on. An app folder holds an app.'));
    return result(null);
  }
  const manifest = validated.manifest;

  if (manifest.key !== key) {
    findings.push(error(at('key').file, 'key', `is "${manifest.key}", and the folder is apps/${key}. They must be the same.`));
  }
  const minimum = manifest.compatibility.minAdminiumVersion;
  if (!meetsMinimum(minimum, opts.version)) {
    findings.push(
      error(at('compatibility.minAdminiumVersion').file, 'compatibility.minAdminiumVersion', `is ${minimum}, and this is Adminium ${opts.version}.`),
    );
  }

  // Every screen the manifest declares has its code, and the reverse.
  for (const [index, frontend] of manifest.frontends.entries()) {
    const built = sides.includes(frontend.side);
    if (frontend.kind === 'spa' && !built) {
      findings.push(
        error(
          at(`frontends.${String(index)}`).file,
          `frontends.${String(index)}`,
          `declares a ${frontend.side} side, and ${appPath(key, frontend.side, 'src', 'main.tsx')} does not exist.`,
        ),
      );
    }
    if (frontend.kind === 'none' && built) {
      findings.push(
        error(at(`frontends.${String(index)}.kind`).file, `frontends.${String(index)}.kind`, `is "none", and ${appPath(key, frontend.side)}/ has code. Make it "spa".`),
      );
    }
  }
  for (const side of sides) {
    if (!manifest.frontends.some((frontend) => frontend.side === side)) {
      findings.push(error(appPath(key, side), '', `has code, and the manifest's frontends do not list a ${side} side.`));
    }
  }

  // The sample data: there, readable, and about this app's tables.
  const sample = manifest.sampleData?.file;
  if (sample !== undefined) {
    const file = join(folder.dir, sample);
    const where = appPath(key, sample);
    if (!existsSync(file)) {
      findings.push(error(where, '', 'is named by sampleData.file and does not exist.'));
    } else {
      try {
        const parsed = sampleBundleSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (!parsed.success) {
          for (const issue of parsed.error.issues) findings.push(error(where, issue.path.map(String).join('.'), issue.message));
        } else {
          for (const issue of sampleBundleIssues(parsed.data, manifest)) findings.push(error(where, issue.path, issue.message));
          for (const [label, asset] of Object.entries(parsed.data.assets)) {
            if (asset.file.split('/').includes('..')) findings.push(error(where, `assets.${label}`, `names ${asset.file}, which leaves seeds/.`));
            else if (!existsSync(join(folder.dir, asset.file))) findings.push(error(where, `assets.${label}`, `names ${asset.file}, which does not exist.`));
          }
        }
      } catch (cause) {
        findings.push(error(where, '', `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
      }
    }
  }

  /*
   * What the install refuses of an app's own browser key, said here rather
   * than part way through an install. The validator does not know this one:
   * it is a rule about the key the install makes, not about the manifest's shape.
   */
  (manifest.publicAccess ?? []).forEach((entry, index) => {
    if (entry.kind === 'availability') return;
    // Anyone at all: no claim, no sign-in, no person found or made by the write.
    const anyone = entry.claim === undefined && entry.claimedBy === undefined && entry.identity === undefined;
    if (anyone && entry.methods.includes('POST') && entry.methods.includes('GET')) {
      const where = at(`publicAccess.${String(index)}.methods`);
      findings.push(
        error(
          where.file,
          where.path,
          `"${entry.table}" lets anyone add a row, so it may not also let anyone read one: every row could be read by guessing ids. ` +
            'Grant GET and POST on different tables, or make the readers sign in (claimedBy).',
        ),
      );
    }
  });

  // What an install refuses of the app's roles: a console grant, a wildcard, a table or page it does not have.
  for (const issue of roleIssues(manifest)) {
    const index = (manifest.roles ?? []).findIndex((role) => role.key === issue.role);
    const where = at(`roles.${String(Math.max(index, 0))}`);
    findings.push(error(where.file, where.path, issue.message));
  }

  // An app package carries no server code; a project's hooks and actions stay in the project.
  const serverCode = serverCodeSources(root);
  if (serverCode.length > 0) {
    findings.push({
      level: 'note',
      file: appPath(key),
      path: '',
      message: `this project has ${String(serverCode.length)} hook and action file(s). A packed app does not carry them: they stay in the project.`,
    });
  }
  for (const need of manifest.addOns?.requires ?? []) {
    findings.push({ level: 'note', file: at('addOns').file, path: 'requires', message: `needs the add-on "${need.key}" (${need.range}) on the Adminium it is installed on.` });
  }

  return result(findings.some((finding) => finding.level === 'error') ? null : manifest, accessInWords(manifest));
}
