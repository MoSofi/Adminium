// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DATABASE'S RULES, SAVED AS AN APP AND INSTALLED AGAIN.
 *
 * Each rule names the file's tables, roles and templates, never an id of the
 * place it was made. Whether it also watches rows written around Adminium is
 * always said. What goes out never travels: a webhook keeps its method, body
 * and header's name, a mail to typed addresses keeps only that it goes to
 * typed addresses; on the target both arrive empty and switched off, and the
 * "after you install" list names each. A rule a document's trigger made stays
 * with the document; a rule that tells people by name waits for an answer.
 * On every engine the machine runs.
 */
import { automationsRepo, documentProfilesRepo, emailTemplatesRepo, permissionsRepo, rolesRepo, usersRepo, type AutomationGraph, type AutomationTrigger } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { automationTarget } from '../src/apps/save/automations.js';
import { ENGINES, type Harness } from './app-install-harness.js';
import { afterInstallOf, APP_KEY, expectValid, installFile, leaked, save, sourceDatabase, standIns, target, type Doc, type Source } from './app-save-rules.helpers.js';

const WEBHOOK_URL = 'https://hooks.example.test/services/T0PATHPIECE';
const SEALED_HEADER = 'sealed-header-value-0f3a9c';
const BOSS = 'boss@example.test';

const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });
const trigger = node('t', 'trigger');

async function rules(source: Source) {
  const { meta, connectionId } = source.h;
  const orders = source.tableId('orders');
  const customers = source.tableId('customers');
  const clerk = await rolesRepo(meta).create({ slug: 'clerk', name: 'Clerk' });
  await permissionsRepo(meta).grant(clerk.id, 'table', `${connectionId}/${orders}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
  const builtin = (await rolesRepo(meta).list()).find((role) => role.isBuiltin)!;
  const owner = (await usersRepo(meta).findByEmail('owner@test'))!;
  const templates = emailTemplatesRepo(meta);
  await templates.upsert('welcome', 'en_US', { name: 'Welcome', subject: 'Welcome, {{record.name}}', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hello {{record.name}}' }, style: {} }], enabled: true });
  await templates.upsert('order-note', 'en_US', { name: 'Order note', subject: 'A new order', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'An order came in.' }, style: {} }], enabled: true });

  const repo = automationsRepo(meta);
  const make = (name: string, enabled: boolean, ruleTrigger: Doc, nodes: Doc[]) =>
    repo.create({ connectionId, name, enabled, trigger: ruleTrigger as AutomationTrigger, graph: { version: 1, nodes } as unknown as AutomationGraph, createdBy: owner.id });
  const onOrders = (event: string, watch: boolean, more: Doc = {}) => ({ kind: 'record', event, connectionId, table: orders, watch, ...more });

  const made = {
    tell: await make('Tell the clerk', true, onOrders('created', false), [
      trigger,
      node('n', 'action', { action: { kind: 'notification', to: { roles: [clerk.id, builtin.id] }, title: 'New order {{record.id}}', locales: { 'de-DE': { title: 'Neue Bestellung {{record.id}}', body: null } } } }),
    ]),
    welcome: await make('Welcome', true, { kind: 'record', event: 'created', connectionId, table: customers, watch: true }, [
      trigger,
      node('m', 'action', { action: { kind: 'email', templateKey: 'welcome', to: { kind: 'field', column: 'email' } } }),
    ]),
    late: await make('Late orders', true, { kind: 'schedule', connectionId, schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Berlin' }, forEach: { table: orders, where: [{ left: { field: 'status' }, op: 'is', right: 'open' }], once: true } }, [
      trigger,
      node('u', 'action', { action: { kind: 'record.update', values: { status: 'late' } } }),
    ]),
    ping: await make('Ping the shop', true, onOrders('updated', true, { changedColumn: 'status' }), [
      trigger,
      node('w', 'action', { action: { kind: 'webhook', url: WEBHOOK_URL, method: 'POST', bodyKind: 'json', body: '{"status":"{{record.status}}"}', headerName: 'Authorization', headerValueEncrypted: SEALED_HEADER } }),
    ]),
    boss: await make('Mail the boss', true, onOrders('created', false), [trigger, node('f', 'action', { action: { kind: 'email', templateKey: 'order-note', to: { kind: 'fixed', addresses: [BOSS] } } })]),
    sam: await make('Tell Sam', true, onOrders('created', false), [trigger, node('p', 'action', { action: { kind: 'notification', to: { users: [owner.id] }, title: 'Look' } })]),
  };
  // A document a rule draws, and a rule a document's own trigger made.
  const fromDocument = await make('Print on create', true, onOrders('created', false), [trigger]);
  const profile = await documentProfilesRepo(meta).create({ addOnKey: 'invoices', kind: 'invoice', name: 'Invoice', connectionId, table: orders, mapping: {}, trigger: { event: 'record.created', automationId: fromDocument.id } });
  const print = await make('Print the invoice', true, onOrders('updated', false, { changedColumn: 'status' }), [trigger, node('d', 'action', { action: { kind: 'document.render', profileId: profile.id } })]);
  return { clerk, builtin, owner, made, fromDocument, profile, print };
}

const ruleNamed = (doc: Doc, name: string): Doc | undefined => (doc['automations'] as Doc[] | undefined)?.find((rule) => rule['name'] === name);

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a database's rules, saved and installed [${dialect}]`, () => {
    let source: Source | null = null;
    let other: Harness | null = null;
    afterEach(async () => {
      await source?.h.close();
      await other?.close();
      source = null;
      other = null;
    });

    it('writes every rule by its refs, never what goes out, and installs the outbound ones switched off', async () => {
      source = await sourceDatabase(dialect);
      const ids = await rules(source);

      // Telling a person by name waits for an answer.
      const first = await save(source);
      expect(first.check).toContainEqual(expect.objectContaining({ group: 'choice', code: 'RULE_TELLS_PEOPLE', item: 'Tell Sam', answer: { choices: ['leave-out'], target: automationTarget(ids.made.sam.id) } }));
      const { manifest, check, files } = await save(source, { leaveOut: [automationTarget(ids.made.sam.id)] });
      expect(check.filter((item) => item.group === 'choice' && item.code !== 'NO_PAGE')).toEqual([]);
      const doc = manifest as unknown as Doc;

      expect((doc['automations'] as Doc[]).map((rule) => rule['name']).sort()).toEqual(['Late orders', 'Mail the boss', 'Ping the shop', 'Print the invoice', 'Tell the clerk', 'Welcome']);
      // Watching is always said, both ways.
      expect(ruleNamed(doc, 'Tell the clerk')!['trigger']).toEqual({ kind: 'record', event: 'created', table: 'orders', watch: false });
      expect(ruleNamed(doc, 'Welcome')!['trigger']).toEqual({ kind: 'record', event: 'created', table: 'customers', watch: true });
      expect(ruleNamed(doc, 'Ping the shop')!['trigger']).toEqual({ kind: 'record', event: 'updated', table: 'orders', changedColumn: 'status', watch: true });
      // The zone is the target's.
      expect(ruleNamed(doc, 'Late orders')!['trigger']).toEqual({ kind: 'schedule', schedule: { kind: 'daily', time: '09:00' }, forEach: { table: 'orders', where: [{ left: { field: 'status' }, op: 'is', right: 'open' }], once: true } });
      // A role by its key, a built-in role not at all; the other languages beside US English.
      expect(ruleNamed(doc, 'Tell the clerk')!['graph'].nodes[1].action).toEqual({ kind: 'notification', to: { roles: ['clerk'] }, title: { 'de-DE': 'Neue Bestellung {{record.id}}', 'en-US': 'New order {{record.id}}' } });
      expect(check).toContainEqual(expect.objectContaining({ group: 'info', code: 'RULE_ROLE_LEFT_OUT', item: 'Tell the clerk' }));
      // A template by the key the install gives it.
      expect(ruleNamed(doc, 'Welcome')!['graph'].nodes[1].action).toEqual({ kind: 'email', templateKey: `${APP_KEY}-welcome`, to: { kind: 'field', column: 'email' }, class: 'service' });
      expect((doc['emailTemplates'] as Doc[]).map((template) => template['key']).sort()).toEqual([`${APP_KEY}-order-note`, `${APP_KEY}-welcome`]);
      // What goes out: its shape, never its address or its header's value.
      expect(ruleNamed(doc, 'Ping the shop')!['graph'].nodes[1].action).toEqual({ kind: 'webhook', method: 'POST', bodyKind: 'json', body: '{"status":"{{record.status}}"}', headerName: 'Authorization' });
      expect(ruleNamed(doc, 'Mail the boss')!['graph'].nodes[1].action).toEqual({ kind: 'email', templateKey: `${APP_KEY}-order-note`, to: { kind: 'fixed' } });
      expect(ruleNamed(doc, 'Print the invoice')!['graph'].nodes[1].action).toEqual({ kind: 'document.render', document: { table: 'orders', kind: 'invoice', addOn: 'invoices' } });
      // The document's own rule stays with the document.
      expect(ruleNamed(doc, 'Print on create')).toBeUndefined();
      expect(check.filter((item) => item.group === 'after').map((item) => [item.code, item.item, item.field, item.afterKind]).sort()).toEqual([
        ['RULE_ADDRESSES', 'Mail the boss', 'f.to.addresses', 'address'],
        ['RULE_WEBHOOK', 'Ping the shop', 'w.url', 'webhook'],
        ['RULE_WEBHOOK_HEADER', 'Ping the shop', 'w.headerValue', 'webhook'],
      ]);

      // Nothing that goes out, and no id of the source.
      expect(leaked(doc, [WEBHOOK_URL, 'hooks.example.test', 'T0PATHPIECE', SEALED_HEADER, BOSS, source.h.connectionId, ids.clerk.id, ids.builtin.id, ids.owner.id, ids.profile.id, ids.print.id, 'Europe/Berlin'])).toEqual([]);

      const file = standIns(doc);
      expectValid(file);
      other = await target(dialect);
      await installFile(other, file, files);

      const installed = (await automationsRepo(other.meta).list({ connectionId: other.connectionId })).filter((rule) => rule.managedBy === APP_KEY);
      const byName = Object.fromEntries(installed.map((rule) => [rule.name, rule]));
      expect(Object.keys(byName).sort()).toEqual(['Late orders', 'Mail the boss', 'Ping the shop', 'Print the invoice', 'Tell the clerk', 'Welcome']);
      // Off where it sends out or waits for the owner, as it was elsewhere.
      expect(byName['Ping the shop']!.enabled).toBe(false);
      expect(byName['Mail the boss']!.enabled).toBe(false);
      expect(byName['Print the invoice']!.enabled).toBe(false);
      expect(byName['Tell the clerk']!.enabled).toBe(true);
      expect(byName['Welcome']!.enabled).toBe(true);
      expect((byName['Tell the clerk']!.trigger as { watch: boolean }).watch).toBe(false);
      expect((byName['Welcome']!.trigger as { watch: boolean }).watch).toBe(true);
      const ping = (byName['Ping the shop']!.graph.nodes[1] as unknown as { action: Doc }).action;
      expect(ping).toMatchObject({ kind: 'webhook', url: null, headerName: 'Authorization', headerValueEncrypted: null });
      const boss = (byName['Mail the boss']!.graph.nodes[1] as unknown as { action: Doc }).action;
      expect(boss['to']).toEqual({ kind: 'fixed', addresses: [] });
      const clerkHere = await rolesRepo(other.meta).findBySlug(`${APP_KEY}-clerk`);
      expect(((byName['Tell the clerk']!.graph.nodes[1] as unknown as { action: Doc }).action['to'] as Doc)).toEqual({ roles: [clerkHere!.id] });
      const zone = (byName['Late orders']!.trigger as { schedule: { timezone: string } }).schedule.timezone;
      expect(zone).toEqual(expect.any(String));

      expect(await afterInstallOf(other)).toEqual([
        ['address', 'mail-the-boss', 'f.to.addresses'],
        ['document', 'print-the-invoice', 'd.profileId'],
        ['webhook', 'ping-the-shop', 'w.headerValue'],
        ['webhook', 'ping-the-shop', 'w.url'],
      ]);
    });

    it('leaves out a rule on a table that does not travel, and one an installed app shipped', async () => {
      source = await sourceDatabase(dialect);
      await rules(source);
      const shipped = await automationsRepo(source.h.meta).create({
        connectionId: source.h.connectionId,
        name: 'Shipped',
        trigger: { kind: 'record', event: 'created', connectionId: source.h.connectionId, table: source.tableId('orders'), watch: false } as AutomationTrigger,
        graph: { version: 1, nodes: [trigger] } as unknown as AutomationGraph,
        managedBy: 'someone-else',
      });
      const { manifest, check } = await save(source, { tables: [source.tableId('orders')], leaveOut: [] });
      const doc = manifest as unknown as Doc;
      expect(ruleNamed(doc, 'Welcome')).toBeUndefined();
      expect(ruleNamed(doc, 'Shipped')).toBeUndefined();
      expect(check).toContainEqual(expect.objectContaining({ group: 'info', code: 'RULE_TABLE_LEFT_OUT', item: 'Welcome' }));
      expect(shipped.managedBy).toBe('someone-else');
    });
  });
}
