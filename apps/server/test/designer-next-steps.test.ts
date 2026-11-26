// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The buttons under a reply: what a model may ask for, and what the server
 * lets stand. The names a person reads are the server's, never the model's.
 */
import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventLog, type DesignerEvent } from '../src/designer/events.js';
import { NEXT_STEP_TEXT_MAX, NEXT_STEPS_MAX, resolveNextSteps, suggestNextTool, type NextStepsDeps } from '../src/designer/next-steps.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import type { ToolContext } from '../src/designer/tool-types.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
let deps: NextStepsDeps;

beforeEach(async () => {
  root = tempProject('adminium-designer-next-');
  const io = fakeIo({ interactive: false });
  const cli = fakeDeps({ cwd: root, env: {} });
  cli.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps: cli }), io.stderr()).toBe(0);
  deps = {
    root,
    version: APP_VERSION,
    listAddOns: async () => [
      { key: 'inventory', name: 'Inventory', version: '1.0.36', line: 'Stock that counts itself.', state: 'listed' },
      { key: 'invoices', name: 'Invoices & Receipts', version: '1.0.7', line: 'Invoices and receipts.', state: 'installed' },
    ],
  };
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the steps a reply offers', () => {
  it('a table of the app becomes its name and its dashboard page, read from the app’s own files', async () => {
    expect(await resolveNextSteps(deps, 'repairs', [{ table: 'items' }])).toEqual({ steps: [{ kind: 'rows', table: 'items', name: 'Items', path: '/p/repairs-items' }], dropped: [] });
  });

  it('an add-on is named by the server, and says whether it is installed', async () => {
    const { steps } = await resolveNextSteps(deps, 'repairs', [
      { add_on: 'inventory', say: 'Lower stock when a repair uses a part' },
      { add_on: 'invoices', say: 'Send a receipt for each repair' },
    ]);
    expect(steps).toEqual([
      { kind: 'add-on', key: 'inventory', name: 'Inventory', text: 'Lower stock when a repair uses a part', installed: false },
      { kind: 'add-on', key: 'invoices', name: 'Invoices & Receipts', text: 'Send a receipt for each repair', installed: true },
    ]);
  });

  it('a request is one plain line, cut to its length', async () => {
    const { steps } = await resolveNextSteps(deps, 'repairs', [{ say: `Add a page\nwhere customers book ${'x'.repeat(200)}` }]);
    expect(steps).toHaveLength(1);
    const [step] = steps;
    expect(step?.kind === 'ask' && !step.text.includes('\n') && [...step.text].length <= NEXT_STEP_TEXT_MAX).toBe(true);
  });

  it('drops what the server cannot stand behind, and says why', async () => {
    const { steps, dropped } = await resolveNextSteps(deps, 'repairs', [{ table: 'nothing_here' }, { add_on: 'made-up', say: 'Do magic' }, { add_on: 'inventory' }, {}, { say: 'Add a booking page' }]);
    expect(steps).toEqual([{ kind: 'ask', text: 'Add a booking page' }]);
    expect(dropped).toHaveLength(4);
    expect(dropped[0]).toContain('not a table of this app');
    expect(dropped[1]).toContain('list_add_ons');
  });

  it('shows no step twice, and no more than the page has room for', async () => {
    const many = await resolveNextSteps(deps, 'repairs', [{ table: 'items' }, { table: 'items' }, { say: 'One' }, { say: 'One' }, { say: 'Two' }, { say: 'Three' }, { say: 'Four' }]);
    expect(many.steps).toHaveLength(NEXT_STEPS_MAX);
    expect(many.steps.map((step) => (step.kind === 'ask' ? step.text : step.kind))).toEqual(['rows', 'One', 'Two', 'Three']);
  });

  it('what is not a list is no step', async () => {
    expect((await resolveNextSteps(deps, 'repairs', 'Add Stripe')).steps).toEqual([]);
  });
});

describe('suggest_next', () => {
  const run = async (input: Record<string, unknown>) => {
    const events: DesignerEvent[] = [];
    const signal = new AbortController().signal;
    const ask = async (): Promise<never> => {
      throw new Error('it asks nothing');
    };
    const log = createEventLog({ lastSeq: 0, append: (event) => void events.push(event), publish: () => undefined });
    const context: ToolContext = { session: { id: 'ds_000000000000000000000000', appKey: 'repairs' } as DesignerSession, turn: 3, signal, ask, handle: { turn: 3, by: { id: null, label: 'x' }, signal, ask, events: log } };
    const outcome = await suggestNextTool(deps, 'repairs').run(input, context);
    log.flush();
    return { outcome, events };
  };

  it('says the steps as one event of the turn, and tells the model not to say them again', async () => {
    const { outcome, events } = await run({ steps: [{ table: 'items' }, { say: 'Add a booking page' }] });
    expect(events).toMatchObject([{ kind: 'next-steps', turn: 3, steps: [{ kind: 'rows', table: 'items' }, { kind: 'ask', text: 'Add a booking page' }] }]);
    expect(outcome).toMatchObject({ label: 'Suggested what comes next', facts: { count: 2 } });
    expect(outcome.content).toContain('Do not list them again');
  });

  it('a call nothing of which stands takes the buttons away and says so', async () => {
    const { outcome, events } = await run({ steps: [{ add_on: 'made-up', say: 'Do magic' }] });
    expect(events).toMatchObject([{ kind: 'next-steps', steps: [] }]);
    expect(outcome).toMatchObject({ label: 'No next steps', facts: { count: 0 } });
    expect(outcome.content).toContain('list_add_ons');
  });
});
