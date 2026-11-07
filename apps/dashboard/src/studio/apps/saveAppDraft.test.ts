// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: the draft the quick save and the wizard share.
 *
 * What matters: an answer is recorded exactly where its Check item says (the
 * per-choice value when the item gives one); a personal view is answered
 * "stays behind" by default, with its own item's value; ticking brings what a
 * thing needs; unticking names what would lose it; and the quick save's count
 * is Check's.
 */
import { describe, expect, it } from 'vitest';

import type { CheckItem, SaveInventory, SavePlan } from './saveAppApi.js';
import { answerTarget, compareVersions, nextVersionAfter } from './saveAppApi.js';
import {
  dependentsOf,
  draftFromInventory,
  groupCheck,
  keyFromName,
  learnViewItems,
  needsCount,
  requestOf,
  tick,
  untick,
} from './saveAppDraft.js';
import { aboutProblems, looksLikeAddress, nextVersionFor } from './saveAppAbout.js';
import { saveDatabases } from './saveAppDatabases.js';
import { answerLabel, answeredSentence } from './saveAppWords.js';
import { makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';

function inventory(over: Partial<SaveInventory> = {}): SaveInventory {
  return {
    connectionId: 'con_1',
    tables: [
      { id: 'public.customers', name: 'customers', columns: 4, rows: 1240, rowsExact: true, links: [], personal: ['email'], secretLike: ['api_token'], rowsAllowed: true, personalAllowed: true },
      { id: 'public.orders', name: 'orders', columns: 5, rows: 12, rowsExact: true, links: [{ column: 'customer_id', to: 'public.customers', required: false }], personal: [], secretLike: [], rowsAllowed: true, personalAllowed: true },
    ],
    pages: [
      { id: 'page_customers', title: 'Customers', tableId: 'public.customers', generated: true },
      { id: 'page_orders', title: 'Orders', tableId: 'public.orders', generated: false },
    ],
    views: [
      { id: 'view_shared', name: 'Everyone', pageId: 'page_orders', ownerId: null },
      { id: 'view_mine', name: 'Late ones', pageId: 'page_orders', ownerId: 'usr_rosa' },
    ],
    roles: [{ id: 'role_1', name: 'Roasters' }],
    automations: [{ id: 'aut_1', name: 'Welcome new customers', tableIds: ['public.customers'] }],
    emailTemplates: [{ key: 'spring', name: 'Spring news' }],
    documents: [],
    reports: [],
    invoiceLayouts: [],
    scheduledReports: [{ id: 'sch_1', name: 'Monday orders', tableIds: [], pageId: 'page_orders' }],
    publicEndpoints: [],
    payments: false,
    instance: true,
    ...over,
  };
}

const personalView: CheckItem = {
  group: 'choice',
  code: 'PERSONAL_VIEW',
  kind: 'view',
  item: 'Orders: Late ones',
  message: 'x',
  answer: { choices: ['make-shared', 'leave-out'], target: 'view_mine', targets: { 'leave-out': 'view:view_mine' } },
};
const secret: CheckItem = {
  group: 'choice',
  code: 'SECRET_FOUND',
  kind: 'automation',
  item: 'Post to Slack',
  field: 'steps[0].body',
  message: 'x',
  answer: { choices: ['clear', 'leave-out'], target: 'automation:Post to Slack:steps[0].body', targets: { 'leave-out': 'automation:Post to Slack' } },
};
const noType: CheckItem = {
  group: 'choice',
  code: 'TYPE_NO_FORM',
  kind: 'column',
  item: 'activity_log',
  field: 'ip_address',
  message: 'x',
  answer: { choices: ['carry-as-text', 'leave-out'], target: 'public.activity_log.ip_address' },
};

function plan(check: CheckItem[], over: Partial<SavePlan> = {}): SavePlan {
  return { key: 'fernhill-ops', version: '1.0.0', lineage: 'new', label: 'Fernhill main', minAdminiumVersion: '0.3.49', ready: false, check, problems: [], counts: {}, ...over };
}

describe('the save draft', () => {
  it('starts with everything ticked, no rows and nothing answered', () => {
    const draft = draftFromInventory(inventory(), { name: 'Fernhill Ops', key: 'fernhill-ops' });
    const request = requestOf(draft, inventory());
    expect(request).toMatchObject({
      connectionId: 'con_1',
      key: 'fernhill-ops',
      name: 'Fernhill Ops',
      include: { tables: ['public.customers', 'public.orders'], pages: ['page_customers', 'page_orders'], emailTemplates: ['spring'], instance: false, payments: false },
    });
    expect(request.rows).toBeUndefined();
    expect(request.answers).toBeUndefined();
    expect(request.version).toBeUndefined();
    expect(request.icon).toBeUndefined();
    expect(requestOf({ ...draft, icon: 'coffee' }, inventory()).icon).toBe('coffee');
  });

  it('records each answer under its list, with the value the item gives for that choice', () => {
    let draft = draftFromInventory(inventory(), { name: 'Fernhill Ops', key: 'fernhill-ops' });
    draft = { ...draft, answers: { a: { item: secret, choice: 'leave-out' }, b: { item: noType, choice: 'carry-as-text' } } };
    expect(requestOf(draft, inventory()).answers).toEqual({ leaveOut: ['automation:Post to Slack'], carryAsText: ['public.activity_log.ip_address'] });
    draft = { ...draft, answers: { a: { item: secret, choice: 'clear' } } };
    expect(requestOf(draft, inventory()).answers).toEqual({ clear: ['automation:Post to Slack:steps[0].body'] });
    expect(answerTarget(noType, 'leave-out')).toBe('public.activity_log.ip_address');
    expect(answerTarget(noType, 'keep')).toBeNull();
  });

  it('answers a personal view "stays behind" once its item is known, and shares it when made shared', () => {
    const base = draftFromInventory(inventory(), { name: 'Fernhill Ops', key: 'fernhill-ops' });
    const learned = learnViewItems(base, plan([personalView, noType]));
    expect(learned).not.toBeNull();
    expect(learnViewItems(learned!, plan([personalView]))).toBeNull();
    expect(requestOf(learned!, inventory()).answers).toEqual({ leaveOut: ['view:view_mine'] });
    expect(requestOf({ ...learned!, sharedViews: ['view_mine'] }, inventory()).answers).toEqual({ shareViews: ['view_mine'] });
    // A view of a page left out is asked about by nobody.
    expect(requestOf(untick(learned!, [{ kind: 'pages', id: 'page_orders' }]), inventory()).answers).toBeUndefined();
  });

  it('sends rows only for ticked tables, and the version only when typed', () => {
    const draft = { ...draftFromInventory(inventory(), { name: 'x', key: 'xx' }), version: '2.0.0', rows: { 'public.customers': { mode: 'starting' as const, viewId: 'view_shared' }, 'public.orders': { mode: 'none' as const } } };
    expect(requestOf(draft, inventory())).toMatchObject({ version: '2.0.0', rows: { 'public.customers': { mode: 'starting', viewId: 'view_shared' } } });
    expect(requestOf(untick(draft, [{ kind: 'tables', id: 'public.customers' }]), inventory()).rows).toBeUndefined();
  });

  it('brings what a thing needs when it is ticked, and names what would lose a table', () => {
    const inv = inventory();
    let draft = untick(draftFromInventory(inv, { name: 'x', key: 'xx' }), [
      { kind: 'tables', id: 'public.orders' },
      { kind: 'pages', id: 'page_orders' },
      { kind: 'scheduledReports', id: 'sch_1' },
    ]);
    const ticked = tick(inv, draft, { kind: 'scheduledReports', id: 'sch_1' });
    expect(ticked.brought).toEqual([
      { kind: 'pages', id: 'page_orders' },
      { kind: 'tables', id: 'public.orders' },
    ]);
    draft = ticked.draft;
    expect(dependentsOf(inv, draft, { kind: 'tables', id: 'public.customers' })).toEqual({
      things: [
        { kind: 'pages', id: 'page_customers' },
        { kind: 'automations', id: 'aut_1' },
      ],
      links: [{ tableId: 'public.orders', column: 'customer_id' }],
    });
    expect(dependentsOf(inv, draft, { kind: 'pages', id: 'page_orders' }).things).toEqual([{ kind: 'scheduledReports', id: 'sch_1' }]);
  });

  it('counts what needs the person as Check does: blocks, then choices with the views as one', () => {
    const p = plan([secret, noType, { group: 'after', code: 'SENDER', kind: 'email', item: 'Welcome', message: 'x' }], { problems: [{ code: 'PLAN_REFUSED', message: 'no' }] });
    expect(groupCheck(p)).toMatchObject({ blocks: [secret], choices: [noType] });
    expect(needsCount(p, 0)).toEqual({ blocks: 2, choices: 1 });
    expect(needsCount(p, 10)).toEqual({ blocks: 2, choices: 2 });
  });

  it('words a key of several columns as kept unique together, never as text', () => {
    const composite: CheckItem = { ...noType, code: 'COMPOSITE_KEY', kind: 'table', item: 'pairs' };
    expect(answerLabel('carry-as-text', composite)).toBe('Keep them unique together');
    expect(answerLabel('carry-as-text', noType)).toBe('Carry as text');
    expect(answeredSentence(composite, 'carry-as-text')).toMatch(/unique together, and no key/);
  });

  it('makes a key from a name, and numbers versions as the server does', () => {
    expect(keyFromName('Fernhill Café Ops')).toBe('fernhill-cafe-ops');
    expect(keyFromName('2024 Ops')).toBe('ops');
    expect(keyFromName('!')).toBe('');
    expect(nextVersionAfter('1.0.9')).toBe('1.0.10');
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
  });
});

describe('what the app is called', () => {
  const saves = [
    { id: 'asv_1', key: 'fernhill-ops', version: '1.0.3', connectionId: 'con_1', name: 'Fernhill Ops', description: null, label: 'Fernhill main', icon: null, savedBy: null, savedByName: null, savedAt: 1, integrity: 'sha512-x', bytes: 1, downloadable: true },
    { id: 'asv_2', key: 'kiln', version: '1.0.0', connectionId: 'con_2', name: 'Kiln', description: null, label: 'Kiln', icon: null, savedBy: null, savedByName: null, savedAt: 1, integrity: 'sha512-x', bytes: 1, downloadable: true },
  ];
  const draft = (over: object) => ({ ...draftFromInventory(inventory(), { name: 'Fernhill Ops', key: 'fernhill-ops' }), ...over });

  it('takes the next version and refuses a saved or older one', () => {
    expect(nextVersionFor('fernhill-ops', saves)).toBe('1.0.4');
    expect(nextVersionFor('new-one', saves)).toBe('1.0.0');
    expect(aboutProblems(draft({}), saves, 'con_1')).toBeNull();
    expect(aboutProblems(draft({ version: '1.0.3' }), saves, 'con_1')?.version).toBe('1.0.3 was already saved. A saved version can’t be saved again.');
    expect(aboutProblems(draft({ version: '1.0.1' }), saves, 'con_1')?.version).toMatch(/older than 1\.0\.3/);
  });

  it('refuses a key another database saved, an adminium.dev key, and an address for a label', () => {
    expect(aboutProblems(draft({ key: 'kiln' }), saves, 'con_1')?.key).toMatch(/another database/);
    expect(aboutProblems(draft({ key: 'shop' }), saves, 'con_1', new Set(['shop']))?.key).toMatch(/adminium\.dev/);
    expect(aboutProblems(draft({ key: 'X' }), saves, 'con_1')?.key).toMatch(/lower-case/);
    expect(aboutProblems(draft({ label: 'https://fernhill.example' }), saves, 'con_1')?.label).toBeDefined();
    expect(looksLikeAddress('fernhill.example.com')).toBe(true);
    expect(looksLikeAddress('Fernhill main')).toBe(false);
  });
});

describe('the databases Save as app offers', () => {
  const connection = (id: string, name: string) => ({ id, name, engine: 'postgres', tableCount: 3 }) as unknown as ConnectionDto;
  const connections = [connection('con_a', 'archive'), connection('con_f', 'fernhill'), connection('con_k', 'kiln')];

  it('lists each database once with its workspace chips, the current workspace first', () => {
    const bootstrap = {
      ...makeBootstrap(),
      workspaces: {
        workspaces: [
          { id: 'ws_k', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: ['con_k', 'con_f'] },
          { id: 'ws_f', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: ['con_f'] },
        ],
        otherDatabases: ['con_a'],
        workspaceView: 'one',
        lastWorkspaceId: 'ws_k',
        manage: true,
      },
    } as unknown as Parameters<typeof saveDatabases>[1];
    const rows = saveDatabases(connections, bootstrap, 'ws_k');
    expect(rows.map((row) => [row.connection.name, row.workspaces, row.other])).toEqual([
      ['fernhill', ['Fernhill Coffee', 'Kiln Street Pottery'], false],
      ['kiln', ['Kiln Street Pottery'], false],
      ['archive', [], true],
    ]);
    const all = saveDatabases(connections, { ...(bootstrap as object), workspaces: { ...(bootstrap as unknown as { workspaces: object }).workspaces, workspaceView: 'all' } } as never);
    expect(all.map((row) => row.connection.name)).toEqual(['archive', 'fernhill', 'kiln']);
    // The tab's workspace, never the server's last choice: "Other databases" puts its own first.
    expect(saveDatabases(connections, bootstrap, 'other').map((row) => row.connection.name)).toEqual(['archive', 'fernhill', 'kiln']);
    expect(saveDatabases(connections, bootstrap, 'ws_f').map((row) => row.connection.name)).toEqual(['fernhill', 'archive', 'kiln']);
    expect(saveDatabases(connections, bootstrap).map((row) => row.connection.name)).toEqual(['archive', 'fernhill', 'kiln']);
  });

  it('has no chips while the server has no workspaces', () => {
    expect(saveDatabases(connections, makeBootstrap()).every((row) => row.workspaces.length === 0 && !row.other)).toBe(true);
  });
});
