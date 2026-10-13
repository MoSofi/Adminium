// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHARE LINK'S KEY THAT BELONGS TO A PART. An app's quotes are a part built
 * on an add-on it only suggests, and the customer's link to a quote is served
 * through a key of its own (`publicKeys.quote`), every entry of which is the
 * part's. The key goes where the part goes:
 *
 *  - the app is a whole manifest without the part: no "no entry is served
 *    through the key" from the check of what is left;
 *  - installed without the add-on, the part is left out and so is the key: no
 *    key is made, and no entry stored;
 *  - the add-on installed for the app afterwards puts the part in; the key and
 *    its entries are made once the owner allows the app's public access, as
 *    for any part put in later;
 *  - the part switched off closes every entry the key serves, and the link
 *    itself; switched on, they answer again.
 *
 * Through the real routes, on SQLite, Postgres and MySQL.
 */
import { readFileSync } from 'node:fs';

import { validateManifest, withoutModules } from '@adminium/manifest';
import { publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { addOnHarness, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';
import type { InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });

/** A part of the quote shape, spelled out as the app's own table. */
function tableOnPart(part: string, ref: string, extra: Doc[] = []): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, module: 'quotes', builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: mapTableRefs(def.states, map).value }) };
}

const page = (ref: string, table: string, module: string) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'manifest:sample', icon: 'list', order: 1 }, bindings: { rows: table }, module });

function crm(over: Doc = {}): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.'), checked: true }],
      features: [{ id: 'quotes', label: en('Quotes'), requires: ['invoices'] }],
    },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'quotes', label: en('Quotes'), default: 'on', feature: 'quotes' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        tableOnPart('document', 'quotes', [
          { ref: 'sent_to_email', type: 'text', maxLength: 254, nullable: true },
          { ref: 'share_code', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
        ]),
        tableOnPart('lines', 'quote_lines'),
      ],
    },
    // The customer's link: a key of its own, and every entry on it is the part's.
    publicKeys: { quote: {} },
    publicAccess: [
      { table: 'quotes', key: 'quote', module: 'quotes', methods: ['GET'], claim: { by: 'token', column: 'share_code', own: true, address: 'sent_to_email' }, select: ['id', 'status', 'valid_until'] },
      { table: 'quote_lines', key: 'quote', module: 'quotes', methods: ['GET'], visibleWith: { table: 'quotes', via: 'document_id' }, level: 'verified', select: ['id', 'description', 'amount'] },
    ],
    roles: [{ key: 'rep', name: 'Sales rep', modules: ['selling', 'quotes'], permissions: ['table:@deals:read', 'table:@quotes:read', 'page:@crm-deals:view', 'page:@crm-quotes:view'] }],
    pages: [page('crm-deals', 'deals', 'selling'), page('crm-quotes', 'quotes', 'quotes')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
    ...over,
  });
}

describe('the check of an app without its part', () => {
  const issuesOf = (manifest: Doc) => {
    const result = validateManifest(manifest);
    return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
  };

  it('a key every entry of which is the part\'s is left out with it', () => {
    expect(issuesOf(crm())).toEqual([]);
    const cut = withoutModules(crm(), ['quotes']);
    expect(cut['publicKeys']).toBeUndefined();
    expect(cut['publicAccess']).toBeUndefined();
  });

  it('a key that still serves an entry stays, and one that never served any is still named', () => {
    // One entry of the key on a table that stays: the key stays, with that entry.
    const shared = crm({
      publicKeys: { quote: {}, deal: {} },
      publicAccess: [
        ...(crm()['publicAccess'] as Doc[]),
        { table: 'deals', key: 'deal', module: 'selling', methods: ['GET'], claim: { by: 'token', column: 'name' }, select: ['id'] },
      ],
    });
    const cut = withoutModules(shared, ['quotes']);
    expect(Object.keys(cut['publicKeys'] as Doc)).toEqual(['deal']);
    expect((cut['publicAccess'] as Doc[]).map((entry) => entry['table'])).toEqual(['deals']);
    // A key nothing was ever served through is the manifest's mistake, with or without the part.
    const idle = crm({ publicKeys: { quote: {}, idle: {} } });
    expect(Object.keys(withoutModules(idle, ['quotes'])['publicKeys'] as Doc)).toEqual(['idle']);
    expect(issuesOf(idle).join('\n')).toContain('no entry is served through "idle"');
    // The app's own key is never taken away: only its peak is said there.
    const own = crm({ publicKeys: { quote: {}, customer: { peak: { reads: 6000, writes: 600 } } }, publicAccess: [...(crm()['publicAccess'] as Doc[]), { table: 'quotes', key: 'customer', module: 'quotes', methods: ['GET'], select: ['id'], filters: [{ column: 'status', op: 'eq', value: 'sent' }] }] });
    expect(Object.keys(withoutModules(own, ['quotes'])['publicKeys'] as Doc)).toEqual(['customer']);
  });
});

let h: Harness | undefined;
let served: Served | undefined;
afterEach(async () => {
  await served?.close().catch(() => undefined);
  served = undefined;
  await h?.close().catch(() => undefined);
  h = undefined;
});

const quoteKeys = async (harness: Harness) => (await publicKeysRepo(harness.meta).listManagedBy('crm')).filter((key) => key.purpose === 'quote');
const entryRefs = async (harness: Harness) => (await publicEndpointsRepo(harness.meta).listByConnection(harness.connectionId)).map((row) => row.ref).sort();

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a share link's key that belongs to a part, on ${dialect}`, () => {
    it('is not made while the part is left out, and is made once the part is in and its public access allowed', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(crm());
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: '0.2.0', connectionId: h.connectionId, addOns: [] } });
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.problems).toEqual([]);
      const installed = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await h.tableNames()).not.toContain('crm_quotes');
      // No key for a link that opens nothing, and no entry of it.
      expect(await quoteKeys(h)).toEqual([]);
      expect(await entryRefs(h)).toEqual([]);

      const addOn = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.1.0', attachTo: ['crm'], connectionId: h.connectionId } });
      expect(addOn.statusCode, addOn.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['crm_quotes', 'crm_quote_lines']));
      // Put in unattended, the part opens nothing to the public by itself: that is the owner's to allow, as at an install.
      expect(await quoteKeys(h)).toEqual([]);
      await h.stageApp({ ...crm(), version: '0.2.1' });
      const updated = await h.inject({ method: 'POST', url: '/apps/crm/update', payload: { publicAccess: true } });
      expect(updated.statusCode, updated.body).toBe(200);
      const keys = await quoteKeys(h);
      expect(keys).toHaveLength(1);
      expect(keys[0]!.requiresStaff).toBeNull();
      expect(await entryRefs(h)).toHaveLength(2);
    });

    it('follows the part\'s switch: off closes the link and what it reads, on opens them again', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const planned = await h.plan(crm());
      const installed = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum, addOns: [{ key: 'invoices', version: '1.1.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      const [key] = await quoteKeys(h);
      expect(key).toBeDefined();
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', h.connectionId).execute();
      await h.rows("insert into crm_quotes (status, share_code, sent_to_email) values ('sent', 'SHAREQTESHARZZZY', 'buyer@example.com')");
      await h.rows("insert into crm_quote_lines (document_id, position, description, qty, rate, discount_kind) values (1, 1, 'Fit-out', 1, 100, 'none')").catch(async () => {
        await h!.rows("insert into crm_quote_lines (document_id, description) values (1, 'Fit-out')");
      });
      served = await servePublic(h as unknown as InvoicingHarness, key!.id);
      let ip = 0;
      const from = () => `10.11.0.${String((ip += 1))}`;
      const open = () => served!.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress: from(), headers: served!.headers(), payload: { token: 'SHAREQTESHARZZZY' } });
      const refs = await entryRefs(h);
      const read = (ref: string, session: string) => served!.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${ref}`, remoteAddress: from(), headers: served!.headers(session) });
      const answers = async (session: string) => Promise.all(refs.map(async (ref) => (await read(ref, session)).statusCode));

      const opened = await open();
      expect(opened.statusCode, opened.body).toBe(200);
      const session = (opened.json() as { data: { session: string } }).data.session;
      expect(await answers(session)).toEqual([200, 200]);

      const switched = await h.inject({ method: 'PUT', url: '/apps/crm/parts/quotes', payload: { on: false } });
      expect(switched.statusCode, switched.body).toBe(200);
      const closed = await answers(session);
      expect(closed.every((status) => status >= 400), JSON.stringify(closed)).toBe(true);
      const again = await open();
      expect(again.statusCode, again.body).toBeGreaterThanOrEqual(400);

      const on = await h.inject({ method: 'PUT', url: '/apps/crm/parts/quotes', payload: { on: true } });
      expect(on.statusCode, on.body).toBe(200);
      const reopened = await open();
      expect(reopened.statusCode, reopened.body).toBe(200);
      expect(await answers((reopened.json() as { data: { session: string } }).data.session)).toEqual([200, 200]);
    });
  });
}
