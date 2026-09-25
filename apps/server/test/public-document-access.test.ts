// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which resources make a document a person's own, asked of the rule itself:
 * the cases no manifest can express (an entry with no claim cannot declare
 * documents) still have to answer "no", because an operator's hand-written
 * scope can.
 */
import { describe, expect, it } from 'vitest';

import type { PublicSessionContext } from '../src/public-api/claim.js';
import type { CompiledResource } from '../src/public-api/scope.js';
import { createDocumentAccess, decodeDocumentCursor, encodeDocumentCursor } from '../src/routes/public/documents.js';

const access = createDocumentAccess({ meta: {} as never, manager: {} as never, viewFor: () => Promise.resolve(null) });

const resource = (over: Partial<CompiledResource> = {}): CompiledResource =>
  ({
    ref: 'invoices_claimed',
    table: 'public.invoices',
    kind: 'records',
    actions: new Set(['read']),
    claim: { column: 'client_id', ref: 'clients_claimed' },
    level: 'lookup',
    ...over,
  }) as unknown as CompiledResource;

const session = (level: 'lookup' | 'verified' = 'lookup'): PublicSessionContext => ({
  id: 'pss_1',
  keyId: 'pbk_1',
  grant: { ref: 'clients_claimed', column: 'id', value: 7 },
  level,
});

describe('a person\'s own resource', () => {
  it('reads with a claim this session reaches', () => {
    expect(access.personal(resource(), session())).toBe(true);
  });

  it('is never a resource with no claim: its rows are everybody\'s', () => {
    expect(access.personal(resource({ claim: null }), session())).toBe(false);
  });

  it('is not one opened through another identity', () => {
    expect(access.personal(resource({ claim: { column: 'client_id', ref: 'staff_claimed' } as never }), session())).toBe(false);
  });

  it('asks a confirmed session where the resource asks one', () => {
    expect(access.personal(resource({ level: 'verified' }), session('lookup'))).toBe(false);
    expect(access.personal(resource({ level: 'verified' }), session('verified'))).toBe(true);
  });

  it('is a readable resource of rows', () => {
    expect(access.personal(resource({ actions: new Set(['create']) as never }), session())).toBe(false);
    expect(access.personal(resource({ kind: 'availability' }), session())).toBe(false);
  });
});

describe('the list\'s cursor', () => {
  it('round-trips, and a cursor it never gave out is refused rather than read', () => {
    const cursor = encodeDocumentCursor({ createdAt: 1_790_000_000_000, id: 'doc_1' });
    expect(decodeDocumentCursor(cursor)).toEqual({ createdAt: 1_790_000_000_000, id: 'doc_1' });
    expect(decodeDocumentCursor(undefined)).toBeUndefined();
    expect(decodeDocumentCursor('bm90IGpzb24')).toBeNull();
    expect(decodeDocumentCursor(Buffer.from(JSON.stringify(['x', 1])).toString('base64url'))).toBeNull();
  });
});
