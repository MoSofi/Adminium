// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE RULE, SAID IN TWO PLACES, HELD TOGETHER HERE.
 *
 * An entry of `publicAccess` that sends values and leaves a browser nothing
 * to set cannot become an endpoint: the scope compile refuses it
 * (`SCOPE_ACTION_WITHOUT_WRITABLE`, "declares "create" but lists no writable
 * columns"). That is read when the endpoints are made, which on a server is
 * when a person allows the app's public access. The manifest's own check
 * says the same when the file is written (`writableThrough` in
 * `packages/manifest/src/public-access.ts`), from the declared tables alone.
 *
 * The two work the answer out from different facts: one from the manifest,
 * one from the real table and the rules kept on it. So every shape below is
 * put to both, against tables the real installer made, and they must agree:
 *
 *  - an entry the endpoint would be made for is not refused by the manifest;
 *  - one the endpoint is refused for, for this reason, is.
 *
 * A rule added to either side's reading of "what a browser may set when the
 * entry names nothing" (`defaultWritable` and `decidedColumnsOf` in
 * `public-api/endpoint.ts`; `filledOf` in the manifest's `schema.ts`) fails
 * here until the other follows.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest, type Manifest } from '@adminium/manifest';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planPublicEndpoints, servedPublicEntries } from '../src/apps/manifest-public.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { installInvoicing, invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';

type Entry = Record<string, unknown>;

/** The endpoint's refusal, as the scope compile words it. */
const REFUSED = /declares "(create|update|replace|batch)" but lists no writable columns/;
/** The manifest's finding. */
const ASKED = /^this entry [a-z, ]+ rows, so list the columns a browser may set in writable/;
/** The two older findings that ask a child entry for the same list, in their own words. */
const ASKED_OF_A_CHILD = [/^a change through an entry visible with a parent names what it may write$/, /^this entry creates rows under "[a-z_]+", so "[a-z_]+" is writable/];

/** A client signs in by their address: what makes `claimedBy` and `visibleWith` entries reachable. */
const CLIENT: Entry = { table: 'clients', methods: ['GET'], select: ['id', 'name'], claim: { match: ['email'] } };
const MINE = { claimedBy: { table: 'clients', column: 'client_id' } };
/** A client's own invoices: the parent an invoice's lines are visible with. */
const INVOICES: Entry = { table: 'invoices', methods: ['GET'], select: ['id', 'status'], ...MINE };
const UNDER = { visibleWith: { table: 'invoices', via: 'invoice_id' } };

interface Shape {
  name: string;
  /** The entries before the one under test (the sign-in, a parent). */
  around?: Entry[];
  entry: Entry;
  /** Whether the endpoint is refused for having nothing writable. */
  refused: boolean;
  /** The manifest already asked this entry for its list in an older finding's words, so the new one stays quiet. */
  askedAsAChild?: true;
}

/*
 * `invoices` carries one column of every kind that matters here. Filled by
 * Adminium on both sides: `number_seq` (a sequence), `issued_on` and `due_on`
 * (stamps), `tax_rate` (a copy), `subtotal` and `paid` (roll-ups), `balance`
 * (a roll-up's balance). Decided for the manifest's other checks, and yet
 * offered by the endpoint's own default: `number` (a format), `tax` and
 * `total` (formulas), `currency` (a default). Plain: `status`, `terms`,
 * `client_paid_at`, and the link `client_id`.
 */
const SHAPES: Shape[] = [
  // The entry a Designer wrote on a trial, for a form that sends six columns.
  { name: 'adds rows, shows only the key, names nothing', entry: { table: 'invoices', methods: ['POST'], select: ['id'] }, refused: true },
  { name: 'adds rows and names a column', entry: { table: 'invoices', methods: ['POST'], select: ['id'], writable: ['client_paid_at'] }, refused: false },
  { name: 'adds rows with a list left empty', entry: { table: 'invoices', methods: ['POST'], select: ['id'], writable: [] }, refused: true },
  { name: 'names nothing, shows a plain column: the endpoint takes it', entry: { table: 'invoices', methods: ['POST'], select: ['id', 'client_paid_at'] }, refused: false },
  { name: 'names nothing and no select: every column, less what is filled', entry: { table: 'invoices', methods: ['POST'] }, refused: false },
  {
    name: 'names nothing, shows only what Adminium fills',
    entry: { table: 'invoices', methods: ['POST'], select: ['id', 'number_seq', 'issued_on', 'due_on', 'tax_rate', 'subtotal', 'paid', 'balance'] },
    refused: true,
  },
  { name: 'names nothing, shows a formatted number: the endpoint offers it', entry: { table: 'invoices', methods: ['POST'], select: ['id', 'number'] }, refused: false },
  { name: 'names nothing, shows a formula: the endpoint offers it', entry: { table: 'invoices', methods: ['POST'], select: ['id', 'total'] }, refused: false },
  { name: 'names nothing, shows a column with a default rule: the endpoint offers it', entry: { table: 'invoices', methods: ['POST'], select: ['id', 'currency'] }, refused: false },
  {
    name: 'names nothing, shows only the column its filter holds',
    entry: { table: 'invoices', methods: ['POST'], select: ['id', 'status'], filters: [{ column: 'status', op: 'eq', value: 'draft' }] },
    refused: true,
  },
  {
    name: 'the filter holds one column, another is left',
    entry: { table: 'invoices', methods: ['POST'], select: ['id', 'status', 'terms'], filters: [{ column: 'status', op: 'eq', value: 'draft' }] },
    refused: false,
  },
  { name: 'values the server writes are not a browser\'s', entry: { table: 'invoices', methods: ['POST'], select: ['id'], writable: [], defaults: { status: 'draft' } }, refused: true },
  { name: 'nor are the values a column may take', entry: { table: 'invoices', methods: ['POST'], select: ['id'], writable: [], writableValues: { status: ['draft'] } }, refused: true },
  {
    name: 'nor what its child rows may write',
    entry: { table: 'invoices', methods: ['POST'], select: ['id'], writable: [], children: { invoice_lines: { via: 'invoice_id', writable: ['qty'], max: 5 } } },
    refused: true,
  },
  // A person's own rows: the column they are claimed by is never a browser's.
  { name: 'a person\'s own rows, shows only the key and the claim column', around: [CLIENT], entry: { table: 'invoices', methods: ['POST'], select: ['id', 'client_id'], ...MINE }, refused: true },
  { name: 'a person\'s own rows, one more column shown', around: [CLIENT], entry: { table: 'invoices', methods: ['POST'], select: ['id', 'client_id', 'terms'], ...MINE }, refused: false },
  { name: 'changes a person\'s own rows, names nothing, shows only the key', around: [CLIENT], entry: { table: 'invoices', methods: ['GET', 'PATCH'], select: ['id'], ...MINE }, refused: true },
  { name: 'changes a person\'s own rows, shows a plain column', around: [CLIENT], entry: { table: 'invoices', methods: ['GET', 'PATCH'], select: ['id', 'client_paid_at'], ...MINE }, refused: false },
  { name: 'adds and changes with a list left empty', around: [CLIENT], entry: { table: 'invoices', methods: ['POST', 'PATCH'], select: ['id', 'terms'], writable: [], ...MINE }, refused: true },
  { name: 'replaces rows, names nothing, shows only the key', around: [CLIENT], entry: { table: 'invoices', methods: ['GET', 'PUT'], select: ['id'], ...MINE }, refused: true },
  { name: 'writes many rows with a list left empty', around: [CLIENT], entry: { table: 'invoices', methods: ['GET', 'BATCH'], select: ['id', 'terms'], writable: [], ...MINE }, refused: true },
  // The sign-in itself: a claim is proved on the row's key.
  { name: 'the sign-in changes its own row, shows only the key', entry: { table: 'clients', methods: ['GET', 'PATCH'], select: ['id'], claim: { match: ['email'] } }, refused: true },
  { name: 'the sign-in changes its own row, shows its name', entry: { table: 'clients', methods: ['GET', 'PATCH'], select: ['id', 'name'], claim: { match: ['email'] } }, refused: false },
  // Rows seen with a parent write only what they name: what they show is never taken for it.
  { name: 'a child adds rows and names nothing', around: [CLIENT, INVOICES], entry: { table: 'invoice_lines', methods: ['POST'], select: ['id', 'qty'], ...UNDER }, refused: true, askedAsAChild: true },
  { name: 'a child changes rows and names nothing', around: [CLIENT, INVOICES], entry: { table: 'invoice_lines', methods: ['GET', 'PATCH'], select: ['id', 'qty'], ...UNDER }, refused: true, askedAsAChild: true },
  { name: 'a child changes rows with a list left empty', around: [CLIENT, INVOICES], entry: { table: 'invoice_lines', methods: ['GET', 'PATCH'], select: ['id', 'qty'], writable: [], ...UNDER }, refused: true },
  { name: 'a child adds rows under the parent it names', around: [CLIENT, INVOICES], entry: { table: 'invoice_lines', methods: ['POST'], select: ['id', 'qty'], writable: ['invoice_id', 'qty'], ...UNDER }, refused: false },
  {
    name: 'a row the parent points at adds rows and names nothing',
    around: [CLIENT, INVOICES],
    entry: { table: 'clients', methods: ['POST'], select: ['id', 'name'], visibleWith: { table: 'invoices', via: 'client_id' } },
    refused: true,
  },
  // No endpoint that writes: an availability entry answers free or full, whatever methods it lists.
  { name: 'an availability entry', entry: { table: 'invoices', kind: 'availability', methods: ['GET', 'POST'] }, refused: false },
  // Reads send nothing.
  { name: 'a read', entry: { table: 'invoices', methods: ['GET'], select: ['id'] }, refused: false },
];

describe('an entry that sends values and names nothing a browser may set', () => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let view: SnapshotView;
  let names: Record<string, string>;

  beforeAll(async () => {
    h = await installInvoicing('sqlite');
    const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
    const model = parseDatabaseModel(snapshot.schema);
    const overrides = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
    view = new SnapshotView(h.connectionId, applyOverrides(model, overrides), new Map());
    names = Object.fromEntries(invoicingTables().map((table) => [table['ref'] as string, h!.real(table['ref'] as string)]));
  }, 180_000);
  afterAll(async () => h?.close());

  const withEntries = (entries: Entry[]) => ({ ...invoicingManifest(), publicAccess: entries });
  /** What the manifest's check says of the entry at `at`, at its `writable`. */
  const saidOfWritable = (entries: Entry[], at: number): string[] => {
    const result = validateManifest(withEntries(entries));
    return (result.ok ? [] : result.issues).filter((issue) => issue.path === `publicAccess.${String(at)}.writable`).map((issue) => issue.message);
  };
  /** What stops the endpoint the entry at `at` becomes, against the installed tables. */
  const stopsTheEndpoint = (entries: Entry[], at: number): string[] => planPublicEndpoints(withEntries(entries) as unknown as Manifest, names, view)[at]!.issues;

  it('reads the installed rules: the fixture\'s filled columns are filled there too', () => {
    // Without the rules kept on the table the shapes below would agree for the wrong reason.
    const invoices = view.table(view.model.tables.find((table) => table.name === names['invoices'])!.id).table;
    const ruled = (column: string) => invoices.columns.find((candidate) => candidate.name === column)!;
    expect(ruled('number_seq').sequence).toBeDefined();
    expect(ruled('issued_on').stamp).toBeDefined();
    expect(ruled('subtotal').rollup).toBeDefined();
    expect(ruled('tax_rate').copy).toBeDefined();
  });

  it.each(SHAPES)('$name', ({ around = [], entry, refused, askedAsAChild }) => {
    const entries = [...around, entry];
    const at = around.length;
    const endpoint = stopsTheEndpoint(entries, at).some((message) => REFUSED.test(message));
    const said = saidOfWritable(entries, at);
    const asked = said.some((message) => ASKED.test(message));
    expect(endpoint, `the endpoint: ${JSON.stringify(stopsTheEndpoint(entries, at))}`).toBe(refused);
    if (askedAsAChild === true) {
      // Asked once, in the older words.
      expect(said.some((message) => ASKED_OF_A_CHILD.some((words) => words.test(message))), JSON.stringify(said)).toBe(true);
      expect(asked).toBe(false);
    } else {
      expect(asked, `the manifest: ${JSON.stringify(said)}`).toBe(refused);
    }
  });

  it('says nothing of a forms entry, which is no endpoint and asks for its list in its own words', () => {
    const entries: Entry[] = [{ table: 'invoices', key: 'forms', methods: ['POST'], writable: [] }];
    expect(servedPublicEntries(withEntries(entries) as unknown as Manifest)).toEqual([]);
    expect(saidOfWritable(entries, 0)).toEqual(['a forms entry names the columns a form may fill (writable)']);
  });

  it('says which rows the entry writes, and why a missing list came to nothing', () => {
    const of = (entry: Entry, around: Entry[] = []) => saidOfWritable([...around, entry], around.length).filter((message) => ASKED.test(message));
    const worked = ": with no list it may set the columns the entry shows (select), and none of those is a browser's to set";
    expect(of({ table: 'invoices', methods: ['POST'], select: ['id'] })).toEqual([`this entry adds rows, so list the columns a browser may set in writable${worked}`]);
    expect(of({ table: 'invoices', methods: ['POST'], select: ['id'], writable: [] })).toEqual(['this entry adds rows, so list the columns a browser may set in writable']);
    expect(of({ table: 'invoices', methods: ['GET', 'PATCH'], select: ['id'], ...MINE }, [CLIENT])).toEqual([`this entry changes rows, so list the columns a browser may set in writable${worked}`]);
    expect(of({ table: 'invoices', methods: ['POST', 'PATCH'], select: ['id'], writable: [], ...MINE }, [CLIENT])).toEqual(['this entry adds and changes rows, so list the columns a browser may set in writable']);
  });
});
