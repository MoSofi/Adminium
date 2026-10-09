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
  ASSISTANT_MAX_ROUNDS,
  ASSISTANT_SCHEMA_VERSION,
  type AssistantStepEvent,
} from '@adminium/llm';

import { runAssistantTurn, type TurnMessage, type TurnRunInput } from '../src/assistant/turn-runner.js';
import type { AssistantDocument, AssistantToolOutcome } from '../src/assistant/types.js';
import { makeScriptedClient, ProviderError, type ScriptStep } from './llm-fixtures.js';

/** A reply the contract accepts, with whichever move the test needs. */
function reply(move: Record<string, unknown>, say = 'Working on it.'): string {
  return JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say, ...move });
}

function call(id: string, tool: string, args: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, tool, args, step: { icon: 'database', label: `Run ${tool}`, detail: '' } };
}

/** A page's document that accepts anything, and projects two lines. */
function stubDocument(overrides: Partial<AssistantDocument> = {}): AssistantDocument {
  return {
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
  /** `null` for a page that drafts nothing. */
  document?: AssistantDocument | null;
  overrides?: Partial<TurnRunInput>;
}

function run(script: readonly ScriptStep[], options: RunOptions = {}) {
  const scripted = makeScriptedClient(script);
  const events: { event: AssistantStepEvent; percent: number }[] = [];
  const messages: TurnMessage[] = [{ role: 'user', content: 'Draft a welcome email' }];
  const document = options.document === undefined ? stubDocument() : options.document;
  const promise = runAssistantTurn({
    client: scripted.client,
    model: 'm',
    provider: 'anthropic',
    maxTokens: 4000,
    system: 'SYSTEM',
    messages,
    document: document ?? undefined,
    execute: options.execute ?? (() => Promise.resolve({ result: { ok: true } })),
    accept: (artefact) => (document ?? stubDocument()).acceptArtefact(artefact, {} as never),
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

  it('gives up when the rounds run out without an answer', async () => {
    const { scripted, promise } = run([{ text: reply({ calls: [call('c', 'list_documents')] }) }]);
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(scripted.calls).toHaveLength(ASSISTANT_MAX_ROUNDS);
    expect(outcome.errors[0]?.message).toContain('rounds');
  });

  it('leaves a round to answer in after every call the turn allows, one call at a time', async () => {
    // The shape a careful model takes: one lookup, read it, the next. At six
    // rounds this turn read everything it needed and never got to write.
    const lookups = Array.from({ length: ASSISTANT_MAX_CALLS_PER_TURN }, (_, n) => ({
      text: reply({ calls: [call(`c${String(n)}`, 'list_documents')] }),
    }));
    const { promise } = run([...lookups, { text: reply({}, 'Here is what I found.') }]);
    const outcome = await promise;
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.steps).toHaveLength(ASSISTANT_MAX_CALLS_PER_TURN);
  });

  it('tells the model before its last round, and not before', async () => {
    const { scripted, promise } = run([{ text: reply({ calls: [call('c', 'list_documents')] }) }]);
    await promise;
    const told = scripted.calls.map((sent) => sent.messages.some((message) => message.content.includes('your last reply')));
    expect(told.at(-1)).toBe(true);
    expect(told.slice(0, -1).every((value) => !value)).toBe(true);
    // It is the last thing the model reads, after the tool results it follows.
    expect(scripted.calls.at(-1)?.messages.at(-1)?.content).toContain('Do not call a tool');
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

describe('a page that drafts nothing', () => {
  it('answers in words, with the tools it ran', async () => {
    const { promise } = run(
      [
        { text: reply({ calls: [call('c1', 'read_rows', { table: 'main.customers' })] }) },
        { text: reply({}, 'You have 12 customers.') },
      ],
      { document: null, execute: () => Promise.resolve({ result: { total: 12 }, tables: ['shop.main.customers'] }) },
    );
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: 'done', say: 'You have 12 customers.', result: null, sources: ['shop.main.customers'] });
  });

  it('sends a draft back as a reply the page cannot use, and takes the answer that follows', async () => {
    const drafted = reply({ result: { title: 'T', meta: '', artefact: { name: 'x' } } }, 'Here is a draft.');
    const { scripted, promise } = run([{ text: drafted }, { text: reply({}, 'There are 12.') }], { document: null });
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: 'done', say: 'There are 12.', result: null });
    // The model was told why, in the words of the contract it was shown.
    expect(scripted.calls[1]?.messages.at(-1)?.content).toContain('This page has no document');
  });

  it('ends the turn when the model keeps drafting', async () => {
    const drafted = reply({ result: { title: 'T', meta: '', artefact: { name: 'x' } } });
    const { promise } = run([{ text: drafted }], { document: null });
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
  });
});

describe('a model that does not answer in the reply format', () => {
  const empty = (toolCalls?: string[]) => ({
    throw: new ProviderError({ provider: 'ollama', code: 'empty_response', message: 'ollama: no text', ...(toolCalls === undefined ? {} : { toolCalls }) }),
  });

  it('is asked again when its reply was only its own tool call, and told which call that was', async () => {
    const { scripted, promise } = run([empty(['repo_browser.open_file']), { text: reply({}, 'There are 12.') }], { document: null });
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: 'done', say: 'There are 12.' });
    const sent = scripted.calls[1]!.messages;
    expect(sent.at(-1)!.content).toContain('"repo_browser.open_file"');
    expect(sent.at(-1)!.content).toContain('in "calls" INSIDE that object');
    // Its empty turn is in the record as a word: a provider refuses a message with no text.
    expect(sent.at(-2)).toEqual({ role: 'assistant', content: '(no text)' });
  });

  it('ends as the model`s fault, not the wire`s, when it never does', async () => {
    const { scripted, promise } = run([empty(['shell'])], { document: null });
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: 'failed', reason: 'model-format' });
    // Asked, then twice more.
    expect(scripted.calls).toHaveLength(3);
  });

  it('ends the same way after replies it could not read, and not when the model declined', async () => {
    const unreadable = await run([{ text: 'I think the answer is twelve.' }], { document: null }).promise;
    expect(unreadable).toMatchObject({ status: 'failed', reason: 'model-format' });
    const declined = await run([{ text: JSON.stringify({ error: 'I will not do that.' }) }], { document: null }).promise;
    expect(declined.status).toBe('failed');
    expect((declined as { reason?: string }).reason).toBeUndefined();
  });

  it('still ends a turn at once when the provider itself fails', async () => {
    const { scripted, promise } = run([{ throw: new ProviderError({ provider: 'ollama', code: 'network', message: 'refused' }) }]);
    const outcome = await promise;
    expect(outcome.status).toBe('failed');
    expect((outcome as { reason?: string }).reason).toBeUndefined();
    expect(scripted.calls).toHaveLength(1);
  });

  it('keeps a repair for the draft after two for the format', async () => {
    const draft = (name: string) => reply({ result: { title: 'T', meta: '', artefact: { name } } });
    let seen = 0;
    const { promise } = run([{ text: 'not json' }, { text: 'still not json' }, { text: draft('bad') }, { text: draft('good') }], {
      document: {
        formatSpec: () => '',
        examples: () => [],
        // The first draft is refused by the page; the second is fine.
        acceptArtefact: (artefact) => {
          seen += 1;
          return Promise.resolve(artefact.name === 'good' ? { ok: true as const, artefact } : { ok: false as const, errors: [{ path: 'name', code: 'X', message: 'not that name' }] });
        },
        projectForDiff: () => [],
        baseForDiff: () => Promise.resolve(null),
        details: () => [],
      },
    });
    const outcome = await promise;
    // With one shared budget of two, the refused draft was the end of the turn.
    expect(outcome.status).toBe('done');
    expect(seen).toBe(2);
  });
});

describe('an answer with nothing in it', () => {
  it('is asked for again rather than shown as an empty reply', async () => {
    const { scripted, promise } = run([{ text: reply({}, '') }, { text: reply({}, '   ') }, { text: reply({}, 'Twelve.') }], { document: null });
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: 'done', say: 'Twelve.' });
    expect(scripted.calls[1]!.messages.at(-1)!.content).toContain('"say" is empty');
  });

  it('lets a draft speak for itself: a result needs no words beside it', async () => {
    const { promise } = run([{ text: reply({ result: { title: 'T', meta: '', artefact: { name: 'x' } } }, '') }]);
    expect((await promise).status).toBe('done');
  });
});
