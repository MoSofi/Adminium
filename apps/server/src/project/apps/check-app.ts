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
  namedAddOns,
  sampleBundleIssues,
  sampleBundleSchema,
  sampleSectionIssues,
  validateManifest,
  type AddOnManifest,
  type AppManifest,
} from '@adminium/manifest';

import { addAndReadRefusal, anonymousAddAndRead, openToAnyone } from '../../apps/anonymous-access.js';
import { meetsMinimum } from '../../apps/catalog.js';
import { roleIssues } from '../../apps/manifest-roles.js';
import { unbuiltInManifest } from '../../crud/unbuilt-rules.js';
import { serverCodeSources } from '../build-shared.js';
import { MANIFEST_FILE, MANIFEST_PARTS_DIR, SIDES, appPath, readAppFolder, sideEntry, type AppFolder, type AppProblem, type AppSide } from './read-app.js';
import { hasOwnBuild } from './own-build.js';

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
export function accessInWords(manifest: AppManifest, addOns?: AddOnsInSight): string[] {
  const columns = (list: readonly string[] | undefined): string => (list === undefined || list.length === 0 ? '' : ` (${list.join(', ')})`);
  type Entry = NonNullable<AppManifest['publicAccess']>[number];
  const inWords = (entry: Entry): string => {
    const does: string[] = [];
    // Answered by an add-on's stock words: a yes or no about stock, never a row.
    if (entry.kind === 'availability' && entry.words !== undefined) does.push(`see whether it is in stock (answered by ${entry.words.slice(0, entry.words.indexOf(':'))})`);
    else if (entry.kind === 'availability') does.push('see when it is free');
    else if (entry.methods.includes('GET')) does.push(`read${columns(entry.select)}`);
    if (entry.methods.includes('POST')) does.push(`add a row${columns(entry.writable)}`);
    if (entry.methods.includes('PATCH')) does.push(`change${columns(entry.writable)}`);
    const own =
      entry.unlockBy !== undefined && 'self' in entry.unlockBy
        ? ', its own row by its code'
        : entry.claim !== undefined || entry.claimedBy !== undefined
          ? ', its own rows only'
          : '';
    return `${entry.table}: ${listed(does)}${own}`;
  };
  const out = (manifest.publicAccess ?? []).map(inWords);
  /*
   * What the add-ons it names add: the customer side reaches those too, once
   * each is connected and somebody allowed it, so a list without them would be
   * false. With their manifests in sight, entry by entry; without, by name.
   */
  const named = namedAddOns(manifest.addOns).map((need) => need.key);
  const unseen: string[] = [];
  for (const key of named) {
    const addOn = addOns?.get(key);
    if (addOn === undefined) {
      unseen.push(key);
      continue;
    }
    const link = Object.keys(addOn.publicKeys ?? {})[0];
    const through = (addOn.publicAccess ?? []).filter((entry) => entry.key === undefined || entry.key !== link);
    if (through.length > 0) out.push(`${addOn.name} adds: ${through.map(inWords).join('; ')}`);
  }
  if (unseen.length > 0 && addOns === undefined) out.push(`plus what ${listed(unseen)} ${unseen.length === 1 ? 'grants' : 'grant'} when ${unseen.length === 1 ? 'it is' : 'they are'} connected`);
  return out;
}

/** The add-ons a check can see, by key: the packages beside the project, or the ones installed. */
export type AddOnsInSight = ReadonlyMap<string, AddOnManifest>;

const error = (file: string, path: string, message: string): AppFinding => ({ level: 'error', file, path, message });

/**
 * Check `apps/<key>/`. `version` is the Adminium doing the checking; `addOns`
 * the add-ons this check can see — without them, what needs an add-on's own
 * manifest is left for the apply, and said as a note.
 */
export function checkApp(root: string, key: string, opts: { version: string; addOns?: AddOnsInSight | undefined }): AppCheck {
  const folder = readAppFolder(root, key);
  const findings: AppFinding[] = folder.problems.map((problem) => ({ ...problem, level: 'error' as const }));
  // An app with a build of its own keeps its screens where its build wants them: the manifest says which sides it has.
  const ownBuild = hasOwnBuild(root, key);
  let sides = SIDES.filter((side) => sideEntry(root, key, side) !== null);
  const result = (manifest: AppManifest | null, access: string[] = []): AppCheck => ({ key, folder, manifest, findings, access, sides });
  if (folder.document === null) return result(null);

  /** A validator path, said against the file it is written in. */
  const at = (issuePath: string): { file: string; path: string } => {
    if (folder.origin === null) return { file: appPath(key, MANIFEST_FILE), path: issuePath };
    const located = locateIssue(folder.origin, issuePath);
    return { file: appPath(key, MANIFEST_PARTS_DIR, located.file), path: located.path };
  };

  // Said before the validator, which would refuse the folder's own publisher first and never reach the plain sentence.
  if ((folder.document as { kind?: unknown }).kind === 'add-on') {
    findings.push(error(at('kind').file, 'kind', 'is an add-on. An app folder holds an app. An add-on is a package: Studio → Add-ons installs it.'));
    return result(null);
  }
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
  const addOns = opts.addOns;

  // A word this Adminium reads and does not run yet: refused here, where it is written, not part way through an apply.
  for (const word of unbuiltInManifest(folder.document)) {
    const where = at(word.path);
    findings.push(
      error(where.file, where.path, `uses "${word.word}", which Adminium ${word.release} runs and this Adminium ${opts.version} does not. Take it out, or run this folder on Adminium ${word.release}.`),
    );
  }

  if (manifest.key !== key) {
    findings.push(error(at('key').file, 'key', `is "${manifest.key}", and the folder is apps/${key}. They must be the same.`));
  }
  const minimum = manifest.compatibility.minAdminiumVersion;
  if (!meetsMinimum(minimum, opts.version)) {
    findings.push(
      error(at('compatibility.minAdminiumVersion').file, 'compatibility.minAdminiumVersion', `is ${minimum}, and this is Adminium ${opts.version}.`),
    );
  }

  if (ownBuild) sides = SIDES.filter((side) => manifest.frontends.some((frontend) => frontend.side === side && frontend.kind === 'spa'));
  // Every screen the manifest declares has its code, and the reverse.
  for (const [index, frontend] of ownBuild ? [] : manifest.frontends.entries()) {
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
  for (const side of ownBuild ? [] : sides) {
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

  // Its rows for each add-on it names: there, readable, for that add-on, and about tables the two declare.
  for (const [addOnKey, section] of Object.entries(manifest.sampleData?.addOns ?? {})) {
    const where = appPath(key, section.file);
    const file = join(folder.dir, section.file);
    if (!existsSync(file)) {
      findings.push(error(where, '', `is named by sampleData.addOns.${addOnKey}.file and does not exist.`));
      continue;
    }
    try {
      const parsed = sampleBundleSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) findings.push(error(where, issue.path.map(String).join('.'), issue.message));
        continue;
      }
      if (parsed.data.addOn !== undefined && parsed.data.addOn !== addOnKey) {
        findings.push(error(where, 'addOn', `is "${parsed.data.addOn}", and the manifest lists this file under "${addOnKey}".`));
      }
      for (const issue of sampleSectionIssues(parsed.data, manifest, addOns?.get(addOnKey))) findings.push(error(where, issue.path, issue.message));
      if (addOns?.has(addOnKey) !== true) {
        findings.push({ level: 'note', file: where, path: '', message: `its tables of "${addOnKey}" are checked when it is applied: that add-on is not in sight here.` });
      }
    } catch (cause) {
      findings.push(error(where, '', `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
    }
  }

  // A link into an add-on's table: with the add-on in sight, the table is one of its, and the column can hold its key.
  manifest.requiredSchema.tables.forEach((table, t) => {
    table.columns.forEach((column, c) => {
      const link = column.rules?.addOnLink;
      const addOn = link === undefined ? undefined : addOns?.get(link.addOn);
      if (link === undefined || addOn === undefined) return;
      const where = at(`requiredSchema.tables.${String(t)}.columns.${String(c)}.rules.addOnLink`);
      const target = (addOn.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === link.table);
      if (target === undefined) {
        findings.push(error(where.file, where.path, `links into "${link.addOn}.${link.table}", and ${addOn.name} ${addOn.version} has no such table.`));
        return;
      }
      const keyType = target.columns.find((candidate) => candidate.role === 'pk')?.type ?? 'int';
      const holds = keyType === 'text' ? column.type === 'text' : column.type === 'int' || column.type === 'bigint';
      if (!holds) {
        findings.push(error(where.file, where.path, `"${table.ref}.${column.ref}" is ${column.type}, and the key of "${link.addOn}.${link.table}" is ${keyType}: it cannot hold it (ADD_ON_LINK_MISMATCH).`));
      }
    });
  });

  /*
   * What the install refuses of an app's own browser key, said here rather
   * than part way through an install. The validator does not know this one:
   * it is a rule about the key the install makes, not about the manifest's shape.
   */
  // The same hole written as two entries: POST in one, GET in the next.
  for (const index of anonymousAddAndRead(manifest.publicAccess ?? [])) {
    const where = at(`publicAccess.${String(index)}.methods`);
    findings.push(error(where.file, where.path, addAndReadRefusal((manifest.publicAccess ?? [])[index]?.table ?? '')));
  }
  (manifest.publicAccess ?? []).forEach((entry, index) => {
    // The install decides the same way (`manifest-public.ts`): a published app that installs must not be refused here once it is a folder's.
    if (openToAnyone(entry) && entry.methods.includes('POST') && entry.methods.includes('GET')) {
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
  // A suggested add-on a posting rests on: without it that posting does nothing, which is worth saying once.
  const features = new Map((manifest.addOns?.features ?? []).map((feature) => [feature.id, feature.requires]));
  const rested = new Set<string>();
  for (const table of manifest.requiredSchema.tables) {
    for (const posting of (table as { postings?: readonly { needs?: string; into: { addOn: string } }[] }).postings ?? []) {
      if (posting.needs !== undefined && (features.get(posting.needs) ?? []).includes(posting.into.addOn)) rested.add(posting.into.addOn);
    }
  }
  for (const need of manifest.addOns?.suggests ?? []) {
    if (!rested.has(need.key)) continue;
    findings.push({ level: 'note', file: at('addOns').file, path: 'suggests', message: `posts into the add-on "${need.key}" (${need.range}) when it is connected; without it those postings do nothing.` });
  }

  return result(findings.some((finding) => finding.level === 'error') ? null : manifest, accessInWords(manifest, addOns));
}
