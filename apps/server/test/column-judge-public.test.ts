// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILE COLUMN'S JUDGE ON A PUBLIC WRITE, on every meta engine: a public
 * write names only a guest's upload it holds, in the very table and column it
 * was held for, a stranger's file still alive and no record's yet, of a kind
 * and a size the column takes. A file id it does not hold, one held for
 * another column or table, a staff upload and a binned file are each refused
 * as `file-not-here`; a public write that holds nothing names nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../src/crud/identifiers.js';
import { createFileColumnJudge } from '../src/files/column-judge.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const file = (accept: string[], maxBytes: number) => ({ accept, maxBytes });

/** A table of order lines with two file columns: the artwork, and a proof. */
const LINES = {
  id: 'public.shop_order_lines',
  schema: 'public',
  name: 'shop_order_lines',
  primaryKey: ['id'],
  readOnly: false,
  columns: new Map([
    ['id', { name: 'id' }],
    ['artwork', { name: 'artwork', file: file(['pdf', 'png'], 1_000) }],
    ['proof', { name: 'proof', file: file(['pdf'], 1_000) }],
  ]),
} as unknown as ResolvedTable;

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the file column's judge on a public write — ${engine.name}`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
    });
    afterEach(async () => {
      await handle.destroy();
    });

    const made = async (over: { kind?: 'stranger' | 'upload'; mime?: string; size?: number } = {}) =>
      (await filesRepo(meta).create({ filename: 'a.pdf', mime: over.mime ?? 'application/pdf', sizeBytes: over.size ?? 100, sha256: 'f'.repeat(64), kind: over.kind ?? 'stranger', uploadedBy: null })).id;

    const judge = (values: Record<string, unknown>, held?: ReadonlyMap<string, { table: string; column: string }>) =>
      createFileColumnJudge({ meta }).judge({ connectionId: 'conn_1', table: LINES, origin: 'public', actor: { kind: 'public', id: null, label: 'public:key' }, values, stored: null, held });

    it('takes a held upload in its own table and column, and nothing else', async () => {
      const artwork = await made();
      const holds = new Map([[artwork, { table: LINES.id, column: 'artwork' }]]);
      expect(await judge({ artwork }, holds)).toBeNull();
      // Held for the artwork, named as the proof.
      expect(await judge({ proof: artwork }, holds)).toEqual({ proof: { code: 'file-not-here' } });
      // Held for another table's column of the same name.
      expect(await judge({ artwork }, new Map([[artwork, { table: 'public.shop_orders', column: 'artwork' }]]))).toEqual({ artwork: { code: 'file-not-here' } });
      // Not held by this write at all, or no holds.
      expect(await judge({ artwork }, new Map())).toEqual({ artwork: { code: 'file-not-here' } });
      expect(await judge({ artwork })).toEqual({ artwork: { code: 'file-not-here' } });
    });

    it('refuses a staff upload, a binned file, a kind and a size the column does not take', async () => {
      const staff = await made({ kind: 'upload' });
      const binned = await made();
      await filesRepo(meta).markDeleted(binned);
      const picture = await made({ mime: 'image/jpeg' });
      const large = await made({ size: 5_000 });
      const holds = new Map([staff, binned, picture, large].map((id) => [id, { table: LINES.id, column: 'artwork' }]));
      expect(await judge({ artwork: staff }, holds)).toEqual({ artwork: { code: 'file-not-here' } });
      expect(await judge({ artwork: binned }, holds)).toEqual({ artwork: { code: 'file-not-here' } });
      expect(await judge({ artwork: picture }, holds)).toEqual({ artwork: { code: 'file-type' } });
      expect(await judge({ artwork: large }, holds)).toEqual({ artwork: { code: 'file-too-large', n: 1_000 } });
    });
  });
}
