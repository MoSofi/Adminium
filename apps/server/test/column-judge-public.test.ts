// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILE COLUMN'S JUDGE ON A PUBLIC WRITE, on every meta engine: a public
 * write names only a guest's upload it holds, in the very table and column it
 * was held for, a stranger's file still alive and no record's yet, of a kind
 * and a size the column takes. A file id it does not hold, one held for
 * another column or table, a staff upload and a binned file are each refused
 * as `file-not-here`; a public write that holds nothing names nothing. A
 * held SVG is one the upload store cleaned: cleaned again, the bytes kept;
 * and so is an SVG a sample's add made (an import).
 */
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../src/crud/identifiers.js';
import { createFileColumnJudge } from '../src/files/column-judge.js';
import { cleanSvg } from '../src/files/svg.js';
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
    ['logo', { name: 'logo', file: file(['svg'], 1_000) }],
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

    it('takes a held SVG only when its bytes are the cleaner\'s own', async () => {
      const raw = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" class="x"><rect width="1" height="1"/></svg>', 'utf8');
      const cleaned = cleanSvg(raw);
      const stored = async (bytes: Buffer) =>
        (await filesRepo(meta).create({ filename: 'logo.svg', mime: 'image/svg+xml', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'stranger', uploadedBy: null })).id;
      const kept = await stored(cleaned);
      const uncleaned = await stored(raw);
      const bytes = new Map([
        [kept, cleaned],
        [uncleaned, raw],
      ]);
      const holds = new Map([kept, uncleaned].map((id) => [id, { table: LINES.id, column: 'logo' }]));
      const withBytes = (values: Record<string, unknown>) =>
        createFileColumnJudge({ meta, bytesOf: async (f) => bytes.get(f.id) }).judge({ connectionId: 'conn_1', table: LINES, origin: 'public', actor: { kind: 'public', id: null, label: 'public:key' }, values, stored: null, held: holds });
      expect(await withBytes({ logo: kept })).toBeNull();
      expect(await withBytes({ logo: uncleaned })).toEqual({ logo: { code: 'file-not-here' } });
      // Bytes that cannot be read: not taken.
      expect(await judge({ logo: kept }, holds)).toEqual({ logo: { code: 'file-not-here' } });
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

    it('takes a sample\'s SVG only when its bytes are the cleaner\'s own, as on every other door', async () => {
      const raw = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><rect width="1" height="1"/></svg>', 'utf8');
      const cleaned = cleanSvg(raw);
      const minted = async (bytes: Buffer) =>
        (await filesRepo(meta).create({ filename: 'logo.svg', mime: 'image/svg+xml', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'upload', uploadedBy: null, entityConnectionId: 'conn_1' })).id;
      const kept = await minted(cleaned);
      const uncleaned = await minted(raw);
      const bytes = new Map([
        [kept, cleaned],
        [uncleaned, raw],
      ]);
      const imported = (values: Record<string, unknown>, bytesOf?: (f: { id: string }) => Promise<Buffer | undefined>) =>
        createFileColumnJudge({ meta, bytesOf }).judge({ connectionId: 'conn_1', table: LINES, origin: 'import', actor: { kind: 'user', id: null, label: 'test' }, values, stored: null, minted: new Set([kept, uncleaned]) });
      const read = async (f: { id: string }) => bytes.get(f.id);
      expect(await imported({ logo: kept }, read)).toBeNull();
      expect(await imported({ logo: uncleaned }, read)).toEqual({ logo: { code: 'file-not-here' } });
      // Bytes that cannot be read: not taken.
      expect(await imported({ logo: kept })).toEqual({ logo: { code: 'file-not-here' } });
    });
  });
}
