// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public-scope consequence — 35-schema-authoring.md §6, 35-T07, §10
 * criterion 16.
 *
 * ─── The bug this file exists to keep fixed ────────────────────────────────
 *
 * Preflight's own comment calls this "the largest blast radius in the table: a
 * scope that stops compiling takes the whole KEY dark, not the scope." It was
 * also the only lookup in that file with no test, and it had **never fired for
 * a real scope**.
 *
 * `PublicScope.document` is declared `string` and the repo normalises it to
 * text whatever the store did — it is already JSON. The probe ran
 * `JSON.stringify` over it, producing the escaped form (`\"public.orders\"`),
 * so `document.includes('"public.orders"')` was always false. A live
 * publishable key read a table, the operator planned a drop, and the review
 * pane said nothing at all about the key going dark.
 *
 * Found by running §10 criterion 16 in a browser against a real key.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DdlStep } from '@adminium/engine';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  publicKeysRepo,
  publicScopesRepo,
  type MetaDb,
} from '@adminium/meta';

import { preflight } from '../src/schema-ddl/preflight.js';

let CONN = '';

const step = (over: Partial<DdlStep> & { id: string; kind: DdlStep['kind']; table: string }): DdlStep => ({
  column: null,
  hazard: 'irreversible',
  requiresSuperAdmin: true,
  summary: 's',
  rationale: 'r',
  consequences: [],
  dependsOn: [],
  outsideTransaction: false,
  refusal: null,
  ...over,
});

let meta: MetaDb;
let scopeId: string;

beforeAll(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  // A real connection row: `adminium_public_scopes.connection_id` is a foreign
  // key, and a scope that cannot exist is not the thing under test.
  const connection = await connectionsRepo(meta, {
    encrypt: (v: string) => v,
    decrypt: (v: string) => v,
  }).create({ name: 'demo', engine: 'postgres', introspectDsn: 'postgres://localhost/x' });
  CONN = connection.id;

  // A scope written exactly as the route writes one: the document as TEXT.
  const scope = await publicScopesRepo(meta).create({
    connectionId: CONN,
    side: 'customer',
    name: 'Storefront',
    timezone: 'Europe/Berlin',
    document: JSON.stringify({
      version: 1,
      side: 'customer',
      timezone: 'Europe/Berlin',
      resources: [
        { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'name'] },
      ],
    }),
    createdBy: null,
  });
  scopeId = scope.id;

  const keys = publicKeysRepo(meta);
  await keys.create({
    name: 'Website',
    prefix: 'adm_pub_aaaaaaaa',
    tokenHash: 'hash-a',
    tokenEncrypted: 'enc-a',
    scopeId,
    side: 'customer',
    origins: [],
  });
  const revoked = await keys.create({
    name: 'Old kiosk',
    prefix: 'adm_pub_bbbbbbbb',
    tokenHash: 'hash-b',
    tokenEncrypted: 'enc-b',
    scopeId,
    side: 'customer',
    origins: [],
  });
  await keys.revoke(revoked.id);
});

afterAll(async () => {
  await meta.db.destroy();
});

describe('dropping a table a public scope reads', () => {
  it('says public access will STOP, names the keys, and gives the 30-second window', async () => {
    const result = await preflight({
      meta,
      connectionId: CONN,
      steps: [step({ id: 'd1', kind: 'drop-table', table: 'public.menu_items' })],
    });
    const consequences = result.consequences.get('d1') ?? [];
    const scopeLines = consequences.filter((c) => c.kind === 'public-scope');
    expect(scopeLines.length).toBeGreaterThan(0);

    const headline = scopeLines[0]!;
    // STOP in capitals, because "may be affected" is the sentence that gets a
    // storefront taken down without anyone reading it.
    expect(headline.message).toContain('STOP');
    expect(headline.message).toContain('Storefront');
    // §6: the delay is per-instance and the operator has to plan around it.
    expect(headline.message).toContain('30 seconds');
    // The WHOLE key stops, not just the resource that named this table.
    expect(headline.message).toContain('WHOLE key');

    // The refs are KEY ids — a key is what was published and what has to be
    // replaced; a scope id is an internal handle.
    expect(headline.refs.every((ref) => ref.startsWith('pbk_'))).toBe(true);
    // One live key, and the revoked one is not counted: it stopped working
    // when it was revoked, and listing it would inflate the damage.
    expect(headline.refs).toHaveLength(1);
    expect(scopeLines.some((c) => c.message.includes('Website'))).toBe(true);
    expect(scopeLines.some((c) => c.message.includes('Old kiosk'))).toBe(false);
  });

  it('matches an UNQUALIFIED document too — SQLite scopes name the bare table', async () => {
    // `resourceSchema.table` is "physical schema.table" and postgres documents
    // qualify, but a SQLite connection has no schema to name, so the probe has
    // to try the bare name as well. Asserted with a document that writes one.
    const bare = await publicScopesRepo(meta).create({
      connectionId: CONN,
      side: 'customer',
      name: 'Kiosk',
      timezone: 'Europe/Berlin',
      document: JSON.stringify({
        version: 1,
        side: 'customer',
        timezone: 'Europe/Berlin',
        resources: [{ ref: 'menu', table: 'specials', actions: ['read'], expose: ['id'] }],
      }),
      createdBy: null,
    });

    const result = await preflight({
      meta,
      connectionId: CONN,
      steps: [step({ id: 'd2', kind: 'drop-table', table: 'main.specials' })],
    });
    const lines = (result.consequences.get('d2') ?? []).filter((c) => c.kind === 'public-scope');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]?.message).toContain('Kiosk');
    // No live key on this scope, so the refs fall back to the scope itself
    // rather than claiming zero keys are affected.
    expect(lines[0]?.refs).toEqual([bare.id]);
  });

  it('says nothing about a table no scope reads', async () => {
    const result = await preflight({
      meta,
      connectionId: CONN,
      steps: [step({ id: 'd3', kind: 'drop-table', table: 'public.internal_audit' })],
    });
    expect((result.consequences.get('d3') ?? []).some((c) => c.kind === 'public-scope')).toBe(false);
  });

  it('says nothing for a SAFE step — a scope is not affected by adding a column', async () => {
    const result = await preflight({
      meta,
      connectionId: CONN,
      steps: [
        step({ id: 'a1', kind: 'add-column', table: 'public.menu_items', column: 'note', hazard: 'safe', requiresSuperAdmin: false }),
      ],
    });
    expect((result.consequences.get('a1') ?? []).some((c) => c.kind === 'public-scope')).toBe(false);
  });
});
