// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULES A MANIFEST SHIPS, INSTALLED.
 *
 * An add-on brings automation rules written against its own short names. At
 * its install each is bound to the real tables, the real roles, the
 * instance's language and the database's zone, and stored as the manifest's
 * own. An update rewrites what nobody touched and leaves what the owner
 * changed; a rule no longer shipped goes unless it was edited; so does every
 * rule at an uninstall. And a shipped rule does not run while what shipped it
 * is switched off.
 */
import { automationsRepo, rolesRepo, settingsRepo, type Automation } from '@adminium/meta';
import type { Manifest } from '@adminium/manifest';
import { afterEach, describe, expect, it } from 'vitest';

import { automationHashOf, installAutomations, removeAutomations } from '../src/apps/manifest-automations.js';
import { walkRule } from '../src/automations/runner.js';
import { onMappingRulesChanged } from '../src/documents/trigger-sync.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest and a stored rule read freely
type Doc = Record<string, any>;

const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });
const RULES: Doc[] = [
  {
    key: 'low-stock',
    name: { 'en-US': 'Low stock', 'de-DE': 'Wenig Bestand' },
    description: 'Tells the managers.',
    enabled: true,
    trigger: { kind: 'record', event: 'updated', table: 'items', changedColumn: 'zone', when: [{ left: { field: 'opening' }, op: 'lt', right: 5 }] },
    graph: {
      version: 1,
      nodes: [
        node('t', 'trigger', { title: { 'en-US': 'When stock is low', 'de-DE': 'Wenn der Bestand niedrig ist' } }),
        node('n', 'action', { action: { kind: 'notification', to: { roles: ['manager'] }, title: { 'en-US': '{{record.name}} is low', 'de-DE': '{{record.name}} ist knapp' }, body: 'Order more.' } }),
        node('c', 'action', { action: { kind: 'record.create', table: 'takes', values: { item_id: '{{record.id}}', qty: '1' } } }),
      ],
    },
  },
  {
    key: 'evening',
    name: 'Evening tidy',
    enabled: false,
    trigger: { kind: 'schedule', schedule: { kind: 'daily', time: '17:00' }, forEach: { table: 'items', once: false, where: [{ left: { field: 'opening' }, op: 'gt', right: 0 }] } },
    graph: { version: 1, nodes: [node('t', 'trigger'), node('u', 'action', { action: { kind: 'record.update', values: { zone: 'cellar' } } })] },
  },
];
const kit = (rules: Doc[] = RULES): Doc => ({ ...stockKitManifest(), automations: structuredClone(rules) });

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function installed(doc: Doc = kit(), before?: (harness: Harness) => Promise<void>) {
  h = await addOnHarness('sqlite', { unbuiltWords: {} });
  await before?.(h);
  await h.stageAddOn(doc, { files: { 'dist/client.js': 'export default function Count() { return null; }' } });
  const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
  return reply;
}
const rulesOf = () => automationsRepo(h!.meta).listManagedBy('stock-kit', h!.connectionId);
const again = async (doc: Doc, at?: number) => {
  const view = await loadSnapshotView(h!.meta, h!.connectionId);
  return installAutomations({ meta: h!.meta, manifest: doc as unknown as Manifest, connectionId: h!.connectionId, view, realId: (ref) => view.model.tables.find((table) => table.name === `stock_kit_${ref}`)?.id ?? ref, ...(at === undefined ? {} : { at }) });
};

describe('the rules an add-on ships', () => {
  it('are stored at its install as its own: the real tables, the real role, one language, the owner\'s switch as shipped', async () => {
    const reply = await installed();
    expect(reply.statusCode, reply.body).toBe(200);
    const [low, evening] = await rulesOf();
    const view = await loadSnapshotView(h!.meta, h!.connectionId);
    const id = (ref: string) => view.model.tables.find((table) => table.name === `stock_kit_${ref}`)!.id;
    const manager = (await rolesRepo(h!.meta).findBySlug('stock-kit-manager'))!;

    expect(low).toMatchObject({ managedBy: 'stock-kit', templateKey: 'low-stock', name: 'Low stock', description: 'Tells the managers.', enabled: true, createdBy: null, connectionId: h!.connectionId });
    // A shipped rule runs on what Adminium writes: it polls for nothing.
    expect(low!.trigger).toEqual({ kind: 'record', event: 'updated', connectionId: h!.connectionId, table: id('items'), watch: false, changedColumn: 'zone', when: [{ left: { field: 'opening' }, op: 'lt', right: 5 }] });
    const nodes = low!.graph.nodes as Doc[];
    expect(nodes[0]!['title']).toBe('When stock is low');
    // The role by its id here, the words in one language, the tokens as written.
    expect(nodes[1]!['action']).toMatchObject({ kind: 'notification', to: { roles: [manager.id] }, title: '{{record.name}} is low', body: 'Order more.' });
    expect(nodes[2]!['action']).toMatchObject({ kind: 'record.create', table: id('takes'), values: { item_id: '{{record.id}}', qty: '1' } });

    // A rule by the clock: the database's zone (the server's, where it has none), switched off as shipped, so no tick is set.
    expect(evening).toMatchObject({ templateKey: 'evening', enabled: false, nextRunAt: null });
    const schedule = (evening!.trigger as Doc)['schedule'];
    expect(schedule).toMatchObject({ kind: 'daily', time: '17:00' });
    expect(typeof schedule.timezone).toBe('string');
    expect(schedule.timezone.length).toBeGreaterThan(0);
    expect((evening!.trigger as Doc)['forEach'].table).toBe(id('items'));
    // Each is fingerprinted as it was stored: reading it back is no edit.
    for (const rule of [low!, evening!]) expect(rule.contentHash).toBe(automationHashOf(rule));
  });

  it('the install tells whoever keeps rules in memory that there are new ones', async () => {
    let told = 0;
    const reply = await installed(kit(), async (harness) => onMappingRulesChanged(harness.meta, () => void (told += 1)));
    expect(reply.statusCode, reply.body).toBe(200);
    // Untold, a new rule would do nothing until the process restarted.
    expect(told).toBeGreaterThanOrEqual(1);
    const before = told;
    // An add-on that ships none tells nobody.
    await h!.close();
    h = null;
    told = 0;
    const plain = await installed(stockKitManifest() as Doc, async (harness) => onMappingRulesChanged(harness.meta, () => void (told += 1)));
    expect(plain.statusCode, plain.body).toBe(200);
    expect(told).toBe(0);
    expect(before).toBeGreaterThan(0);
  });

  it('speak the instance\'s language where the manifest wrote one', async () => {
    const reply = await installed(kit(), async (harness) => void (await settingsRepo(harness.meta).set('locale.default', 'de_DE')));
    expect(reply.statusCode, reply.body).toBe(200);
    const [low] = await rulesOf();
    expect(low!.name).toBe('Wenig Bestand');
    expect((low!.graph.nodes as Doc[])[1]!['action'].title).toBe('{{record.name}} ist knapp');
    // A text with one spelling is that spelling.
    expect(low!.description).toBe('Tells the managers.');
  });

  it('a rule that names a role the add-on does not have is refused, and nothing of the add-on is half installed', async () => {
    const rules = structuredClone(RULES);
    rules[0]!['graph'].nodes[1].action.to.roles = ['nobody'];
    const reply = await installed(kit(rules));
    // The manifest's own validation says it first.
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain('nobody');
    expect(await automationsRepo(h!.meta).list({})).toEqual([]);
  });

  it('an update rewrites a rule nobody touched, keeps the owner\'s switch, and leaves an edited rule alone', async () => {
    expect((await installed()).statusCode).toBe(200);
    const repo = automationsRepo(h!.meta);
    const [low, evening] = await rulesOf();
    // The owner switches the evening rule on, and rewrites the low-stock one.
    await repo.update(evening!.id, { enabled: true });
    await repo.update(low!.id, { name: 'My own low stock' });

    const next = structuredClone(RULES);
    next[0]!['name'] = 'Low stock, v2';
    next[1]!['name'] = 'Evening tidy, v2';
    next[1]!['trigger'].schedule.time = '18:30';
    const result = await again(kit(next), Date.UTC(2026, 9, 7, 12, 0));
    expect(result).toEqual({ written: ['evening'], kept: ['low-stock'], removed: [] });

    const [lowNow, eveningNow] = await rulesOf();
    expect(lowNow!.name).toBe('My own low stock');
    expect(eveningNow).toMatchObject({ name: 'Evening tidy, v2', enabled: true });
    expect((eveningNow!.trigger as Doc)['schedule'].time).toBe('18:30');
    // Switched on by the owner and by the clock: its next tick is worked out again.
    expect(eveningNow!.nextRunAt).toEqual(expect.any(Number));
    expect(eveningNow!.contentHash).toBe(automationHashOf(eveningNow!));
    // A switch alone is no edit: the rule was rewritten, as above.
  });

  it('a rule the manifest no longer ships goes — unless the owner made it theirs; an update that ships none and had none says nothing', async () => {
    expect((await installed()).statusCode).toBe(200);
    const repo = automationsRepo(h!.meta);
    const [low] = await rulesOf();
    await repo.update(low!.id, { description: 'Mine now.' });
    const result = await again(kit([]));
    expect(result).toEqual({ written: [], kept: [], removed: ['evening'] });
    expect((await rulesOf()).map((rule) => rule.templateKey)).toEqual(['low-stock']);

    // An owner's own rule on the same database is nobody's business here.
    const own = await repo.create({ connectionId: h!.connectionId, name: 'Mine', trigger: low!.trigger, graph: low!.graph });
    await removeAutomations(h!.meta, 'stock-kit', h!.connectionId, { tablesDropped: false });
    expect((await repo.findById(own.id))?.name).toBe('Mine');
    expect(await again({ ...stockKitManifest(), key: 'another' } as Doc)).toBeUndefined();
  });

  it('an uninstall takes the unedited rules, and switches an edited one off when its tables go too — saying so', async () => {
    expect((await installed()).statusCode).toBe(200);
    const repo = automationsRepo(h!.meta);
    const [low, evening] = await rulesOf();
    await repo.update(low!.id, { name: 'Kept by the owner' });

    expect(await removeAutomations(h!.meta, 'stock-kit', h!.connectionId, { tablesDropped: true })).toBe(1);
    expect(await repo.findById(evening!.id)).toBeNull();
    const kept = await repo.findById(low!.id);
    expect(kept).toMatchObject({ name: 'Kept by the owner', enabled: false });
    const said = await h!.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'automation.disable').execute();
    expect(said).toHaveLength(1);
    expect(JSON.stringify(said[0]!.changes)).toContain('stock-kit');
  });

  it('with its tables kept, an edited rule stays as the owner left it', async () => {
    expect((await installed()).statusCode).toBe(200);
    const repo = automationsRepo(h!.meta);
    const [low] = await rulesOf();
    await repo.update(low!.id, { name: 'Kept by the owner' });
    await removeAutomations(h!.meta, 'stock-kit', h!.connectionId, { tablesDropped: false });
    expect(await repo.findById(low!.id)).toMatchObject({ enabled: true });
  });

  it('a shipped rule does not run while what shipped it is switched off; an owner\'s own rule is not asked', async () => {
    expect((await installed()).statusCode).toBe(200);
    const [low] = await rulesOf();
    const event = { event: 'record.updated', origin: 'dashboard', hops: 0, record: { connectionId: h!.connectionId, table: (low!.trigger as Doc)['table'], pk: { id: 999_999 }, label: 'x' }, snapshot: {}, occurredAt: 1 };
    const run = (rule: Automation) => walkRule({ meta: h!.meta, manager: h!.manager, secret: 'x'.repeat(40) } as never, { rule, runId: 'run_1', event: event as never });

    await h!.meta.db.updateTable('adminium_manifests').set({ status: 'disabled' } as never).where('manifestKey', '=', 'stock-kit').execute();
    const off = await run(low!);
    expect(off).toMatchObject({ kind: 'finished', status: 'skipped' });
    expect(JSON.stringify(off)).toContain('Its add-on is switched off.');

    // The same rule as an owner's own: the add-on's switch is not read, and the run goes on to look for its record.
    const mine = { ...low!, managedBy: null };
    const own = await run(mine);
    expect(JSON.stringify(own)).not.toContain('Its add-on is switched off.');
    expect(JSON.stringify(own)).toContain('Record no longer exists');
  });
});
