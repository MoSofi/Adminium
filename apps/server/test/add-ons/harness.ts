// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RELEASED-SHAPE ADD-ON, INSTALLED FOR REAL.
 *
 * The add-ons live in a repository of their own. A test here takes one as it
 * is built there — its `manifest.json` and the files its manifest names —
 * and installs it through the add-on routes, the way a server does with a
 * package that comes with it. So what is tested is the add-on an owner will
 * get, on each database, and not a fixture written to look like it.
 *
 * It needs a checkout of that repository with the package built
 * (`ADMINIUM_ADD_ONS_REPO`, and `npm run build` in the package). Where there
 * is none the suites are skipped, by name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { addOnHarness, type Dialect, type Harness, type HarnessOptions } from '../app-add-ons.helpers.js';

type Doc = Record<string, unknown>;

/** Where the add-ons repository is checked out, when it is. */
export const ADD_ONS_REPO = process.env['ADMINIUM_ADD_ONS_REPO'];

export interface BuiltAddOn {
  key: string;
  version: string;
  manifest: Doc;
  /** The built files the manifest names, by their path in the package. */
  files: Record<string, string>;
}

/** Every built file an add-on's manifest names: what decides, and each page's bundle. */
function namedFiles(manifest: Doc): string[] {
  const addOn = (manifest['addOn'] ?? {}) as { provides?: { server?: string }[]; pages?: { client?: string }[]; slots?: { client?: string }[] };
  const named = [...(addOn.provides ?? []).map((one) => one.server), ...(addOn.pages ?? []).map((one) => one.client), ...(addOn.slots ?? []).map((one) => one.client)];
  return [...new Set(named.filter((path): path is string => typeof path === 'string'))];
}

/** An add-on of the checkout as it is built, or null when the checkout or the build is not there. */
export function builtAddOn(key: string): BuiltAddOn | null {
  if (ADD_ONS_REPO === undefined || ADD_ONS_REPO === '') return null;
  const root = join(ADD_ONS_REPO, 'packages', key);
  if (!existsSync(join(root, 'manifest.json'))) return null;
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Doc;
  const files: Record<string, string> = {};
  for (const path of namedFiles(manifest)) {
    if (!existsSync(join(root, path))) return null;
    files[path] = readFileSync(join(root, path), 'utf8');
  }
  return { key, version: String(manifest['version']), manifest, files };
}

export interface Installed {
  h: Harness;
  addOn: BuiltAddOn;
  /** The install's own reply. */
  reply: Doc;
  /** The real name of one of the add-on's tables. */
  real: (ref: string) => string;
  /** Every row of one of the add-on's tables, by its short name. */
  rowsOf: (ref: string, where?: string) => Promise<Record<string, unknown>[]>;
}

/**
 * Installs a built add-on with no app, as a package that comes with the
 * server (so its deciding code is trusted to run), under the server's OWN list
 * of words it does not run yet: an add-on that leans on one is refused here
 * as it would be on a real server.
 */
export async function installBuilt(dialect: Dialect, addOn: BuiltAddOn, opts: HarnessOptions = {}): Promise<Installed> {
  const h = await addOnHarness(dialect, opts);
  await h.stageAddOn(addOn.manifest, { bundled: true, files: addOn.files });
  const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: addOn.key, version: addOn.version, attachTo: [] } });
  if (res.statusCode !== 200) {
    await h.close();
    throw new Error(`installing ${addOn.key} answered ${String(res.statusCode)}: ${res.body.slice(0, 1200)}`);
  }
  const prefix = `${addOn.key.replace(/-/g, '_')}_`;
  const real = (ref: string) => `${prefix}${ref}`;
  return { h, addOn, reply: res.json() as Doc, real, rowsOf: (ref, where) => h.rows(`select * from ${real(ref)}${where === undefined ? '' : ` where ${where}`}`) };
}
