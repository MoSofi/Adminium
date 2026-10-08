// SPDX-License-Identifier: AGPL-3.0-only
/**
 * POST_TO_LEDGER — the Designer's tool that makes a table of the app post
 * into an add-on's ledger, against a real starter app on disk.
 *
 * It writes the table's columns and rule, the requirement, the role's read
 * grant and the app's floor together, and nothing at all when the app's own
 * check refuses the result. An add-on that is not here is asked for on the
 * way, once a turn.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import type { AddOnGetter, AddOnLook } from '../src/designer/get-add-on.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools, DESIGNER_TOOL_NAMES } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const VERSION = '0.3.18';
let root: string;
let asked: CardRequest[];
let answers: CardAnswer[];
let onServer: boolean;
let gets: string[];
let looks: AddOnLook;
let turn: number;

const tools = (version = VERSION): DesignerTool[] =>
  createDesignerTools(
    {
      root,
      version,
      designer: () => ({ store: { messages: () => [] } }) as never,
      skills: createSkills(),
      listAddOns: async () => [],
      addOnGetter: {
        look: async () => (onServer ? { state: 'installed', name: 'Ledger kit', version: '1.0.0' } : looks),
        allowed: async () => true,
        switchOn: async () => ({ ok: true }),
        get: async (key) => {
          gets.push(key);
          onServer = true;
          return { ok: true, name: 'Ledger kit', version: '1.0.0' };
        },
      } satisfies AddOnGetter,
      readAddOn: async (key) => (onServer && key === 'ledger-kit' ? ledgerKitManifest() : null),
    },
    'repairs',
  );
const context = (): ToolContext => {
  const signal = new AbortController().signal;
  const ask = async (card: CardRequest): Promise<CardAnswer> => {
    asked.push(card);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('nobody answered');
    return answer;
  };
  const session = { id: 'ds_000000000000000000000000', appKey: 'repairs' } as DesignerSession;
  return { session, turn, signal, ask, handle: { turn, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
};
const post = (input: Record<string, unknown> = {}, version = VERSION) =>
  tools(version)
    .find((tool) => tool.name === 'post_to_ledger')!
    .run({ add_on: 'ledger-kit', ledger: 'units', action: 'use', table: 'item_parts', via: 'item_id', when: { post: { column: 'status', in: ['done'] }, reverse: { column: 'status', from: ['done'], in: ['open'] } }, ...input }, context());
const file = (name: string) => join(root, 'apps/repairs/manifest', name);
const json = (name: string) => JSON.parse(readFileSync(file(name), 'utf8')) as Record<string, unknown>;
const parts = () => writeFileSync(file('tables/item_parts.json'), JSON.stringify({ ref: 'item_parts', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'item_id', type: 'fk', references: 'items' }] }));
const errors = () => checkApp(root, 'repairs', { version: VERSION }).findings.filter((finding) => finding.level === 'error').map((finding) => `${finding.file} · ${finding.path} · ${finding.message}`);

beforeEach(async () => {
  root = tempProject('adminium-designer-ledger-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
  asked = [];
  answers = [];
  gets = [];
  onServer = true;
  turn = 1;
  looks = { state: 'here', name: 'Ledger kit', version: '1.0.0', line: 'Units by account.', tables: 7 };
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('post_to_ledger', () => {
  it('is one of the Designer\'s tools', () => {
    expect(DESIGNER_TOOL_NAMES).toContain('post_to_ledger');
    expect(tools().map((tool) => tool.name)).toContain('post_to_ledger');
  });

  it('writes the columns, the rule, the requirement, the role\'s grant and the floor together, and the app still checks', async () => {
    parts();
    const done = await post({ role: 'staff' });
    expect(done.isError, done.content).toBeUndefined();
    expect(done.label).toBe('Posts item_parts into ledger-kit');
    const table = json('tables/item_parts.json') as { columns: { ref: string }[]; postings: unknown[] };
    expect(table.columns.map((column) => column.ref)).toEqual(['id', 'item_id', 'account_id', 'qty']);
    expect(table.postings).toEqual([
      {
        id: 'units',
        into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
        via: 'item_id',
        post: { on: { column: 'status', in: ['done'] } },
        reverse: { on: { column: 'status', from: ['done'], in: ['open'] } },
        map: { account: 'account_id', quantity: 'qty' },
      },
    ]);
    expect(json('add-ons.json')).toMatchObject({ requires: [{ key: 'ledger-kit', range: '>=1.0.0' }] });
    const staff = (json('roles.json') as unknown as { key: string; tables?: unknown[] }[]).find((role) => role.key === 'staff')!;
    expect(staff.tables).toEqual([{ addOn: 'ledger-kit', table: 'accounts', actions: ['read'] }]);
    expect((json('app.json') as { compatibility: { minAdminiumVersion: string } }).compatibility.minAdminiumVersion).toBe('0.3.18');
    expect(errors()).toEqual([]);
    expect(done.content).toContain('added account_id (int, a link to ledger-kit.accounts), qty (decimal, scale 4)');
    expect(done.content).toContain('apps/repairs/manifest/add-ons.json: requires ledger-kit >=1.0.0');
    expect(done.content).toContain('"minAdminiumVersion" is now 0.3.18');
    expect(done.content).toContain('Left to you: a page for the table');

    // Called again with another moment: the rule is replaced, nothing is added twice.
    const again = await post({ role: 'staff', when: { post: { create: true } } });
    expect(again.isError, again.content).toBeUndefined();
    expect(again.content).toContain('no column added');
    const after = json('tables/item_parts.json') as { columns: unknown[]; postings: { post: unknown }[] };
    expect(after.columns).toHaveLength(4);
    expect(after.postings).toHaveLength(1);
    expect(after.postings[0]!.post).toEqual({ on: { create: true } });
    expect((json('add-ons.json') as { requires: unknown[] }).requires).toHaveLength(1);
    expect((json('roles.json') as unknown as { key: string; tables?: unknown[] }[]).find((role) => role.key === 'staff')!.tables).toHaveLength(1);
  });

  it('with "suggests" the app runs without the add-on: a ticked suggestion, a feature, and the rule under it', async () => {
    parts();
    const done = await post({ need: 'suggests' });
    expect(done.isError, done.content).toBeUndefined();
    expect(json('add-ons.json')).toMatchObject({ suggests: [{ key: 'ledger-kit', range: '>=1.0.0', checked: true }], features: [{ id: 'ledger-kit', requires: ['ledger-kit'] }] });
    expect((json('tables/item_parts.json') as { postings: { needs?: string }[] }).postings[0]!.needs).toBe('ledger-kit');
    expect(errors()).toEqual([]);
  });

  it('the table must be there first, and the refusal says what to write', async () => {
    const refused = await post();
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content).toBe('There is no table "item_parts" yet. Write apps/repairs/manifest/tables/item_parts.json first (its id, its link to the row it belongs to, nothing about stock), then call this again.');
    // Nothing was asked of the person for a table that is not there.
    onServer = false;
    await post();
    expect(asked).toEqual([]);
  });

  it('asks for the add-on on the way, once a turn', async () => {
    parts();
    onServer = false;
    answers = [{ type: 'add-on', accept: true }];
    const done = await post();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: 'add-on', key: 'ledger-kit', here: true, tables: 7 });
    expect(gets).toEqual(['ledger-kit']);
    expect(done.isError, done.content).toBeUndefined();
  });

  it('a no is kept for the turn: nothing is written, and the card is not shown twice', async () => {
    parts();
    onServer = false;
    answers = [{ type: 'add-on', accept: false }];
    const first = await post();
    expect(first).toMatchObject({ isError: true, label: 'Could not post into ledger-kit', facts: { outcome: 'declined' } });
    // The same tools, the same turn: asked once.
    const mine = tools();
    const run = mine.find((tool) => tool.name === 'post_to_ledger')!;
    const input = { add_on: 'ledger-kit', ledger: 'units', action: 'use', table: 'item_parts', when: { post: { create: true } } };
    answers = [{ type: 'add-on', accept: false }];
    asked = [];
    await run.run(input, context());
    expect((await run.run(input, context())).content).toContain('already said no');
    expect(asked).toHaveLength(1);
    expect(json('tables/item_parts.json')['postings']).toBeUndefined();
  });

  it('a rule the app\'s own check refuses is taken back whole', async () => {
    parts();
    const before = { table: readFileSync(file('tables/item_parts.json'), 'utf8'), roles: readFileSync(file('roles.json'), 'utf8'), app: readFileSync(file('app.json'), 'utf8') };
    // The row the lines belong to has no column "shipped_at": the manifest's check refuses the rule.
    const refused = await post({ role: 'staff', when: { post: { column: 'shipped_at', set: true } } });
    expect(refused, refused.content).toMatchObject({ isError: true });
    expect(refused.content).toContain('Nothing was written: with the rule in place the app\'s check says');
    expect(readFileSync(file('tables/item_parts.json'), 'utf8')).toBe(before.table);
    expect(readFileSync(file('roles.json'), 'utf8')).toBe(before.roles);
    expect(readFileSync(file('app.json'), 'utf8')).toBe(before.app);
    expect(() => readFileSync(file('add-ons.json'), 'utf8')).toThrow();
  });

  const check = async () => (await tools().find((tool) => tool.name === 'check_app')!.run({}, context())).content;

  it('check_app checks a rule against the add-on when it is here, and says so when it is not', async () => {
    parts();
    expect((await post()).isError).toBeUndefined();
    expect(await check()).toMatch(/^No errors\./);
    // The rule edited by hand: an input the action has not, and one it needs left out.
    const table = json('tables/item_parts.json') as { postings: { map: Record<string, unknown> }[] };
    table.postings[0]!.map = { account: 'account_id', amount: 'qty' };
    writeFileSync(file('tables/item_parts.json'), JSON.stringify(table));
    expect(await check()).toContain(
      'error · apps/repairs/manifest/tables/item_parts.json · postings.0 · "amount" is not an input of ledger-kit/units/use. Its inputs are account, quantity, note (optional). Call post_to_ledger for this table again; do not edit the rule by hand.',
    );
    table.postings[0]!.map = { account: 'account_id' };
    writeFileSync(file('tables/item_parts.json'), JSON.stringify(table));
    expect(await check()).toContain('"quantity" is not mapped. ledger-kit/units/use needs: account, quantity. Call post_to_ledger for this table again; do not edit the rule by hand.');
    // The add-on gone from this server: nothing is checked against it, and the check says so.
    onServer = false;
    const unchecked = await check();
    expect(unchecked).not.toContain('is not mapped');
    expect(unchecked).toContain(
      'warn · apps/repairs/manifest/add-ons.json · The add-on "ledger-kit" is not on this server, so the rule in tables/item_parts.json was not checked against it. Call get_add_on with "ledger-kit".',
    );
  });

  it('check_app sends a rule written by hand, with no requirement beside it, to the tool', async () => {
    parts();
    expect((await post()).isError).toBeUndefined();
    rmSync(file('add-ons.json'));
    const said = await check();
    expect(said).toContain('postings.0.into.addOn · "ledger-kit" is not an add-on this manifest names. Call post_to_ledger for this table: it writes the rule and the requirement together.');
  });

  it('says what a model got wrong on a real walk: no way back, nobody to pick a row, and who installs the add-on', async () => {
    parts();
    const bare = await post({ when: { post: { create: true } } });
    expect(bare.content).toContain('No "reverse" was given: what is taken is never given back, even when the row is undone or cancelled.');
    expect(bare.content).toContain('No role reads ledger-kit.accounts yet, so nobody could pick a row: call this again with "role".');
    expect(bare.content).toContain('Ledger kit is installed with the app when it is applied: do not tell the person to install it.');
    // The check says the same of a link nobody may pick from, with what to write.
    expect(await check()).toContain(
      'warn · apps/repairs/manifest/roles.json · No role reads ledger-kit.accounts, which item_parts.account_id links to, so nobody could pick a row there. On the role that fills it write "tables": [{ "addOn": "ledger-kit", "table": "accounts", "actions": ["read"] }] beside "permissions".',
    );
    const whole = await post({ role: 'staff' });
    expect(whole.content).not.toContain('No "reverse" was given');
    expect(whole.content).not.toContain('No role reads');
    expect(await check()).not.toContain('No role reads');
    // The grant written as a permission, as the model tried three ways: the refusal says where it goes.
    const roles = json('roles.json') as unknown as { permissions: string[]; tables?: unknown }[];
    delete roles[0]!.tables;
    roles[0]!.permissions.push('table:@ledger-kit.accounts:read');
    writeFileSync(file('roles.json'), JSON.stringify(roles));
    expect(await check()).toContain(
      '"table:@ledger-kit.accounts:read" is not a grant an app can give. A table of the add-on "ledger-kit" is granted beside "permissions", on the role itself: "tables": [{ "addOn": "ledger-kit", "table": "accounts", "actions": ["read"] }]',
    );
  });

  it('a column the model wrote itself is given its link and made one that may be empty, and the app checks', async () => {
    writeFileSync(file('tables/item_parts.json'), JSON.stringify({ ref: 'item_parts', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'item_id', type: 'fk', references: 'items' }, { ref: 'account_id', type: 'int' }, { ref: 'qty', type: 'decimal', scale: 2, default: 1 }] }));
    const done = await post();
    expect(done.isError, done.content).toBeUndefined();
    expect(done.content).toContain('no column added; account_id is now a link to ledger-kit.accounts, and may be empty; the rule "units"');
    expect((json('tables/item_parts.json') as { columns: unknown[] }).columns[2]).toEqual({ ref: 'account_id', type: 'int', rules: { addOnLink: { addOn: 'ledger-kit', table: 'accounts' } }, nullable: true });
    expect(errors()).toEqual([]);
  });

  it('a role that is not the app\'s, and a server too old for the rule, are refused before anything is written', async () => {
    parts();
    expect((await post({ role: 'cashier' })).content).toContain('There is no role "cashier" in apps/repairs/manifest/roles.json. Its roles: staff.');
    expect((await post({}, '0.3.17')).content).toBe('This server is Adminium 0.3.17, and a table that posts into an add-on needs 0.3.18 or later. Tell the person; build the app without it.');
    expect(json('tables/item_parts.json')['postings']).toBeUndefined();
  });
});
