// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's turn: a person's message, the model and its tools in a loop,
 * then the engine's verdict.
 *
 * It runs in the server's own process, not as a job. A job cannot stop a
 * model call that is under way, shares two worker slots with exports and
 * mail, and retries what fails; a turn must stop the moment Stop is pressed,
 * must not run twice, and is watched as it goes.
 *
 * ─── One at a time ──────────────────────────────────────────────────────────
 *
 * One turn runs per project folder, whichever session it belongs to: two
 * turns writing the same files would each undo the other's work.
 *
 * ─── How a turn ends ────────────────────────────────────────────────────────
 *
 *   done          the model finished; the engine checked, applied and saved a version
 *   not-applied   the model finished; the engine refused it (said why)
 *   limit         a step or token ceiling was reached; what was made is checked, applied and kept
 *   stopped       Stop: the changes so far stay in the folder, no version is made
 *   failed        the model could not be reached, or kept sending what could not be read
 *
 * A card (a question, a package, data that would be lost) pauses the turn
 * until it is answered. Stop answers every waiting card with "stopped".
 */
import { ATTACHMENT_MAX_PER_MESSAGE, attachmentNote, type Attachment, type Attachments } from './attachments.js';
import { requestTokens } from './prompt.js';
import { randomBytes } from 'node:crypto';

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  estimateTokens,
  ProviderError,
  type ProviderRunner,
  type RunBlock,
  type RunMessage,
  type RunResult,
} from '@adminium/llm';

import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import { answerFor, type CardAnswer, type DesignerCard } from './cards.js';
import type { DesignerEvent, EventLog, LimitKind, SpendMark, TurnOutcome } from './events.js';
import { createEventLog } from './events.js';
import type { DesignerSession, SessionStore } from './session-store.js';
import type { Actor, DesignerTool, ToolContext, TurnHandle } from './tool-types.js';
import { TurnStoppedError } from './tool-types.js';
import { closeDangling, joinUserMessages } from './transcript.js';

export interface DesignerLimits {
  maxSteps: number;
  /** Marks, not ceilings (D92): a turn or a session that passes one is warned about and goes on. */
  turnTokens: number;
  sessionTokens: number;
}

/** What the end of a turn reports. */
export interface PipelineResult {
  ok: boolean;
  /** The version saved, or null (versions off, or not applied). */
  version: { n: number; name: string } | null;
  /** Applied, and something is not as the files asked: a page written with nothing to show. */
  warnings?: string[];
}

export interface RunnerDeps {
  store: SessionStore;
  /** The model a session calls. */
  runnerFor(session: DesignerSession): Promise<{ runner: ProviderRunner; maxTokens?: number }>;
  /** The tools a session's model may call. */
  tools(session: DesignerSession): DesignerTool[];
  /** What the model is told, and the transcript as it fits the model's window. */
  prompt(session: DesignerSession, messages: RunMessage[]): Promise<{ system: string; messages: RunMessage[] }>;
  /**
   * What the check says is wrong with the app now, one line per error. Asked
   * when the model says it is finished: a model that stops with errors left
   * is told them and goes on, instead of the turn ending "not applied".
   */
  problems?(session: DesignerSession): string[];
  /**
   * What the app is short of that the check does not count as an error (a
   * table nobody can open). Said once, when the model says it is finished
   * and the check has nothing left.
   */
  advice?(session: DesignerSession): string[];
  /** How long to wait before asking a provider again after it failed in passing; one entry per try. */
  retryWaitsMs?: readonly number[];
  /** The engine's last word: check, build, apply, and save a version. Emits its own events. */
  pipeline(session: DesignerSession, turn: TurnHandle): Promise<PipelineResult>;
  limits(): Promise<DesignerLimits>;
  /** What people attach to a message: pictures and CSV files, kept in the session's folder. */
  attachments?: Attachments;
  /** Send an event to the pages watching this session. */
  publish(event: DesignerEvent & { sessionId: string }): void;
  /** Record a turn's start and end. */
  audit?(action: 'designer.turn.started' | 'designer.turn.finished', session: DesignerSession, detail: Record<string, unknown>): Promise<void>;
  /** A card a person answered, for the audit log. */
  auditCard?(sessionId: string, by: Actor, detail: Record<string, unknown>): Promise<void>;
  log?: (message: string, error?: unknown) => void;
  now?: () => number;
}

export type { Actor, TurnHandle } from './tool-types.js';

export interface DesignerRunner {
  /** Start a turn. 409 (reason `TURN_RUNNING`) while another turn runs in this folder. */
  start(sessionId: string, input: { text: string; by: Actor; attachments?: readonly string[] }): Promise<{ turn: number }>;
  /** Stop the session's turn. False when none runs. */
  stop(sessionId: string): boolean;
  /** Answer a waiting card. */
  answer(sessionId: string, cardId: string, value: unknown, by: Actor): void;
  /** The cards waiting in a session. */
  waiting(sessionId: string): DesignerCard[];
  /** The turn that runs now, anywhere in this folder. */
  active(): { sessionId: string; turn: number } | null;
  /** The event log of a session: the routes read history through the store, and this writes. */
  events(sessionId: string): EventLog;
  /** Stop what runs and wait for it to end. */
  shutdown(): Promise<void>;
  /** For tests: the promise of the turn that runs. */
  settled(): Promise<void>;
}

/** Calls in a row whose arguments could not be read, before the turn gives up. */
export const MAX_REPAIRS = 2;
/** How many times a turn's model is sent back to errors it left behind. */
export const MAX_NUDGES = 2;
/** The waits before a provider that failed in passing (a 5xx, a 429, a dropped line) is asked again. */
export const RETRY_WAITS_MS: readonly number[] = [2000, 6000];
/** The tools that change, check or apply the app. */
const ACTING: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'delete_file', 'check_app', 'build_sides', 'apply_app', 'add_side', 'build_on_shape']);
const PASSING: ReadonlySet<string> = new Set(['server', 'rate_limit', 'network', 'timeout']);

/** Wait, unless the turn is stopped first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

interface Running {
  sessionId: string;
  turn: number;
  controller: AbortController;
  /** Who started the turn: its cards are theirs to answer. */
  by: Actor;
  cards: Map<string, { card: DesignerCard; resolve: (answer: CardAnswer) => void; reject: (error: Error) => void }>;
  done: Promise<void>;
}

/** The first line of a refusal, short enough for a step's line on the page. */
function whyOf(content: string): string {
  const line = content.split('\n', 1)[0] ?? '';
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

/** The file or name a call is about, for the page to name: its `path`, else its `name`. */
function stepSubject(input: Record<string, unknown>): string | undefined {
  const value = typeof input['path'] === 'string' ? input['path'] : typeof input['name'] === 'string' ? input['name'] : typeof input['key'] === 'string' ? input['key'] : undefined;
  return value === undefined || value === '' ? undefined : value.slice(0, 200);
}

export function createDesignerRunner(deps: RunnerDeps): DesignerRunner {
  const now = deps.now ?? Date.now;
  const logs = new Map<string, EventLog>();
  let running: Running | null = null;
  let cardSeq = 0;

  function events(sessionId: string): EventLog {
    let log = logs.get(sessionId);
    if (log === undefined) {
      log = createEventLog({
        lastSeq: deps.store.lastSeq(sessionId),
        append: (event) => {
          deps.store.appendEvent(sessionId, event);
        },
        publish: (event) => {
          deps.publish({ ...event, sessionId });
        },
        now,
      });
      logs.set(sessionId, log);
    }
    return log;
  }

  async function loop(session: DesignerSession, turn: number, run: Running, by: Actor): Promise<void> {
    const log = events(session.id);
    const { signal } = run.controller;
    const limits = await deps.limits();
    const handle: TurnHandle = {
      turn,
      by,
      events: log,
      signal,
      ask: (card) => {
        if (signal.aborted) return Promise.reject(new TurnStoppedError());
        cardSeq += 1;
        // Not guessable: a page that is not the Designer's cannot name the card it would answer.
        const full = { ...card, id: `card_${String(turn)}_${String(cardSeq)}_${randomBytes(8).toString('hex')}` } as DesignerCard;
        return new Promise<CardAnswer>((resolve, reject) => {
          // Stop answers the card at once: the tool waiting on it must not hold the turn open.
          const onStop = (): void => {
            run.cards.delete(full.id);
            reject(new TurnStoppedError());
          };
          signal.addEventListener('abort', onStop, { once: true });
          run.cards.set(full.id, {
            card: full,
            resolve: (answer) => {
              signal.removeEventListener('abort', onStop);
              resolve(answer);
            },
            reject,
          });
          log.emit(turn, { kind: 'card', card: full });
        });
      },
    };
    const context: ToolContext = { session, turn, signal, ask: handle.ask, handle };

    let outcome: TurnOutcome = 'done';
    let steps = 0;
    let turnTokens = 0;
    let sessionTokens = session.tokens.in + session.tokens.out;
    let tokensIn = 0;
    let tokensOut = 0;
    let unreadable = 0;
    let continued = false;
    let nudges = 0;
    /** Whether this turn changed, checked or applied anything: only then is it held to the check. */
    let acted = false;
    const waits = deps.retryWaitsMs ?? RETRY_WAITS_MS;
    let limit: { which: LimitKind; value: number } | null = null;
    const warned = new Set<SpendMark>();

    try {
      const { runner, maxTokens } = await deps.runnerFor(session);
      const tools = deps.tools(session);
      for (;;) {
        if (signal.aborted) throw new TurnStoppedError();
        if (steps >= limits.maxSteps) {
          limit = { which: 'steps', value: limits.maxSteps };
          break;
        }
        const transcript = joinUserMessages(closeDangling(deps.store.messages(session.id).map((entry) => entry.message)));
        const request = await deps.prompt(session, transcript);
        let result: RunResult;
        for (let attempt = 0; ; attempt += 1) {
          let said = false;
          try {
            result = await runner.run({
              system: request.system,
              messages: request.messages,
              tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
              model: session.model,
              maxTokens: maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
              signal,
              onEvent: (event) => {
                if (event.type !== 'text') return;
                said = true;
                log.text(turn, event.delta);
              },
            });
            break;
          } catch (error) {
            if (error instanceof ProviderError && error.code === 'aborted') throw new TurnStoppedError();
            // A provider that failed in passing is asked again, as long as nothing of this reply reached the page.
            const wait = waits[attempt];
            if (!(error instanceof ProviderError) || !PASSING.has(error.code) || said || wait === undefined) throw error;
            deps.log?.(`the Designer's model failed in passing (${error.code}); asking again`);
            await pause(wait, signal);
            if (signal.aborted) throw new TurnStoppedError();
          }
        }
        steps += 1;

        // What the step cost, reported or estimated.
        const estimated = result.usage === undefined;
        const usedIn = result.usage?.inputTokens ?? requestTokens(request.system, request.messages);
        const usedOut = result.usage?.outputTokens ?? estimateTokens(JSON.stringify(result.blocks));
        tokensIn += usedIn;
        tokensOut += usedOut;
        turnTokens += usedIn + usedOut;
        sessionTokens += usedIn + usedOut;
        log.emit(turn, { kind: 'usage', step: steps, tokensIn: usedIn, tokensOut: usedOut, estimated, turnTokens });
        // Tokens end nothing (D92): past a mark the person is told, once a turn for each mark, and the work goes on.
        if (!warned.has('turn-tokens') && turnTokens >= limits.turnTokens) {
          warned.add('turn-tokens');
          log.emit(turn, { kind: 'spend', which: 'turn-tokens', mark: limits.turnTokens, used: turnTokens });
        }
        if (!warned.has('session-tokens') && sessionTokens >= limits.sessionTokens) {
          warned.add('session-tokens');
          log.emit(turn, { kind: 'spend', which: 'session-tokens', mark: limits.sessionTokens, used: sessionTokens });
        }

        const assistant: RunMessage = { role: 'assistant', content: result.blocks.length > 0 ? result.blocks : [{ type: 'text', text: '' }] };
        deps.store.appendMessage(session.id, turn, assistant);

        const calls = result.blocks.filter((block): block is Extract<RunBlock, { type: 'tool_call' }> => block.type === 'tool_call');
        if (calls.length === 0) {
          if (result.stop === 'max_tokens' && !continued) {
            // Cut off mid-sentence: one "go on" before the turn is called finished.
            continued = true;
            deps.store.appendMessage(session.id, turn, { role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
            continue;
          }
          if (result.stop === 'refused') {
            log.emit(turn, { kind: 'error', code: 'refused', message: 'The model declined to answer this.' });
            outcome = 'failed';
            break;
          }
          // It says it is finished. A turn that only talked (a question, "this needs no app") is left to its words.
          if (!acted) break;
          const errors = deps.problems?.(session) ?? [];
          // What it was already told, this turn or an earlier one, is not said again.
          const told = deps.store.messages(session.id).flatMap((entry) => (entry.message.role === 'user' ? entry.message.content.flatMap((block) => (block.type === 'text' ? block.text.split('\n') : [])) : []));
          const missing = errors.length > 0 ? [] : (deps.advice?.(session) ?? []).filter((line) => !told.includes(line));
          const sendBack =
            errors.length > 0 && nudges < MAX_NUDGES
              ? `The app does not pass the check yet, so nothing is applied:\n${errors.slice(0, 12).join('\n')}\nFix these, then check_app and apply_app.`
              : missing.length > 0
                ? `Before you finish:\n${missing.slice(0, 12).join('\n')}\nAdd what is missing, then check_app and apply_app. If one of these is left out on purpose, say so in a sentence and finish.`
                : null;
          if (sendBack === null) break;
          if (errors.length > 0) nudges += 1;
          deps.store.appendMessage(session.id, turn, { role: 'user', content: [{ type: 'text', text: sendBack }] });
          continue;
        }

        const malformed = new Map(result.malformed.map((entry) => [entry.id, entry]));
        const results: RunBlock[] = [];
        for (const call of calls) {
          if (signal.aborted) break;
          const bad = malformed.get(call.id);
          if (bad !== undefined) {
            results.push({ type: 'tool_result', callId: call.id, isError: true, content: `The arguments of this call could not be read (${bad.error}). Send the call again with a JSON object.` });
            continue;
          }
          const tool = tools.find((candidate) => candidate.name === call.name);
          if (tool === undefined) {
            results.push({ type: 'tool_result', callId: call.id, isError: true, content: `There is no tool "${call.name}". The tools are: ${tools.map((candidate) => candidate.name).join(', ')}.` });
            continue;
          }
          if (ACTING.has(tool.name)) acted = true;
          const stepId = `${String(turn)}.${String(steps)}.${call.id}`;
          const started = now();
          const subject = stepSubject(call.input);
          const about = subject === undefined ? {} : { subject };
          log.emit(turn, { kind: 'step', id: stepId, tool: tool.name, label: safeLabel(() => tool.running(call.input), tool.name), state: 'running', ...about });
          try {
            const done = await tool.run(call.input, context);
            log.emit(turn, {
              kind: 'step',
              id: stepId,
              tool: tool.name,
              label: done.label,
              state: done.isError === true ? 'failed' : 'done',
              ms: now() - started,
              ...about,
              ...(done.facts ?? {}),
              ...(done.isError === true ? { ended: done.miss === true ? ('miss' as const) : ('error' as const) } : {}),
              // A failure says why on the page too: the first line of what the model was told.
              ...(done.detail !== undefined ? { detail: done.detail } : done.isError === true && done.miss !== true ? { detail: whyOf(done.content) } : {}),
            });
            results.push({ type: 'tool_result', callId: call.id, content: done.content, ...(done.isError === true ? { isError: true } : {}) });
          } catch (error) {
            if (error instanceof TurnStoppedError || signal.aborted) {
              log.emit(turn, { kind: 'step', id: stepId, tool: tool.name, label: 'Stopped', state: 'failed', ms: now() - started, ...about, ended: 'stopped' });
              break;
            }
            const message = error instanceof Error ? error.message : String(error);
            log.emit(turn, { kind: 'step', id: stepId, tool: tool.name, label: `${tool.name} failed`, state: 'failed', ms: now() - started, ...about, ended: 'error', detail: message });
            results.push({ type: 'tool_result', callId: call.id, isError: true, content: `The tool failed: ${message}` });
          }
        }
        if (results.length > 0) deps.store.appendMessage(session.id, turn, { role: 'user', content: results });
        if (signal.aborted) throw new TurnStoppedError();

        // A model that sends only calls that cannot be read is not going to start making sense.
        unreadable = malformed.size > 0 && malformed.size === calls.length ? unreadable + 1 : 0;
        if (unreadable > MAX_REPAIRS) {
          log.emit(turn, { kind: 'error', code: 'unreadable', message: 'The model keeps sending tool calls that cannot be read.' });
          outcome = 'failed';
          break;
        }
      }

      if (limit !== null) {
        log.emit(turn, { kind: 'limit', which: limit.which, value: limit.value });
        outcome = 'limit';
      }
      if (outcome !== 'failed') {
        // The engine has the last word, also on a limit: what was made so far is kept as a version.
        const verdict = await deps.pipeline(session, handle);
        // Stop during the last build ends that build: said as a stop, not as a build that failed.
        if (!verdict.ok && signal.aborted) throw new TurnStoppedError();
        if (!verdict.ok && outcome === 'done') outcome = 'not-applied';
      }
    } catch (error) {
      if (error instanceof TurnStoppedError || signal.aborted) {
        outcome = 'stopped';
        log.emit(turn, { kind: 'stopped' });
      } else {
        outcome = 'failed';
        const provider = error instanceof ProviderError ? { provider: error.provider, ...(error.status === undefined ? {} : { status: error.status }) } : {};
        log.emit(turn, {
          kind: 'error',
          code: error instanceof ProviderError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
          ...provider,
        });
        if (!(error instanceof ProviderError)) deps.log?.('a Designer turn failed', error);
      }
    } finally {
      // Every waiting card is answered "stopped": nothing may wait on a turn that is over.
      for (const waiting of run.cards.values()) waiting.reject(new TurnStoppedError());
      run.cards.clear();
      log.emit(turn, { kind: 'turn-finished', outcome });
      const latest = deps.store.read(session.id);
      deps.store.update(session.id, { tokens: { in: latest.tokens.in + tokensIn, out: latest.tokens.out + tokensOut } });
      await deps.audit?.('designer.turn.finished', session, { turn, outcome, steps, tokens: tokensIn + tokensOut }).catch((error: unknown) => {
        deps.log?.('could not record the end of a Designer turn', error);
      });
    }
  }

  return {
    async start(sessionId, input) {
      const text = input.text.trim();
      if (text.length === 0 || text.length > 20_000) {
        throw new ValidationFailedError('Say what to build, in at most 20,000 characters.', { reason: 'TURN_TEXT' });
      }
      if (running !== null) {
        throw new ConflictError('The Designer is already working on something in this project. Stop it, or wait for it to finish.', 'CONFLICT', {
          reason: 'TURN_RUNNING',
          sessionId: running.sessionId,
        });
      }
      const session = deps.store.read(sessionId);
      // What goes with the message: files this session already holds, and nothing else.
      const ids = [...new Set(input.attachments ?? [])];
      if (ids.length > ATTACHMENT_MAX_PER_MESSAGE) throw new ValidationFailedError(`Up to ${String(ATTACHMENT_MAX_PER_MESSAGE)} files go with one message.`, { reason: 'TURN_ATTACHMENTS' });
      const attached = ids.map((id) => deps.attachments?.find(sessionId, id) ?? null);
      if (attached.some((entry) => entry === null)) throw new ValidationFailedError('One of the attached files is not in this session. Attach it again.', { reason: 'TURN_ATTACHMENTS' });
      const files = attached.filter((entry): entry is Attachment => entry !== null);
      const turn = session.turns + 1;
      // Claimed before anything is awaited, so two starts cannot both pass the check above.
      const claim: Running = { sessionId, turn, controller: new AbortController(), by: input.by, cards: new Map(), done: Promise.resolve() };
      running = claim;
      try {
        const updated = deps.store.update(sessionId, { turns: turn });
        // The person's words first and alone; what the server says about a file is a block of its own; a picture is a reference, never its bytes.
        const note = deps.attachments === undefined ? '' : attachmentNote(deps.attachments, sessionId, ids);
        deps.store.appendMessage(sessionId, turn, {
          role: 'user',
          content: [
            { type: 'text', text },
            ...(note === '' ? [] : [{ type: 'text' as const, text: `\n\n${note}` }]),
            ...files.filter((file) => file.kind === 'image').map((file) => ({ type: 'image' as const, mediaType: file.mediaType, data: '', ref: file.id, name: file.label })),
          ],
        });
        events(sessionId).emit(turn, {
          kind: 'turn-started',
          text,
          ...(files.length === 0 ? {} : { attachments: files.map((file) => ({ id: file.id, label: file.label, kind: file.kind, ...(file.rows === undefined ? {} : { rows: file.rows }) })) }),
        });
        await deps.audit?.('designer.turn.started', updated, { turn, by: input.by.label });
        claim.done = loop(updated, turn, claim, input.by).finally(() => {
          if (running === claim) running = null;
        });
      } catch (error) {
        if (running === claim) running = null;
        throw error;
      }
      return { turn };
    },
    stop(sessionId) {
      if (running === null || running.sessionId !== sessionId) return false;
      running.controller.abort();
      return true;
    },
    answer(sessionId, cardId, value, by) {
      const waiting = running !== null && running.sessionId === sessionId ? running.cards.get(cardId) : undefined;
      if (running === null || waiting === undefined) throw new NotFoundError('Nothing is waiting for that answer.', { cardId });
      // A yes is the yes of the person who asked for the turn, not of whoever else may use the Designer.
      if (running.by.id !== by.id) throw new ForbiddenError('This question is for the person who started the turn.', 'FORBIDDEN', { reason: 'NOT_YOUR_TURN' });
      const answer = answerFor(waiting.card, value);
      if (answer === null) throw new ValidationFailedError('That answer does not fit the question.', { cardId });
      running.cards.delete(cardId);
      events(sessionId).emit(running.turn, { kind: 'card-answered', id: cardId, value: answer });
      // A yes to a package, to tests or to server code is a person's decision about this server: it is kept, with who gave it.
      const { card } = waiting;
      void deps
        .auditCard?.(sessionId, by, {
          turn: running.turn,
          card: card.type,
          ...(card.type === 'package' ? { name: card.name, version: card.version } : {}),
          ...(card.type === 'rows' ? { attachment: card.attachment, table: card.table, rows: card.rows, left: card.left } : {}),
          ...(card.type === 'add-on' ? { key: card.key, version: card.version, ...(card.listOff === true ? { switchesListOn: true } : {}) } : {}),
          ...(card.type === 'question' ? { question: card.question.slice(0, 300) } : {}),
          answer: answer.type === 'question' ? answer.text.slice(0, 300) : answer,
        })
        .catch(() => undefined);
      waiting.resolve(answer);
    },
    waiting(sessionId) {
      if (running === null || running.sessionId !== sessionId) return [];
      return [...running.cards.values()].map((entry) => entry.card);
    },
    active: () => (running === null ? null : { sessionId: running.sessionId, turn: running.turn }),
    events,
    async shutdown() {
      const current = running;
      if (current === null) return;
      current.controller.abort();
      await current.done;
    },
    settled: async () => {
      await running?.done;
    },
  };
}

function safeLabel(make: () => string, fallback: string): string {
  try {
    return make();
  } catch {
    return fallback;
  }
}
