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
 * A turn is not the only thing that writes the folder. A person saves a file
 * by hand, changes the style, goes back to a version, starts from a published
 * app: each of those takes the folder with `hold`, and a turn and a hold
 * never run together, nor two holds. A hold owns a stop of its own, which a
 * shutdown, the live Designer's switch and a cap on its length all reach.
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
import { requestTokens, type PromptOpts } from './prompt.js';
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
import type { DesignerEvent, EventLog, HoldKind, LimitKind, SpendMark, TurnOutcome } from './events.js';
import { createEventLog } from './events.js';
import type { DesignerSession, SessionStore } from './session-store.js';
import type { Actor, DesignerTool, ToolContext, TurnHandle } from './tool-types.js';
import { TurnStoppedError } from './tool-types.js';
import { closeDangling, joinUserMessages } from './transcript.js';
import { HAND_EDITS_MAX, plainPath } from './write-guard.js';

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
  prompt(session: DesignerSession, messages: RunMessage[], opts?: PromptOpts): Promise<{ system: string; messages: RunMessage[] }>;
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
  /**
   * What the screens are short of as a design (a class nothing styles, an
   * emoji for an icon, no logo). Said when the check and the advice have
   * nothing left, at most `MAX_DESIGN_ROUNDS` times a turn: a model that
   * cannot fix a finding must not go round on it for ever. Each line names
   * one finding in the same words each time.
   */
  design?(session: DesignerSession): string[] | Promise<string[]>;
  /**
   * The page as it shows, once the checks have nothing left: what was measured
   * on it and, for a model that reads pictures, a picture of it. Asked once a
   * turn, and only in a turn whose page said it is watching (`sees`). `since`
   * is when this turn last built or applied. Null when there is nothing to say.
   */
  sight?(
    session: DesignerSession,
    opts: { since: number; signal: AbortSignal; /** Looked at once already this turn: said again only when the page has stopped (blank, or an error). */ again: boolean },
  ): Promise<{ text: string; image?: { ref: string; mediaType: string; name: string }; /** Which side was looked at, and the page's own path there: for the event the person reads, never for the model. */ side?: 'staff' | 'customer'; path?: string } | null>;
  /** Before the model is first asked in a turn: what the server itself settles with the person (a card), and files it makes sure are there. */
  opening?(session: DesignerSession, turn: TurnHandle): Promise<void>;
  /** What the person is told as the turn ends, in the Designer's own words: something they asked for that was left undone and unsaid. */
  closing?(session: DesignerSession): string[];
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
  /** How long a hold may last before its work is told to stop; `HOLD_CAP_MS` when left out. */
  holdCapMs?: number;
}

/** What has the folder: a turn, or one of the things a person does from the page. */
export type BusyKind = 'turn' | HoldKind;

/**
 * The folder, held for one piece of work. `signal` says when that work must
 * stop; `release` hands the folder back, once. `announce` tells the session's
 * pages that the folder is being written (`hold`, and `released` when it is
 * handed back): called when the work is about to write, so a request that is
 * refused before it writes anything says nothing to anyone.
 */
export interface FolderHold {
  signal: AbortSignal;
  announce(): void;
  release(): void;
}

/** The folder, kept for a turn that is about to start: nothing else takes it meanwhile. */
export interface TurnClaim {
  release(): void;
}

export type { Actor, TurnHandle } from './tool-types.js';

export interface DesignerRunner {
  /** Start a turn. 409 while another turn runs in this folder (reason `TURN_RUNNING`) or something else has it (`DESIGNER_BUSY`). */
  start(
    sessionId: string,
    input: { text: string; by: Actor; attachments?: readonly string[]; /** The page that sent this shows the preview, and will say what it sees after a build. */ sees?: boolean; /** The folder, kept for this turn beforehand. */ claim?: TurnClaim },
  ): Promise<{ turn: number }>;
  /**
   * Take the folder for something a person does from the page, at once or not
   * at all: 409 while a turn runs (reason `TURN_RUNNING`) or another hold has
   * it (`DESIGNER_BUSY`). With a session, its pages are told once the hold is
   * announced (`hold`, then `released`).
   */
  hold(kind: HoldKind, sessionId?: string): FolderHold;
  /** Keep the folder for a turn that starts in a moment (a new session with its first message). 409 as `hold`. */
  claim(): TurnClaim;
  /** What has the folder now: a turn, or a hold. */
  busy(): { kind: BusyKind; sessionId: string | null } | null;
  /** Tell whatever holds the folder outside a turn to stop. */
  stopHolds(): void;
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
/** How many times a turn's model is sent back to what its screens lack as a design. */
export const MAX_DESIGN_ROUNDS = 2;
/** How often a turn looks at the page it built: once, and then only for a page that stopped (blank, or an error) after what was built since. */
export const MAX_LOOKS = 3;
/** The longest a hand save, a style change or going back may hold the folder before its work is told to stop. */
export const HOLD_CAP_MS = 60_000;
/** A tool an older session called by another name: a transcript that names it still runs. */
export const TOOL_ALIASES: Readonly<Record<string, string>> = { set_look: 'set_style' };
/** The waits before a provider that failed in passing (a 5xx, a 429, a dropped line) is asked again. */
export const RETRY_WAITS_MS: readonly number[] = [2000, 6000];
/** The tools that change, check or apply the app. */
const ACTING: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'delete_file', 'check_app', 'build_sides', 'apply_app', 'add_side', 'build_on_shape', 'post_to_ledger', 'set_style', 'add_ui_part', 'find_pictures']);
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
  /** Whether the page that started the turn will say what it sees of a build. */
  sees: boolean;
}

/** The first line of a refusal, short enough for a step's line on the page. */
function whyOf(content: string): string {
  const line = content.split('\n', 1)[0] ?? '';
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

/** The file or name a call is about, for the page to name: its `path`, else its `name`. */
function stepSubject(input: Record<string, unknown>): string | undefined {
  const value =
    typeof input['path'] === 'string' ? input['path'] : typeof input['name'] === 'string' ? input['name'] : typeof input['key'] === 'string' ? input['key'] : typeof input['style'] === 'string' ? input['style'] : undefined;
  return value === undefined || value === '' ? undefined : value.slice(0, 200);
}

export function createDesignerRunner(deps: RunnerDeps): DesignerRunner {
  const now = deps.now ?? Date.now;
  const logs = new Map<string, EventLog>();
  let running: Running | null = null;
  /** What has the folder outside a turn; `kind: 'turn'` is a turn about to start. */
  let held: { kind: BusyKind; sessionId: string | null; controller: AbortController; done: Promise<void>; token: object } | null = null;
  /** Each claim's own hold, so only the turn it was made for takes it over. */
  const claims = new WeakMap<TurnClaim, object>();
  /** Sessions whose model refused a request that carried pictures: none is sent to them again while this server runs. */
  const blind = new Set<string>();
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
      mendHold(sessionId, log);
    }
    return log;
  }

  /**
   * A hold whose end was never written: the server stopped between the two. Nothing of this process can be
   * holding a session whose log it opens for the first time, so the end is written now, and the session's
   * pages (which read a hold with no end as "being changed") can be used again.
   */
  function mendHold(sessionId: string, log: EventLog): void {
    try {
      let open: HoldKind | null = null;
      for (const event of deps.store.eventsSince(sessionId, 0, Number.MAX_SAFE_INTEGER).events) {
        if (event.kind === 'hold') open = event.what;
        else if (event.kind === 'released' || event.kind === 'turn-started') open = null;
      }
      if (open !== null) log.emit(deps.store.read(sessionId).turns, { kind: 'released', what: open }, { by: 'person' });
    } catch (error) {
      deps.log?.('could not close a hold that a stopped server left open', error);
    }
  }

  /** Refuse, in the words for what has the folder. `forTurn`: it is a turn that asks. */
  function refuseIfTaken(forTurn: boolean, mine?: object): void {
    if (running !== null) {
      throw new ConflictError(
        forTurn ? 'The Designer is already working on something in this project. Stop it, or wait for it to finish.' : 'The Designer is working. Stop it, or wait for it to finish.',
        'CONFLICT',
        { reason: 'TURN_RUNNING', busy: 'turn', sessionId: running.sessionId },
      );
    }
    if (held !== null && held.token !== mine) {
      throw new ConflictError('The app is being changed. Try again in a moment.', 'CONFLICT', { reason: 'DESIGNER_BUSY', busy: held.kind, ...(held.sessionId === null ? {} : { sessionId: held.sessionId }) });
    }
  }

  function take(kind: BusyKind, sessionId: string | null, capMs: number | null): FolderHold {
    refuseIfTaken(kind === 'turn');
    const controller = new AbortController();
    const token = {};
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // Taken before anything else is done, so two takers cannot both pass the check above.
    held = { kind, sessionId, controller, done, token };
    const timer = capMs === null ? undefined : setTimeout(() => controller.abort(), capMs);
    timer?.unref();
    // The pages of the session are told, as an event of no turn: a second tab locks, and reads its files again after.
    const say = (what: 'hold' | 'released'): void => {
      if (sessionId === null || kind === 'turn') return;
      try {
        events(sessionId).emit(deps.store.read(sessionId).turns, { kind: what, what: kind }, { by: 'person' });
      } catch (error) {
        deps.log?.('could not tell a session that its folder is held', error);
      }
    };
    let announced = false;
    let released = false;
    return {
      signal: controller.signal,
      announce: () => {
        if (announced || released) return;
        announced = true;
        say('hold');
      },
      release: () => {
        if (released) return;
        released = true;
        if (timer !== undefined) clearTimeout(timer);
        if (held?.token === token) held = null;
        if (announced) say('released');
        finish();
      },
    };
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
    let designRounds = 0;
    /** When this turn last built or applied the app, and whether the page was already looked at. */
    let builtAt = 0;
    /** How often it built or applied, how often the page was looked at, and how many builds the last look had behind it. */
    let builds = 0;
    let looks = 0;
    let lookedAfter = 0;
    /** Whether this turn changed, checked or applied anything: only then is it held to the check. */
    let acted = false;
    const waits = deps.retryWaitsMs ?? RETRY_WAITS_MS;
    let limit: { which: LimitKind; value: number } | null = null;
    const warned = new Set<SpendMark>();

    /** The request just refused carried pictures, and the next one goes without them: its outcome says whether they were the reason. */
    let triedWithout = false;

    try {
      const { runner, maxTokens } = await deps.runnerFor(session);
      let tools = deps.tools(session);
      await deps.opening?.(session, handle);
      for (;;) {
        if (signal.aborted) throw new TurnStoppedError();
        if (steps >= limits.maxSteps) {
          limit = { which: 'steps', value: limits.maxSteps };
          break;
        }
        // The session as it is stored now: a step may have named the app, a person renamed the session.
        session = deps.store.read(session.id);
        context.session = session;
        const entries = deps.store.messages(session.id);
        const transcript = joinUserMessages(closeDangling(entries.map((entry) => entry.message)));
        // What the messages alone do not say: the person's own words for this turn, and the turn each picture came with.
        const pictureTurns = new Map<string, number>();
        // The latest turn a picture came with: one attached again (a retry of its turn) is that turn's, not an old one.
        for (const entry of entries) for (const block of entry.message.content) if (block.type === 'image' && block.ref !== undefined) pictureTurns.set(block.ref, entry.turn);
        const opening = entries.find((entry) => entry.turn === turn && entry.message.role === 'user')?.message.content.find((block) => block.type === 'text');
        const request = await deps.prompt(session, transcript, {
          turn,
          pictureTurns,
          pictures: !blind.has(session.id),
          ...(opening?.type === 'text' ? { said: opening.text } : {}),
        });
        const carriesPictures = request.messages.some((message) => message.content.some((block) => block.type === 'image' && block.data.length > 0));
        let result: RunResult | undefined;
        let retryWithout = false;
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
            // A request refused while it carried pictures: asked again without them, and no picture is sent in this session again.
            // (A picture a provider cannot take would otherwise go with every later message, and the session could never run.)
            if (error instanceof ProviderError && error.code === 'http' && carriesPictures && !said) {
              blind.add(session.id);
              triedWithout = true;
              deps.log?.('the Designer’s model refused a request that carried pictures; asking again without them');
              retryWithout = true;
              break;
            }
            // Asked again without them and refused again: the pictures were not the reason, and the session keeps them.
            if (triedWithout) blind.delete(session.id);
            // A provider that failed in passing is asked again, as long as nothing of this reply reached the page.
            const wait = waits[attempt];
            if (!(error instanceof ProviderError) || !PASSING.has(error.code) || said || wait === undefined) throw error;
            deps.log?.(`the Designer's model failed in passing (${error.code}); asking again`);
            await pause(wait, signal);
            if (signal.aborted) throw new TurnStoppedError();
          }
        }
        if (retryWithout || result === undefined) continue;
        // Answered: if this was the try without pictures, they were the reason, and the session stays without them.
        triedWithout = false;
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
                ? `Before you finish:\n${missing.slice(0, 12).join('\n')}\nDo what each line says: where it names a tool, call that tool; after a change to the app's files, check_app and apply_app. If one of these is left out on purpose, say so in a sentence and finish.`
                : null;
          if (sendBack === null && designRounds < MAX_DESIGN_ROUNDS) {
            // The design, last: the app works, and its screens are held to what a designed page has.
            const findings = (await deps.design?.(session)) ?? [];
            if (findings.length > 0) {
              designRounds += 1;
              deps.store.appendMessage(session.id, turn, {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `The app works. Its screens are not finished as a design yet:\n${findings.slice(0, 12).join('\n')}\nFix each, then build_sides and apply_app.${designRounds === MAX_DESIGN_ROUNDS ? ' This is the last time these are said: fix what you can, and tell the person in a sentence what is left.' : ''}`,
                  },
                ],
              });
              continue;
            }
          }
          if (sendBack === null && looks < MAX_LOOKS && builds > lookedAfter && run.sees && deps.sight !== undefined) {
            // Last of all: the page as it shows. What the checks cannot read from the files is seen here. Once; and once
            // more only if what was built after that left the page blank or stopped, which no person should be handed.
            looks += 1;
            lookedAfter = builds;
            const seen = await deps.sight(session, { since: builtAt, signal, again: looks > 1 }).catch(() => null);
            if (signal.aborted) throw new TurnStoppedError();
            if (seen !== null) {
              // Said to the person only now that a look is really going to the model.
              if (seen.side !== undefined) log.emit(turn, { kind: 'sight', side: seen.side, path: seen.path ?? '/' });
              deps.store.appendMessage(session.id, turn, {
                role: 'user',
                content: [{ type: 'text', text: seen.text }, ...(seen.image === undefined ? [] : [{ type: 'image' as const, mediaType: seen.image.mediaType, data: '', ref: seen.image.ref, name: seen.image.name }])],
              });
              continue;
            }
          }
          if (sendBack === null) {
            // Left undone and unsaid: said to the person by the Designer itself, as the last words of the turn.
            const notes = deps.closing?.(session) ?? [];
            if (notes.length > 0) log.text(turn, `${assistant.content.some((block) => block.type === 'text' && block.text.trim() !== '') ? '\n\n' : ''}${notes.join('\n\n')}`);
            break;
          }
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
          const tool = tools.find((candidate) => candidate.name === (TOOL_ALIASES[call.name] ?? call.name));
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
            if (done.isError !== true && (call.name === 'apply_app' || call.name === 'build_sides')) {
              builtAt = now();
              builds += 1;
            }
            // A tool that named the app moved its folder: the tools after it in this reply, and every later step, work in the new one.
            const stored = deps.store.read(session.id);
            if (stored.appKey !== session.appKey) {
              session = stored;
              context.session = stored;
              tools = deps.tools(stored);
            }
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
      deps.store.update(session.id, {
        tokens: { in: latest.tokens.in + tokensIn, out: latest.tokens.out + tokensOut },
        // The model finished its work on the files a person changed by hand: they are the app's now. A turn that stopped or failed is told of them again.
        ...((outcome === 'done' || outcome === 'not-applied') && (latest.handEdits ?? []).length > 0 ? { handEdits: [] } : {}),
      });
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
      const kept = held !== null && held.kind === 'turn' && input.claim !== undefined && claims.get(input.claim) === held.token ? held.token : undefined;
      refuseIfTaken(true, kept);
      const session = deps.store.read(sessionId);
      // What goes with the message: files this session already holds, and nothing else.
      const ids = [...new Set(input.attachments ?? [])];
      if (ids.length > ATTACHMENT_MAX_PER_MESSAGE) throw new ValidationFailedError(`Up to ${String(ATTACHMENT_MAX_PER_MESSAGE)} files go with one message.`, { reason: 'TURN_ATTACHMENTS' });
      const attached = ids.map((id) => deps.attachments?.find(sessionId, id) ?? null);
      if (attached.some((entry) => entry === null)) throw new ValidationFailedError('One of the attached files is not in this session. Attach it again.', { reason: 'TURN_ATTACHMENTS' });
      const files = attached.filter((entry): entry is Attachment => entry !== null);
      const turn = session.turns + 1;
      // Claimed before anything is awaited, so two starts cannot both pass the check above.
      const claim: Running = { sessionId, turn, controller: new AbortController(), by: input.by, cards: new Map(), done: Promise.resolve(), sees: input.sees === true };
      running = claim;
      // The folder was kept for this turn: it has it now.
      input.claim?.release();
      try {
        const updated = deps.store.update(sessionId, { turns: turn });
        // What the person saved by hand since the Designer last finished: named, so it reads each again before it writes it.
        const edited = (session.handEdits ?? []).filter(plainPath).slice(0, HAND_EDITS_MAX);
        // The person's words first and alone; what the server says about a file is a block of its own; a picture is a reference, never its bytes.
        const note = deps.attachments === undefined ? '' : attachmentNote(deps.attachments, sessionId, ids);
        deps.store.appendMessage(sessionId, turn, {
          role: 'user',
          content: [
            { type: 'text', text },
            ...(note === '' ? [] : [{ type: 'text' as const, text: `\n\n${note}` }]),
            ...(edited.length === 0
              ? []
              : [
                  {
                    type: 'text' as const,
                    text: `\n\n(Since your last turn the person changed these files by hand: ${JSON.stringify(edited)}. Read each one again before you change it, and keep what they changed unless this message asks otherwise.)`,
                  },
                ]),
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
    hold: (kind, sessionId) => take(kind, sessionId ?? null, kind === 'start' ? null : (deps.holdCapMs ?? HOLD_CAP_MS)),
    claim() {
      const taken = take('turn', null, null);
      const claim: TurnClaim = { release: taken.release };
      if (held !== null) claims.set(claim, held.token);
      return claim;
    },
    busy: () => (running !== null ? { kind: 'turn', sessionId: running.sessionId } : held === null ? null : { kind: held.kind, sessionId: held.sessionId }),
    stopHolds() {
      held?.controller.abort();
    },
    events,
    async shutdown() {
      const current = running;
      const holding = held;
      current?.controller.abort();
      holding?.controller.abort();
      await current?.done;
      // A turn that is only about to start has nothing to wait for.
      if (holding !== null && holding.kind !== 'turn') await holding.done;
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
