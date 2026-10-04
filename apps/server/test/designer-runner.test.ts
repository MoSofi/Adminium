// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's turn, with a scripted model.
 *
 * A turn is a loop between a model and its tools, and how it ENDS is most of
 * what a person sees: finished and applied, stopped, out of steps or tokens,
 * failed. Each ending is driven here by a model that answers from a script,
 * so the loop is tested without a provider. The files a session leaves are
 * read back, because they are what survives a restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProviderError, type ProviderRunner, type RunMessage, type RunRequest, type RunResult } from '@adminium/llm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesignerEvent } from '../src/designer/events.js';
import { createEventLog, TEXT_FLUSH_CHARS } from '../src/designer/events.js';
import { createDesignerRunner, MAX_REPAIRS, type DesignerLimits, type DesignerRunner, type PipelineResult, type TurnHandle } from '../src/designer/runner.js';
import { createSessionStore, type DesignerSession, type SessionStore } from '../src/designer/session-store.js';
import type { DesignerTool } from '../src/designer/tool-types.js';
import { closeDangling, INTERRUPTED, joinUserMessages } from '../src/designer/transcript.js';

let root: string;
let store: SessionStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-designer-'));
  store = createSessionStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const newSession = (): DesignerSession =>
  store.create({ appKey: 'repairs', title: 'Repairs', target: 'auto', connectionId: 'env:anthropic', model: 'm', createdApp: true });

// ── the files ────────────────────────────────────────────────────────────────

describe('a session’s files', () => {
  it('keeps what a session is, its messages and its events, and reads them back after a restart', () => {
    const session = newSession();
    store.appendMessage(session.id, 1, { role: 'user', content: [{ type: 'text', text: 'Make a jobs table.' }] });
    store.appendEvent(session.id, { kind: 'turn-started', text: 'x', seq: 1, turn: 1, at: 1 });
    store.appendEvent(session.id, { kind: 'stopped', seq: 2, turn: 1, at: 2 });

    const again = createSessionStore(root);
    expect(again.read(session.id)).toEqual(session);
    expect(again.messages(session.id)).toEqual([{ turn: 1, message: { role: 'user', content: [{ type: 'text', text: 'Make a jobs table.' }] } }]);
    expect(again.lastSeq(session.id)).toBe(2);
    expect(again.eventsSince(session.id, 1, 10)).toEqual({ events: [{ kind: 'stopped', seq: 2, turn: 1, at: 2 }], more: false });
    expect(again.eventsSince(session.id, 0, 1)).toMatchObject({ more: true });
    expect(again.list().map((listed) => listed.id)).toEqual([session.id]);
  });

  it('answers a 404 for an id that is not one, and never reads a path out of it', () => {
    for (const id of ['../../etc', 'ds_short', 'ds_0000000000000000000000000/..', '']) {
      expect(() => store.read(id)).toThrow('no such Designer session');
    }
  });
});

// ── the transcript ───────────────────────────────────────────────────────────

describe('a transcript a provider accepts', () => {
  const call = (id: string): RunMessage['content'][number] => ({ type: 'tool_call', id, name: 'read_file', input: {} });
  const result = (id: string): RunMessage['content'][number] => ({ type: 'tool_result', callId: id, content: 'ok' });

  it('answers a call that has no answer', () => {
    expect(closeDangling([{ role: 'user', content: [{ type: 'text', text: 'go' }] }, { role: 'assistant', content: [call('c1')] }])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [call('c1')] },
      { role: 'user', content: [{ type: 'tool_result', callId: 'c1', content: INTERRUPTED, isError: true }] },
    ]);
  });

  it('answers the one of two calls that went unanswered, ahead of what the person said next', () => {
    const fixed = closeDangling([
      { role: 'assistant', content: [call('c1'), call('c2')] },
      { role: 'user', content: [result('c1'), { type: 'text', text: 'and also…' }] },
    ]);
    expect(fixed[1]?.content.map((block) => (block.type === 'tool_result' ? block.callId : block.type))).toEqual(['c1', 'c2', 'text']);
  });

  it('leaves a clean transcript as it is', () => {
    const clean: RunMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [call('c1')] },
      { role: 'user', content: [result('c1')] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(closeDangling(clean)).toEqual(clean);
  });

  it('joins two user messages in a row, results first', () => {
    expect(joinUserMessages([{ role: 'user', content: [{ type: 'text', text: 'a' }] }, { role: 'user', content: [result('c1')] }])).toEqual([
      { role: 'user', content: [result('c1'), { type: 'text', text: 'a' }] },
    ]);
  });
});

// ── events ───────────────────────────────────────────────────────────────────

describe('a session’s events', () => {
  it('number from where the session left off, and are written before they are sent', () => {
    const order: string[] = [];
    const log = createEventLog({
      lastSeq: 41,
      append: (event) => order.push(`append ${String(event.seq)}`),
      publish: (event) => order.push(`publish ${String(event.seq)}`),
      now: () => 7,
    });
    expect(log.emit(3, { kind: 'stopped' })).toEqual({ kind: 'stopped', seq: 42, turn: 3, at: 7 });
    expect(order).toEqual(['append 42', 'publish 42']);
  });

  it('gather text, and send it before any other event', () => {
    vi.useFakeTimers();
    const sent: DesignerEvent[] = [];
    const log = createEventLog({ lastSeq: 0, append: () => undefined, publish: (event) => sent.push(event) });
    log.text(1, 'Hel');
    log.text(1, 'lo');
    expect(sent).toEqual([]);
    log.emit(1, { kind: 'stopped' });
    expect(sent.map((event) => event.kind)).toEqual(['text', 'stopped']);
    expect(sent[0]).toMatchObject({ delta: 'Hello', seq: 1 });

    log.text(1, 'more');
    vi.advanceTimersByTime(100);
    expect(sent.at(-1)).toMatchObject({ kind: 'text', delta: 'more' });

    log.text(1, 'x'.repeat(TEXT_FLUSH_CHARS));
    expect(sent.at(-1)).toMatchObject({ kind: 'text' });
    vi.useRealTimers();
  });
});

// ── the runner ───────────────────────────────────────────────────────────────

/** A model that answers each call from a script. A step may wait for the caller's stop. */
type Step = RunResult | Error | 'wait-for-stop';
function scripted(steps: Step[]): ProviderRunner & { requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  return {
    id: 'anthropic',
    requests,
    async run(req) {
      requests.push(req);
      const step = steps.shift() ?? { blocks: [{ type: 'text', text: 'Done.' }], stop: 'end', malformed: [] };
      if (step === 'wait-for-stop') {
        return new Promise<RunResult>((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new ProviderError({ provider: 'anthropic', code: 'aborted', message: 'stopped' })));
        });
      }
      if (step instanceof Error) throw step;
      req.onEvent?.({ type: 'text', delta: step.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('') });
      return step;
    },
  };
}
const says = (text: string, usage = true): RunResult => ({
  blocks: [{ type: 'text', text }],
  stop: 'end',
  malformed: [],
  ...(usage ? { usage: { inputTokens: 100, outputTokens: 10 } } : {}),
});
const calls = (...names: string[]): RunResult => ({
  blocks: names.map((name, index) => ({ type: 'tool_call' as const, id: `c${String(index)}_${name}`, name, input: { path: 'apps/repairs/x.json' } })),
  stop: 'tool_calls',
  malformed: [],
  usage: { inputTokens: 100, outputTokens: 10 },
});

const echo: DesignerTool = {
  name: 'read_file',
  description: 'Read a file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  running: (input) => `Reading ${String(input['path'])}`,
  run: async (input) => ({ content: `contents of ${String(input['path'])}`, label: `Read ${String(input['path'])}` }),
};
/** A tool that changes the app: a turn that called it is held to the check. */
const writing: DesignerTool = { ...echo, name: 'write_file', description: 'Write a file.', running: () => 'Writing', run: async () => ({ content: 'Made it.', label: 'Wrote it' }) };
const asking: DesignerTool = {
  name: 'ask_person',
  description: 'Ask.',
  inputSchema: { type: 'object' },
  running: () => 'Asking',
  run: async (_input, ctx) => {
    const answer = await ctx.ask({ type: 'question', question: 'Which colour?', choices: ['Red', 'Blue'] });
    return { content: answer.type === 'question' ? answer.text : '', label: 'Asked' };
  },
};

interface Harness {
  runner: DesignerRunner;
  model: ReturnType<typeof scripted>;
  published: DesignerEvent[];
  pipelineRuns: number;
  audits: string[];
}

function harness(
  steps: Step[],
  opts: { limits?: Partial<DesignerLimits>; pipeline?: (handle: TurnHandle) => Promise<PipelineResult>; tools?: DesignerTool[]; problems?: () => string[]; advice?: () => string[]; sight?: NonNullable<Parameters<typeof createDesignerRunner>[0]['sight']> } = {},
): Harness {
  const model = scripted(steps);
  const h: Harness = {
    model,
    published: [],
    pipelineRuns: 0,
    audits: [],
    runner: undefined as unknown as DesignerRunner,
  };
  h.runner = createDesignerRunner({
    store,
    runnerFor: async () => ({ runner: model }),
    tools: () => opts.tools ?? [echo, writing, asking],
    prompt: async (_session, messages) => ({ system: 'You build apps.', messages }),
    pipeline: async (_session, handle) => {
      h.pipelineRuns += 1;
      if (opts.pipeline !== undefined) return opts.pipeline(handle);
      handle.events.emit(handle.turn, { kind: 'version', n: 1, name: 'v1' });
      return { ok: true, version: { n: 1, name: 'v1' } };
    },
    limits: async () => ({ maxSteps: 60, turnTokens: 400_000, sessionTokens: 4_000_000, ...opts.limits }),
    ...(opts.problems === undefined ? {} : { problems: opts.problems }),
    ...(opts.advice === undefined ? {} : { advice: opts.advice }),
    ...(opts.sight === undefined ? {} : { sight: opts.sight }),
    retryWaitsMs: [0, 0],
    publish: (event) => h.published.push(event),
    audit: async (action) => {
      h.audits.push(action);
    },
  });
  return h;
}

const kinds = (h: Harness): string[] => h.published.map((event) => event.kind);
const finished = (h: Harness): unknown => h.published.find((event) => event.kind === 'turn-finished');

describe('a Designer turn', () => {
  it('runs the tools the model calls, in order, then lets the engine judge, and keeps it all in the files', async () => {
    const session = newSession();
    const h = harness([calls('read_file', 'read_file'), says('I made the table.')]);
    expect(await h.runner.start(session.id, { text: 'Make a jobs table.', by: { id: 'u1', label: 'Owner' } })).toEqual({ turn: 1 });
    await h.runner.settled();

    expect(kinds(h)).toEqual(['turn-started', 'usage', 'step', 'step', 'step', 'step', 'text', 'usage', 'version', 'turn-finished']);
    expect(finished(h)).toMatchObject({ outcome: 'done' });
    expect(h.published.filter((event) => event.kind === 'step').map((event) => (event.kind === 'step' ? [event.state, event.label] : null))).toEqual([
      ['running', 'Reading apps/repairs/x.json'],
      ['done', 'Read apps/repairs/x.json'],
      ['running', 'Reading apps/repairs/x.json'],
      ['done', 'Read apps/repairs/x.json'],
    ]);
    expect(h.published.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(h.pipelineRuns).toBe(1);
    expect(h.audits).toEqual(['designer.turn.started', 'designer.turn.finished']);

    // The second request carried the results, and the transcript holds the whole turn.
    const second = h.model.requests[1]?.messages ?? [];
    expect(second.at(-1)?.content).toEqual([
      { type: 'tool_result', callId: 'c0_read_file', content: 'contents of apps/repairs/x.json' },
      { type: 'tool_result', callId: 'c1_read_file', content: 'contents of apps/repairs/x.json' },
    ]);
    expect(store.messages(session.id).map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(store.read(session.id)).toMatchObject({ turns: 1, tokens: { in: 200, out: 20 } });
    expect(store.eventsSince(session.id, 0, 100).events).toHaveLength(10);
  });

  it('lets one turn run at a time in a project folder', async () => {
    const one = newSession();
    const two = newSession();
    const h = harness(['wait-for-stop']);
    await h.runner.start(one.id, { text: 'go', by: { id: null, label: 'x' } });
    await vi.waitFor(() => expect(h.model.requests).toHaveLength(1));
    await expect(h.runner.start(two.id, { text: 'go', by: { id: null, label: 'x' } })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'TURN_RUNNING', sessionId: one.id } });
    expect(h.runner.active()).toEqual({ sessionId: one.id, turn: 1 });
    h.runner.stop(one.id);
    await h.runner.settled();
    expect(h.runner.active()).toBeNull();
  });

  it('stops within a second in the middle of a model call, keeps no version, and can be continued', async () => {
    const session = newSession();
    const h = harness(['wait-for-stop', says('Picked up where I stopped.')]);
    await h.runner.start(session.id, { text: 'Build it.', by: { id: null, label: 'x' } });
    // In the middle of the model call, not before it.
    await vi.waitFor(() => expect(h.model.requests).toHaveLength(1));
    const started = Date.now();
    expect(h.runner.stop(session.id)).toBe(true);
    await h.runner.settled();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(kinds(h).slice(-2)).toEqual(['stopped', 'turn-finished']);
    expect(finished(h)).toMatchObject({ outcome: 'stopped' });
    expect(h.pipelineRuns).toBe(0);

    await h.runner.start(session.id, { text: 'Continue.', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(finished({ published: h.published.filter((event) => event.turn === 2) } as Harness)).toMatchObject({ outcome: 'done' });
  });

  it('closes a call the stop left unanswered, so the next turn’s transcript is one a provider accepts', async () => {
    const session = newSession();
    let release: (() => void) | undefined;
    const slow: DesignerTool = {
      ...echo,
      run: () =>
        new Promise((resolve) => {
          release = () => resolve({ content: 'late', label: 'late' });
        }),
    };
    const h = harness([calls('read_file', 'read_file'), says('ok')], { tools: [slow] });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await vi.waitFor(() => expect(release).toBeDefined());
    h.runner.stop(session.id);
    release?.();
    await h.runner.settled();
    await h.runner.start(session.id, { text: 'again', by: { id: null, label: 'x' } });
    await h.runner.settled();
    const sent = h.model.requests[1]?.messages ?? [];
    const answered = sent.flatMap((message) => message.content.flatMap((block) => (block.type === 'tool_result' ? [block.callId] : [])));
    expect(answered).toEqual(['c0_read_file', 'c1_read_file']);
  });

  it('pauses on a question card, goes on with the answer, and refuses an answer that does not fit', async () => {
    const session = newSession();
    const h = harness([calls('ask_person'), says('Blue it is.')]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await vi.waitFor(() => expect(h.runner.waiting(session.id)).toHaveLength(1));
    const card = h.runner.waiting(session.id)[0];
    expect(card).toMatchObject({ type: 'question', question: 'Which colour?', choices: ['Red', 'Blue'] });
    expect(() => {
      h.runner.answer(session.id, card?.id ?? '', { accept: true }, { id: null, label: 'x' });
    }).toThrow('does not fit');
    expect(() => {
      h.runner.answer(session.id, 'card_9_9', { text: 'Blue' }, { id: null, label: 'x' });
    }).toThrow('Nothing is waiting');
    // A card's id is not one a page could guess, and the answer is the asker's to give.
    expect(card?.id).toMatch(/^card_1_1_[0-9a-f]{16}$/);
    expect(() => {
      h.runner.answer(session.id, card?.id ?? '', { text: 'Blue' }, { id: 'usr_someone_else', label: 'y' });
    }).toThrow('for the person who started the turn');
    h.runner.answer(session.id, card?.id ?? '', { text: 'Blue' }, { id: null, label: 'x' });
    await h.runner.settled();
    expect(kinds(h)).toContain('card-answered');
    expect(finished(h)).toMatchObject({ outcome: 'done' });
    expect(h.model.requests[1]?.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool_result', content: 'Blue' });
  });

  it('answers a waiting card “stopped” when the turn is stopped', async () => {
    const session = newSession();
    const h = harness([calls('ask_person')]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await vi.waitFor(() => expect(h.runner.waiting(session.id)).toHaveLength(1));
    h.runner.stop(session.id);
    await h.runner.settled();
    expect(finished(h)).toMatchObject({ outcome: 'stopped' });
    expect(h.runner.waiting(session.id)).toEqual([]);
  });

  it('ends at the step limit, says so, and still lets the engine keep what was made', async () => {
    const session = newSession();
    const h = harness([calls('read_file'), calls('read_file'), calls('read_file')], { limits: { maxSteps: 2 } });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.published.find((event) => event.kind === 'limit')).toMatchObject({ which: 'steps', value: 2 });
    expect(finished(h)).toMatchObject({ outcome: 'limit' });
    expect(h.pipelineRuns).toBe(1);
    expect(h.model.requests).toHaveLength(2);
  });

  it('ends no turn for tokens: past the turn’s mark it warns once, counting what a provider reports, and goes on', async () => {
    const session = newSession();
    const h = harness([], { limits: { turnTokens: 10_000, maxSteps: 3 } });
    h.model.run = (async (req: RunRequest) => {
      h.model.requests.push(req);
      return { ...calls('read_file'), usage: { inputTokens: 9_000, outputTokens: 2_000 } };
    }) as ProviderRunner['run'];
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    // Three steps, each over the mark: one warning, and the steps are what end it.
    expect(h.model.requests).toHaveLength(3);
    expect(h.published.filter((event) => event.kind === 'spend')).toEqual([expect.objectContaining({ which: 'turn-tokens', mark: 10_000, used: 11_000 })]);
    expect(h.published.find((event) => event.kind === 'limit')).toMatchObject({ which: 'steps' });
  });

  it('warns past the session’s mark across turns, estimating tokens a provider does not report, and finishes', async () => {
    const session = newSession();
    store.update(session.id, { tokens: { in: 99_000, out: 900 } });
    const h = harness([calls('read_file'), says('x', false)], { limits: { sessionTokens: 100_000 } });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.published.filter((event) => event.kind === 'spend')).toEqual([expect.objectContaining({ which: 'session-tokens', mark: 100_000 })]);
    expect(kinds(h)).not.toContain('limit');
    expect(finished(h)).toMatchObject({ outcome: 'done' });
  });

  it('answers a call it cannot read with an error, and gives up after the model keeps sending them', async () => {
    const session = newSession();
    const bad: RunResult = { blocks: [{ type: 'tool_call', id: 'b1', name: 'read_file', input: {} }], stop: 'tool_calls', malformed: [{ id: 'b1', name: 'read_file', raw: '{oops', error: 'not valid JSON' }] };
    const recovers = harness([bad, says('fixed')]);
    await recovers.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await recovers.runner.settled();
    expect(finished(recovers)).toMatchObject({ outcome: 'done' });
    expect(recovers.model.requests[1]?.messages.at(-1)?.content[0]).toMatchObject({ isError: true });

    const other = newSession();
    const stuck = harness(Array.from({ length: MAX_REPAIRS + 2 }, () => bad));
    await stuck.runner.start(other.id, { text: 'go', by: { id: null, label: 'x' } });
    await stuck.runner.settled();
    expect(finished(stuck)).toMatchObject({ outcome: 'failed' });
    expect(stuck.published.find((event) => event.kind === 'error')).toMatchObject({ code: 'unreadable' });
    expect(stuck.pipelineRuns).toBe(0);
  });

  it('says a miss is a miss and gives a real refusal its reason, for the page', async () => {
    const session = newSession();
    const missing: DesignerTool = { ...echo, name: 'read_file', run: async () => ({ content: 'There is no skill file "x.md". The files there are listed below.\n\n- a.md\n- b.md', label: 'No such reference', isError: true, miss: true }) };
    const refusing: DesignerTool = { ...echo, name: 'write_file', run: async () => ({ content: 'That is not valid JSON, and nothing was written: line 3.\nSend the whole file again.', label: 'Could not write x', isError: true }) };
    const h = harness([calls('read_file'), calls('write_file'), says('ok')], { tools: [missing, refusing] });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    const ended = h.published.filter((event) => event.kind === 'step' && event.state === 'failed');
    expect(ended[0]).toMatchObject({ tool: 'read_file', ended: 'miss' });
    expect(ended[0]).not.toHaveProperty('detail');
    expect(ended[1]).toMatchObject({ tool: 'write_file', ended: 'error', detail: 'That is not valid JSON, and nothing was written: line 3.' });
    // The model is told both in full, as errors: it is the page that draws them apart.
    expect(h.model.requests[1]?.messages.at(-1)?.content[0]).toMatchObject({ isError: true, content: expect.stringContaining('- a.md') });
    expect(finished(h)).toMatchObject({ outcome: 'done' });
  });

  it('tells the model a tool it named does not exist, and goes on', async () => {
    const session = newSession();
    const h = harness([calls('run_shell'), says('ok')]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests[1]?.messages.at(-1)?.content[0]).toMatchObject({ isError: true, content: expect.stringContaining('There is no tool "run_shell"') });
  });

  it('says a model that could not be reached failed, with the provider’s own words', async () => {
    const session = newSession();
    const h = harness([new ProviderError({ provider: 'anthropic', code: 'auth', status: 401, message: 'anthropic: HTTP 401 — invalid x-api-key' })]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.published.find((event) => event.kind === 'error')).toMatchObject({ code: 'auth', provider: 'anthropic', status: 401 });
    expect(finished(h)).toMatchObject({ outcome: 'failed' });
  });

  it('asks a provider again after a failure in passing, and gives up after the last wait', async () => {
    const busy = (): ProviderError => new ProviderError({ provider: 'anthropic', code: 'server', status: 500, message: 'anthropic: HTTP 500' });
    const session = newSession();
    const h = harness([busy(), busy(), says('Done.')]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(3);
    expect(finished(h)).toMatchObject({ outcome: 'done' });
    expect(kinds(h)).not.toContain('error');

    const second = newSession();
    const down = harness([busy(), busy(), busy(), says('Never reached.')]);
    await down.runner.start(second.id, { text: 'go', by: { id: null, label: 'x' } });
    await down.runner.settled();
    expect(down.model.requests).toHaveLength(3);
    expect(down.published.find((event) => event.kind === 'error')).toMatchObject({ code: 'server', status: 500 });
    expect(finished(down)).toMatchObject({ outcome: 'failed' });
  });

  it('sends a model that stops with errors left back to them, twice at most', async () => {
    const session = newSession();
    let left = ['- apps/repairs/manifest/pages/jobs.json · nav.order · expected number'];
    const h = harness([calls('write_file'), says('All done!'), calls('read_file'), says('Fixed now.')], {
      problems: () => {
        const now = left;
        // Fixed by the time it is asked again.
        left = [];
        return now;
      },
    });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(4);
    expect(h.model.requests[2]?.messages.at(-1)?.content).toEqual([
      { type: 'text', text: expect.stringMatching(/does not pass the check yet[\s\S]*nav\.order · expected number[\s\S]*check_app and apply_app/) },
    ]);
    expect(finished(h)).toMatchObject({ outcome: 'done' });

    // Errors that never go away: two reminders, then the engine's verdict. What is merely missing is not brought up while errors stand.
    const stuck = newSession();
    const never = harness([calls('write_file'), says('Done.'), says('Done.'), says('Done.'), says('Never reached.')], {
      problems: () => ['- still wrong'],
      advice: () => ['- The table "bikes" has no dashboard page: nobody can open it.'],
      pipeline: async () => ({ ok: false, version: null }),
    });
    await never.runner.start(stuck.id, { text: 'go', by: { id: null, label: 'x' } });
    await never.runner.settled();
    expect(never.model.requests).toHaveLength(4);
    expect(JSON.stringify(never.model.requests.at(-1)?.messages)).not.toContain('Before you finish');
    expect(finished(never)).toMatchObject({ outcome: 'not-applied' });
  });

  it('leaves a turn that only talked to its words', async () => {
    const session = newSession();
    const h = harness([says('Which of the two do you mean?'), says('Never reached.')], { problems: () => ['- apps/repairs/manifest/tables/ · tables · Too small'], pipeline: async () => ({ ok: false, version: null }) });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(1);
  });

  it('says what the app is short of once in a session, when nothing is wrong with it', async () => {
    const session = newSession();
    const advice = () => ['- The table "bikes" has no dashboard page: nobody can open it.'];
    const h = harness([calls('write_file'), says('Done.'), says('Left out on purpose.'), calls('write_file'), says('Changed.'), says('Never reached.')], { advice });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(3);
    expect(h.model.requests[2]?.messages.at(-1)?.content).toEqual([{ type: 'text', text: expect.stringMatching(/^Before you finish:\n- The table "bikes" has no dashboard page/) }]);
    expect(finished(h)).toMatchObject({ outcome: 'done' });
    // The next turn: the same line is not said again.
    await h.runner.start(session.id, { text: 'rename a label', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(5);
  });

  it('looks at the page once, last of all, in a turn whose page is watching and that built something; and not otherwise', async () => {
    const applying: DesignerTool = { ...echo, name: 'apply_app', running: () => 'Applying', run: async () => ({ content: 'Applied.', label: 'Applied the app' }) };
    const asked: number[] = [];
    const again: boolean[] = [];
    const sight = async (_session: DesignerSession, opts: { since: number; again: boolean }) => {
      asked.push(opts.since);
      again.push(opts.again);
      // After the first look, only a page that stopped is said; this one did not.
      return opts.again ? null : { text: 'This picture is the customer page as it shows now.', image: { ref: 'att_00000000000000000001', mediaType: 'image/jpeg', name: 'the page' } };
    };
    const session = newSession();
    const h = harness([calls('apply_app'), says('Done.'), calls('apply_app'), says('Fixed the hero.'), says('Never reached.')], { tools: [echo, writing, asking, applying], sight });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' }, sees: true });
    await h.runner.settled();
    // Asked after the model said it was done, with when the turn last built; what was seen went to the model as a message with the picture.
    // It built again after looking, so the page is asked after once more, and only for whether it stopped: it did not, and nothing more is said.
    expect(again).toEqual([false, true]);
    expect(asked[0]).toBeGreaterThan(0);
    expect(asked[1]).toBeGreaterThanOrEqual(asked[0] as number);
    expect(h.model.requests).toHaveLength(4);
    expect(h.model.requests[2]?.messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'This picture is the customer page as it shows now.' },
      { type: 'image', mediaType: 'image/jpeg', data: '', ref: 'att_00000000000000000001', name: 'the page' },
    ]);
    expect(finished(h)).toMatchObject({ outcome: 'done' });

    // A page that stopped after the look is said again, and the model goes on; it is never asked more than three times a turn.
    const stops: boolean[] = [];
    const stopping = harness([calls('apply_app'), says('Done.'), calls('apply_app'), says('Fixed.'), calls('apply_app'), says('Fixed again.'), calls('apply_app'), says('And again.'), says('Never reached.')], {
      tools: [echo, writing, asking, applying],
      sight: async (_session, opts) => {
        stops.push(opts.again);
        return { text: opts.again ? 'After that change the customer page was opened again, and it does not show.' : 'This picture is the customer page.' };
      },
    });
    await stopping.runner.start(newSession().id, { text: 'go', by: { id: null, label: 'x' }, sees: true });
    await stopping.runner.settled();
    expect(stops).toEqual([false, true, true]);
    expect(finished(stopping)).toMatchObject({ outcome: 'done' });

    // A page that is not watching (a turn from the command line, a test, the switch off): never asked.
    const quiet = harness([calls('apply_app'), says('Done.')], { tools: [echo, writing, asking, applying], sight });
    await quiet.runner.start(newSession().id, { text: 'go', by: { id: null, label: 'x' } });
    await quiet.runner.settled();
    // A turn that built nothing (it only wrote a file): there is no new page to look at.
    const unbuilt = harness([calls('write_file'), says('Done.')], { sight });
    await unbuilt.runner.start(newSession().id, { text: 'go', by: { id: null, label: 'x' }, sees: true });
    await unbuilt.runner.settled();
    expect(asked).toHaveLength(2);
    // Nothing seen (no page answered in time): the turn ends as it would have.
    const blind = harness([calls('apply_app'), says('Done.')], { tools: [echo, writing, asking, applying], sight: async () => null });
    await blind.runner.start(newSession().id, { text: 'go', by: { id: null, label: 'x' }, sees: true });
    await blind.runner.settled();
    expect(blind.model.requests).toHaveLength(2);
    expect(finished(blind)).toMatchObject({ outcome: 'done' });
  });

  it('still sends the check’s errors back past the token mark', async () => {
    const session = newSession();
    const h = harness([calls('write_file'), says('Done.'), says('Still done.'), says('Really.')], { problems: () => ['- still wrong'], limits: { turnTokens: 150 }, pipeline: async () => ({ ok: false, version: null }) });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(4);
    expect(kinds(h)).toContain('spend');
    expect(kinds(h)).not.toContain('limit');
    expect(finished(h)).toMatchObject({ outcome: 'not-applied' });
    expect(JSON.stringify(store.messages(session.id))).toContain('does not pass the check yet');
  });

  it('says a turn stopped during its last build as stopped, not as a build that failed', async () => {
    const session = newSession();
    const h: Harness = harness([says('Done.')], {
      pipeline: async () => {
        // Stop arrives while the build runs; the build ends and reports nothing built.
        h.runner.stop(session.id);
        return { ok: false, version: null };
      },
    });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(finished(h)).toMatchObject({ outcome: 'stopped' });
  });

  it('reports a turn the engine refused as not applied', async () => {
    const session = newSession();
    const h = harness([says('Done.')], { pipeline: async () => ({ ok: false, version: null }) });
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(finished(h)).toMatchObject({ outcome: 'not-applied' });
  });

  it('asks once more when the model was cut off mid-answer', async () => {
    const session = newSession();
    const h = harness([{ ...says('This is a long'), stop: 'max_tokens' }, says(' answer.')]);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await h.runner.settled();
    expect(h.model.requests).toHaveLength(2);
    expect(h.model.requests[1]?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'Continue.' }]);
  });

  it('refuses an empty message', async () => {
    const session = newSession();
    await expect(harness([]).runner.start(session.id, { text: '  ', by: { id: null, label: 'x' } })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('stops what runs on shutdown, and waits for it', async () => {
    const session = newSession();
    const h = harness(['wait-for-stop']);
    await h.runner.start(session.id, { text: 'go', by: { id: null, label: 'x' } });
    await vi.waitFor(() => expect(h.model.requests).toHaveLength(1));
    await h.runner.shutdown();
    expect(finished(h)).toMatchObject({ outcome: 'stopped' });
  });
});
