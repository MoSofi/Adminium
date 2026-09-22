// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `prepareValues` — what a stranger's POST actually becomes before it reaches
 * the operator's database.
 *
 * ── WHY THIS FILE DID NOT EXIST UNTIL NOW ──────────────────────────────────
 *
 * The function lived inside the route plugin, so exercising it meant composing
 * a server, a meta store, a connection, a scope row and a minted key. Nothing
 * did. The one function that decides what an anonymous caller may write had no
 * direct test, while the review said in as many words that this is
 * "security-critical new code [that] needs property tests, not unit tests".
 * It got a second
 * job — resolving `$generate` sentinels — which is when the absence stopped
 * being tolerable.
 *
 * The four rules it holds, in the order they matter:
 *
 *   1. NOTHING outside `writable` gets through, and a column that is not
 *      writable is a REFUSAL rather than a silent drop.
 *   2. `defaults` are applied AFTER the caller's values, so they are immutable
 *      rather than merely suggested.
 *   3. A `$generate` sentinel is resolved on create and dropped on update.
 *   4. The claim grant is written LAST, so neither a caller nor a default can
 *      make one visitor write as another.
 */

import { describe, expect, it } from 'vitest';

import type { PublicSessionContext } from '../src/public-api/claim.js';
import type { CompiledResource } from '../src/public-api/scope.js';
import { prepareValues } from '../src/public-api/values.js';

function resource(over: Partial<CompiledResource> = {}): CompiledResource {
  return {
    ref: 'conversation_messages',
    table: 'public.conversation_messages',
    actions: new Set(['read', 'create']),
    expose: ['id', 'author', 'sender_kind', 'body', 'created_at'],
    filterable: new Set(['created_at']),
    searchable: [],
    orderable: new Set(['created_at']),
    writable: new Set(['author', 'body']),
    defaults: {
      id: { $generate: 'uuid' },
      created_at: { $generate: 'now' },
      sender_kind: 'customer',
    },
    mandatory: null,
    claim: { column: 'conversation_id' },
    sensitive: false,
    limit: 100,
    defaultLimit: 100,
    defaultOrder: null,
    rate: null,
    response: { shape: 'wrapped' },
    count: 'none',
    ...over,
  };
}

const session = (value: unknown): PublicSessionContext => ({
  id: 'sess_1',
  keyId: 'key_1',
  grant: { ref: 'conversation', column: 'id', value },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('only writable columns survive', () => {
  it('lets the writable ones through', () => {
    const out = prepareValues(resource(), { author: 'Ada', body: 'hello' }, null, 'create', 'sqlite');
    expect(out?.['author']).toBe('Ada');
    expect(out?.['body']).toBe('hello');
  });

  it.each([
    ['id', 'a primary key the caller picked'],
    ['conversation_id', "somebody else's conversation"],
    ['sender_kind', 'a visitor posting as staff'],
    ['created_at', 'a backdated message'],
    ['internal_note', 'a column the scope never mentions'],
  ])('refuses `%s` outright — %s', (column) => {
    /*
     * A REFUSAL, NOT A DROP. Silently ignoring a field produces a row that is
     * not the one the caller asked for and gives them no way to find out.
     */
    expect(prepareValues(resource(), { body: 'x', [column]: 'v' }, null, 'create', 'sqlite')).toBeNull();
  });

  it('refuses a column that is merely defaulted, not writable', () => {
    // The acceptance criterion's own list: a visitor cannot set
    // `sender_kind`, and it is proved by SENDING it rather than by reading the
    // scope back.
    expect(
      prepareValues(resource(), { sender_kind: 'staff' }, null, 'create', 'sqlite'),
    ).toBeNull();
  });
});

describe('defaults overwrite whatever arrived', () => {
  it('stamps a literal default even when the column is writable', () => {
    // Unchanged, long-standing behaviour, pinned so the `$generate` work above
    // it cannot alter it by accident.
    const r = resource({ writable: new Set(['author', 'body', 'sender_kind']) });
    const out = prepareValues(r, { body: 'x', sender_kind: 'staff' }, null, 'create', 'sqlite');
    expect(out?.['sender_kind']).toBe('customer');
  });
});

describe('$generate resolves on create and never on update', () => {
  it('mints an id and an instant for a create', () => {
    const out = prepareValues(resource(), { body: 'hello' }, null, 'create', 'sqlite');
    expect(String(out?.['id'])).toMatch(UUID);
    expect(String(out?.['created_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('mints NOTHING for an update', () => {
    /*
     * The bug this rule exists to prevent: `defaults` have always been applied
     * on both paths, so a sentinel left in would hand the row a fresh primary
     * key and a fresh `created_at` on every PATCH a visitor makes — and a
     * visitor PATCHes their conversation on every message they send.
     */
    const out = prepareValues(resource(), { body: 'edited' }, null, 'update', 'sqlite');
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('created_at');
    // The literal default is unaffected: only the minted ones are dropped.
    expect(out?.['sender_kind']).toBe('customer');
  });

  it('shapes the instant for the dialect it was handed', () => {
    const pg = prepareValues(resource(), {}, null, 'create', 'postgres');
    const my = prepareValues(resource(), {}, null, 'create', 'mysql');
    expect(String(pg?.['created_at'])).toContain('T');
    expect(String(my?.['created_at'])).not.toContain('T');
    expect(String(my?.['created_at'])).not.toContain('Z');
  });
});

describe('the claim writes itself in, last', () => {
  it('supplies the claim column a caller may not set', () => {
    const out = prepareValues(resource(), { body: 'x' }, session('conv_7'), 'create', 'sqlite');
    expect(out?.['conversation_id']).toBe('conv_7');
  });

  it('beats a default that tried to set the same column', () => {
    /*
     * Order is the whole security property here: caller values, then defaults,
     * then the grant. A scope that (wrongly) defaulted the claim column would
     * otherwise pin every visitor's rows to one conversation.
     */
    const r = resource({ defaults: { conversation_id: 'conv_everyone', sender_kind: 'customer' } });
    const out = prepareValues(r, { body: 'x' }, session('conv_7'), 'create', 'sqlite');
    expect(out?.['conversation_id']).toBe('conv_7');
  });

  it('writes nothing extra for an unclaimed session on a claim-free resource', () => {
    const r = resource({ claim: null, defaults: {} });
    expect(prepareValues(r, { body: 'x' }, null, 'create', 'sqlite')).toEqual({ body: 'x' });
  });
});
