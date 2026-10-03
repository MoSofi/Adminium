// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a Designer tool is, and what it is given when it runs.
 *
 * The list of tools is closed: the model can do what these do and nothing
 * else. No shell, no network, no web.
 */
import type { CardAnswer, CardRequest } from './cards.js';
import type { EventLog } from './events.js';
import type { DesignerSession } from './session-store.js';

/** The person behind a turn. */
export interface Actor {
  id: string | null;
  label: string;
}

/** What the pipeline and the tools see of a running turn. */
export interface TurnHandle {
  turn: number;
  /** Who started the turn: a card's answer acts as them. */
  by: Actor;
  events: EventLog;
  signal: AbortSignal;
  ask(card: CardRequest): Promise<CardAnswer>;
}

export interface ToolOutcome {
  /** What the model is told. */
  content: string;
  isError?: boolean;
  /** With `isError`: what was asked for is not there, and the answer says where to look. The page draws it plainly, not as a failure. */
  miss?: boolean;
  /** The step's line on the page: "Wrote tables/jobs.json". */
  label: string;
  /** More for the page, never for the model: a check's findings, the first error. */
  detail?: string;
  /** What the page words the line from, in its own language. */
  facts?: { count?: number; outcome?: 'added' | 'declined' | 'refused' | 'failed'; look?: string };
}

export interface ToolContext {
  session: DesignerSession;
  turn: number;
  /** The turn's stop. A tool that waits on something passes it on. */
  signal: AbortSignal;
  /** Show a card and wait for its answer. Rejects when the turn is stopped. */
  ask(card: CardRequest): Promise<CardAnswer>;
  /** The turn itself, for a tool that runs the engine's steps mid-turn. */
  handle: TurnHandle;
}

export interface DesignerTool {
  name: string;
  description: string;
  /** A JSON Schema of type `object`. */
  inputSchema: Record<string, unknown>;
  /** What the step says while it runs: "Writing tables/jobs.json". */
  running(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** The turn was stopped while something waited. */
export class TurnStoppedError extends Error {
  override readonly name = 'TurnStoppedError';
  constructor() {
    super('The turn was stopped.');
  }
}
