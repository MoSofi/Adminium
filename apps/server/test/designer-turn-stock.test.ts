// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SUPPLIES APP, START TO FINISH, WITH A SCRIPTED MODEL.
 *
 * "Track the supplies each job uses": the prompt carries the add-ons skill
 * and the stock task; the model writes its own table, looks at the add-ons,
 * and calls post_to_ledger; the person is asked for the add-on on a card and
 * says yes; the rule, the requirement and the grant are written; the app's
 * own check passes; and the next turn's prompt says what posts where.
 *
 * The model answers from a script. The prompt, the tools, the files and the
 * check are the real ones; the add-on is the test one that keeps a ledger.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderRunner, RunRequest, RunResult } from '@adminium/llm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import type { DesignerEvent } from '../src/designer/events.js';
import type { AddOnGetter } from '../src/designer/get-add-on.js';
import { createPrompt } from '../src/designer/prompt.js';
import { createDesignerRunner } from '../src/designer/runner.js';
import { createSessionStore, type SessionStore } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import { createDesignerTools, type AddOnLine } from '../src/designer/tools.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';

/** This server: the version the starter app is written for, whatever release this is. */
const VERSION = APP_VERSION.replace(/[-+].*$/, '');
const BY = { id: 'u1', label: 'Owner' };
let root: string;
let sessions: string;
let store: SessionStore;
let onServer: boolean;

beforeEach(async () => {
  root = tempProject('adminium-designer-stock-');
  sessions = mkdtempSync(join(tmpdir(), 'adminium-designer-stock-sessions-'));
  store = createSessionStore(sessions);
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
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

describe('a supplies app, start to finish', () => {
  it('the model looks at the add-ons, posts its table into the ledger after the person\'s yes, and the app checks', async () => {
    const base = 'apps/repairs/manifest';
    const steps: RunResult[] = [
      call(
        ['write_file', { path: `${base}/tables/item_parts.json`, content: JSON.stringify({ ref: 'item_parts', label: { 'en-US': 'Part used' }, labelPlural: { 'en-US': 'Parts used' }, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'item_id', type: 'fk', references: 'items' }] }) }],
        ['list_add_ons', {}],
      ),
      call(['post_to_ledger', { add_on: 'ledger-kit', ledger: 'units', action: 'use', table: 'item_parts', via: 'item_id', when: { post: { column: 'status', in: ['done'] }, reverse: { column: 'status', from: ['done'], in: ['open'] } }, role: 'staff' }]),
      call(['check_app', {}]),
      says('A job\'s parts now come out of stock when the job is done.'),
    ];
    const requests: RunRequest[] = [];
    const model: ProviderRunner = {
      id: 'anthropic',
      async run(req) {
        requests.push(req);
        return steps.shift() ?? says('Done.');
      },
    };
    const listed: AddOnLine = { key: 'ledger-kit', name: 'Ledger kit', version: '1.0.0', line: 'Units by account.', state: 'listed' };
    const here = (): AddOnLine => ({ ...listed, state: 'installed', shapes: [], ledgers: ['units — use (account: link to accounts, quantity: decimal; optional note)'] });
    const getter: AddOnGetter = {
      look: async () => (onServer ? { state: 'installed', name: 'Ledger kit', version: '1.0.0' } : { state: 'listed', name: 'Ledger kit', version: '1.0.0', line: 'Units by account.' }),
      allowed: async () => true,
      switchOn: async () => ({ ok: true }),
      get: async () => {
        onServer = true;
        return { ok: true, name: 'Ledger kit', version: '1.0.0' };
      },
    };
    const published: DesignerEvent[] = [];
    const prompt = createPrompt({ root, version: VERSION, skills: createSkills(), providerOf: async () => 'anthropic' });
    const runner = createDesignerRunner({
      store,
      runnerFor: async () => ({ runner: model }),
      tools: () =>
        createDesignerTools(
          {
            root,
            version: VERSION,
            designer: () => ({ store }) as never,
            skills: createSkills(),
            listAddOns: async () => [onServer ? here() : listed],
            addOnGetter: getter,
            readAddOn: async (key) => (onServer && key === 'ledger-kit' ? ledgerKitManifest() : null),
          },
          'repairs',
        ),
      prompt,
      // The engine's part, as far as a folder goes: the app's own check.
      pipeline: async () => {
        const errors = checkApp(root, 'repairs', { version: VERSION }).findings.filter((finding) => finding.level === 'error');
        return errors.length === 0 ? { ok: true, version: { n: 1, name: 'v1' } } : { ok: false, version: null };
      },
      limits: async () => ({ maxSteps: 60, turnTokens: 400_000, sessionTokens: 4_000_000 }),
      retryWaitsMs: [0, 0],
      publish: (event) => published.push(event),
      audit: async () => undefined,
    });
    const session = store.create({ appKey: 'repairs', title: 'Repairs', target: 'dashboard', connectionId: 'env:anthropic', model: 'm', createdApp: false });

    await runner.start(session.id, { text: 'Track the supplies each job uses, and take them out of stock when the job is done.', by: BY });

    // The person is asked for the add-on, by the server's own words, once.
    await vi.waitFor(() => expect(runner.waiting(session.id)).toHaveLength(1), { timeout: 20_000 });
    const card = runner.waiting(session.id)[0]!;
    expect(card).toMatchObject({ type: 'add-on', key: 'ledger-kit', name: 'Ledger kit', version: '1.0.0' });
    runner.answer(session.id, card.id, { accept: true }, BY);
    await runner.settled();

    // What the model was told before it wrote anything.
    const system = requests[0]!.system ?? '';
    expect(system).toContain('===== adminium-add-ons/SKILL.md =====');
    expect(system).toContain('- adminium-app/references/guides/manifest-by-task--stock-from-the-inventory-add-on.md: Stock from the Inventory add-on');
    expect(system).toContain('then call post_to_ledger with that table');
    expect(requests[0]!.tools?.map((tool) => tool.name)).toContain('post_to_ledger');

    // What each tool answered.
    const answers = requests.flatMap((request) => request.messages.at(-1)?.content ?? []).flatMap((block) => (block.type === 'tool_result' ? [String(block.content)] : []));
    expect(answers.find((answer) => answer.startsWith('ledger-kit 1.0.0'))).toBe('ledger-kit 1.0.0 (not on this server: get_add_on brings it) — Ledger kit: Units by account.');
    const written = answers.find((answer) => answer.startsWith('Written:'))!;
    expect(written).toContain('added account_id (int, a link to ledger-kit.accounts), qty (decimal, scale 4); the rule "units" posts into ledger-kit/units (use)');
    expect(written).toContain(`${base}/add-ons.json: requires ledger-kit >=1.0.0`);
    expect(written).toContain('"staff" reads ledger-kit.accounts');
    expect(answers.find((answer) => answer.startsWith('No errors.'))).toBeDefined();

    // How the turn ended, and what it left on disk.
    expect(published.find((event) => event.kind === 'turn-finished')).toMatchObject({ outcome: 'done' });
    const table = JSON.parse(readFileSync(join(root, base, 'tables/item_parts.json'), 'utf8')) as { postings: { into: unknown; map: unknown }[] };
    expect(table.postings).toHaveLength(1);
    expect(table.postings[0]).toMatchObject({ into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' } });
    expect(checkApp(root, 'repairs', { version: VERSION }).findings.filter((finding) => finding.level === 'error')).toEqual([]);

    // The next turn starts from an app that says what posts where, with the add-ons skill whatever is said.
    const next = await prompt(store.read(session.id)!, [{ role: 'user', content: [{ type: 'text', text: 'Rename the page.' }] }]);
    expect(next.system).toContain('  posts to ledger-kit/units (use), as lines of item_id: post when status becomes done; reverse when status becomes open (from done); maps account←account_id, quantity←qty');
    expect(next.system).toContain('Requires the add-on ledger-kit >=1.0.0');
    expect(next.system).toContain('===== adminium-add-ons/SKILL.md =====');
  }, 60_000);
});
