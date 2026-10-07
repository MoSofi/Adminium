// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IS THIS POSTING LIVE? — every answer the registry gives, over the test
 * ledger's own manifest: not installed and not connected read as not there;
 * switched off for the app, being updated, or with no code to ask, it cannot
 * answer; the owner's switch turns a rule off and is the way through an
 * add-on that cannot answer.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { validateManifest, type AddOnManifest } from '@adminium/manifest';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import type { InstalledDecider } from '../src/add-ons/decide.js';
import type { AddOnInstalls, InstalledAddOn } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import type { DeclaredPosting } from '../src/crud/ledger-points.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const KIT = ((): AddOnManifest => {
  const read = validateManifest(ledgerKitManifest());
  if (!read.ok) throw new Error(JSON.stringify(read.issues));
  return read.manifest as AddOnManifest;
})();
const KIT_TABLES = (KIT.requiredSchema?.tables ?? []).map((table) => table.ref);

const col = (name: string) => ({ name, logicalType: 'integer' });
const key = { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } };
const table = (name: string) => ({ schema: 'public', name, primaryKey: ['id'], columns: [key, col('account_id'), col('qty')] });
const stored = (tableName: string, op: string, value: Record<string, unknown>, origin: SchemaOverride['origin']): SchemaOverride => ({
  id: `ovr_${tableName}_${op}_${origin}`,
  connectionId: 'cnx_test',
  op: op as SchemaOverride['op'],
  tableName,
  columnName: null,
  value,
  origin,
  llmRunId: null,
  status: 'active',
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
});

const posting = (id: string, over: Partial<DeclaredPosting> = {}): DeclaredPosting => ({ id, into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, ...over });
const APP_RULE = posting('app-rule');
const NEEDS = posting('needs-rule', { needs: 'stock' });
const OWN_RULE = posting('own-rule');
const KIT_RULE = posting('kit-rule');

function world(over: { switchedOff?: string[]; tables?: string[] } = {}) {
  const names = ['shop_orders', 'notes', ...(over.tables ?? KIT_TABLES.map((ref) => `ledger_kit_${ref}`))];
  const model = applyClassification(parseDatabaseModel({ dialect: 'postgres', name: 'shop', defaultSchema: 'public', schemas: ['public'], tables: names.map(table), relations: [] })) as DatabaseModel;
  const view = new SnapshotView(
    'cnx_test',
    applyOverrides(model, [
      stored('public.shop_orders', 'table.postings', { postings: [APP_RULE, NEEDS] }, 'app'),
      stored('public.shop_orders', 'table.postings', { postings: [OWN_RULE] }, 'user'),
      stored('public.notes', 'table.postings', { postings: [posting('note-rule')] }, 'user'),
      // A rule the kit ships on a table of its own, as its install stores it.
      stored('public.ledger_kit_requests', 'table.postings', { postings: [KIT_RULE] }, 'app'),
      ...(over.switchedOff === undefined ? [] : [stored('public.shop_orders', 'table.switchedOff', { postings: over.switchedOff }, 'user')]),
    ]),
  );
  const requests = over.tables === undefined ? view.table('public.ledger_kit_requests') : null;
  return { view, orders: view.table('public.shop_orders'), notes: view.table('public.notes'), requests };
}

const DECIDER = { key: 'ledger-kit', version: '1.0.0', sha256: 'x', kinds: ['rows'] } as unknown as InstalledDecider;

function runtime(over: { addOn?: Partial<InstalledAddOn> | null; decider?: InstalledDecider | null; feature?: boolean } = {}) {
  const addOn: InstalledAddOn | null = over.addOn === null ? null : { manifest: KIT, version: '1.0.0', status: 'installed', hosts: new Map([['shop', true]]), ...over.addOn };
  const installs: AddOnInstalls = {
    installed: (connectionId, addOnKey) => (connectionId === 'cnx_test' && addOnKey === 'ledger-kit' ? addOn : null),
    tableOf: (_connectionId, addOnKey, ref) => (addOnKey === 'ledger-kit' && KIT_TABLES.includes(ref) ? `public.ledger_kit_${ref}` : null),
    // The shop made its orders; nobody made `notes`.
    refOf: (_connectionId, tableId) => (tableId === 'public.shop_orders' ? 'shop:orders' : tableId === 'public.ledger_kit_requests' ? 'ledger-kit:requests' : tableId),
    tableOfRef: () => null,
    featureOn: () => over.feature !== false,
  };
  return createLedgerRuntime({ installs: () => installs, decider: () => (over.decider === undefined ? DECIDER : over.decider), versionNow: async () => ({ version: '1.0.0', status: 'installed' }) });
}

describe('whether a posting is live', () => {
  it('live: the ledger with its tables as they are here, the action, and the code that decides', () => {
    const w = world();
    const answer = runtime().resolve(w.view, w.orders, APP_RULE);
    if (answer.state !== 'live' || !('ledger' in answer)) throw new Error(JSON.stringify(answer));
    expect(answer.decider).toBe(DECIDER);
    expect(answer.action.phases).toEqual(['reserve', 'post', 'reverse']);
    expect(answer.ledger).toMatchObject({ addOn: 'ledger-kit', version: '1.0.0', id: 'units', refusal: 'stock' });
    expect(answer.ledger.receipts.id).toBe('public.ledger_kit_postings');
    expect(answer.ledger.settings?.id).toBe('public.ledger_kit_settings');
    expect([...answer.ledger.writes.keys()].sort()).toEqual(['public.ledger_kit_entries', 'public.ledger_kit_holds', 'public.ledger_kit_requests', 'public.ledger_kit_things']);
    expect(answer.ledger.writes.get('public.ledger_kit_holds')).toEqual({ insert: ['account_id', 'amount', 'state'], update: { by: ['id'], set: ['state'] } });
    expect(answer.ledger.table('accounts')?.id).toBe('public.ledger_kit_accounts');
    expect(answer.ledger.table('ghosts')).toBeNull();
    expect(answer.ledger.refOf('public.ledger_kit_entries')).toBe('entries');
    expect(answer.ledger.refOf('public.shop_orders')).toBe('public.shop_orders');
  });

  it('a rule the add-on ships on a table of its own needs no app: it is live with nothing connected', () => {
    const w = world();
    // No app is connected at all; an add-on is never a host of itself.
    const alone = runtime({ addOn: { hosts: new Map() } });
    expect(alone.resolve(w.view, w.requests!, KIT_RULE).state).toBe('live');
    // An app's rule in the same database still waits for its app to be connected.
    expect(alone.resolve(w.view, w.orders, APP_RULE)).toEqual({ state: 'idle' });
    // And the add-on's own rule still stops with the add-on: no code, no posting.
    expect(runtime({ addOn: { hosts: new Map() }, decider: null }).resolve(w.view, w.requests!, KIT_RULE)).toMatchObject({ state: 'unavailable', cause: 'no-decider' });
  });

  it('not installed in this database: the rule reads as not there, whoever made it', () => {
    const w = world();
    expect(runtime({ addOn: null }).resolve(w.view, w.orders, APP_RULE)).toEqual({ state: 'idle' });
    expect(runtime({ addOn: null }).resolve(w.view, w.orders, OWN_RULE)).toEqual({ state: 'idle' });
  });

  it('an app\'s rule for an add-on not connected to that app is inert; the owner\'s own rule on the same table is not', () => {
    const w = world();
    const elsewhere = runtime({ addOn: { hosts: new Map([['kiosk', true]]) } });
    expect(elsewhere.resolve(w.view, w.orders, APP_RULE)).toEqual({ state: 'idle' });
    expect(elsewhere.resolve(w.view, w.orders, OWN_RULE).state).toBe('live');
    // A rule the owner made on a table no app made is the owner's too.
    expect(elsewhere.resolve(w.view, w.notes, posting('note-rule')).state).toBe('live');
  });

  it('switched off for the app, or its feature not on: it cannot answer — never skipped', () => {
    const w = world();
    // With the ledger as far as it can be found: a round already open is still given back, on its own receipt table.
    expect(runtime({ addOn: { hosts: new Map([['shop', false]]) } }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'unavailable', cause: 'switched-off-for-app', ledger: { id: 'units' }, action: { holds: true } });
    expect(runtime({ feature: false }).resolve(w.view, w.orders, NEEDS)).toMatchObject({ state: 'unavailable', cause: 'switched-off-for-app', ledger: { id: 'units' } });
    expect(runtime({ feature: false }).resolve(w.view, w.orders, APP_RULE).state).toBe('live');
    // The owner's own rule has no app to be switched off for.
    expect(runtime({ addOn: { hosts: new Map([['shop', false]]) } }).resolve(w.view, w.orders, OWN_RULE).state).toBe('live');
  });

  it('being updated, disabled, or with no code to ask: it cannot answer, and says why', () => {
    const w = world();
    for (const status of ['updating', 'disabled', 'error', 'installing'] as const) {
      expect(runtime({ addOn: { status } }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'unavailable', cause: status, ledger: { id: 'units' } });
    }
    expect(runtime({ decider: null }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'unavailable', cause: 'no-decider', ledger: { id: 'units' }, action: { holds: true } });
    // Code loaded from another version than the one installed is not this add-on's code.
    expect(runtime({ decider: { ...DECIDER, version: '0.9.0' } as InstalledDecider }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'unavailable', cause: 'version-moved' });
    expect(runtime().resolve(w.view, w.orders, posting('x', { into: { addOn: 'ledger-kit', ledger: 'ghost', action: 'use' } }))).toEqual({ state: 'unavailable', cause: 'no-such-ledger' });
    expect(runtime().resolve(w.view, w.orders, posting('x', { into: { addOn: 'ledger-kit', ledger: 'units', action: 'ghost' } }))).toMatchObject({ state: 'unavailable', cause: 'no-such-action' });
    // One of its tables is not in this database (dropped by hand, say).
    const short = world({ tables: KIT_TABLES.filter((ref) => ref !== 'holds').map((ref) => `ledger_kit_${ref}`) });
    expect(runtime().resolve(short.view, short.orders, APP_RULE)).toEqual({ state: 'unavailable', cause: 'tables-missing' });
  });

  it('the owner\'s switch: off with everything to give an open round back; and the way through an add-on that cannot answer', () => {
    const w = world({ switchedOff: ['app-rule'] });
    const off = runtime().resolve(w.view, w.orders, APP_RULE);
    expect(off).toMatchObject({ state: 'off', ledger: { id: 'units' }, decider: DECIDER });
    // The other rules of the table are untouched by it.
    expect(runtime().resolve(w.view, w.orders, OWN_RULE).state).toBe('live');
    // Off while it cannot answer: still off — with the ledger, so a round left open is given back on its own receipts, unasked.
    expect(runtime({ addOn: { status: 'updating' } }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'off', ledger: { id: 'units' }, decider: null });
    expect(runtime({ decider: null }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'off', ledger: { id: 'units' }, decider: null });
    expect(runtime({ addOn: { hosts: new Map([['shop', false]]) } }).resolve(w.view, w.orders, APP_RULE)).toMatchObject({ state: 'off', decider: null });
    // Not connected stays not there: the switch has nothing to switch.
    expect(runtime({ addOn: { hosts: new Map() } }).resolve(w.view, w.orders, APP_RULE)).toEqual({ state: 'idle' });
  });
});
