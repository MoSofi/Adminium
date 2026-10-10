// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GIFT CARDS AT A TILL, START TO FINISH, WITH A SCRIPTED MODEL.
 *
 * "Sell gift cards at the till, and let people pay with one": the prompt
 * carries the add-ons skill and the discounts task; the model writes the
 * till's own tables, looks at the add-ons, and calls build_on_shape twice
 * with its tables; the person is asked for the add-on on a card, once, and
 * says yes; the columns, the two rules, the requirement and the floor are
 * written; the app's own check passes; and the next turn's prompt says what
 * posts where.
 *
 * The model answers from a script. The prompt, the tools, the files and the
 * check are the real ones; the shapes are Offers' own, as its manifest
 * declares them.
 */
import { APP_VERSION } from '../src/version.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProviderRunner, RunRequest, RunResult } from '@adminium/llm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { shapesOf } from '../src/designer/add-on-lines.js';
import type { DesignerEvent } from '../src/designer/events.js';
import type { AddOnGetter } from '../src/designer/get-add-on.js';
import { createPrompt } from '../src/designer/prompt.js';
import { createDesignerRunner } from '../src/designer/runner.js';
import { createSessionStore, type SessionStore } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import { createDesignerTools, type AddOnLine } from '../src/designer/tools.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const OFFERS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'offers-shapes.json'), 'utf8')) as Record<string, unknown>;
/** This build's own version: what a new app's floor is written as, and what the server says it is. */
const VERSION = APP_VERSION;
const BY = { id: 'u1', label: 'Owner' };
let root: string;
let sessions: string;
let store: SessionStore;
let onServer: boolean;

beforeEach(async () => {
  root = tempProject('adminium-designer-cards-');
  sessions = mkdtempSync(join(tmpdir(), 'adminium-designer-cards-sessions-'));
  store = createSessionStore(sessions);
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'till'], { io, deps }), io.stderr()).toBe(0);
  onServer = false;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(sessions, { recursive: true, force: true });
});

const call = (...made: [string, Record<string, unknown>][]): RunResult => ({
  blocks: made.map(([name, input], index) => ({ type: 'tool_call' as const, id: `c${String(index)}_${name}`, name, input })),
  stop: 'tool_calls',
  malformed: [],
  usage: { inputTokens: 100, outputTokens: 10 },
});
const says = (text: string): RunResult => ({ blocks: [{ type: 'text', text }], stop: 'end', malformed: [], usage: { inputTokens: 100, outputTokens: 10 } });
const pk = { ref: 'id', type: 'int', role: 'pk' };
const named = (ref: string, one: string, many: string) => ({ ref, label: { 'en-US': one }, labelPlural: { 'en-US': many }, keyField: 'id' });

describe('gift cards at a till, start to finish', () => {
  it('the model writes the till, adds two of Offers\' shapes to it after the person\'s yes, and the app checks', async () => {
    const base = 'apps/till/manifest';
    const table = (file: string, value: unknown): [string, Record<string, unknown>] => ['write_file', { path: `${base}/tables/${file}.json`, content: JSON.stringify(value) }];
    const steps: RunResult[] = [
      call(
        table('tickets', {
          ...named('tickets', 'Ticket', 'Tickets'),
          columns: [pk, { ref: 'status', type: 'enum', enum: ['open', 'paid', 'void'], default: 'open' }, { ref: 'due', type: 'money', scale: 'currency', nullable: true }],
          states: { column: 'status', initial: 'open', moves: { open: ['paid', 'void'], paid: ['void'] } },
        }),
        table('ticket_lines', { ...named('ticket_lines', 'Line', 'Lines'), columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, { ref: 'line_total', type: 'money', scale: 'currency', nullable: true }] }),
        table('payments', { ...named('payments', 'Payment', 'Payments'), columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, { ref: 'amount', type: 'money', scale: 'currency', nullable: true }] }),
        ['list_add_ons', {}],
      ),
      call(['build_on_shape', { add_on: 'offers', shape: 'card-sale@1', tables: { 'card-sale@1/order': 'tickets', 'card-sale@1/lines': 'ticket_lines' }, when: { post: { to: ['paid'] }, reverse: { to: ['void'], from: ['paid'] } } }]),
      call(['build_on_shape', { add_on: 'offers', shape: 'card-payment@1', tables: { 'card-payment@1/order': 'tickets', 'card-payment@1/payments': 'payments' }, columns: { amount: 'amount', due: 'due' }, when: { post: { create: true }, reverse: { column: 'voided_at', set: true } } }]),
      call(['check_app', {}]),
      says('A line on a ticket can now sell a gift card, and a payment can be a card. Offers keeps the balance.'),
    ];
    const requests: RunRequest[] = [];
    const model: ProviderRunner = {
      id: 'anthropic',
      async run(req) {
        requests.push(req);
        return steps.shift() ?? says('Done.');
      },
    };
    // In this server's store, and not installed: it reads, and the person is still asked before it adds its tables.
    const line: AddOnLine = { key: 'offers', name: 'Offers & gift cards', version: '1.0.9', line: 'Discounts, codes, vouchers and gift cards.', state: 'available', shapes: shapesOf(OFFERS) };
    const getter: AddOnGetter = {
      look: async () => (onServer ? { state: 'installed', name: 'Offers & gift cards', version: '1.0.9' } : { state: 'here', name: 'Offers & gift cards', version: '1.0.9', line: 'Discounts, codes, vouchers and gift cards.', tables: 21 }),
      allowed: async () => true,
      switchOn: async () => ({ ok: true }),
      get: async () => {
        onServer = true;
        return { ok: true, name: 'Offers & gift cards', version: '1.0.9' };
      },
    };
    const published: DesignerEvent[] = [];
    const prompt = createPrompt({ root, version: VERSION, skills: createSkills(), providerOf: async () => 'anthropic' });
    const errorsNow = () => checkApp(root, 'till', { version: VERSION }).findings.filter((finding) => finding.level === 'error');
    const runner = createDesignerRunner({
      store,
      runnerFor: async () => ({ runner: model }),
      tools: () => createDesignerTools({ root, version: VERSION, designer: () => ({ store }) as never, skills: createSkills(), listAddOns: async () => [{ ...line, state: onServer ? 'installed' : 'available' }], addOnGetter: getter, readAddOn: async (key) => (key === 'offers' ? OFFERS : null) }, 'till'),
      prompt,
      pipeline: async () => (errorsNow().length === 0 ? { ok: true, version: { n: 1, name: 'v1' } } : { ok: false, version: null }),
      limits: async () => ({ maxSteps: 60, turnTokens: 400_000, sessionTokens: 4_000_000 }),
      retryWaitsMs: [0, 0],
      publish: (event) => published.push(event),
      audit: async () => undefined,
    });
    const session = store.create({ appKey: 'till', title: 'Till', target: 'dashboard', connectionId: 'env:anthropic', model: 'm', createdApp: false });

    await runner.start(session.id, { text: 'Sell gift cards at the till, and let people pay with one.', by: BY });

    // The person is asked for the add-on once, by the server's own words; the second shape asks nothing.
    await vi.waitFor(() => expect(runner.waiting(session.id)).toHaveLength(1), { timeout: 20_000 });
    const card = runner.waiting(session.id)[0]!;
    expect(card).toMatchObject({ type: 'add-on', key: 'offers', name: 'Offers & gift cards', version: '1.0.9', here: true, tables: 21 });
    runner.answer(session.id, card.id, { accept: true }, BY);
    await runner.settled();
    expect(published.filter((event) => event.kind === 'card')).toHaveLength(1);

    // What the model was told before it wrote anything.
    const system = requests[0]!.system ?? '';
    expect(system).toContain('===== adminium-add-ons/SKILL.md =====');
    expect(system).toContain('- adminium-app/references/guides/manifest-by-task--discounts-codes-and-gift-cards-from-the-offers-add-on.md: Discounts, codes and gift cards from the Offers add-on');
    expect(system).toContain('then call build_on_shape with the Offers shape and your tables');

    // What each tool answered.
    const answers = requests.flatMap((request) => request.messages.at(-1)?.content ?? []).flatMap((block) => (block.type === 'tool_result' ? [String(block.content)] : []));
    expect(answers.find((answer) => answer.startsWith('offers 1.0.9'))).toContain('Shapes for build_on_shape, added to your own tables: discountable@1, card-payment@1, card-sale@1, voucher-sale@1.');
    const written = answers.filter((answer) => answer.startsWith('Written:'));
    expect(written).toHaveLength(2);
    expect(written[0]).toContain(`${base}/tables/ticket_lines.json: added gift_card_id (int, a link to offers.gift_cards), load_amount (money); the rule "card-load" posts into offers/value (issue)`);
    expect(written[0]).toContain(`${base}/add-ons.json: requires offers >=1.0.12`);
    expect(written[1]).toContain(`${base}/tables/payments.json: added card_code (text), card_id (int, a link to offers.gift_cards), card_last4 (text), card_balance_after (money), voided_at (timestamptz); the rule "card" posts into offers/value (spend)`);
    // The ticket's own "due" is what the card is asked to pay: nothing was added to the ticket.
    expect(written[1]).toContain(`${base}/tables/tickets.json: no column added`);
    expect(answers.find((answer) => answer.startsWith('No errors.'))).toBeDefined();

    // How the turn ended, and what it left on disk.
    expect(published.find((event) => event.kind === 'turn-finished')).toMatchObject({ outcome: 'done' });
    const read = (file: string) => JSON.parse(readFileSync(join(root, base, file), 'utf8')) as Record<string, unknown>;
    expect((read('tables/ticket_lines.json')['postings'] as unknown[])[0]).toMatchObject({ id: 'card-load', via: 'ticket_id', post: { on: { to: ['paid'] } }, map: { card: 'gift_card_id', amount: 'load_amount' } });
    expect((read('tables/payments.json')['postings'] as unknown[])[0]).toMatchObject({ id: 'card', via: 'ticket_id', reverse: { on: { column: 'voided_at', set: true, own: true } }, map: { card: 'card_id', due: { parent: 'due' }, amount: 'amount' } });
    for (const file of ['tables/tickets.json', 'tables/ticket_lines.json', 'tables/payments.json']) expect(read(file)['builtOn'], file).toBeUndefined();
    expect((read('app.json')['compatibility'] as { minAdminiumVersion: string }).minAdminiumVersion).toBe(VERSION);
    expect(errorsNow()).toEqual([]);

    // The next turn starts from an app that says what posts where, with the add-ons skill whatever is said.
    const next = await prompt(store.read(session.id)!, [{ role: 'user', content: [{ type: 'text', text: 'Rename the page.' }] }]);
    expect(next.system).toContain('  posts to offers/value (issue), as lines of ticket_id:');
    expect(next.system).toContain('  posts to offers/value (spend), as lines of ticket_id:');
    expect(next.system).toContain('Requires the add-on offers >=1.0.12');
    expect(next.system).toContain('===== adminium-add-ons/SKILL.md =====');
  }, 60_000);
});
