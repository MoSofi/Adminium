// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a Designer session says while it works, in order.
 *
 * Every event carries a sequence number that starts at 1 for the session and
 * never repeats. It is written to the session's `events.jsonl` BEFORE it is
 * published: the file is the truth, and the live channel is only the fast
 * way to it. A page that missed an event (a dropped socket, a reload) asks
 * for everything after the last number it saw, and gets it.
 *
 * Text arrives from a model a few characters at a time. It is gathered and
 * sent ten times a second, or sooner when it grows, and always before any
 * other event, so the order on the page is the order it happened in.
 */
import type { DesignerCard } from './cards.js';

export type TurnOutcome = 'done' | 'stopped' | 'limit' | 'failed' | 'not-applied';
/** `turn-tokens` and `session-tokens` end no turn since D92; a session written before it may still hold them. */
export type LimitKind = 'steps' | 'turn-tokens' | 'session-tokens';
/** A spending mark: passing one warns the person and ends nothing. */
export type SpendMark = 'turn-tokens' | 'session-tokens';

export type DesignerEventBody =
  | { kind: 'turn-started'; text: string; /** What the person attached to the message. */ attachments?: { id: string; label: string; kind: 'image' | 'csv'; rows?: number }[] }
  | { kind: 'text'; delta: string }
  | {
      kind: 'step';
      id: string;
      tool: string;
      /** The step's line in English, for logs and a page that does not know the tool. The page words it from the facts below. */
      label: string;
      state: 'running' | 'done' | 'failed';
      ms?: number;
      detail?: string;
      /** The file or name the step is about. */
      subject?: string;
      /** A count the line names: a check's errors, the screens built. */
      count?: number;
      /** What came of a package asked for. */
      outcome?: 'added' | 'declined' | 'refused' | 'failed';
      /** The look a step changed to. */
      look?: string;
      /** How a failed step ended: stopped by the person, an error in the tool, or a miss (a file or reference that is not there, which the model is told how to find). */
      ended?: 'stopped' | 'error' | 'miss';
    }
  | { kind: 'usage'; step: number; tokensIn: number; tokensOut: number; estimated: boolean; turnTokens: number }
  | { kind: 'spend'; which: SpendMark; mark: number; used: number }
  | { kind: 'card'; card: DesignerCard }
  | { kind: 'card-answered'; id: string; value: unknown }
  | { kind: 'check'; ok: boolean; findings: { file: string; path: string; message: string; level: string }[] }
  | { kind: 'build'; ok: boolean; problems: string[] }
  | { kind: 'apply'; ok: boolean; state: string; stage?: string; message?: string }
  | { kind: 'version'; n: number; name: string }
  /** The look was changed from the page ("Change the look"), with no model behind it. */
  | { kind: 'look'; direction: string }
  | { kind: 'limit'; which: LimitKind; value: number }
  | { kind: 'stopped' }
  | { kind: 'error'; code: string; message: string; provider?: string; status?: number }
  | { kind: 'turn-finished'; outcome: TurnOutcome };

export type DesignerEvent = DesignerEventBody & { seq: number; turn: number; at: number };

export interface EventLog {
  emit(turn: number, body: DesignerEventBody): DesignerEvent;
  /** A piece of the model's text: gathered, and sent soon. */
  text(turn: number, delta: string): void;
  /** Send any gathered text now. */
  flush(): void;
}

/** How often gathered text is sent, and how much is gathered before it is sent anyway. */
export const TEXT_FLUSH_MS = 100;
export const TEXT_FLUSH_CHARS = 400;

export function createEventLog(opts: {
  /** The next number to use is one more than this. */
  lastSeq: number;
  append: (event: DesignerEvent) => void;
  publish: (event: DesignerEvent) => void;
  now?: () => number;
}): EventLog {
  const now = opts.now ?? Date.now;
  let seq = opts.lastSeq;
  let pending: { turn: number; text: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function write(turn: number, body: DesignerEventBody): DesignerEvent {
    seq += 1;
    const event = { ...body, seq, turn, at: now() } as DesignerEvent;
    opts.append(event);
    opts.publish(event);
    return event;
  }

  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending === null || pending.text.length === 0) {
      pending = null;
      return;
    }
    const { turn, text } = pending;
    pending = null;
    write(turn, { kind: 'text', delta: text });
  }

  return {
    emit(turn, body) {
      flush();
      return write(turn, body);
    },
    text(turn, delta) {
      if (delta.length === 0) return;
      if (pending !== null && pending.turn !== turn) flush();
      pending = { turn, text: (pending?.text ?? '') + delta };
      if (pending.text.length >= TEXT_FLUSH_CHARS) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, TEXT_FLUSH_MS);
    },
    flush,
  };
}
