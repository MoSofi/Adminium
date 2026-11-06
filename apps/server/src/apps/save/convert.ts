// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: THE CONVERTER.
 *
 * One database's configuration → an app manifest, its package files and the
 * Check list. Pure reading: nothing here writes to the meta store or the
 * database. The save service (`service.ts`) runs the gates on the result (the
 * secret scan, the id gate, validation and a dry plan) and only then packs
 * and records it.
 *
 * The parts run in this order, because later parts use names earlier ones
 * settle: tables first (every other part names tables by ref), email last (it
 * writes the templates the other parts used). Each part writes its own keys
 * of the manifest; two parts writing one key is a bug, refused here.
 */
import { WORD_FLOORS, installFloorWords, type AppManifest } from '@adminium/manifest';

import { convertAddOns } from './add-ons.js';
import { convertAutomations } from './automations.js';
import { CheckList, type CheckItem } from './check.js';
import { convertDocuments } from './documents.js';
import { convertEmail } from './email.js';
import { convertInstance } from './instance.js';
import { convertPages } from './pages.js';
import { convertPayments } from './payments.js';
import { convertPublicAccess } from './public-access.js';
import { buildSaveRefs } from './refs.js';
import { convertRoles } from './roles.js';
import { convertRows } from './rows.js';
import { convertSavedParts } from './saved-parts.js';
import { convertTables } from './tables.js';
import type { ConvertContext, ConvertPart, ManifestPart, SaveChoices, SaveSource } from './types.js';

export interface ConvertResult {
  /** The manifest as written; the gates validate it, nothing here does. */
  manifest: AppManifest;
  files: Map<string, Uint8Array>;
  check: readonly CheckItem[];
}

/** In order. */
const PARTS: readonly [string, ConvertPart][] = [
  ['tables', convertTables],
  ['pages', convertPages],
  ['roles', convertRoles],
  ['automations', convertAutomations],
  ['documents', convertDocuments],
  ['saved-parts', convertSavedParts],
  ['public-access', convertPublicAccess],
  ['payments', convertPayments],
  ['add-ons', convertAddOns],
  ['email', convertEmail],
  ['instance', convertInstance],
  ['rows', convertRows],
];

export async function convertToApp(source: SaveSource, choices: SaveChoices): Promise<ConvertResult> {
  const ctx: ConvertContext = { source, choices, refs: await buildSaveRefs(source, choices), check: new CheckList(), files: new Map() };
  const blocks: Record<string, unknown> = {};
  const writtenBy = new Map<string, string>();
  for (const [name, part] of PARTS) {
    const out: ManifestPart = await part(ctx);
    for (const [key, value] of Object.entries(out)) {
      if (value === undefined) continue;
      const other = writtenBy.get(key);
      if (other !== undefined) throw new Error(`save: the ${name} part and the ${other} part both wrote "${key}"`);
      writtenBy.set(key, name);
      blocks[key] = value;
    }
  }

  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: choices.key,
    name: choices.name,
    version: choices.version,
    publisher: { id: 'local', name: choices.label },
    license: 'UNLICENSED',
    description: { key: `${choices.key}.description`, fallback: choices.description?.trim() || choices.name },
    ...(choices.icon === undefined ? {} : { icon: choices.icon }),
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.0.0' },
    requiredSchema: { tables: [] },
    pages: [],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...blocks,
    provenance: { lineage: choices.lineage, savedAt: choices.savedAt, adminiumVersion: source.adminiumVersion, label: choices.label },
  } as unknown as AppManifest;
  if (manifest.pages.length === 0) {
    // An app opens on a page: with none, nothing would show it on the target.
    ctx.check.add({ group: 'choice', code: 'NO_PAGE', kind: 'app', item: choices.name, message: 'An app needs at least one page. Include a page of this database.' });
  }
  manifest.compatibility = { ...manifest.compatibility, minAdminiumVersion: minimumVersion(manifest, source.adminiumVersion) };
  ctx.check.add({ group: 'info', code: 'MIN_VERSION', kind: 'app', item: choices.name, message: `Installing it needs Adminium ${manifest.compatibility.minAdminiumVersion} or later.` });
  return { manifest, files: ctx.files, check: ctx.check.items() };
}

/**
 * The highest word floor the file uses; when a page carries an envelope or
 * views, at least the running version too (their config is this version's,
 * and an older target cannot be trusted to read it). Never below a floor: a
 * build running before the release that brings a word would otherwise stamp
 * a version the file's own words refuse.
 */
export function minimumVersion(manifest: AppManifest, running: string): string {
  let highest = '0.0.0';
  for (const { word } of installFloorWords(manifest)) {
    const floor = (WORD_FLOORS as Record<string, string | undefined>)[word];
    if (floor !== undefined && compareVersions(floor, highest) > 0) highest = floor;
  }
  const carriesConfig = manifest.pages.some((page) => page.envelope !== undefined || page.views !== undefined);
  return carriesConfig && compareVersions(running, highest) > 0 ? running : highest;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
