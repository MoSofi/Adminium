// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test ledger add-on, as a package: its manifest, the file that decides
 * (`dist/server.js`, a classic script exactly as an add-on ships one), and
 * the app whose orders post into it. One fixture for the install's tests and
 * the write path's.
 *
 * The manifests start from the ones the manifest package's own tests check
 * (`ledger-kit-fixture.ts`) and add what a package needs beside them: a
 * settings row the deciding file reads, and stock words over the ledger.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEDGER, LEDGER_HOST, LEDGER_KIT } from '../../../../../packages/manifest/test/ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

/** The deciding file's bytes. */
export const LEDGER_KIT_SERVER = readFileSync(join(import.meta.dirname, 'dist', 'server.js'));

/** What the kit's ledger lets its code write, and the column that adds up to a balance. */
export const LEDGER_KIT_WRITES = LEDGER.writes;
export const LEDGER_KIT_SUMS = { entries: ['amount'] } as const;

/** The kit's one-row settings table: how its code is told to misbehave, and when a page may say how much is left. */
const SETTINGS = {
  ref: 'settings',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'misbehave', type: 'text', maxLength: 40, nullable: true },
    { ref: 'show_left_below', type: 'int', nullable: true },
    { ref: 'note', type: 'json', nullable: true },
  ],
};

/** The add-on's manifest, version 1.0.0. */
export function ledgerKitManifest(): Doc {
  const kit = structuredClone(LEDGER_KIT) as unknown as Doc & { addOn: Doc; requiredSchema: { tables: Doc[] } };
  kit.addOn = {
    ...kit.addOn,
    settingsTable: 'settings',
    words: [{ id: 'units-left', ledger: 'units', action: 'use', input: 'account', showLeftBelow: { setting: 'show_left_below' } }],
  };
  kit.requiredSchema.tables = [...kit.requiredSchema.tables, SETTINGS];
  return kit;
}

/** The app whose order lines and visits post into the kit's ledger. */
export function ledgerHostManifest(): Doc {
  return structuredClone(LEDGER_HOST) as unknown as Doc;
}

/** The package an install takes: the manifest and the file that decides. */
export function ledgerKitFiles(manifest: Doc = ledgerKitManifest()): Record<string, string> {
  return { 'manifest.json': JSON.stringify(manifest), 'dist/server.js': LEDGER_KIT_SERVER.toString('utf8') };
}
