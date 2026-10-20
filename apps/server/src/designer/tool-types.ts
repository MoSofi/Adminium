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
  /** What the page words the line from, in its own language. `until`/`dated`: reads of an outside source are paused until then (Figma's limit). */
  facts?: { count?: number; outcome?: 'added' | 'declined' | 'refused' | 'failed'; look?: string; until?: number; dated?: boolean };
  /** What the step is about, when the tool knows better than its input says (a Figma node's name, where the input names its id). */
  subject?: string;
  /** A picture the step read, joined to the turn after the results, named in words first (a part of a Figma frame). */
  picture?: { ref: string; mediaType: string; name: string };
  /**
   * From a step that built or applied the app: a mark of what the server now
   * serves for it (its manifest and its screens). The same mark as the build
   * before means nothing new is served, and no page will open itself again.
   */
  built?: string;
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
  /** What the step is about, for its line, when the input does not say it in a path or a name. */
  subject?(input: Record<string, unknown>, ctx: ToolContext): string | undefined;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** The turn was stopped while something waited. */
export class TurnStoppedError extends Error {
  override readonly name = 'TurnStoppedError';
  constructor() {
    super('The turn was stopped.');
  }
}

/** The server's picture sites, as the Designer meets them. */
export interface PictureSites {
  /** Whether a picture on this host, over https, is let through. */
  covers(host: string): boolean;
  /** Null where a person's yes can add a site; otherwise why it cannot, in a sentence for the model. */
  closed(): string | null;
  /** Keep the site (the project's `.env`) and let it through from the next reply. `by` is who said yes. */
  add(host: string, by: { id: string | null; label: string }): void;
}
