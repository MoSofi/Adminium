// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ticket sent to a friend, as a box office's manifest writes it: the
 * addresses a ticket's own link may be emailed to, and the columns the buyer
 * no longer reads once the ticket is someone else's — installed through the
 * real installer on every engine, then read back from each place install
 * writes them and compared exactly:
 *
 *  - the public endpoints, from their stored text (printed and parsed again);
 *  - each key's derived scope: the own link's addresses carried into its
 *    claim, and every entry that withholds columns served.
 *
 * Nothing here runs the rules (`public-ticket-transfer.test.ts` does): each is only kept.
 */
import { readFileSync } from 'node:fs';

import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest } from '@adminium/manifest';
import { overridesRepo, publicEndpointsRepo, publicScopesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { deriveScopeDocument } from '../src/public-api/derive.js';
import { definitionToResource, endpointIssues, parseDefinition, printDefinition, sourceTable, type PublicEndpointDefinition, type PublicMethod } from '../src/public-api/endpoint.js';
import { compileScope, type PublicScopeDocument } from '../src/public-api/scope.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

const FIXTURE = new URL('../../../packages/manifest/test/fixtures/ticket-transfer.manifest.json', import.meta.url);
const transferManifest = (): Doc => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;

describe('the box office', () => {
  it('validates', () => {
    const result = validateManifest(transferManifest());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)('a ticket sent to a friend, kept through install on %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let idOf: (ref: string) => string;
  let view: SnapshotView;
  let endpoints: Map<string, { id: string; definition: PublicEndpointDefinition; text: string }>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, transferManifest());
    const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
    const model = parseDatabaseModel(snapshot.schema);
    idOf = (ref) => model.tables.find((t) => t.name === h!.real(ref))!.id;
    const overrides = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
    view = new SnapshotView(h.connectionId, applyOverrides(model, overrides), new Map());
    endpoints = new Map();
    for (const row of await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)) {
      const parsed = parseDefinition(row.definition);
      expect(parsed.ok, row.definition).toBe(true);
      if (parsed.ok) endpoints.set(row.ref, { id: row.id, definition: parsed.definition, text: row.definition });
    }
  }, 180_000);
  afterAll(async () => h?.close());

  /** The one stored endpoint whose definition passes `test`, with its ref. */
  const endpoint = (test: (d: PublicEndpointDefinition) => boolean) => {
    const found = [...endpoints].filter(([, e]) => test(e.definition));
    expect(found).toHaveLength(1);
    const [ref, e] = found[0]!;
    return { ref, ...e };
  };
  const ticketLink = () => endpoint((d) => d.identity?.strategy === 'token' && d.source === idOf('tickets'));
  const orderLink = () => endpoint((d) => d.identity?.strategy === 'token' && d.source === idOf('orders'));
  const buyerTickets = () => endpoint((d) => d.source === idOf('tickets') && d.visible_with !== undefined && d.methods.includes('PATCH'));
  const linkTickets = () => endpoint((d) => d.source === idOf('tickets') && d.visible_with !== undefined && !d.methods.includes('PATCH'));

  it.skipIf(!available)('installs with every rule kept', async () => {
    const rules = h!.reply['rules'] as { skipped: unknown[] };
    expect(rules.skipped, JSON.stringify(rules.skipped)).toEqual([]);
    const stored = await overridesRepo(h!.meta).listForConnection(h!.connectionId, { status: 'active' });
    const rule = (op: string, table: string, column: string | null) => stored.find((o) => o.op === op && o.tableName === idOf(table) && o.columnName === column)?.value;
    expect(rule('column.code', 'tickets', 'code')).toEqual({ length: 12, renew: { on: { column: 'holder_customer_id', changed: true } } });
    expect(rule('column.stamp', 'tickets', 'holder_email')).toEqual({ set: { copy: 'pending_email' }, on: { columns: ['holder_customer_id'] } });
    expect((rule('table.states', 'tickets', null) as { timed?: unknown }).timed).toEqual([{ from: 'offered', to: 'valid', at: { column: 'offer_until' } }]);
  });

  it.skipIf(!available)('keeps the addresses an own link may be emailed to, in the stored text', () => {
    const ticket = ticketLink();
    expect(ticket.definition.identity).toEqual({ strategy: 'token', match: ['link_token'], column: 'id', own: true, address: ['pending_email', 'holder_email'] });
    // The stored text is the canonical print: parsing and printing again changes nothing.
    expect(printDefinition(ticket.definition)).toBe(ticket.text);
    expect(JSON.parse(ticket.text).identity.address).toEqual(['pending_email', 'holder_email']);
    // One column is kept as a list of one.
    const order = orderLink();
    expect(order.definition.identity?.address).toEqual(['email']);
    expect(printDefinition(order.definition)).toBe(order.text);
    // The friend's accept finds their person by the address the link went to.
    expect(ticket.definition.find_or_create).toMatchObject({ email: 'pending_email', link: 'holder_customer_id' });
  });

  it.skipIf(!available)('keeps the columns withheld from rows read through a parent, in the stored text', () => {
    for (const tickets of [buyerTickets(), linkTickets()]) {
      expect(tickets.definition.withhold).toEqual({ columns: ['code', 'holder_email'], unless_holder: 'holder_customer_id' });
      expect(printDefinition(tickets.definition)).toBe(tickets.text);
      expect(JSON.parse(tickets.text).withhold).toEqual({ columns: ['code', 'holder_email'], unless_holder: 'holder_customer_id' });
    }
  });

  it.skipIf(!available)('checks them against the live schema, by name', () => {
    const codes = (from: { ref: string; definition: PublicEndpointDefinition }, change: (d: PublicEndpointDefinition) => void) => {
      const d = structuredClone(from.definition);
      change(d);
      return endpointIssues(d, { ref: from.ref, view }).map((issue) => issue.code);
    };
    const ticket = ticketLink();
    expect(codes(ticket, () => undefined)).toEqual([]);
    expect(codes(ticket, (d) => delete d.identity!.own)).toContain('ENDPOINT_OWN_ADDRESS_SHAPE');
    expect(codes(ticket, (d) => (d.identity!.address = ['pending_email', 'pending_email']))).toContain('ENDPOINT_OWN_ADDRESS_SHAPE');
    expect(codes(ticket, (d) => (d.identity!.address = ['nope']))).toContain('ENDPOINT_COLUMN_UNKNOWN');
    expect(codes(ticket, (d) => (d.identity!.address = ['offer_until']))).toContain('ENDPOINT_OWN_ADDRESS_SHAPE');
    expect(codes(ticket, (d) => (d.identity!.address = ['link_token']))).toContain('ENDPOINT_OWN_ADDRESS_SHAPE');
    // The link's holder may not re-address it.
    expect(codes(ticket, (d) => d.writable!.push('pending_email'))).toContain('SCOPE_CLAIM_COLUMN_WRITABLE');

    const buyer = buyerTickets();
    expect(codes(buyer, () => undefined)).toEqual([]);
    expect(codes(buyer, (d) => (d.withhold!.columns = ['code', 'nope']))).toContain('ENDPOINT_WITHHOLD_SHAPE');
    expect(codes(buyer, (d) => (d.withhold!.columns = ['code', 'code']))).toContain('ENDPOINT_WITHHOLD_SHAPE');
    expect(codes(buyer, (d) => (d.withhold!.unless_holder = 'nope'))).toContain('ENDPOINT_COLUMN_UNKNOWN');
    expect(codes(buyer, (d) => (d.withhold!.unless_holder = 'pending_name'))).toContain('ENDPOINT_WITHHOLD_SHAPE');
    expect(codes(buyer, (d) => d.writable!.push('holder_customer_id'))).toContain('ENDPOINT_WITHHOLD_SHAPE');
    expect(codes(buyer, (d) => delete d.visible_with)).toContain('ENDPOINT_WITHHOLD_SHAPE');
    expect(codes(buyer, (d) => (d.auth.role = 'service_role'))).toContain('ENDPOINT_WITHHOLD_SHAPE');
    // Claimed by the holder column itself, every row read is already the holder's.
    expect(codes(buyer, (d) => Object.assign(d, { visible_with: undefined, claim: { column: 'holder_customer_id' } }))).toContain('ENDPOINT_WITHHOLD_SHAPE');
  });

  it.skipIf(!available)('carries an own link\'s addresses into its key\'s derived scope', async () => {
    const scopes = await publicScopesRepo(h!.meta).listByConnection(h!.connectionId);
    const compiled = scopes.map((scope) => compileScope(JSON.parse(scope.document), undefined, { timezone: 'UTC' }, { derived: true }));
    const byClaim = (ref: string) => compiled.find((scope) => scope.claim?.ref === ref)!;
    expect(byClaim(ticketLink().ref).claim).toMatchObject({ strategy: 'token', own: true, address: ['pending_email', 'holder_email'] });
    expect(byClaim(orderLink().ref).claim).toMatchObject({ strategy: 'token', own: true, address: ['email'] });
  });

  it.skipIf(!available)('serves every entry that withholds columns, in the derived scopes', async () => {
    const withholding = [buyerTickets(), linkTickets()];
    // What install stored: each is served by its key's scope.
    const scopes = await publicScopesRepo(h!.meta).listByConnection(h!.connectionId);
    const refs = scopes.flatMap((scope) => (JSON.parse(scope.document) as PublicScopeDocument).resources.map((r) => r.ref));
    for (const tickets of withholding) expect(refs).toContain(tickets.ref);
    // Derived again from every endpoint: none of them is suspended.
    const all = new Map([...endpoints].map(([ref, e]) => [e.id, { id: e.id, ref, definition: e.definition }]));
    const access = Object.fromEntries([...all.values()].map((e) => [e.id, e.definition.methods as PublicMethod[]]));
    const derived = deriveScopeDocument({ kind: 'browser', access }, all, view);
    expect(derived.suspended.map((s) => s.ref)).not.toEqual(expect.arrayContaining([buyerTickets().ref]));
    expect(derived.document.resources.map((r) => r.ref)).toContain(buyerTickets().ref);
  });

  it.skipIf(!available)('maps a withholding entry to its scope resource and compiled form, once built', () => {
    const buyer = buyerTickets();
    const parent = endpoint((d) => d.source === idOf('orders') && d.claim?.column === 'customer_id' && d.methods.includes('GET'));
    const person = endpoint((d) => d.identity?.strategy === 'email-link');
    const resource = (e: { ref: string; definition: PublicEndpointDefinition }) =>
      definitionToResource(e.ref, e.definition, e.definition.methods, sourceTable(view, e.definition.source));
    const tickets = resource(buyer);
    expect(tickets.withhold).toEqual({ columns: ['code', 'holder_email'], unlessHolder: 'holder_customer_id' });
    const document: PublicScopeDocument = {
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      resources: [resource(person), resource(parent), tickets],
      claim: { strategy: 'email-link', ref: person.ref, match: ['email'], verify: 'email-link', email: 'email', humanCheck: true },
    };
    const compiled = compileScope(document, undefined, { timezone: 'UTC' }, { derived: true });
    expect(compiled.byRef.get(buyer.ref)!.withhold).toEqual({ columns: ['code', 'holder_email'], unlessHolder: 'holder_customer_id' });
    expect(compiled.byRef.get(parent.ref)!.withhold).toBeNull();
  });
});
