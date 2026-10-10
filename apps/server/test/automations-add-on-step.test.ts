// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STEP AN ADD-ON GIVES TO A RULE.
 *
 * An add-on's manifest names a step: what a person fills in, and the one row
 * of one of its own tables the step makes. A rule uses it by the add-on's key
 * and the step's; the engine reads what the step is from the add-on as it is
 * installed, fills the inputs from the rule's record, and makes the row
 * through the same door as "create a record", so the add-on's own column
 * rules run (the card's code is made by Adminium). On each database: a rule
 * that sends a card to the order's customer, what is refused at the save,
 * what its author must be allowed, and what a run says once the add-on is
 * gone.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo, type Automation, type AutomationGraph, type AutomationTriggerEvent } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { startersOf, tableNotesOn } from '../src/assistant/add-on-notes.js';
import { withoutPersonal } from '../src/automations/actions/add-on-step.js';
import { findStep, stepsOn, type StepLookup } from '../src/automations/add-on-steps.js';
import { walkRule } from '../src/automations/runner.js';
import { firstIncompleteNode, requiredGrants, resolveRule, type RuleSteps } from '../src/automations/validate.js';
import { loadAddOnInstalls, type AddOnInstalls } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Doc => Object.fromEntries(LOCALES.map((locale) => [locale, text]));

/** The cards kit, giving two steps: send a card to a person, and write a note on a card. */
function kitWithSteps(): Doc {
  const base = cardsKitManifest({ compatibility: { minAdminiumVersion: '0.3.22' } });
  const tables = (base['requiredSchema'] as { tables: { ref: string; columns: unknown[] }[] }).tables;
  tables.find((table) => table.ref === 'cards')!.columns.push(
    { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } },
    { ref: 'holder', type: 'text', maxLength: 80, nullable: true, rules: { personal: true } },
    { ref: 'size', type: 'enum', enum: ['small', 'large'], default: 'small' },
    { ref: 'made_by', type: 'text', maxLength: 120, nullable: true },
    { ref: 'sent_at', type: 'timestamptz', nullable: true },
  );
  return {
    ...base,
    addOn: {
      ...(base['addOn'] as Doc),
      // The second block of the same floor: what its tables are, and a question for its pages.
      assistant: { tables: { cards: { is: 'A gift card: a code that holds a balance.', columns: { balance: 'What is left on it.' } } }, questions: [{ key: 'left', text: words('Which cards still hold a balance?') }] },
      steps: [
        {
          key: 'send-card',
          name: words('Send a card'),
          does: words('Makes a card and keeps who it is for'),
          inputs: [
            { key: 'to', label: words('Send to'), kind: 'email', required: true },
            { key: 'name', label: words('Name on the card'), kind: 'text' },
            { key: 'size', label: words('Size'), kind: 'choice', options: [{ value: 'small', label: words('Small') }, { value: 'large', label: words('Large') }] },
            { key: 'worth', label: words('Worth'), kind: 'number' },
            { key: 'tag', label: words('Label'), kind: 'text' },
          ],
          writes: { table: 'cards', values: { email: { input: 'to' }, holder: { input: 'name' }, size: { input: 'size' }, balance: { input: 'worth' }, label: { input: 'tag' }, status: { text: 'active' }, made_by: { token: 'ruleName' }, sent_at: { token: 'now' } } },
        },
        {
          key: 'note-card',
          name: words('Write on a card'),
          does: words('Adds a note to a card'),
          inputs: [{ key: 'card', label: words('Card'), kind: 'record', table: 'cards', required: true }, { key: 'text', label: words('Note'), kind: 'text' }],
          writes: { table: 'notes', values: { card_id: { input: 'card' }, text: { input: 'text' } } },
        },
      ],
    },
  };
}

/** A shop with customers and their orders: what the rule is about. */
const shop = (): Doc =>
  shopManifest({
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
        { ref: 'hours', columns: [pk, { ref: 'day', type: 'text', maxLength: 16, nullable: true }] },
        { ref: 'customers', columns: [pk, { ref: 'first_name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } }] },
        { ref: 'orders', columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'total', type: 'decimal', scale: 2, default: 0 }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }] },
      ],
    },
  });

describe.each(LEGS)('a step an add-on gives to a rule — %s', (dialect, available) => {
  let h: Harness;
  let installs: AddOnInstalls;
  let view: SnapshotView;
  let orders: string;
  let cards: string;
  let notes: string;
  afterEach(async () => {
    if (available) await h.close();
  });

  const read = async (): Promise<void> => {
    await h.introspect();
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
    installs = await loadAddOnInstalls(h.meta, async () => model);
    orders = model.tables.find((table) => table.name.endsWith('shop_orders'))!.id;
    cards = installs.tableOf(h.connectionId, CARDS_KIT, 'cards') ?? '';
    notes = installs.tableOf(h.connectionId, CARDS_KIT, 'notes') ?? '';
  };
  const setUp = async (): Promise<void> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(kitWithSteps());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await h.rows(`INSERT INTO shop_customers (id, first_name, email) VALUES (1, 'Lena', 'lena@client.studio.dev'), (2, NULL, NULL)`);
    await h.rows(`INSERT INTO shop_orders (id, customer_id, total, note) VALUES (10, 1, 42.5, 'first'), (11, 2, 9, NULL), (12, NULL, 5, NULL)`);
    await read();
  };
  const steps = (): RuleSteps => (addOn, step) => findStep(installs, h.connectionId, addOn, step);
  const lookup = (): StepLookup => (connectionId, addOn, step) => findStep(installs, connectionId, addOn, step);
  const trigger = () => ({ kind: 'record' as const, connectionId: h.connectionId, table: orders, event: 'updated' as const, watch: false, when: [] });
  const graphOf = (action: Doc): AutomationGraph =>
    ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'An order changes' }, { id: 'n2', kind: 'action', title: 'Send a card', sub: '', onError: false, action: { addOnName: 'Cards kit', inputs: {}, ...action } }] }) as unknown as AutomationGraph;
  const send = (inputs: Record<string, string>, step = 'send-card'): AutomationGraph => graphOf({ kind: 'add-on.step', addOn: CARDS_KIT, step, inputs });
  const ruleOf = (graph: AutomationGraph): Automation =>
    ({ id: 'auto_test', connectionId: h.connectionId, name: 'Thank the customer', description: null, enabled: true, trigger: trigger(), graph, managedBy: null, templateKey: null, timeSavedMinutes: 0, nextRunAt: null, createdAt: 0, updatedAt: 0 }) as unknown as Automation;
  const event = (id: number): AutomationTriggerEvent => ({ event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: h.connectionId, table: orders, pk: { id }, label: `Order ${String(id)}` }, snapshot: { id }, occurredAt: Date.now() });
  const walk = (graph: AutomationGraph, id: number, dryRun = false) =>
    walkRule({ meta: h.meta, manager: h.manager, secret: TEST_SECRET, now: () => Date.parse('2026-10-10T09:00:00Z'), steps: async () => lookup() }, { rule: ruleOf(graph), runId: `arun_${String(id)}`, event: event(id), ...(dryRun ? { dryRun: true } : {}) });
  const check = (graph: AutomationGraph) => resolveRule(trigger(), graph, { view, templateKeys: new Set(), blockLoopback: false, steps: steps() });
  const lineOf = (outcome: Awaited<ReturnType<typeof walk>>): string => JSON.stringify(outcome.trace.steps.at(-1));
  const whole = { to: '{{customer_id.email}}', name: '{{customer_id.first_name}}', size: 'large', worth: '{{record.total}}', tag: 'A thank-you' };

  it.skipIf(!available)('is offered with its inputs, and the table it writes is the add-on\'s own', async () => {
    await setUp();
    const offered = stepsOn(installs, h.connectionId);
    expect(offered.map((one) => [one.addOn, one.addOnName, one.step.key, one.table])).toEqual([
      [CARDS_KIT, 'Cards kit', 'send-card', cards],
      [CARDS_KIT, 'Cards kit', 'note-card', notes],
    ]);
    expect(offered[1]!.inputTables).toEqual({ card: cards });
    // Installed with both blocks of the floor: what it says of its table is read from the install, by the table's id here.
    expect(tableNotesOn(installs, h.connectionId).get(cards)).toEqual({ addOn: 'Cards kit', is: 'A gift card: a code that holds a balance.', columns: { balance: 'What is left on it.' } });
    expect(startersOf(installs, [h.connectionId], CARDS_KIT, 'any-page', 'en_US')).toEqual([{ key: `${CARDS_KIT}:left`, text: 'Which cards still hold a balance?', addOn: 'Cards kit' }]);
    expect(cards).not.toBe('');
    // The rule's author must be allowed to make the row the step makes, and to read the row the placeholders reach.
    const grants = requiredGrants(trigger(), send(whole), h.connectionId, view, steps()).map((grant) => grant.permission);
    expect(grants).toContain(`table:${h.connectionId}:${cards}:create`);
    expect(grants.some((grant) => grant.endsWith('shop_customers:read'))).toBe(true);
  });

  it.skipIf(!available)('makes the row for the order\'s customer: the inputs filled from the record, the add-on\'s own rules run, the run says what it made', async () => {
    await setUp();
    expect(() => check(send(whole))).not.toThrow();
    expect(firstIncompleteNode(send(whole), steps())).toBeNull();
    const outcome = await walk(send(whole), 10);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    expect(lineOf(outcome)).toContain('Send a card: created');
    const [card] = await h.rows('SELECT * FROM cards_kit_cards');
    // The personal address reached the add-on's row (an address input may read one); the code is Adminium's own.
    expect(card).toMatchObject({ email: 'lena@client.studio.dev', holder: 'Lena', size: 'large', label: 'A thank-you', made_by: 'Thank the customer', status: 'active' });
    expect(Number(card!['balance'])).toBe(42.5);
    expect(String(card!['code'])).toMatch(/^GC-/);
    expect(card!['sent_at']).not.toBeNull();
    // The address is in the row, and nowhere in the run's own record.
    expect(JSON.stringify(outcome.trace)).not.toContain('lena@client.studio.dev');
  });

  it.skipIf(!available)('a test run does everything but the write, and shows an address only as one', async () => {
    await setUp();
    const outcome = await walk(send(whole), 10, true);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    // The order's total is written as each database hands a two-place amount back: 42.5, or 42.50.
    expect(lineOf(outcome)).toMatch(/Would run “Send a card” with Send to = filled in \(kept private\), Name on the card = filled in \(kept private\), Size = large, Worth = 42\.50?, Label = A thank-you/);
    expect(JSON.stringify(outcome.trace)).not.toContain('Lena');
    expect(await h.rows('SELECT id FROM cards_kit_cards')).toEqual([]);
  });

  it.skipIf(!available)('a record with nothing for a needed input fails the step by its name, and writes nothing', async () => {
    await setUp();
    // Order 11's customer has no address; order 12 has no customer at all.
    for (const id of [11, 12]) {
      const outcome = await walk(send(whole), id);
      expect(outcome.kind === 'finished' && outcome.status).toBe('failed');
      expect(lineOf(outcome)).toContain('Send a card: “Send to” has no value for this record.');
    }
    // A personal value in a plain input is not read at the run either: the placeholder stays, and the step says so.
    const leak = await walk(send({ to: 'a@b.example', tag: 'For {{customer_id.first_name}}' }), 10);
    expect(lineOf(leak)).toContain('“Label” reads {{customer_id.first_name}}, which nothing fills.');
    // An input that is not needed and is empty leaves its column to its own default.
    const plain = await walk(send({ to: 'desk@client.studio.dev' }), 12);
    expect(plain.kind === 'finished' && plain.status, lineOf(plain)).toBe('succeeded');
    expect(await h.rows('SELECT email, holder, size FROM cards_kit_cards')).toEqual([{ email: 'desk@client.studio.dev', holder: null, size: 'small' }]);
    // What the record holds is not an address, a number, a choice: said of the input, the value kept out of the log.
    for (const [inputs, says] of [
      [{ to: '{{record.note}}' }, '“Send to” does not hold an email address for this record.'],
      [{ to: 'a@b.example', worth: '{{record.note}}' }, '“Worth” is not a number for this record.'],
      [{ to: 'a@b.example', size: '{{record.note}}' }, '“Size” is none of its choices (small, large).'],
      [{ to: 'a@b.example', name: '{{record.no_such_column}}' }, '“Name on the card” reads {{record.no_such_column}}, which nothing fills.'],
    ] as const) {
      const outcome = await walk(send(inputs), 10);
      expect(outcome.kind === 'finished' && outcome.status).toBe('failed');
      expect(lineOf(outcome)).toContain(says);
    }
    expect(await h.rows('SELECT id FROM cards_kit_cards')).toHaveLength(1);
  });

  it.skipIf(!available)('a value that holds braces of its own is written as it is, and a number is one every engine reads alike', async () => {
    await setUp();
    await h.rows(`UPDATE shop_orders SET note = '{{x}} and {{y|z}}' WHERE id = 10`);
    const outcome = await walk(send({ to: 'a@b.example', tag: '{{record.note}}' }), 10);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    expect(await h.rows('SELECT label FROM cards_kit_cards')).toEqual([{ label: '{{x}} and {{y|z}}' }]);
    for (const worth of ['0x10', '1e3', ' ']) {
      await h.rows(`UPDATE shop_orders SET note = '${worth}' WHERE id = 10`);
      const odd = await walk(send({ to: 'a@b.example', worth: 'x{{record.note}}'.slice(worth === ' ' ? 0 : 1) }), 10);
      expect(lineOf(odd)).toContain('“Worth” is not a number for this record.');
    }
  });

  it('what a failed write says is kept without the personal values it was given', () => {
    const said = withoutPersonal("Duplicate entry 'lena@client.studio.dev' for key 'cards.email' (Lena)", new Set(['to', 'name', 'none']), { to: 'lena@client.studio.dev', name: 'Lena', tag: 'cards' });
    expect(said).toBe("Duplicate entry '…' for key 'cards.email' (…)");
  });

  it.skipIf(!available)('a row of the add-on is picked for a record input, and the note is written on it', async () => {
    await setUp();
    await walk(send({ to: 'desk@client.studio.dev' }), 12);
    const [card] = await h.rows('SELECT id FROM cards_kit_cards');
    const outcome = await walk(send({ card: String(card!['id']), text: 'For {{recordLabel}}' }, 'note-card'), 10);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    expect(await h.rows('SELECT card_id, text FROM cards_kit_notes')).toEqual([{ card_id: card!['id'], text: 'For Order 10' }]);
  });

  it.skipIf(!available)('the save refuses what the step does not take, and a personal column anywhere but in an address', async () => {
    await setUp();
    expect(() => check(send({ to: 'a@b.example', colour: 'red' }))).toThrow('“Send a card” (Cards kit) has no input colour. Its inputs are: to, name, size, worth, tag.');
    expect(() => check(send({ to: 'not an address' }))).toThrow('“not an address” is not an email address (Send to).');
    expect(() => check(send({ to: 'a@b.example', worth: 'a lot' }))).toThrow('Worth takes a number, and “a lot” is not one.');
    expect(() => check(send({ to: 'a@b.example', size: 'huge' }))).toThrow('Size is one of small, large, and “huge” is none of them.');
    expect(() => check(send({ to: '{{customer_id.no_such}}' }))).toThrow('has no column no_such');
    // The customer's address and name are personal: an input the add-on keeps personal may read them, one it keeps plainly may not.
    expect(() => check(send({ to: '{{customer_id.email}}', name: '{{customer_id.first_name}}' }))).not.toThrow();
    expect(() => check(send({ to: 'a@b.example', tag: 'For {{customer_id.first_name}}' }))).toThrow('customer_id.first_name is a protected column and cannot be a placeholder.');
    expect(() => check(send({ to: 'a@b.example', worth: '{{customer_id.email}}' }))).toThrow('customer_id.email is a protected column and cannot be a placeholder.');
    // Unfinished, it is saved and cannot be switched on: a needed input is empty.
    expect(() => check(send({ name: 'x' }))).not.toThrow();
    expect(firstIncompleteNode(send({ name: 'x' }), steps())?.id).toBe('n2');
  });

  it.skipIf(!available)('once the add-on is gone the rule keeps the step, cannot be switched on, and a run says which add-on it lost', async () => {
    await setUp();
    const graph = send(whole);
    const removed = await h.inject({ method: 'DELETE', url: `/add-ons/${CARDS_KIT}` });
    expect([200, 204], removed.body).toContain(removed.statusCode);
    await read();
    expect(findStep(installs, h.connectionId, CARDS_KIT, 'send-card')).toEqual({ state: 'no-add-on' });
    expect(stepsOn(installs, h.connectionId)).toEqual([]);
    // What it said of its tables, and its questions, went with it.
    expect(tableNotesOn(installs, h.connectionId).size).toBe(0);
    expect(startersOf(installs, [h.connectionId], CARDS_KIT, 'any-page', 'en_US')).toEqual([]);
    // The save still stands (the step keeps its settings); it is the switch that is refused.
    expect(() => check(graph)).not.toThrow();
    expect(firstIncompleteNode(graph, steps())?.id).toBe('n2');
    const outcome = await walk(graph, 10);
    expect(outcome.kind === 'finished' && outcome.status).toBe('failed');
    expect(lineOf(outcome)).toContain('The add-on Cards kit is no longer installed.');
  });

  it.skipIf(!available)('a step the add-on does not give is unfinished, and fails by its key', async () => {
    await setUp();
    const graph = send({ to: 'a@b.example' }, 'burn-card');
    expect(firstIncompleteNode(graph, steps())?.id).toBe('n2');
    const outcome = await walk(graph, 10);
    expect(lineOf(outcome)).toContain('The add-on Cards kit no longer has the step “burn-card”.');
  });
});
