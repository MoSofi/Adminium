// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The turn loop, scripted.
 *
 * Pure: a scripted provider, a stub context and a tool executor that answers
 * from a table — no meta store, no job runtime, no network. What is being
 * proved is the conversation itself: how many rounds it takes, what it sends
 * back after each of them, which failures cost a repair and which end the
 * turn, and that the caps hold.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ASSISTANT_MAX_CALLS_PER_TURN,
  ASSISTANT_SCHEMA_VERSION,
  type AssistantStepEvent,
} from '@adminium/llm';

import { runAssistantTurn, type TurnMessage, type TurnRunInput } from '../src/assistant/turn-runner.js';
import type { AssistantContextAdapter, AssistantToolOutcome } from '../src/assistant/types.js';
import { makeScriptedClient, ProviderError, type ScriptStep } from './llm-fixtures.js';

/** A reply the contract accepts, with whichever move the test needs. */
function reply(move: Record<string, unknown>, say = 'Working on it.'): string {
  return JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say, ...move });
}

function call(id: string, tool: string, args: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, tool, args, step: { icon: 'database', label: `Run ${tool}`, detail: '' } };
}

/** A context that accepts anything with a `name`, and projects two lines. */
function stubContext(overrides: Partial<AssistantContextAdapter> = {}): AssistantContextAdapter {
  return {
    key: 'email',
    pageLabel: 'Email templates',
    toolNames: [],
    pageFacts: () => Promise.resolve({ values: {}, scope: { primary: '', extra: 0 }, prompt: '' }),
    formatSpec: () => '',
    examples: () => [],
    acceptArtefact: (artefact) => Promise.resolve({ ok: true as const, artefact }),
    projectForDiff: (artefact) => [`name: ${String(artefact.name ?? '')}`, `body: ${String(artefact.body ?? '')}`],
    baseForDiff: () => Promise.resolve(null),
    details: () => [{ kind: 'formatEmail' as const, args: { blocks: 4 } }],
    ...overrides,
  };
}

interface RunOptions {
  execute?: TurnRunInput['execute'];
  context?: AssistantContextAdapter;
  overrides?: Partial<TurnRunInput>;
}

function run(script: readonly ScriptStep[], options: RunOptions = {}) {
  const scripted = makeScriptedClient(script);
  const events: { event: AssistantStepEvent; percent: number }[] = [];
  const messages: TurnMessage[] = [{ role: 'user', content: 'Draft a welcome email' }];
  const promise = runAssistantTurn({
    client: scripted.client,
    model: 'm',
    provider: 'anthropic',
    maxTokens: 4000,
    system: 'SYSTEM',
    messages,
    context: options.context ?? stubContext(),
    execute: options.execute ?? (() => Promise.resolve({ result: { ok: true } })),
    accept: (artefact) => (options.context ?? stubContext()).acceptArtefact(artefact, {} as never),
    onStep: (event, percent) => {
      events.push({ event, percent });
    },
    ...options.overrides,
  });
  return { scripted, events, promise };
}

describe('the turn loop', () => {
  it('runs tools over three rounds and ends with a validated draft', async () => {
    const seen: string[] = [];
    const { scripted, events, promise } = run(
      [
        { text: reply({ calls: [call('c1', 'list_documents')] }), usage: { inputTokens: 100, outputTokens: 20 } },
        {
          text: reply({ calls: [call('c2', 'read_rows', { table: 'main.customers' })] }),
          usage: { inputTokens: 200, outputTokens: 30 },
        },
        {
          text: reply(
            {
              result: {
                title: 'Welcome email',
                meta: 'template · 4 blocks',
                artefact: { name: 'Welcome', body: 'hello' },
                followups: ['Make it shorter'],
              },
            },
            'Here is a draft.',
          ),
          usage: { inputTokens: 300, outputTokens: 40 },
        },
      ],
      {
        execute: (input) => {
          seen.push(input.tool);
          return Promise.resolve(
            input.tool === 'read_rows'
              ? ({ result: { rows: [] }, tables: ['conn_1.main.customers'] } satisfies AssistantToolOutcome)
              : ({ result: { documents: [] } } satisfies AssistantToolOutcome),
          );
        },
      },
    );
    const outcome = await promise;

    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(seen).toEqual(['list_documents', 'read_rows']);
    expect(scripted.calls).toHaveLength(3);
    // Every round's usage lands on the turn, not just the last one's.
    expect(outcome.tokensIn).toBe(600);
    expect(outcome.tokensOut).toBe(90);
    expect(outcome.sources).toEqual(['conn_1.main.customers']);

    expect(outcome.steps.map((step) => [step.id, step.state])).toEqual([
      ['c1', 'done'],
      ['c2', 'done'],
    ]);
    // The table a step read is on the step, so the card can draw the chip.
    expect(outcome.steps[1]?.tables).toEqual(['conn_1.main.customers']);

    const result = outcome.result;
    expect(result?.title).toBe('Welcome email');
    // No base document, so the whole draft is an addition.
    expect(result?.diff.adds).toBe(2);
    expect(result?.diff.dels).toBe(0);
    expect(result?.diff.against).toBeNull();
    // The page's own rows are kinds the dashboard words; the model's stay in
    // its own words, in their own list.
    expect(result?.details[0]).toEqual({ kind: 'formatEmail', args: { blocks: 4 } });
    expect(result?.modelDetails).toEqual([]);
    expect(result?.followups).toEqual(['Make it shorter']);
    expect(result?.sources).toEqual(['conn_1.main.customers']);

    // Step events reach the channel as they happen: started, then done.
    expect(events.map((entry) => [entry.event.id, entry.event.state])).toEqual([
      ['c1', 'started'],
      ['c1', 'done'],
      ['c2', 'started'],
      ['c2', 'done'],
    ]);
    expect(events.at(-1)?.event.note).toEqual({ kind: 'ready' });
  });

  it('diffs a draft against the document it is based on', async () => {
    const { promise } = run(
      [
        {
          text: reply({
            result: {
              title: 'German welcome',
              meta: '',
              basedOn: 'tpl_1',
              artefact: { name: 'Willkommen', body: 'hallo' },
            },
          }),
        },
      ],
      {
        overrides: {
          baseLines: () => Promise.resolve(['name: Welcome', 'body: hello']),
        },
      },
    );
    const outcome = await promise;
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.result?.diff.against).toBe('tpl_1');
    expect(outcome.result?.diff.adds).toBe(2);
    expect(outcome.result?.diff.dels).toBe(2);
  });

  it('stops on a question and waits for the person', async () => {
    const { promise } = run([
      {
        text: reply({
          ask: {
            groups: [
              {
                key: 'tpl',
                title: 'Template',
                options: [
                  { key: 't1', label: 'Standard', detail: '' },
                  { key: 't2', label: 'EU', detail: '' },
                ],
              },
            ],
          },
        }),
      },
    ]);
    const outcome = await promise;
    expect(outcome.status).toBe('awaiting_picks');
    if (outcome.status !== 'awaiting_picks') return;
    expect(outcome.ask.groups).toHaveLength(1);
    // The question itself is in the transcript, so the answer has something to
    // answer when it arrives as the next turn.
    expect(outcome.messages.at(-1)?.role).toBe('assistant');
  });

  it('answers in words when the model makes no move at all', async () => {
    const { promise } = run([{ text: reply({}, 'A campaign goes to a list; a template is reused.') }]);
    const outcome = await promise;
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.result).toBeNull();
    expect(outcome.say).toBe('A campaign goes to a list; a template is reused.');
  });
});

describe('when the model gets it wrong', () => {
  it('repairs an unreadable reply twice, then fails with the errors', async () => {
    const { scripted, promise } = run([{ text: 'not json' }, { text: 'still not json' }, { text: '{ "nope": 1 }' }]);
    const outcome = await promise;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    // Three consecutive failures: the first attempt plus two repairs.
    expect(scripted.calls).toHaveLength(3);
    expect(outcome.errors.length).toBeGreaterThan(0);
    // Each repair went back as the model's own text plus the error list.
    const repairs = scripted.calls[2]?.messages.filter((message) =>
      message.content.startsWith('Your previous response failed machine validation'),
    );
    expect(repairs).toHaveLength(2);
  });

  it('hands the page`s own complaints back once, and accepts the correction', async () => {
    const accept = vi
      .fn<TurnRunInput['accept']>()
      .mockResolvedValueOnce({
        ok: false as const,
        errors: [
          { path: 'blocks.3.block', code: 'UNKNOWN_BLOCK_KIND', message: 'email.hero is not a block kind.' },
        ],
      })
      .mockResolvedValueOnce({ ok: true as const, artefact: { name: 'Fixed' } });

    const { scripted, promise } = run(
      [
        { text: reply({ result: { title: 'Draft', meta: '', artefact: { name: 'Broken' } } }) },
        { text: reply({ result: { title: 'Draft', meta: '', artefact: { name: 'Fixed' } } }) },
      ],
      { overrides: { accept } },
    );
    const outcome = await promise;

    expect(outcome.status).toBe('done');
    expect(accept).toHaveBeenCalledTimes(2);
    // The correction names the path and the kind, so the model can fix that
    // block rather than re-draft the document.
    const correction = scripted.calls[1]?.messages.at(-1)?.content ?? '';
    expect(correction).toContain('artefact_errors');
    expect(correction).toContain('UNKNOWN_BLOCK_KIND');
    expect(correction).toContain('blocks.3.block');
  });

  it('fails when the draft is still invalid after its repairs', async () => {
    const { promise } = run(
      [
        { text: reply({ result: { title: 'D', meta: '', artefact: {} } }) },
        { text: reply({ result: { title: 'D', meta: '', artefact: {} } }) },
        { text: reply({ result: { title: 'D', meta: '', artefact: {} } }) },
      ],
      {
        overrides: {
          accept: () =>
            Promise.resolve({
              ok: false as const,
              errors: [{ path: 'name', code: 'ARTEFACT_INVALID', message: 'name is required' }],
            }),
        },
      },
    );
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.errors[0]).toMatchObject({ path: 'name', message: 'name is required' });
  });

  it('ends the turn on a provider failure rather than re-prompting it', async () => {
    const { scripted, promise } = run([{ throw: new ProviderError({ provider: 'anthropic', code: 'auth', message: 'Invalid API key' }) }]);
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(scripted.calls).toHaveLength(1);
    expect(outcome.errors[0]).toMatchObject({ kind: 'provider', code: 'auth' });
  });

  it('names the tools that exist when the model invents one', async () => {
    const { promise } = run(
      [
        { text: reply({ calls: [call('c1', 'delete_everything')] }) },
        { text: reply({}, 'Understood.') },
      ],
      {
        execute: () =>
          Promise.resolve({
            error: { code: 'UNKNOWN_TOOL', message: 'There is no tool called "delete_everything" here.' },
          }),
      },
    );
    const outcome = await promise;
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.steps[0]?.state).toBe('failed');
  });
});

describe('the caps', () => {
  it('stops at twelve tool calls in a turn and says so', async () => {
    // Four calls a round: three rounds fit, the fourth is over the cap.
    const four = (round: number): Record<string, unknown> => ({
      calls: [1, 2, 3, 4].map((n) => call(`r${String(round)}c${String(n)}`, 'list_documents')),
    });
    const { scripted, promise } = run([
      { text: reply(four(1)) },
      { text: reply(four(2)) },
      { text: reply(four(3)) },
      { text: reply(four(4)) },
      { text: reply({}, 'Done what I can.') },
    ]);
    const outcome = await promise;

    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.steps).toHaveLength(ASSISTANT_MAX_CALLS_PER_TURN);
    // The model is TOLD, rather than handed an empty result it cannot explain.
    const told = scripted.calls.at(-1)?.messages.some((message) => message.content.includes('tool calls this request allows'));
    expect(told).toBe(true);
  });

  it('gives up after six rounds of tool calls without an answer', async () => {
    const { scripted, promise } = run([{ text: reply({ calls: [call('c', 'list_documents')] }) }]);
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(scripted.calls).toHaveLength(6);
    expect(outcome.errors[0]?.message).toContain('rounds');
  });

  it('asks for temperature 0 on every round', async () => {
    const { scripted, promise } = run([{ text: reply({}, 'Hello.') }]);
    await promise;
    expect(scripted.calls.every((request) => request.temperature === 0)).toBe(true);
  });
});

describe('cancellation', () => {
  it('stops between rounds when the job is cancelled', async () => {
    const controller = new AbortController();
    const { promise } = run(
      [
        { text: reply({ calls: [call('c1', 'list_documents')] }) },
        { text: reply({}, 'unreachable') },
      ],
      {
        execute: () => {
          controller.abort();
          return Promise.resolve({ result: {} });
        },
        overrides: { signal: controller.signal },
      },
    );
    const outcome = await promise;
    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    // What ran is kept: the steps are the record of what the turn did do.
    expect(outcome.steps).toHaveLength(1);
  });
});

/**
 * The turn's first step is the page it read.
 *
 * It is TRUE by construction, unlike every step after it: the runner reports
 * what `pageFacts` found before it asked the model anything. And it carries
 * FACTS, not a sentence — a sentence composed here would be English on the
 * wire, and the dashboard words it per page in the operator's own language.
 */
describe('the page-read step', () => {
  it('is published first, already done, with the facts and no words', async () => {
    const { events, promise } = run([{ text: reply({}) }], {
      overrides: { pageFacts: { templates: 3, campaigns: 1 } },
    });
    const outcome = await promise;

    expect(outcome.status).toBe('done');
    const first = outcome.steps[0];
    expect(first?.id).toBe('page');
    // Done on arrival: the read had already happened when the step was made.
    expect(first?.state).toBe('done');
    expect(first?.facts).toEqual({ templates: 3, campaigns: 1 });
    // No sentence here, in any language.
    expect(first?.label).toBe('');
    expect(first?.detail).toBe('');

    // And it reached the socket before anything else did.
    expect(events[0]?.event.id).toBe('page');
    expect(events[0]?.event.facts).toEqual({ templates: 3, campaigns: 1 });
  });

  it('is absent when the caller has no page to report', async () => {
    const outcome = await run([{ text: reply({}) }]).promise;
    expect(outcome.steps.map((step) => step.id)).not.toContain('page');
  });
});
