// SPDX-License-Identifier: AGPL-3.0-only
/**
 * VALIDATION, A DRY PLAN AND A TRIAL PACK: the file installs.
 *
 * A save must never write a file the target refuses. So the manifest meets
 * what an upload meets:
 *  - `validateManifest` with `allowLocalPublisher`, as the upload reads it;
 *  - a dry `planInstall` against a blank database of the source's engine (no
 *    tables), with the plan context an install gives an app;
 *  - the server's own plan-time checks that need no database: a page's saved
 *    envelope and views, its form and layout, its email templates and the
 *    files they carry, its roles;
 *  - a trial pack: the files written to a folder, packed as a download is
 *    packed, and read back through the archive reader the upload uses, so a
 *    path or a size the upload refuses is refused here. The manifest read
 *    back is validated again, so what is written is what was checked.
 * Any problem refuses the save: it is a bug in the converter, not a choice.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { planInstall, prefixFor, validateManifest, type AppManifest, type Manifest } from '@adminium/manifest';

import { AddOnArchiveError, readAddOnTarball } from '../../../add-ons/archive.js';
import { PackError, packStagedTree } from '../../../add-ons/pack.js';
import { envelopePlanProblems } from '../../manifest-envelopes.js';
import { mailCarries, templateProblems } from '../../manifest-outbox.js';
import { pagePlanProblems } from '../../manifest-page-config.js';
import { roleIssues } from '../../manifest-roles.js';
import type { SaveDialect } from '../types.js';
import type { GateProblem } from './types.js';

const MANIFEST_FILE = 'manifest.json';

/** What `validateManifest` says, as problems. Empty when the manifest is valid. */
export function manifestProblems(document: unknown): { problems: GateProblem[]; manifest: Manifest | null } {
  const validated = validateManifest(document, { allowLocalPublisher: true });
  if (!validated.ok) {
    return {
      manifest: null,
      problems: validated.issues.map((issue) => ({ code: 'MANIFEST_INVALID', path: issue.path, message: issue.path === '' ? issue.message : `${issue.path}: ${issue.message}` })),
    };
  }
  return { manifest: validated.manifest, problems: [] };
}

/** The plan against a blank database, and the plan-time checks that need none. */
export function planProblems(manifest: Manifest, files: ReadonlyMap<string, Uint8Array>, dialect: SaveDialect): GateProblem[] {
  const refused = (message: string, path?: string): GateProblem => ({ code: 'PLAN_REFUSED', message, ...(path === undefined ? {} : { path }) });
  const out: GateProblem[] = [];

  const prefix = manifest.kind === 'app' && manifest.requiredSchema?.prefixed === true ? prefixFor(manifest.key) : null;
  const plan = planInstall(manifest, { tables: [], dialect }, { prefix, records: {}, others: [], dialect, metaSchema: null });
  for (const problem of plan.problems) out.push(refused(problem.message, problem.table === undefined ? undefined : `requiredSchema.tables ${problem.table}`));
  // A blank database has nothing to answer for: a table still waiting on an answer is a plan the target would stop at.
  for (const table of plan.tables ?? []) {
    if (table.action === 'undecided') out.push(refused(`The table "${table.ref}" would wait for an answer on a database that has none of its tables.`, `requiredSchema.tables ${table.ref}`));
  }

  for (const problem of envelopePlanProblems(manifest)) out.push(refused(problem.message, `pages ${problem.page}`));
  for (const problem of pagePlanProblems(manifest)) out.push(refused(problem.message, `pages ${problem.page}`));
  for (const message of templateProblems(manifest)) out.push(refused(message, 'emailTemplates'));
  for (const issue of roleIssues(manifest)) out.push(refused(issue.message, `roles ${issue.role}`));

  // Each file an email carries: in the package, and a kind of file an email can carry.
  if (manifest.kind === 'app') {
    for (const template of manifest.emailTemplates ?? []) {
      for (const { file } of template.attachments ?? []) {
        const bytes = files.get(file);
        const where = `The email "${template.key}" carries "${file}"`;
        if (bytes === undefined) out.push(refused(`${where}, which the file does not hold.`, `emailTemplates ${template.key}`));
        else if (!mailCarries(Buffer.from(bytes), file)) out.push(refused(`${where}, which is not a kind of file an email carries.`, `emailTemplates ${template.key}`));
      }
    }
  }
  return out;
}

/** Pack the file as a download is packed and read it back as an upload reads it. */
export async function trialPackProblems(manifest: AppManifest, files: ReadonlyMap<string, Uint8Array>): Promise<GateProblem[]> {
  const refused = (message: string, path?: string): GateProblem => ({ code: 'PLAN_REFUSED', message, ...(path === undefined ? {} : { path }) });
  if (files.has(MANIFEST_FILE)) return [refused(`A package file is named "${MANIFEST_FILE}", which is the manifest's own name.`, MANIFEST_FILE)];
  const dir = await mkdtemp(join(tmpdir(), 'adminium-save-'));
  try {
    const written = new Map<string, Uint8Array>([[MANIFEST_FILE, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')], ...files]);
    for (const [path, bytes] of written) {
      const full = join(dir, path);
      // A path that climbs out of the folder is refused before anything is written there.
      if (!full.startsWith(`${dir}/`) || path.split(/[\\/]/).some((part) => part === '..' || part === '')) {
        return [refused(`The package file "${path}" has a path an upload refuses.`, path)];
      }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    }

    let entries;
    try {
      const packed = await packStagedTree(dir);
      entries = readAddOnTarball(packed.tarball);
    } catch (error) {
      if (error instanceof PackError || error instanceof AddOnArchiveError) {
        const entry = error instanceof AddOnArchiveError ? error.entry : undefined;
        return [refused(`The file would not upload: ${error.message}`, entry)];
      }
      throw error;
    }

    const out: GateProblem[] = [];
    const read = new Map(entries.map((entry) => [entry.path, entry.bytes]));
    for (const path of written.keys()) {
      if (!read.has(path)) out.push(refused(`The package file "${path}" is lost when the file is packed.`, path));
    }
    const manifestBytes = read.get(MANIFEST_FILE);
    if (manifestBytes !== undefined) {
      let document: unknown;
      try {
        document = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
      } catch {
        return [...out, refused('The packed manifest is not readable JSON.', MANIFEST_FILE)];
      }
      out.push(...manifestProblems(document).problems);
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
