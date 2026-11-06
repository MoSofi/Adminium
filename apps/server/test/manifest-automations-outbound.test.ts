// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHIPPED RULE THAT SENDS OUT ARRIVES EMPTY AND SWITCHED OFF.
 *
 * A file never carries a webhook's address or its header's value, nor the
 * addresses a mail goes to. Whatever the file says of its switch, such a rule
 * is stored off, its steps empty; each empty value is an "after you install"
 * item, handed to the install's one seam. Filling them in is the owner's on
 * the rules page — which needs the automations permission and will not switch
 * on a rule with an empty step — and is no edit of the rule: an update still
 * rewrites it, carrying what the owner filled in.
 */
import { automationsRepo, rolesRepo, usersRepo, type Automation } from '@adminium/meta';
import { bareAddress } from '../src/installs/resolve.js';
import { onlyInstall } from './only-install.js';
import type { Manifest } from '@adminium/manifest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({ calls: [] as { install: unknown; items: unknown[] }[] }));
vi.mock('../src/apps/after-install.js', () => ({
  recordAfterInstall: async (_meta: unknown, install: unknown, items: unknown[]) => {
    seam.calls.push({ install, items: [...items] });
  },
}));

import { automationHashOf, installAutomations } from '../src/apps/manifest-automations.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { servePublic, type Served } from './public-lane.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest and a stored rule read freely
type Doc = Record<string, any>;

const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });
const TEMPLATE = { key: 'stock-kit-low', name: 'Low', locales: { 'en-US': { subject: '{{record.name}} is low', blocks: [{ block: 'email.text', data: { text: 'Only {{record.left}} left.' } }] } } };
const RULES: Doc[] = [
  {
    key: 'tell-slack',
    name: 'Tell the stock channel',
    // The file says on: a rule that calls out is stored off all the same.
    enabled: true,
    trigger: { kind: 'record', event: 'updated', table: 'items', changedColumn: 'zone', watch: true },
    graph: {
      version: 1,
      nodes: [
        node('t', 'trigger'),
        node('w', 'action', { action: { kind: 'webhook', bodyKind: 'slack', body: '{{record.name}} moved', headerName: 'X-Stock-Token' } }),
        node('n', 'action', { action: { kind: 'notification', to: { roles: ['manager'] }, title: '{{record.name}} moved' } }),
      ],
    },
  },
  {
    key: 'mail-buyer',
    name: 'Mail the buyer',
    enabled: true,
    trigger: { kind: 'record', event: 'updated', table: 'items', changedColumn: 'zone' },
    graph: { version: 1, nodes: [node('t', 'trigger'), node('m', 'action', { action: { kind: 'email', templateKey: 'stock-kit-low', to: { kind: 'fixed' } } })] },
  },
  {
    key: 'tidy',
    name: 'Tidy',
    enabled: true,
    trigger: { kind: 'record', event: 'updated', table: 'items', changedColumn: 'zone' },
    graph: { version: 1, nodes: [node('t', 'trigger'), node('u', 'action', { action: { kind: 'record.update', values: { opening: '0' } } })] },
  },
];
const kit = (rules: Doc[] = RULES): Doc => {
  const base = stockKitManifest() as Doc;
  return { ...base, compatibility: { minAdminiumVersion: '0.3.49' }, emailTemplates: [TEMPLATE], automations: structuredClone(rules) };
};

async function harness(): Promise<Harness> {
  const h = await addOnHarness('sqlite', { unbuiltWords: {} });
  await h.stageAddOn(kit(), { files: { 'dist/client.js': 'export default function Count() { return null; }' } });
  const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
  expect(reply.statusCode, reply.body).toBe(200);
  return h;
}
const rulesOf = (h: Harness) => automationsRepo(h.meta).listManagedBy('stock-kit', h.connectionId);
const byKey = async (h: Harness, key: string): Promise<Automation> => (await rulesOf(h)).find((rule) => rule.templateKey === key)!;
const action = (rule: Automation, id: string): Doc => ((rule.graph.nodes as Doc[]).find((one) => one['id'] === id) as Doc)['action'];
const again = async (h: Harness, doc: Doc) => {
  const view = await loadSnapshotView(h.meta, h.connectionId);
  return installAutomations({ meta: h.meta, manifest: doc as unknown as Manifest, install: bareAddress((await onlyInstall(h.meta, 'stock-kit')).installId, 'stock-kit'), connectionId: h.connectionId, view, realId: (ref) => view.model.tables.find((table) => table.name === `stock_kit_${ref}`)?.id ?? ref });
};

describe('a shipped rule that sends out', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
    seam.calls.length = 0;
  });

  it('is stored switched off with no address, whatever the file says; a rule that sends nothing out keeps its switch', async () => {
    h = await harness();
    const slack = await byKey(h, 'tell-slack');
    expect(slack.enabled).toBe(false);
    expect(slack.nextRunAt).toBeNull();
    expect(action(slack, 'w')).toMatchObject({ kind: 'webhook', url: null, method: 'POST', bodyKind: 'slack', body: '{{record.name}} moved', headerName: 'X-Stock-Token', headerValueEncrypted: null });
    // It watches rows written around Adminium, as its file asks.
    expect((slack.trigger as Doc)['watch']).toBe(true);
    const mail = await byKey(h, 'mail-buyer');
    expect(mail.enabled).toBe(false);
    expect(action(mail, 'm')['to']).toEqual({ kind: 'fixed', addresses: [] });
    expect((await byKey(h, 'tidy')).enabled).toBe(true);
    for (const rule of await rulesOf(h)) expect(rule.contentHash).toBe(automationHashOf(rule));
  });

  it('hands every empty value to the install\'s seam, once, as data', async () => {
    h = await harness();
    const calls = seam.calls.filter((call) => (call.install as { appKey: string }).appKey === 'stock-kit');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.install).toEqual({ manifestId: expect.any(String), appKey: 'stock-kit' });
    expect(calls[0]!.items).toEqual([
      { kind: 'webhook', item: 'tell-slack', field: 'w.url' },
      { kind: 'webhook', item: 'tell-slack', field: 'w.headerValue' },
      { kind: 'address', item: 'mail-buyer', field: 'm.to.addresses' },
    ]);
  });

  it('keeps what the owner filled in out of its fingerprint: an update rewrites it and carries the address over', async () => {
    h = await harness();
    const repo = automationsRepo(h.meta);
    const slack = await byKey(h, 'tell-slack');
    const filled = structuredClone(slack.graph) as Doc;
    (filled['nodes'] as Doc[])[1]!['action'] = { ...action(slack, 'w'), url: 'https://hooks.slack.com/services/test-not-a-key-0001', headerValueEncrypted: 'sealed-test-value' };
    await repo.update(slack.id, { graph: filled as never, enabled: true });
    const mail = await byKey(h, 'mail-buyer');
    const typed = structuredClone(mail.graph) as Doc;
    (typed['nodes'] as Doc[])[1]!['action'] = { ...action(mail, 'm'), to: { kind: 'fixed', addresses: ['buyer@example.test'] } };
    await repo.update(mail.id, { graph: typed as never });
    // Filled in, and switched on: neither is an edit.
    for (const rule of await rulesOf(h)) expect(automationHashOf(rule)).toBe(rule.contentHash);

    const next = structuredClone(RULES);
    next[0]!['name'] = 'Tell the stock channel, v2';
    next[0]!['graph'].nodes[1].action.body = '{{record.name}} moved to {{record.zone}}';
    next[1]!['name'] = 'Mail the buyer, v2';
    const result = await again(h, kit(next));
    expect(result).toMatchObject({ written: ['tell-slack', 'mail-buyer', 'tidy'], kept: [] });
    // Nothing is left to fill in.
    expect(result?.afterInstall).toEqual([]);
    const after = await byKey(h, 'tell-slack');
    expect(after).toMatchObject({ name: 'Tell the stock channel, v2', enabled: true });
    expect(action(after, 'w')).toMatchObject({ url: 'https://hooks.slack.com/services/test-not-a-key-0001', headerValueEncrypted: 'sealed-test-value', body: '{{record.name}} moved to {{record.zone}}' });
    expect(action(await byKey(h, 'mail-buyer'), 'm')['to']).toEqual({ kind: 'fixed', addresses: ['buyer@example.test'] });
    for (const rule of await rulesOf(h)) expect(rule.contentHash).toBe(automationHashOf(rule));

    // A header renamed by the update: the value given for the old one is not carried to it.
    const renamed = structuredClone(next);
    renamed[0]!['graph'].nodes[1].action.headerName = 'X-Other-Token';
    const again2 = await again(h, kit(renamed));
    expect(again2?.afterInstall).toEqual([{ kind: 'webhook', item: 'tell-slack', field: 'w.headerValue' }]);
    expect(action(await byKey(h, 'tell-slack'), 'w')).toMatchObject({ headerName: 'X-Other-Token', headerValueEncrypted: null });
  });

  it('a real edit is still an edit: the update leaves it, and its empty values stay listed', async () => {
    h = await harness();
    const repo = automationsRepo(h.meta);
    const slack = await byKey(h, 'tell-slack');
    await repo.update(slack.id, { name: 'My own channel rule' });
    const result = await again(h, kit());
    expect(result?.kept).toEqual(['tell-slack']);
    expect(result?.afterInstall).toContainEqual({ kind: 'webhook', item: 'tell-slack', field: 'w.url' });
  });
});

describe('switching such a rule on', () => {
  let h: Harness;
  let served: Served;
  const cookies: Record<string, string> = {};
  const api = (who: string, method: string, url: string, payload?: unknown) =>
    served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: { cookie: cookies[who] ?? '' }, ...(payload === undefined ? {} : { payload: payload as never }) });

  beforeAll(async () => {
    h = await harness();
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const sign = async (who: string, role: string) => {
      const user = await usersRepo(h.meta).create({ email: `${who}@rules.dev`, name: who, passwordHash: await adminPasswordHash() });
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(role))!.id);
      const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${who}@rules.dev`, password: ADMIN_PASSWORD } });
      cookies[who] = sessionCookie(login.headers['set-cookie']);
    };
    await sign('boss', 'super-admin');
    await sign('ed', 'editor');
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  it('needs the automations permission, and every step filled in; then it is on, and still the add-on\'s unedited rule', async () => {
    const slack = await byKey(h, 'tell-slack');
    const refused = await api('ed', 'PATCH', `/automations/${slack.id}`, { enabled: true });
    expect(refused.statusCode, refused.body).toBe(403);
    const empty = await api('boss', 'PATCH', `/automations/${slack.id}`, { enabled: true });
    expect(empty.statusCode, empty.body).toBe(422);
    expect(empty.json()).toMatchObject({ error: { code: 'AUTOMATION_INCOMPLETE' } });

    const graph = structuredClone(slack.graph) as Doc;
    (graph['nodes'] as Doc[])[1]!['action'] = { ...action(slack, 'w'), url: 'https://hooks.slack.com/services/test-not-a-key-0002', headerValue: 'test-not-a-key-0003' };
    const filled = await api('boss', 'PATCH', `/automations/${slack.id}`, { graph });
    expect(filled.statusCode, filled.body).toBe(200);
    const on = await api('boss', 'PATCH', `/automations/${slack.id}`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({ enabled: true, managed: { key: 'stock-kit', edited: false } });
  });
});
