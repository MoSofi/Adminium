// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Designer's model is told, and how a long session is made to fit.
 *
 * The smallest window the Designer builds with is an OpenAI-compatible
 * server's (24,000 tokens read). What the model must be told, with every
 * skill a request can pull in, has to leave room in it for the
 * conversation; and when the conversation grows, what is cut must never
 * leave a provider a transcript it refuses.
 */
import { withPictures } from '../src/designer/prompt.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ASSISTANT_INPUT_TOKEN_LIMIT, estimateTokens, type RunMessage } from '@adminium/llm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appNow, createPrompt, MENTIONS_ADD_ON, MENTIONS_OWN_ROW, MENTIONS_SCREENS, OWN_ROW_GUIDE, skillsFor, taskGuides, trimTranscript } from '../src/designer/prompt.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { emptyFirstPreview, placeholderScreens, unopenedTables, unreadPersonalColumns } from '../src/designer/service.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import { closeDangling } from '../src/designer/transcript.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
beforeEach(async () => {
  root = tempProject('adminium-designer-prompt-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs', '--staff', '--customer', '--no-install'], { io, deps }), io.stderr()).toBe(0);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const session = (over: Partial<DesignerSession> = {}): DesignerSession =>
  ({ id: 'ds_000000000000000000000000', appKey: 'repairs', target: 'auto', connectionId: 'env:ollama', model: 'm', ...over }) as DesignerSession;
const say = (role: 'user' | 'assistant', text: string): RunMessage => ({ role, content: [{ type: 'text', text }] });

describe('what the Designer’s model is told', () => {
  it('carries the entry and app skills always, the screens skill for screens, the add-ons skill when one is named', () => {
    expect(skillsFor(session(), { hasSides: false, mentionsAddOn: false })).toEqual(['adminium/SKILL.md', 'adminium-app/SKILL.md', 'adminium-app/references/INDEX.md']);
    expect(skillsFor(session({ target: 'web' }), { hasSides: false, mentionsAddOn: false })).toContain('adminium-surface/SKILL.md');
    // Asked for in words, on Auto: the screens skill is carried from the first turn. Never for "dashboard only".
    expect(skillsFor(session(), { hasSides: false, mentionsAddOn: false, mentionsScreens: true })).toContain('adminium-surface/SKILL.md');
    expect(skillsFor(session({ target: 'dashboard' }), { hasSides: false, mentionsAddOn: false, mentionsScreens: true })).not.toContain('adminium-surface/SKILL.md');
    expect(MENTIONS_SCREENS.test('Customers need a public page where they can see our cake menu')).toBe(true);
    expect(MENTIONS_SCREENS.test('I track customers, their bikes and repair jobs')).toBe(false);
    expect(skillsFor(session(), { hasSides: true, mentionsAddOn: true })).toEqual(expect.arrayContaining(['adminium-surface/SKILL.md', 'adminium-add-ons/SKILL.md']));
  });

  it('puts the tested recipe in front of the model when the last request is about a person’s own row, and only then', async () => {
    for (const asked of [
      'Add a page where a customer can track their order: they enter the email they ordered with.',
      'Customers should be able to check the status of their booking.',
      'Let people look up their own ticket.',
      'an order tracking page',
    ]) {
      expect(MENTIONS_OWN_ROW.test(asked), asked).toBe(true);
    }
    for (const asked of ['A bakery takes cake orders. Staff need a screen to see the orders.', 'I track customers, their bikes and repair jobs', 'Make the page darker.']) {
      expect(MENTIONS_OWN_ROW.test(asked), asked).toBe(false);
    }
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'openai-compatible' });
    const about = await prompt(session({ target: 'web' }), [say('user', 'A bakery.'), say('assistant', 'Built.'), say('user', 'Add a page where a customer can track their order.')]);
    expect(about.system).toContain(`===== ${OWN_ROW_GUIDE} =====`);
    expect(about.system).toContain('"claim": { "match": ["code", "customer_email"] }');
    expect(about.system).toContain('`${orders}_claimed`');
    // The next turn is about something else: the page is not carried again.
    const after = await prompt(session({ target: 'web' }), [say('user', 'Add a page where a customer can track their order.'), say('assistant', 'Done.'), say('user', 'Make the buttons bigger.')]);
    expect(after.system).not.toContain(OWN_ROW_GUIDE.concat(' ====='));
    // Mid-turn, the server sends a line back ("Before you finish…"): the recipe stays, because the runner says what the person wrote.
    const nudged = [say('user', 'Add a page where a customer can track their order.'), say('assistant', ''), say('user', 'Before you finish:\n- The table "orders" has no dashboard page: nobody can open it.')];
    expect((await prompt(session({ target: 'web' }), nudged, { said: 'Add a page where a customer can track their order.' })).system).toContain(`===== ${OWN_ROW_GUIDE} =====`);
  });

  it('fits the smallest window with every skill a request can pull in, and leaves room to talk', async () => {
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'openai-compatible' });
    const { system, messages } = await prompt(session({ target: 'web' }), [say('user', 'Make a repair desk, and use the Invoices add-on.')]);
    expect(system).toContain('You are Adminium Designer');
    expect(system).toContain('===== adminium-app/SKILL.md =====');
    expect(system).toContain('===== adminium-surface/SKILL.md =====');
    expect(system).toContain('===== adminium-add-ons/SKILL.md =====');
    expect(system).toContain('Table items:');
    expect(system).toContain('apps/repairs/manifest/app.json');
    expect(system).not.toMatch(/^---\nname:/m);
    const used = estimateTokens(system);
    expect(used).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT['openai-compatible'] / 2);
    expect(messages).toHaveLength(1);
  });

  it('fits Ollama’s window too, the smallest a local model reads', async () => {
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'ollama' });
    const { system } = await prompt(session(), [say('user', 'go')]);
    expect(estimateTokens(system)).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT.ollama - 6000);
  });
});

describe('an add-on that does the job', () => {
  it('the add-ons skill loads for stock, supplies and invoices, and not for a booking page', () => {
    for (const asked of [
      'A small clinic app: patients, visits, and track the supplies each visit uses.',
      'Keep stock of what we sell.',
      'A kitchen app that knows the ingredients of each dish',
      'Tell me which batches are expiring',
      'We do a stocktake every month',
      'Reordering should be automatic',
      'Send an invoice when the job is done',
      'Is there an add-on for it?',
    ]) {
      expect(MENTIONS_ADD_ON.test(asked), asked).toBe(true);
    }
    for (const asked of ['A booking page for a hair salon', 'Our supplier list, with phone numbers', 'Track repair jobs and who is assigned', 'A stockbroker\'s client list']) {
      expect(MENTIONS_ADD_ON.test(asked), asked).toBe(false);
    }
  });

  const posts = () => {
    const dir = `${root}/apps/repairs/manifest`;
    const table = {
      ref: 'job_parts',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'inventory', table: 'items' } } },
        { ref: 'qty', type: 'decimal', scale: 3 },
        { ref: 'done', type: 'bool' },
      ],
      postings: [{ id: 'stock', into: { addOn: 'inventory', ledger: 'stock', action: 'use-item' }, post: { on: { column: 'done', in: [true] } }, reverse: { on: { column: 'done', from: [true], in: [false] } }, map: { item: 'item_id', quantity: 'qty' } }],
    };
    writeFileSync(`${dir}/tables/job_parts.json`, JSON.stringify(table));
    writeFileSync(
      `${dir}/add-ons.json`,
      JSON.stringify({
        requires: [{ key: 'inventory', range: '>=1.0.8', reason: { 'en-US': 'Parts come out of stock.' } }],
        suggests: [{ key: 'invoices', range: '>=1.0.8', reason: { 'en-US': 'A job can be invoiced.' } }],
        features: [{ id: 'billing-papers', label: { 'en-US': 'Invoices for jobs' }, requires: ['invoices'] }],
      }),
    );
    const app = JSON.parse(readFileSync(`${dir}/app.json`, 'utf8')) as { compatibility: { minAdminiumVersion: string } };
    app.compatibility.minAdminiumVersion = '0.3.18';
    writeFileSync(`${dir}/app.json`, JSON.stringify(app));
    const roles = JSON.parse(readFileSync(`${dir}/roles.json`, 'utf8')) as { tables?: unknown }[];
    roles[0]!.tables = [{ addOn: 'inventory', table: 'items', actions: ['read'] }];
    writeFileSync(`${dir}/roles.json`, JSON.stringify(roles));
  };

  it('the app in short says what posts where, what it suggests and what a role reads of an add-on', () => {
    posts();
    const app = appNow(root, '0.3.18', 'repairs');
    expect(app.text).toContain('The last check: no errors.');
    expect(app.text).toContain('item_id int → inventory.items');
    expect(app.text).toContain('  posts to inventory/stock (use-item): post when done becomes true; reverse when done becomes false (from true); maps item←item_id, quantity←qty');
    expect(app.text).toContain('Requires the add-on inventory >=1.0.8');
    expect(app.text).toContain('Suggests the add-on invoices >=1.0.8');
    expect(app.text).toContain('Feature billing-papers: needs invoices');
    expect(app.text).toMatch(/^Role \S+ on inventory\.items: read$/m);
    expect(app.namesAddOn).toBe(true);
  });

  it('an app that already names an add-on carries the add-ons skill, whatever was said', async () => {
    expect(appNow(root, '0.3.18', 'repairs').namesAddOn).toBe(false);
    const prompt = createPrompt({ root, version: '0.3.18', skills: createSkills(), providerOf: async () => 'anthropic' });
    const marker = '===== adminium-add-ons/SKILL.md =====';
    expect((await prompt(session(), [say('user', 'Add a column for the colour.')])).system).not.toContain(marker);
    posts();
    expect((await prompt(session(), [say('user', 'Add a column for the colour.')])).system).toContain(marker);
    expect(skillsFor(session(), { hasSides: false, mentionsAddOn: false, namesAddOn: true })).toContain('adminium-add-ons/SKILL.md');
    // A manifest that does not pass the check still names its add-on: the skill is needed most then.
    writeFileSync(`${root}/apps/repairs/manifest/tables/job_parts.json`, '{ "ref": ');
    expect(appNow(root, '0.3.18', 'repairs').namesAddOn).toBe(true);
  });

  it('every prompt says how stock is built on, and names the tool', async () => {
    const prompt = createPrompt({ root, version: '0.3.18', skills: createSkills(), providerOf: async () => 'anthropic' });
    const { system } = await prompt(session(), [say('user', 'Add a column.')]);
    expect(system).toContain('then call post_to_ledger with that table');
    expect(system).toContain('Never build a stock table of the app\'s own.');
  });
});

describe('an app that is new', () => {
  it('starts bare, and its model is shown what a table, a page and a role look like', async () => {
    scaffoldApp({ root, key: 'bikes', name: 'Bike shop', sides: [], version: APP_VERSION, bare: true });
    expect(existsSync(join(root, 'apps/bikes/manifest/app.json'))).toBe(true);
    expect(existsSync(join(root, 'apps/bikes/manifest/tables'))).toBe(false);
    expect(existsSync(join(root, 'apps/bikes/seeds'))).toBe(false);

    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'ollama' });
    const { system } = await prompt(session({ appKey: 'bikes' }), [say('user', 'A bike shop.')]);
    expect(system).toContain('The app has no table and no page yet');
    expect(system).toContain('apps/bikes/manifest/tables/items.json\n{"ref":"items"');
    expect(system).toContain('apps/bikes/manifest/pages/bikes-items.json\n{"ref":"bikes-items","template":"page-crud"');
    expect(system).toContain('"page:@bikes-items:view"');
    // Only the one example table: nothing of the starter's second one.
    expect(system).not.toContain('table:@requests');
    expect(system).not.toContain('bikes-requests');
    expect(estimateTokens(system)).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT.ollama / 2);

    // An app with tables is not shown the example again.
    expect((await prompt(session(), [say('user', 'Add a column.')])).system).not.toContain('The app has no table and no page yet');
  });

  it('names the references a build opens most, as read_reference takes them', () => {
    const skills = createSkills();
    const guides = taskGuides(skills);
    const names = [...guides.matchAll(/^- (\S+): /gm)].map((found) => found[1] as string);
    expect(names).toContain('adminium-app/references/guides/manifest-by-task--add-a-dashboard-page.md');
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) expect(skills.read(name), name).not.toBeNull();
  });
});

describe('an app copied from a published one', () => {
  it('is described as it is laid out, with its source by folder and not file by file', async () => {
    writeFileSync(`${root}/apps/repairs/build.json`, JSON.stringify({ install: 'npm ci --ignore-scripts', command: 'vite build', output: 'dist-surface/repairs' }));
    mkdirSync(`${root}/apps/repairs/src/screens`, { recursive: true });
    for (let n = 0; n < 40; n += 1) writeFileSync(`${root}/apps/repairs/src/screens/Screen${String(n)}.tsx`, 'export {};');
    writeFileSync(`${root}/apps/repairs/src/main.tsx`, 'export {};');
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'ollama' });
    const { system } = await prompt(session(), [say('user', 'Add a column.')]);
    expect(system).toContain('This app is a copy of a published app');
    expect(system).toContain('apps/repairs/src/screens/ (40 files)');
    expect(system).not.toContain('Screen7.tsx');
    expect(system).toContain('apps/repairs/manifest/tables/items.json');
    expect(estimateTokens(system)).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT.ollama / 2);
  });
});

describe('tables nobody can open', () => {
  const column = (ref: string, references?: string) => ({ ref, type: references === undefined ? 'text' : 'fk', ...(references === undefined ? {} : { references }) });
  it('are named: no page, or no grant; a child of a shown table and the outbox are not', () => {
    const manifest = {
      requiredSchema: {
        tables: [
          { ref: 'customers', columns: [column('name')] },
          { ref: 'bikes', columns: [column('customer_id', 'customers')] },
          { ref: 'invoices', part: 'document', columns: [column('number')] },
          { ref: 'invoice_lines', part: 'lines', columns: [column('document_id', 'invoices')] },
          { ref: 'messages', columns: [column('kind')] },
        ],
      },
      pages: [{ bindings: { rows: 'customers' } }, { bindings: { rows: 'invoices' } }],
      roles: [{ permissions: ['table:@customers:read', 'table:@invoices:read', 'table:@invoice_lines:read', 'page:@x:view'] }],
      outbox: { table: 'messages' },
    };
    // `bikes` hangs off `customers`, which has a page: it is reached from there, and still has no grant.
    expect(unopenedTables(manifest)).toEqual(['- No role is granted the table "bikes": staff cannot read it.']);
    // Nothing leads to `parts`.
    const alone = { ...manifest, requiredSchema: { tables: [...manifest.requiredSchema.tables, { ref: 'parts', columns: [column('name')] }] } };
    expect(unopenedTables(alone)).toContain('- The table "parts" has no dashboard page: nobody can open it.');
    expect(unopenedTables(null)).toEqual([]);
    // A way in for customers, and no screen to come in by.
    const open = { requiredSchema: { tables: [{ ref: 'cakes', columns: [column('name')] }] }, pages: [{ bindings: { rows: 'cakes' } }], roles: [{ permissions: ['table:@cakes:read'] }], publicAccess: [{ table: 'cakes' }] };
    expect(unopenedTables({ ...open, frontends: [{ side: 'staff', kind: 'none' }] })).toEqual([expect.stringContaining('no customer screen')]);
    expect(unopenedTables({ ...open, frontends: [{ side: 'customer', kind: 'spa' }] })).toEqual([]);
  });

  it('says when a role reads a table and not its personal columns', () => {
    const app = (permissions: string[]) => ({
      requiredSchema: { tables: [{ ref: 'orders', columns: [{ ref: 'id' }, { ref: 'customer' }, { ref: 'email' }, { ref: 'contact_phone' }, { ref: 'emailed_at_count' }] }, { ref: 'cakes', columns: [{ ref: 'id' }, { ref: 'name' }] }] },
      roles: [{ key: 'staff', permissions }],
    });
    const lines = unreadPersonalColumns(app(['table:@orders:read', 'table:@cakes:read']));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('The role "staff" reads the table "orders" and not its personal columns (email, contact_phone)');
    expect(lines[0]).toContain('"table:@orders:read_pii"');
    // Granted, or a role that does not read the table at all: nothing to say.
    expect(unreadPersonalColumns(app(['table:@orders:read', 'table:@orders:read_pii']))).toEqual([]);
    expect(unreadPersonalColumns(app(['table:@cakes:read']))).toEqual([]);
    expect(unreadPersonalColumns(null)).toEqual([]);
  });
});

describe('a screen that shows nothing', () => {
  it('is named: the starter’s screen over tables the app lacks, or a few empty lines', () => {
    // The fixture app is the starter with both sides and its own `items`: nothing to say.
    expect(placeholderScreens(root, 'repairs', ['items', 'requests'])).toEqual([]);
    // The same screen in an app with no `items` is the starter's, left as it came.
    expect(placeholderScreens(root, 'repairs', ['cakes'])).toEqual([expect.stringContaining('staff/src/App.tsx is still the starter'), expect.stringContaining('customer/src/App.tsx is still the starter')]);
    writeFileSync(`${root}/apps/repairs/customer/src/App.tsx`, 'export function App() { return <div>Bakery</div>; }');
    expect(placeholderScreens(root, 'repairs', ['items', 'requests'])).toEqual([expect.stringContaining('customer/src/ shows nothing real yet')]);
    // Its calls may live beside App.tsx.
    writeFileSync(`${root}/apps/repairs/customer/src/menu.ts`, 'export const load = (client) => client.list("cakes");');
    // It reads a table now. Whether it is designed is the design check's to say, not this one's.
    expect(placeholderScreens(root, 'repairs', ['items', 'requests'])).toEqual([]);
    writeFileSync(`${root}/apps/repairs/customer/src/App.tsx`, `export function App() { return <div className="page"><label>{en('en-US: Email')}</label></div>; }`);
    expect(placeholderScreens(root, 'repairs', ['items', 'requests'])).toEqual([expect.stringContaining('en() takes the English text alone')]);
    writeFileSync(`${root}/apps/repairs/customer/src/App.tsx`, `export function App() { return <div className="page hero">{en('Email')}</div>; }`);
    expect(placeholderScreens(root, 'repairs', ['items', 'requests'])).toEqual([]);
  });

  it('names what customers read with no sample rows, before the app has a version', () => {
    const app = { kind: 'app', publicAccess: [{ table: 'cakes', methods: ['GET'] }, { table: 'orders', methods: ['POST'] }] };
    expect(emptyFirstPreview(app)).toEqual([expect.stringContaining('Customers read "cakes"')]);
    expect(emptyFirstPreview({ ...app, sampleData: { file: 'seeds/sample.json' } })).toEqual([]);
    expect(emptyFirstPreview({ kind: 'app', publicAccess: [{ table: 'orders', methods: ['POST'] }] })).toEqual([]);
    expect(emptyFirstPreview(null)).toEqual([]);
  });
});

describe('a long session, made to fit', () => {
  const turn = (n: number, resultSize: number): RunMessage[] => [
    say('user', `Request number ${String(n)}`),
    { role: 'assistant', content: [{ type: 'tool_call', id: `c${String(n)}`, name: 'read_file', input: { path: 'a.json' } }] },
    { role: 'user', content: [{ type: 'tool_result', callId: `c${String(n)}`, content: 'x'.repeat(resultSize) }] },
    say('assistant', `Done with number ${String(n)}.`),
  ];

  it('is left alone when it fits', () => {
    const messages = turn(1, 100);
    expect(trimTranscript(messages, 100_000)).toEqual(messages);
  });

  it('cuts old tool results first, keeping the last two turns whole', () => {
    const messages = [...turn(1, 20_000), ...turn(2, 20_000), ...turn(3, 20_000)];
    const trimmed = trimTranscript(messages, 13_000);
    const results = trimmed.flatMap((message) => message.content.flatMap((block) => (block.type === 'tool_result' ? [block.content.length] : [])));
    expect(results[0]).toBeLessThan(400);
    expect(results.slice(1)).toEqual([20_000, 20_000]);
  });

  it('folds whole old turns into a line each, keeps the first message, and never leaves a call without its answer', () => {
    const messages = Array.from({ length: 12 }, (_value, index) => turn(index + 1, 4000)).flat();
    const trimmed = trimTranscript(messages, 3000);
    expect(trimmed[0]).toEqual(say('user', 'Request number 1'));
    expect(JSON.stringify(trimmed)).toContain('Earlier: Request number 2 → Done with number 2.');
    // Every call still has its answer.
    expect(closeDangling(trimmed)).toEqual(trimmed);
    expect(estimateTokens(JSON.stringify(trimmed))).toBeLessThan(estimateTokens(JSON.stringify(messages)) / 4);
  });
});

describe('pictures, made ready to send', () => {
  const picture = (ref: string): RunMessage['content'][number] => ({ type: 'image', mediaType: 'image/png', data: '', ref, name: `${ref}.png` });
  const user = (text: string, ...refs: string[]): RunMessage => ({ role: 'user', content: [{ type: 'text', text }, ...refs.map(picture)] });
  const said = (text: string): RunMessage => ({ role: 'assistant', content: [{ type: 'text', text }] });
  const bytesOf = (size = 4) => (ref: string) => Buffer.alloc(size, ref.length);
  const sent = (messages: RunMessage[]): string[] => messages.flatMap((message) => message.content.flatMap((block) => (block.type === 'image' && block.data.length > 0 ? [block.ref ?? ''] : [])));
  const lines = (messages: RunMessage[]): string => messages.flatMap((message) => message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))).join(' ');

  it('goes by the turn a picture was attached in: a line the server sends back mid-turn is not a turn', () => {
    const turns = new Map([['a', 3]]);
    // Turn 3, with two "Before you finish" lines sent back by the server: the picture is still this turn's.
    const messages = [user('Make it look like this.', 'a'), said(''), user('Before you finish: one'), said(''), user('Before you finish: two')];
    expect(sent(withPictures(messages, { reads: true, bytesOf: bytesOf(), turnOf: (ref) => turns.get(ref), turn: 3 }))).toEqual(['a']);
    // The turn after: still sent. Two turns after: a line saying it was there.
    expect(sent(withPictures(messages, { reads: true, bytesOf: bytesOf(), turnOf: (ref) => turns.get(ref), turn: 4 }))).toEqual(['a']);
    const later = withPictures(messages, { reads: true, bytesOf: bytesOf(), turnOf: (ref) => turns.get(ref), turn: 5 });
    expect(sent(later)).toEqual([]);
    expect(lines(later)).toContain('A picture the person attached earlier: "a.png"');
  });

  it('a turn that failed does not keep its picture with every later message', () => {
    // Turn 2 failed before any answer, so its message and turn 3's and 4's are one message to the provider.
    const merged = [user('Like this.', 'a'), { role: 'user', content: [{ type: 'text', text: 'Again.' }] } as RunMessage, { role: 'user', content: [{ type: 'text', text: 'And again.' }] } as RunMessage];
    expect(sent(withPictures(merged, { reads: true, bytesOf: bytesOf(), turnOf: () => 2, turn: 4 }))).toEqual([]);
  });

  it('says a picture the server took of the page, since replaced, as that: nobody attached it, and the person is not asked to describe it', () => {
    const page: RunMessage = { role: 'user', content: [{ type: 'text', text: 'This picture is the customer page as it shows now.' }, { type: 'image', mediaType: 'image/jpeg', data: '', ref: 'gone', name: 'the customer page as it shows.jpg' }] };
    // Its file was taken out when a newer picture of the page came: there are no bytes for it.
    const told = withPictures([page], { reads: true, bytesOf: () => null, turnOf: () => 1, turn: 2 });
    expect(sent(told)).toEqual([]);
    expect(lines(told)).toContain('(A picture of the page as it showed then. It is not sent again.)');
    expect(lines(told)).not.toContain('attached');
    expect(lines(withPictures([page], { reads: false, bytesOf: () => null, turnOf: () => 1, turn: 2 }))).not.toContain('attached');
  });

  it('sends none to a model that reads none, or once a request with pictures was refused', () => {
    const blind = withPictures([user('Like this.', 'a')], { reads: false, bytesOf: bytesOf(), turnOf: () => 1, turn: 1 });
    expect(sent(blind)).toEqual([]);
    expect(lines(blind)).toContain('You cannot see it: this model does not read pictures.');
  });

  it('a picture attached again goes once, with the newest message that carries it', () => {
    // Turn 2 failed and was asked again as turn 3 with the same file.
    const messages = [user('Like this.', 'a'), user('Like this.', 'a')];
    const out = withPictures(messages, { reads: true, bytesOf: bytesOf(), turnOf: () => 3, turn: 3 });
    expect(out.map((message) => sent([message]))).toEqual([[], ['a']]);
    expect(lines([out[0] as RunMessage])).toContain('The picture "a.png" is with a later message.');
  });

  it('keeps one request under what a provider takes: the newest pictures first', () => {
    const five = 5 * 1024 * 1024;
    const messages = [user('One.', 'p1', 'p2'), said('ok'), user('Two.', 'p3', 'p4')];
    const out = withPictures(messages, { reads: true, bytesOf: bytesOf(five), turnOf: () => 2, turn: 2 });
    // Twelve megabytes: two of five fit, and they are the newest two.
    expect(sent(out)).toEqual(['p3', 'p4']);
    expect(lines(out)).toContain('"p1.png". You cannot see it: it could not be sent with this request');
  });
});
