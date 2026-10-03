// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A session's events folded into what the chat draws: one entry per turn,
 * with the person's message, the Designer's text, its steps, its cards and
 * how it ended. Pure, so a reload (which replays every event) and the live
 * stream draw the same thing.
 *
 * The steps list keeps each step where it first appeared and shows its
 * latest state. Files written one after another fold into one row ("Wrote 6
 * files"); the header still counts every step. The end-of-turn check, build
 * and apply join the list as rows of their own.
 */
import type { DesignerCard, DesignerEvent, LimitKind, StepFacts, TurnOutcome } from '../api.js';

export interface StepRow extends StepFacts {
  id: string;
  tool: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  ms: number | null;
  detail: string | null;
  /** Rows folded into this one: files written one after another. */
  folded: number;
}

export interface CardView {
  card: DesignerCard;
  /** The answer, once given. */
  answer: unknown;
  answered: boolean;
}

export interface TurnView {
  turn: number;
  /** What the person wrote; null for a turn whose start was not seen (a page opened mid-turn). */
  text: string | null;
  reply: string;
  steps: StepRow[];
  /** Every step, before folding: what the header counts. */
  stepCount: number;
  usage: { step: number; tokens: number } | null;
  cards: CardView[];
  version: { n: number; name: string } | null;
  limit: { which: LimitKind; value: number } | null;
  error: { code: string; message: string; provider?: string; status?: number } | null;
  /** The engine's last word, when it did not apply. */
  notApplied: string | null;
  outcome: TurnOutcome | null;
  startedAt: number;
  finishedAt: number | null;
  /** The turn wrote, edited or deleted a file: "Put the files back" has something to do. */
  changedFiles: boolean;
}

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);
const FOLDABLE = new Set(['write_file', 'edit_file']);

function blank(turn: number, at: number): TurnView {
  return {
    turn,
    text: null,
    reply: '',
    steps: [],
    stepCount: 0,
    usage: null,
    cards: [],
    version: null,
    limit: null,
    error: null,
    notApplied: null,
    outcome: null,
    startedAt: at,
    finishedAt: null,
    changedFiles: false,
  };
}

/** Consecutive finished file writes, folded into one row. */
function fold(rows: StepRow[]): StepRow[] {
  const out: StepRow[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last !== undefined && FOLDABLE.has(row.tool) && FOLDABLE.has(last.tool) && row.state === 'done' && last.state === 'done') {
      const { subject: _subject, ...rest } = last;
      out[out.length - 1] = { ...rest, folded: last.folded + 1, ms: (last.ms ?? 0) + (row.ms ?? 0) };
      continue;
    }
    out.push(row);
  }
  return out;
}

export function foldTurns(events: readonly DesignerEvent[]): TurnView[] {
  const turns = new Map<number, TurnView>();
  const rows = new Map<number, StepRow[]>();
  const view = (event: DesignerEvent): TurnView => {
    let found = turns.get(event.turn);
    if (found === undefined) {
      found = blank(event.turn, event.at);
      turns.set(event.turn, found);
      rows.set(event.turn, []);
    }
    return found;
  };

  for (const event of events) {
    const turn = view(event);
    const list = rows.get(event.turn) ?? [];
    switch (event.kind) {
      case 'turn-started':
        turn.text = event.text;
        turn.startedAt = event.at;
        break;
      case 'text':
        turn.reply += event.delta;
        break;
      case 'step': {
        const at = list.findIndex((row) => row.id === event.id);
        const row: StepRow = {
          id: event.id,
          tool: event.tool,
          label: event.label,
          state: event.state,
          ms: event.ms ?? null,
          detail: event.detail ?? null,
          folded: 1,
          ...(event.subject === undefined ? {} : { subject: event.subject }),
          ...(event.count === undefined ? {} : { count: event.count }),
          ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
          ...(event.ended === undefined ? {} : { ended: event.ended }),
        };
        if (at === -1) list.push(row);
        else list[at] = row;
        if (FILE_TOOLS.has(event.tool) && event.state === 'done') turn.changedFiles = true;
        break;
      }
      case 'usage':
        turn.usage = { step: event.step, tokens: event.turnTokens };
        break;
      case 'card':
        turn.cards.push({ card: event.card, answer: undefined, answered: false });
        break;
      case 'card-answered': {
        const card = turn.cards.find((entry) => entry.card.id === event.id);
        if (card !== undefined) {
          card.answer = event.value;
          card.answered = true;
        }
        break;
      }
      case 'check':
        if (!event.ok) {
          const errors = event.findings.filter((finding) => finding.level === 'error');
          list.push({
            id: `check-${String(event.seq)}`,
            tool: 'check',
            label: 'Checked',
            state: 'failed',
            ms: null,
            detail: errors.slice(0, 3).map((finding) => `${finding.file} · ${finding.message}`).join('\n') || null,
            folded: 1,
            count: errors.length,
          });
        }
        break;
      case 'build':
        if (!event.ok) list.push({ id: `build-${String(event.seq)}`, tool: 'build', label: 'Build', state: 'failed', ms: null, detail: event.problems.slice(0, 3).join('\n') || null, folded: 1 });
        break;
      case 'apply':
        list.push({
          id: `apply-${String(event.seq)}`,
          tool: 'apply',
          label: 'Apply',
          state: event.ok ? 'done' : 'failed',
          ms: null,
          detail: event.ok ? null : (event.message ?? null),
          folded: 1,
        });
        if (!event.ok) turn.notApplied = event.message ?? event.stage ?? event.state;
        break;
      case 'version':
        turn.version = { n: event.n, name: event.name };
        break;
      case 'limit':
        turn.limit = { which: event.which, value: event.value };
        break;
      case 'error':
        turn.error = {
          code: event.code,
          message: event.message,
          ...(event.provider === undefined ? {} : { provider: event.provider }),
          ...(event.status === undefined ? {} : { status: event.status }),
        };
        break;
      case 'stopped':
        break;
      case 'turn-finished':
        turn.outcome = event.outcome;
        turn.finishedAt = event.at;
        break;
    }
    rows.set(event.turn, list);
  }

  return [...turns.values()]
    .sort((a, b) => a.turn - b.turn)
    .map((turn) => {
      const list = rows.get(turn.turn) ?? [];
      return { ...turn, stepCount: list.filter((row) => !row.id.startsWith('apply-') && !row.id.startsWith('check-') && !row.id.startsWith('build-')).length, steps: fold(list) };
    });
}

/** The cards still waiting for an answer, newest last. */
export function waitingCards(turns: readonly TurnView[]): DesignerCard[] {
  const last = turns.at(-1);
  if (last === undefined || last.outcome !== null) return [];
  return last.cards.filter((entry) => !entry.answered).map((entry) => entry.card);
}

/** Whether a turn is running: the last one has started and not finished. */
export function isWorking(turns: readonly TurnView[]): boolean {
  const last = turns.at(-1);
  return last !== undefined && last.outcome === null;
}
