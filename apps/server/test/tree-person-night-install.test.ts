// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The vocabulary for a create that carries its child rows, a person found by
 * address, a row's own link, a read for a signed-in guest alone, prices by
 * the night, copies that follow, totals that count, days between dates and a
 * joined name — installed through the real installer on every engine, then
 * read back from each place install writes it and compared exactly:
 *
 *  - the column rules, from the override store and as the schema resolves them;
 *  - the public endpoints, from their stored text (printed and parsed again);
 *  - the key's derived scope, compiled, and what `/public/config` answers.
 *
 * Nothing here runs the rules: a later build does. Each is only kept.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest } from '@adminium/manifest';
import { overridesRepo, publicEndpointsRepo, publicScopesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { endpointIssues, parseDefinition, printDefinition, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { compileScope, publicConfigOf } from '../src/public-api/scope.js';
import { publicConfigReply } from '../src/routes/public/schema.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { EXTRAS_CHILD, lodgeManifest, PER_NIGHT } from './tree-person-night-fixture.js';

// The rules stored here run in later changes; until then the server refuses
// their tables and suspends their entries. This file proves what is stored
// and served once they run, so the refusal is lifted for it alone.
vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  unbuiltEntryRuleOf: () => null,
  refuseUnbuiltTable: () => undefined,
}));

describe('the app', () => {
  it('validates with every new field', () => {
    const result = validateManifest(lodgeManifest());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)('the vocabulary, kept through install on %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  /** The snapshot id of one of the app's tables. */
  let idOf: (ref: string) => string;
  let endpoints: Map<string, PublicEndpointDefinition & { text: string }>;
  /** The schema as the endpoint checks read it, with `extra` rules laid over the installed ones. */
  let viewWith: (extra?: { op: string; table: string; column: string; value: unknown }[]) => Promise<SnapshotView>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, lodgeManifest());
    const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
    const model = parseDatabaseModel(snapshot.schema);
    idOf = (ref) => model.tables.find((t) => t.name === h!.real(ref))!.id;
    viewWith = async (extra = []) => {
      const overrides = await overridesRepo(h!.meta).listForConnection(h!.connectionId, { status: 'active' });
      const more = extra.map((rule, n) => ({ ...overrides[0]!, id: `extra_${String(n)}`, op: rule.op, tableName: idOf(rule.table), columnName: rule.column, value: rule.value }));
      return new SnapshotView(h!.connectionId, applyOverrides(model, [...overrides, ...more] as typeof overrides), new Map());
    };
    endpoints = new Map();
    for (const row of await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)) {
      const parsed = parseDefinition(row.definition);
      if (parsed.ok) endpoints.set(row.ref, { ...parsed.definition, text: row.definition });
    }
  }, 180_000);
  afterAll(async () => h?.close());

  /** The one stored endpoint whose definition passes `test`. */
  const endpoint = (test: (d: PublicEndpointDefinition) => boolean) => {
    const found = [...endpoints.values()].filter(test);
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  it.skipIf(!available)('keeps each new column rule in the store, and resolves it', async () => {
    const overrides = await overridesRepo(h!.meta).listForConnection(h!.connectionId, { status: 'active' });
    const rule = (table: string, column: string, op: string) => overrides.find((o) => o.tableName === idOf(table) && o.columnName === column && o.op === op)?.value;
    expect(rule('stays', 'room_total', 'column.perNight')).toEqual({ ...PER_NIGHT, adjust: { ...PER_NIGHT.adjust, table: idOf('rate_rules') } });
    expect(rule('stays', 'extra_count', 'column.rollup')).toEqual({ from: idOf('stay_extras'), via: 'stay_id', count: true });
    expect(rule('stay_extras', 'nights', 'column.copy')).toEqual({ via: 'stay_id', from: 'nights', mode: 'always', follow: true });
    expect(rule('stays', 'nights', 'column.formula')).toEqual({ formula: { daysBetween: ['arrive', 'depart'] } });
    expect(rule('stays', 'reference', 'column.formula')).toEqual({ formula: { join: ['ref_prefix', '-', 'ref_code'] } });

    const snapshot = (await snapshotsRepo(h!.meta).latest(h!.connectionId))!;
    const effective = applyOverrides(parseDatabaseModel(snapshot.schema), overrides);
    const column = (table: string, name: string) => effective.tables.find((t) => t.id === idOf(table))!.columns.find((c) => c.name === name)!;
    expect(column('stays', 'room_total').perNight).toEqual({ ...PER_NIGHT, adjust: { ...PER_NIGHT.adjust, table: idOf('rate_rules') } });
    expect(column('stays', 'extra_count').rollup).toEqual({ from: idOf('stay_extras'), via: 'stay_id', count: true });
    expect(column('stay_extras', 'guests').copy).toEqual({ via: 'stay_id', from: 'guests', mode: 'always', follow: true });
    expect(column('stays', 'nights').formula).toEqual({ daysBetween: ['arrive', 'depart'] });
  });

  it.skipIf(!available)('keeps a create\'s child rows, checks, dry run, price check, retry key and found person in the stored endpoint', () => {
    const create = endpoint((d) => d.methods.includes('POST') && d.source === idOf('stays'));
    // The stored text is the canonical print: parsing and printing again changes nothing.
    expect(printDefinition(create)).toBe(create.text);
    const identity = endpoint((d) => d.identity?.strategy === 'email-link');
    expect(create.children).toEqual({
      stay_extras: {
        source: idOf('stay_extras'),
        via: 'stay_id',
        writable: ['extra_id', 'note'],
        select: ['id', 'amount'],
        position: 'position',
        min: 0,
        max: 10,
        agrees: EXTRAS_CHILD.agrees,
        counts: EXTRAS_CHILD.counts,
        plain_text: ['note'],
        sum_max: { column: 'amount', max: { table: idOf('settings'), column: 'max_items' } },
        children: { stay_extra_notes: { source: idOf('stay_extra_notes'), via: 'stay_extra_id', writable: ['text'], max: 3, plain_text: ['text'] } },
      },
    });
    expect(create.agrees).toEqual([{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }]);
    expect([create.dry_run, create.expect, create.client_key]).toEqual([true, 'total', 'client_key']);
    expect(create.find_or_create).toEqual({ identity_ref: [...endpoints].find(([, d]) => d === identity)![0], email: 'email', link: 'customer_id', fill: { name: 'last_name' } });
    expect(create.share_link).toEqual({ column: 'link_token', key: 'link' });
  });

  it.skipIf(!available)('keeps the own link, forgetting, a change\'s dry run and a read for a session alone', () => {
    const own = endpoint((d) => d.identity?.strategy === 'token');
    expect(own.identity).toEqual({ strategy: 'token', match: ['link_token'], column: 'id', stopped: 'link_stopped', own: true });
    expect([own.level, own.dry_run, own.expect]).toEqual(['verified', true, 'total']);
    expect(printDefinition(own)).toBe(own.text);
    const identity = endpoint((d) => d.identity?.strategy === 'email-link');
    expect(identity.forget).toEqual({ columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' });
    const settings = endpoint((d) => d.source === idOf('settings'));
    expect([settings.session_only, settings.level, settings.auth.role]).toEqual([true, 'verified', 'authenticated']);
    expect(printDefinition(settings)).toBe(settings.text);
  });

  it.skipIf(!available)('refuses, by name, what the live schema says a tree or a found person may not do', async () => {
    const view = await viewWith();
    const create = endpoint((d) => d.methods.includes('POST') && d.source === idOf('stays'));
    const ref = [...endpoints].find(([, d]) => d === create)![0];
    const codes = (change: (d: PublicEndpointDefinition) => void, v: SnapshotView = view) => {
      const d = structuredClone(create) as PublicEndpointDefinition & { text?: string };
      delete d.text;
      change(d);
      return endpointIssues(d, { ref, view: v }).map((i) => i.code);
    };
    expect(codes(() => undefined)).toEqual([]);
    const extras = (d: PublicEndpointDefinition) => d.children!['stay_extras']!;
    expect(codes((d) => (extras(d).via = 'extra_id'))).toContain('ENDPOINT_CHILD_VIA_NOT_PARENT');
    expect(codes((d) => extras(d).writable.push('each'))).toContain('ENDPOINT_CHILD_WRITABLE_DECIDED');
    expect(codes((d) => extras(d).writable.push('amount'))).toContain('ENDPOINT_CHILD_WRITABLE_DECIDED');
    expect(codes((d) => (extras(d).select = ['id', 'nope']))).toContain('ENDPOINT_CHILD_SELECT_UNKNOWN');
    expect(codes((d) => (extras(d).source = 'main.nope'))).toContain('ENDPOINT_CHILD_UNKNOWN');
    expect(codes((d) => (extras(d).children!['stay_extra_notes']!.source = idOf('stays')))).toContain('ENDPOINT_CHILD_TWICE');
    expect(codes((d) => (extras(d).min = 20))).toContain('ENDPOINT_CHILD_ROWS');
    expect(codes((d) => (extras(d).agrees![0]!.eq = { parent: 'nope' }))).toContain('ENDPOINT_CHILD_AGREES_PATH');
    expect(codes((d) => (extras(d).counts![0]!.by = ['note']))).toContain('ENDPOINT_CHILD_COUNTS');
    expect(codes((d) => d.methods.push('BATCH'))).toContain('ENDPOINT_CHILDREN_NO_CREATE');
    // A batch creates its rows one by one: a retry key, a price check or an agreement on it would never run.
    const batched = (d: PublicEndpointDefinition) => {
      delete d.children;
      delete d.client_key;
      delete d.expect;
      delete d.agrees;
      d.methods.push('BATCH');
    };
    expect(codes(batched)).not.toContain('ENDPOINT_CHILDREN_NO_CREATE');
    expect(codes((d) => [batched(d), (d.client_key = 'client_key')])).toContain('ENDPOINT_CHILDREN_NO_CREATE');
    expect(codes((d) => [batched(d), (d.expect = 'total')])).toContain('ENDPOINT_CHILDREN_NO_CREATE');
    expect(codes((d) => [batched(d), (d.agrees = [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }])])).toContain('ENDPOINT_CHILDREN_NO_CREATE');
    expect(codes((d) => delete d.human_check)).toContain('ENDPOINT_CHILDREN_NEED_PROOF');
    expect(codes((d) => (d.expect = 'note'))).toContain('ENDPOINT_EXPECT_COLUMN');
    expect(codes((d) => d.select.push('client_key'))).toContain('ENDPOINT_CLIENT_KEY');
    expect(codes((d) => d.select.push('customer_id'))).toContain('ENDPOINT_FIND_OR_CREATE_SHAPE');
    expect(codes((d) => d.methods.push('PATCH'))).toContain('ENDPOINT_FIND_OR_CREATE_SHAPE');
    expect(codes((d) => (d.share_link = { column: 'note', key: 'link' }))).toContain('ENDPOINT_SHARE_LINK_NOT_A_CODE');
    // Nothing on the creating table reads the found person, however the rule got there.
    const reading = await viewWith([{ op: 'column.copy', table: 'stays', column: 'note', value: { via: 'customer_id', from: 'phone' } }]);
    expect(codes(() => undefined, reading)).toContain('SCOPE_FIND_OR_CREATE_READS_PERSON');

    const settings = endpoint((d) => d.source === idOf('settings'));
    const settingsRef = [...endpoints].find(([, d]) => d === settings)![0];
    const withPost = { ...structuredClone(settings), methods: ['GET', 'POST'] } as PublicEndpointDefinition;
    delete (withPost as { text?: string }).text;
    expect(endpointIssues(withPost, { ref: settingsRef, view }).map((i) => i.code)).toContain('ENDPOINT_SESSION_ONLY_READS');
    const person = endpoint((d) => d.identity?.strategy === 'email-link');
    const personRef = [...endpoints].find(([, d]) => d === person)![0];
    const forgetsKey = { ...structuredClone(person), forget: { columns: ['id', 'email'] } } as PublicEndpointDefinition;
    delete (forgetsKey as { text?: string }).text;
    expect(endpointIssues(forgetsKey, { ref: personRef, view }).map((i) => i.code)).toContain('SCOPE_FORGET_COLUMN');
  });

  it.skipIf(!available)('carries them into each key\'s derived scope, and says the tree in /public/config', async () => {
    const scopes = await publicScopesRepo(h!.meta).listByConnection(h!.connectionId);
    const compiled = scopes.map((scope) => compileScope(JSON.parse(scope.document), undefined, { timezone: 'UTC' }, { derived: true }));
    const customer = compiled.find((scope) => scope.claim?.strategy === 'email-link')!;
    const link = compiled.find((scope) => scope.claim?.strategy === 'token')!;
    expect(link.claim?.own).toBe(true);
    const create = [...customer.byRef.values()].find((r) => r.actions.has('create') && r.table === idOf('stays'))!;
    expect(Object.fromEntries(create.children!)).toEqual({
      stay_extras: {
        table: idOf('stay_extras'),
        via: 'stay_id',
        writable: ['extra_id', 'note'],
        select: ['id', 'amount'],
        position: 'position',
        min: 0,
        max: 10,
        agrees: EXTRAS_CHILD.agrees,
        counts: EXTRAS_CHILD.counts,
        plainText: ['note'],
        sumMax: { column: 'amount', max: { table: idOf('settings'), column: 'max_items' } },
        children: { stay_extra_notes: { table: idOf('stay_extra_notes'), via: 'stay_extra_id', writable: ['text'], max: 3, plainText: ['text'] } },
      },
    });
    expect([create.dryRun, create.expect, create.clientKey, create.agrees]).toEqual([true, 'total', 'client_key', [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }]]);
    expect(create.findOrCreate).toMatchObject({ email: 'email', link: 'customer_id', fill: { name: 'last_name' } });
    expect(create.shareLink).toEqual({ column: 'link_token', key: 'link' });
    const settings = [...customer.byRef.values()].find((r) => r.table === idOf('settings'))!;
    expect(settings.sessionOnly).toBe(true);
    const person = [...customer.byRef.values()].find((r) => r.ref === customer.claim!.ref)!;
    expect(person.forget).toEqual({ columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' });

    // The config answer names the tree by the wire's names, and never a real table.
    const config = publicConfigReply.parse({ data: { ...publicConfigOf(customer), now: new Date().toISOString() } }).data;
    expect(config.refs[create.ref]!.children).toEqual({
      stay_extras: { writable: ['extra_id', 'note'], select: ['id', 'amount'], max: 10, children: { stay_extra_notes: { writable: ['text'], select: [], max: 3 } } },
    });
    expect(config.refs[create.ref]!.dryRun).toBe(true);
  });
});
