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
import type { DesignerCard, DesignerEvent, LimitKind, SpendMark, StepFacts, TurnOutcome } from '../api.js';

export interface StepRow extends StepFacts {
  id: string;
  tool: string;
  label: string;
  /** `missed`: what was looked for is not there, and the Designer went on. Not a failure. */
  state: 'running' | 'done' | 'failed' | 'missed';
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
  /** The spending marks this turn passed. Nothing ends at one; the person is told. */
  spend: { which: SpendMark; mark: number }[];
  cards: CardView[];
  version: { n: number; name: string } | null;
  /**
   * How the newest build of the screens went, by a tool's step or by the
   * engine's own build at the end: null when it built (or nothing was built),
   * else what the build said. A build that failed and was then fixed is no
   * longer a failure, whichever of the two fixed it.
   */
  buildFailed: string | null;
  /** The look chosen from the page after this turn ("Change the look"), newest. */
  look: string | null;
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
    spend: [],
    cards: [],
    version: null,
    buildFailed: null,
    look: null,
    limit: null,
    error: null,
    notApplied: null,
    outcome: null,
    startedAt: at,
    finishedAt: null,
    changedFiles: false,
  };
}

/**
 * Consecutive file writes, folded into one row. A write still running joins
 * the row above it at once ("Writing b", then "Wrote 2 files"): a row that
 * appeared and then folded away made the list grow and shrink by a line at
 * every write, and the chat moved up and down with it.
 */
function fold(rows: StepRow[]): StepRow[] {
  const out: StepRow[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last !== undefined && FOLDABLE.has(row.tool) && FOLDABLE.has(last.tool) && last.state === 'done' && (row.state === 'done' || row.state === 'running')) {
      const { subject: _subject, ...rest } = last;
      out[out.length - 1] = {
        ...rest,
        tool: row.tool,
        state: row.state,
        folded: last.folded + 1,
        ms: (last.ms ?? 0) + (row.ms ?? 0),
        // While it runs the row names the file being written; done, it counts them.
        ...(row.state === 'running' && row.subject !== undefined ? { subject: row.subject } : {}),
      };
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
          // A session written before misses were told apart says a wrong reference name this way.
          state: event.state === 'failed' && (event.ended === 'miss' || (event.tool === 'read_reference' && event.label === 'No such reference')) ? 'missed' : event.state,
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
        if (event.tool === 'build_sides' && event.state !== 'running') turn.buildFailed = event.state === 'failed' && event.ended !== 'stopped' ? (event.detail ?? '') : null;
        break;
      }
      case 'usage':
        turn.usage = { step: event.step, tokens: event.turnTokens };
        break;
      case 'spend':
        if (!turn.spend.some((entry) => entry.which === event.which)) turn.spend.push({ which: event.which, mark: event.mark });
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
        turn.buildFailed = event.ok ? null : event.problems.slice(0, 3).join('\n');
        if (!event.ok) list.push({ id: `build-${String(event.seq)}`, tool: 'build', label: 'Build', state: 'failed', ms: null, detail: event.problems.slice(0, 3).join('\n') || null, folded: 1 });
        break;
      case 'apply':
        // A good apply is said once: by the tool's own step (which is still running when its apply is told), or by the first apply event of the turn.
        if (event.ok && list.some((row) => (row.tool === 'apply_app' && row.state !== 'failed') || (row.tool === 'apply' && row.state === 'done'))) break;
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
      case 'look':
        turn.look = event.direction;
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

/**
 * The marks to warn about above the message box: the session's, once any turn
 * passed it (it stays passed), and the turn's for as long as that turn is
 * still working — a turn that ended has nothing left to stop.
 */
export function spendWarnings(turns: readonly TurnView[]): { which: SpendMark; mark: number }[] {
  const session = turns.flatMap((turn) => turn.spend).findLast((entry) => entry.which === 'session-tokens');
  const last = turns.at(-1);
  const turn = last === undefined || last.outcome !== null ? undefined : last.spend.find((entry) => entry.which === 'turn-tokens');
  return [...(turn === undefined ? [] : [turn]), ...(session === undefined ? [] : [session])];
}
