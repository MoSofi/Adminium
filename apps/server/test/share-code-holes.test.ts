// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT KEEPS A SECRET ONE — the rules a share code's `secret: false` was
 * never meant to open, on every engine this run can reach.
 *
 * An app may show a column only on a table its install created: a
 * `secret: false` (or anything else that would show a secret, or take a
 * personal column's mask off) on a table it reuses — an operator's `users`
 * with its `api_token` — is skipped, with a sentence. A `code` rule never
 * shows a column by itself; the code a shared link opens a row with is shown
 * to staff because the install says so, on its own table. The operator's own
 * word wins over an app's either way, and a copy of a row kept for other
 * readers (the audit log, Workflow Logs) carries no code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overridesRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { CODE_CHANGED, CODE_KEPT, keptImages, keptRow } from '../src/crud/mask.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { triggerSummary } from '../src/automations/trace.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

/** A table of guessed secrets, as introspection leaves it: `share_token`, `api_token`, `card_token`, and a harmless `name`. */
function model() {
  const column = (name: string, i: number, secret: boolean) => ({
    name,
    ordinal: i + 1,
    dbType: 'text',
    logicalType: 'text',
    nullable: true,
    default: null,
    isPrimaryKey: name === 'id',
    isUnique: false,
    isGenerated: false,
    enumRef: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    isArray: false,
    comment: null,
    references: null,
    semantics: secret
      ? { primary: 'secret', flags: { secret: true, pii: null, maskedByDefault: true }, format: null, pair: null, confidence: 0.95, source: 'heuristic' }
      : { primary: 'plain', flags: { secret: false, pii: null, maskedByDefault: false }, format: null, pair: null, confidence: 0.5, source: 'heuristic' },
  });
  return {
    irVersion: 1,
    dialect: 'postgres',
    source: { kind: 'live', connectionId: 'c' },
    name: 'c',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [
      {
        id: 'public.projects',
        schema: 'public',
        name: 'projects',
        kind: 'table',
        comment: null,
        primaryKey: ['id'],
        columns: [column('id', 0, false), column('name', 1, false), column('share_token', 2, true), column('api_token', 3, true), column('ref_code', 4, false)],
      },
    ],
    relations: [],
    enums: [],
  };
}
let seq = 0;
const row = (op: string, columnName: string, value: Record<string, unknown>, origin = 'app') => {
  seq += 1;
  return { id: `ovr_${String(seq)}`, connectionId: 'c', op, tableName: 'public.projects', columnName, value, origin, status: 'active', llmRunId: null, createdAt: seq, updatedAt: seq } as never;
};
const secretOf = (rows: never[], column: string) => applyOverrides(model() as never, rows).tables[0]!.columns.find((c) => c.name === column)!.semantics!.flags.secret;

describe('what makes a column readable', () => {
  it('is never a code rule: a code a studio made for itself stays a secret when its name says so', () => {
    // An operator's code rule on a column introspection guessed a secret, as a Studio save writes it.
    const rows = [row('column.pii', 'share_token', { masked: true }, 'auto'), row('column.code', 'share_token', { length: 16 }, 'user')];
    expect(secretOf(rows, 'share_token')).toBe(true);
    // An app's own code rule says no more.
    expect(secretOf([row('column.code', 'share_token', { length: 16 })], 'share_token')).toBe(true);
    // Said outright, it is shown.
    expect(secretOf([row('column.code', 'share_token', { length: 16 }), row('column.secret', 'share_token', { secret: false })], 'share_token')).toBe(false);
  });

  it('is the operator’s word over an app’s, in whichever order the rows were written', () => {
    // The operator tagged it a secret; an app installed later says it is none.
    expect(secretOf([row('column.semanticType', 'api_token', { semanticType: 'secret' }, 'user'), row('column.secret', 'api_token', { secret: false })], 'api_token')).toBe(true);
    // The operator said `secret: true`; an app's later `false` does not take it back.
    expect(secretOf([row('column.secret', 'share_token', { secret: true }, 'user'), row('column.secret', 'share_token', { secret: false })], 'share_token')).toBe(true);
    // And the operator may show one an app hides (Studio asks Super Admin for that).
    expect(secretOf([row('column.secret', 'share_token', { secret: true }), row('column.secret', 'share_token', { secret: false }, 'user')], 'share_token')).toBe(false);
  });
});

describe('a copy of a row kept for other readers', () => {
  const view = new SnapshotView('c', applyOverrides(model() as never, [row('column.code', 'ref_code', { length: 6 }), row('column.code', 'share_token', { length: 16 }), row('column.secret', 'share_token', { secret: false })]));
  const table = view.table('public.projects');

  it('says a code is there, and whether the write changed it — never the code', () => {
    const before = { id: 1, name: 'Harbour', share_token: 'ABCDEFGHJKMNPQRS', ref_code: 'ABC123', api_token: 'hidden' };
    const after = { ...before, share_token: 'ZYXWVUTSRQPNMKJH' };
    const kept = keptImages(table, before, after);
    expect(kept.before).toEqual({ id: 1, name: 'Harbour', share_token: CODE_KEPT, ref_code: CODE_KEPT });
    expect(kept.after).toEqual({ id: 1, name: 'Harbour', share_token: CODE_CHANGED, ref_code: CODE_KEPT });
    expect(JSON.stringify(kept)).not.toMatch(/ABCDEFGHJKMNPQRS|ZYXWVUTSRQPNMKJH|ABC123/);
    // A create, a delete, an empty code.
    expect(keptImages(table, null, after).after!['share_token']).toBe(CODE_KEPT);
    expect(keptRow({ id: 2, share_token: null, ref_code: '' }, table)).toEqual({ id: 2, share_token: null, ref_code: '' });
  });

  it('is never recognised in Workflow Logs by its code', () => {
    expect(triggerSummary(table, { id: 1, share_token: 'ABCDEFGHJKMNPQRS', name: 'Harbour', ref_code: 'ABC123' })).toBe('Harbour');
  });
});

/*
 * ─── Through the real installer ───────────────────────────────────────────
 */

const OPERATORS_TOKEN = 'tok_live_9f8e7d6c5b4a';

function reusingManifest(): Record<string, unknown> {
  return invoicingManifest([
    // The operator's own table, which the app reuses: its secrets are theirs.
    {
      ref: 'users',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254 },
        { ref: 'api_token', type: 'text', maxLength: 64, nullable: true, rules: { secret: false } },
        { ref: 'reset_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } },
      ],
    },
    // A table the install makes: the app may say what its own columns are.
    {
      ref: 'notes',
      columns: [
        id,
        { ref: 'body', type: 'text', maxLength: 200, nullable: true },
        { ref: 'hint_token', type: 'text', maxLength: 40, nullable: true, rules: { secret: false } },
        // A code of the app's own that no shared link opens, and that says nothing: a secret, by its name.
        { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } },
      ],
    },
  ]);
}

describe.each(LEGS)('an app that reuses a table with secrets — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, reusingManifest(), undefined, {}, {
      prepare: async (run) => {
        await run(`CREATE TABLE studio_users (id integer PRIMARY KEY, email varchar(254) NOT NULL, api_token varchar(64), reset_token varchar(16))`);
        await run(`INSERT INTO studio_users (id, email, api_token) VALUES (1, 'ops@studio.dev', '${OPERATORS_TOKEN}')`);
      },
      choices: { users: { action: 'reuse' } },
    });
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('keeps them secret, and says which rule it skipped and why', async () => {
    const { view, targetOf } = await writerFor(h);
    const users = targetOf('users').table;
    expect(users.columns.get('api_token')!.secret).toBe(true);
    expect(users.columns.get('reset_token')!.secret).toBe(true);
    expect(view.selectableColumns(users).map((c) => c.name)).toEqual(['id', 'email']);
    const skipped = (h.reply['rules'] as { skipped: { column: string; op: string; reason: string }[] }).skipped;
    expect(skipped).toContainEqual({
      table: users.id,
      column: 'api_token',
      op: 'column.secret',
      reason: `It would show "${h.real('users')}.api_token", which is kept from readers, on a table that was here before the app: only an operator can show it, in Studio, as Super Admin.`,
    });
    // Nothing of the app's says otherwise in the store.
    const secrets = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.secret' && o.tableName === users.id);
    expect(secrets).toEqual([]);
    // And the check step says so before an install or an update.
    const plan = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.0', connectionId: h.connectionId, choices: { users: { action: 'reuse' } } } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect((plan.json() as { plan: { ruleWarnings?: unknown[] } }).plan.ruleWarnings).toEqual([
      { table: 'users', column: 'api_token', message: expect.stringContaining('only an operator can show it') },
    ]);
  });

  it.skipIf(!available)('shows a column of a table it made when the app says so, and never by a code rule alone', async () => {
    const notes = (await writerFor(h)).targetOf('notes').table;
    expect(notes.columns.get('hint_token')!.secret).toBe(false);
    expect(notes.columns.get('share_token')!.secret).toBe(true);
  });
});
