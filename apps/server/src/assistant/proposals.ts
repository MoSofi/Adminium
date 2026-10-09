// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A proposal, from what a model wrote to what a person is shown.
 *
 * The turn's job stores a proposal exactly as the model wrote it and shows
 * nothing: it has nobody's session to check it with. The check runs here, in
 * the person's OWN request, when their panel asks for it:
 *
 * - each action is held against the switches and the cap as they are NOW;
 * - a row action must be on the table of the page the turn was asked on, and
 *   from then on the page's own ids are used, never the model's text;
 * - each is then tried through the door: the same route the screen would
 *   call, as the person, writing nothing. What the route refuses is the
 *   refusal, in the route's words;
 * - what the person will see (a new row, a change's before and after, what a
 *   delete would take with it) is built from those replies, so it holds only
 *   what they may read, masked as their screen masks it.
 *
 * Nothing here writes a row. The model is never shown a preview.
 *
 * A proposal has a life: it is `unchecked` until its first check, `open`
 * while it can be confirmed, and then `superseded` (the conversation moved
 * on), `expired` (thirty minutes) or `refused` (it could never be confirmed
 * as a whole). What it would have shown is dropped when it stops being open.
 */
import { createHash } from 'node:crypto';

import { assistantProposalSchema, type AssistantAction } from '@adminium/llm';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ConflictError, ValidationFailedError } from '../errors.js';
import { dataPageOf } from './data-page.js';
import { DoorRefusedError, type Door, type DoorReply, type DoorRouteKey } from './door.js';
import { viewOrError } from './tools/schema.js';
import type { AssistantToolDeps } from './types.js';

/** How long a checked proposal may be confirmed. After it, the person asks again. */
export const PROPOSAL_LIFETIME_MS = 30 * 60_000;
/** Columns of a change the stale-row guard carries: the route's own limit. */
export const PROPOSAL_SEEN_MAX = 8;
/** The longest text one previewed cell keeps. */
const PREVIEW_CELL_MAX = 300;

export type ProposalState = 'unchecked' | 'open' | 'refused' | 'superseded' | 'expired' | 'applying' | 'applied' | 'interrupted';

/** Why one action, or a whole proposal, cannot be done. `code` is the dashboard's to word; `message` is the route's own. */
export interface ProposalRefusal {
  code: string;
  message: string;
  /** The columns a route named, when it named any. */
  fields?: string[];
}

export type ProposalPreview =
  | { kind: 'create'; after: Record<string, unknown> }
  | { kind: 'change'; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: 'delete'; row: Record<string, unknown>; references: { table: string; count: number }[] };

export type CheckedAction = AssistantAction & {
  /** `row.change` only: what the changed columns held when it was checked. Sent with the write, so a row changed since is refused. */
  seen?: Record<string, unknown>;
  preview?: ProposalPreview;
  refused?: ProposalRefusal;
};

/** A proposal as it is stored in `turn.answer.proposal`. */
export interface StoredProposal {
  state: ProposalState;
  title: string;
  actions: CheckedAction[];
  madeAt: number;
  hash?: string;
  checkedAt?: number;
  expiresAt?: number;
  /** Why the whole of it cannot be confirmed (`state: 'refused'`). */
  refusal?: ProposalRefusal & { count?: number; cap?: number };
  /** The indexes the person confirmed. */
  picked?: number[];
  /** What the confirm did, written after every row. Never a token and never a one-time code. */
  outcome?: ProposalOutcome;
  appliedAt?: number;
}

/** What a confirm did, by the action's index. */
export interface ProposalOutcome {
  done: { index: number; id: string | null }[];
  failed: { index: number; code: string; message: string }[];
  /** Picked and never sent: the run was stopped before them. */
  notTried: number[];
  /** `interrupted` only: the one that was being written when the process went. Done or not is not known. */
  unsure?: number[];
}

/** What a confirm answers once, to the browser that asked, and stores nowhere. */
export interface ProposalHandOver {
  /** The route's own undo token per row that has one, for the route's own minute. */
  undo: { index: number; token: string }[];
  /** One-time codes a create answered, as the route gave them. */
  once: unknown[];
}

const storedProposalSchema = assistantProposalSchema.extend({
  state: z.enum(['unchecked', 'open', 'refused', 'superseded', 'expired', 'applying', 'applied', 'interrupted']),
  madeAt: z.number(),
  hash: z.string().optional(),
  checkedAt: z.number().optional(),
  expiresAt: z.number().optional(),
  refusal: z.record(z.string(), z.unknown()).optional(),
  picked: z.array(z.number()).optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
  appliedAt: z.number().optional(),
  actions: z.array(z.record(z.string(), z.unknown())).min(1),
});

/** Read a turn's stored proposal; `null` when it has none or it no longer reads. */
export function storedProposalOf(answer: unknown): StoredProposal | null {
  const proposal = (answer as { proposal?: unknown } | null)?.proposal;
  if (proposal === undefined || proposal === null) return null;
  const parsed = storedProposalSchema.safeParse(proposal);
  return parsed.success ? (parsed.data as unknown as StoredProposal) : null;
}

/**
 * What a reader of the turn is given. Before its check a proposal is the
 * model's own text and is told as nothing but "there is one"; once it is no
 * longer open, what it would have shown is gone.
 */
export function proposalView(proposal: StoredProposal): Record<string, unknown> {
  if (proposal.state === 'unchecked') return { state: 'unchecked', madeAt: proposal.madeAt };
  if (proposal.state === 'open' || proposal.state === 'refused') return { ...proposal };
  // Confirmed: what was asked for and what became of each, and none of what was previewed.
  if (proposal.state === 'applying' || proposal.state === 'applied' || proposal.state === 'interrupted') {
    return {
      state: proposal.state,
      title: proposal.title,
      madeAt: proposal.madeAt,
      actions: bare(proposal.actions),
      picked: proposal.picked ?? [],
      outcome: proposal.outcome ?? { done: [], failed: [], notTried: [] },
      ...(proposal.appliedAt === undefined ? {} : { appliedAt: proposal.appliedAt }),
    };
  }
  return { state: proposal.state, title: proposal.title, madeAt: proposal.madeAt, count: proposal.actions.length };
}

/** The hash a confirm must name: the actions as they were checked, and nothing a preview holds. */
export function proposalHash(actions: readonly CheckedAction[]): string {
  const canonical = actions.map((action) => {
    const { preview: _preview, refused: _refused, ...rest } = action;
    return sortKeys(rest);
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/** Without previews and refusals: what a proposal keeps once it stops being open. */
function bare(actions: readonly CheckedAction[]): CheckedAction[] {
  return actions.map((action) => {
    const { preview: _preview, refused: _refused, seen: _seen, ...rest } = action;
    return rest as CheckedAction;
  });
}

function clip(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null) return {};
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'string' && value.length > PREVIEW_CELL_MAX ? `${value.slice(0, PREVIEW_CELL_MAX - 1)}…` : value,
    ]),
  );
}

/** A route's refusal, read from its error envelope. */
function refusalOf(reply: DoorReply): ProposalRefusal {
  const error = (reply.body as { error?: { code?: unknown; message?: unknown; details?: { fields?: unknown } } } | null)?.error;
  const fields = error?.details?.fields;
  return {
    code: typeof error?.code === 'string' ? error.code : `HTTP_${String(reply.status)}`,
    message: typeof error?.message === 'string' ? error.message : 'The server refused this.',
    ...(typeof fields === 'object' && fields !== null ? { fields: Object.keys(fields).slice(0, 20) } : {}),
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface CheckProposalInput {
  request: FastifyRequest;
  door: Door;
  meta: MetaDb;
  /** The turn's own page and person, resolved as a turn's tools are. */
  deps: AssistantToolDeps;
  sessionId: string;
  turnId: string;
  proposal: StoredProposal;
  /** Whether this turn is the conversation's newest: a proposal is let go once the person asks anything else. */
  newest: boolean;
  now: number;
}

const ABILITY_OF = { 'row.create': 'create', 'row.change': 'change', 'row.delete': 'delete' } as const;

/** Where a row action lands: ids the SERVER resolved, or why it lands nowhere. */
type Placed = { ok: true; connectionId: string; table: string } | { ok: false; refusal: ProposalRefusal };
type Place = (action: { connectionId: string; table: string }) => Promise<Placed>;

const NOT_THIS_TABLE: ProposalRefusal = { code: 'NOT_THIS_TABLE', message: 'Changes can be proposed on the table of the page they were asked on, and no other.' };
const NOT_A_DATA_TABLE: ProposalRefusal = { code: 'NOT_A_DATA_TABLE', message: 'That is not a table of your data.' };

/**
 * How a turn's page places a row action.
 *
 * On a data page there is one table, the page's own, and its ids are the
 * page's. Away from any page (the general assistant) a table is one the
 * person's own view of the connection holds and they may read: it is looked
 * up there and the view's id is used. Either way nothing of the model's text
 * is carried into an address.
 */
export async function placeFor(deps: AssistantToolDeps): Promise<Place> {
  if (deps.context === 'data') {
    const page = await dataPageOf(deps);
    return async (action) =>
      page === null || page.connectionId === null || page.table === null || action.connectionId !== page.connectionId || action.table !== page.table
        ? { ok: false, refusal: NOT_THIS_TABLE }
        : { ok: true, connectionId: page.connectionId, table: page.table };
  }
  if (deps.context !== 'general') return async () => ({ ok: false, refusal: NOT_THIS_TABLE });
  const allowed = new Set(deps.host.connectionIds);
  return async (action) => {
    if (allowed.size > 0 && !allowed.has(action.connectionId)) return { ok: false, refusal: NOT_A_DATA_TABLE };
    const found = await viewOrError(deps, action.connectionId);
    if ('error' in found) return { ok: false, refusal: NOT_A_DATA_TABLE };
    let id: string;
    try {
      id = found.view.table(action.table).id;
    } catch {
      return { ok: false, refusal: NOT_A_DATA_TABLE };
    }
    // Adminium's own tables are never the assistant's to write, whoever asks.
    if (/(^|\.)adminium_/i.test(id)) return { ok: false, refusal: NOT_A_DATA_TABLE };
    const canRead = await deps.canReadTable(action.connectionId);
    if (!(await canRead(id))) return { ok: false, refusal: NOT_A_DATA_TABLE };
    return { ok: true, connectionId: action.connectionId, table: id };
  };
}

type Through = (route: DoorRouteKey, params: Record<string, string>, payload?: Record<string, unknown>) => Promise<DoorReply>;

interface CheckOneInput {
  action: CheckedAction;
  abilities: { create: boolean; change: boolean; send: boolean; delete: boolean };
  place: Place;
  through: Through;
}

/**
 * Try ONE action as the person and say what they would see, or why not.
 * `stop` is set when the server said "too many requests": nothing after it
 * is tried.
 */
async function checkOne(input: CheckOneInput): Promise<{ checked: CheckedAction; stop?: ProposalRefusal }> {
  const { action, abilities, through } = input;
  if (action.do !== 'row.create' && action.do !== 'row.change' && action.do !== 'row.delete') {
    return { checked: { ...action, refused: { code: 'NOT_OFFERED', message: 'That cannot be done from here.' } } };
  }
  if (!abilities[ABILITY_OF[action.do]]) {
    return { checked: { ...action, refused: { code: 'SWITCHED_OFF', message: 'This is switched off for the assistant in this workspace.' } } };
  }
  // Placed by the server: from here on nothing of the model's names a table.
  const at = await input.place(action);
  if (!at.ok) return { checked: { ...action, refused: at.refusal } };
  const placed = { ...action, connectionId: at.connectionId, table: at.table };
  const where = { connectionId: at.connectionId, table: at.table };
  const refusedBy = (reply: DoorReply): { checked: CheckedAction; stop?: ProposalRefusal } => {
    const refused = refusalOf(reply);
    return { checked: { ...placed, refused }, ...(reply.status === 429 ? { stop: refused } : {}) };
  };
  try {
    if (placed.do === 'row.create') {
      const tried = await through('row.create.try', where, { values: placed.values });
      if (tried.status !== 200) return refusedBy(tried);
      return { checked: { ...placed, preview: { kind: 'create', after: clip((tried.body as { data?: unknown }).data) } } };
    }
    const row = { ...where, recordId: placed.id };
    const read = await through('row.read', row);
    if (read.status !== 200) return refusedBy(read);
    const before = clip((read.body as { data?: unknown }).data);
    if (placed.do === 'row.delete') {
      const tried = await through('row.delete.try', row);
      if (tried.status !== 200) return refusedBy(tried);
      const references = ((tried.body as { references?: { table?: unknown; count?: unknown }[] }).references ?? [])
        .filter((entry) => typeof entry.count === 'number' && entry.count > 0)
        .map((entry) => ({ table: String(entry.table), count: Number(entry.count) }));
      return { checked: { ...placed, preview: { kind: 'delete', row: before, references } } };
    }
    const tried = await through('row.change.try', row, { values: placed.values });
    if (tried.status !== 200) return refusedBy(tried);
    const after = clip((tried.body as { data?: unknown }).data);
    // Everything the change would leave different, not only the columns the model named:
    // a figure a rule works out moves with them, and the person is shown that too.
    const moved = Object.keys(after).filter((column) => !same(before[column], after[column]));
    if (moved.length === 0) return { checked: { ...placed, refused: { code: 'NO_CHANGE', message: 'The row already holds these values.' } } };
    const named = Object.keys(placed.values).filter((column) => column in before).slice(0, PROPOSAL_SEEN_MAX);
    return {
      checked: {
        ...placed,
        seen: Object.fromEntries(named.map((column) => [column, before[column]])),
        preview: {
          kind: 'change',
          before: Object.fromEntries(moved.map((column) => [column, before[column] ?? null])),
          after: Object.fromEntries(moved.map((column) => [column, after[column] ?? null])),
        },
      },
    };
  } catch (error) {
    if (!(error instanceof DoorRefusedError)) throw error;
    return { checked: { ...placed, refused: { code: error.code, message: error.message } } };
  }
}


/**
 * Bring a proposal up to date and say what it is now. Checks an unchecked
 * one; lets go of one whose time or place has passed; answers an open one as
 * it was stored. The caller stores what comes back when `changed` is set.
 */
export async function checkProposal(input: CheckProposalInput): Promise<{ proposal: StoredProposal; changed: boolean }> {
  const { proposal, now } = input;
  if (proposal.state !== 'unchecked' && proposal.state !== 'open') return { proposal, changed: false };
  if (!input.newest) return { proposal: { state: 'superseded', title: proposal.title, actions: bare(proposal.actions), madeAt: proposal.madeAt }, changed: true };
  if (now > proposal.madeAt + PROPOSAL_LIFETIME_MS) {
    return { proposal: { state: 'expired', title: proposal.title, actions: bare(proposal.actions), madeAt: proposal.madeAt }, changed: true };
  }
  if (proposal.state === 'open') return { proposal, changed: false };

  const settings = settingsRepo(input.meta);
  const abilities = await settings.get('assistant.abilities');
  const cap = await settings.get('assistant.maxRows');
  const refuseAll = (refusal: StoredProposal['refusal']): { proposal: StoredProposal; changed: boolean } => ({
    proposal: { state: 'refused', title: proposal.title, actions: bare(proposal.actions), madeAt: proposal.madeAt, checkedAt: now, ...(refusal === undefined ? {} : { refusal }) },
    changed: true,
  });
  // Over the cap nothing is tried: a dry run costs the person's own request budget.
  if (proposal.actions.length > cap) {
    return refuseAll({ code: 'OVER_CAP', message: `That is ${String(proposal.actions.length)} changes; at most ${String(cap)} can be confirmed at once.`, count: proposal.actions.length, cap });
  }
  const place = await placeFor(input.deps);
  const through = throughFor(input);

  const checked: CheckedAction[] = [];
  let stopped: ProposalRefusal | null = null;
  for (const action of bare(proposal.actions)) {
    if (stopped !== null) {
      checked.push({ ...action, refused: stopped });
      continue;
    }
    const one = await checkOne({ action, abilities, place, through });
    checked.push(one.checked);
    if (one.stop !== undefined) stopped = one.stop;
  }

  return {
    proposal: {
      state: 'open',
      title: proposal.title,
      actions: checked,
      madeAt: proposal.madeAt,
      hash: proposalHash(checked),
      checkedAt: now,
      expiresAt: proposal.madeAt + PROPOSAL_LIFETIME_MS,
    },
    changed: true,
  };
}

function throughFor(input: Pick<CheckProposalInput, 'door' | 'request' | 'sessionId' | 'turnId'>): Through {
  return (route, params, payload) =>
    input.door.replay(input.request, { route, params, sessionId: input.sessionId, turnId: input.turnId, ...(payload === undefined ? {} : { payload }) });
}

// ─── The confirm ─────────────────────────────────────────────────────────────

/** What the confirm needs of the turn's store: three writes, each one statement. */
export interface ProposalStore {
  recordAnswer: (turnId: string, answer: Record<string, unknown>) => Promise<boolean>;
  claimProposal: (turnId: string, at: number) => Promise<boolean>;
  finishProposal: (turnId: string, answer: Record<string, unknown>, at: number) => Promise<boolean>;
}

export interface ApplyProposalInput extends CheckProposalInput {
  store: ProposalStore;
  /** The turn's whole answer, which the proposal is one key of. */
  answer: Record<string, unknown>;
  /** The hash the person's card showed. */
  hash: string;
  /** The indexes they left ticked; absent means every action that can be done. */
  pick?: readonly number[] | undefined;
  /** The key column of the page's table, to name a new row; absent, a new row is not named. */
  keyColumn?: string | undefined;
}

/** Thrown with the proposal as it now stands: the browser draws that instead of what it had. */
function conflict(reason: 'proposal-changed' | 'proposal-spent', message: string, proposal: StoredProposal): ConflictError {
  return new ConflictError(message, 'CONFLICT', { reason, proposal: proposalView(proposal) });
}

/**
 * Carry out what the person confirmed, once.
 *
 * Everything that was true at the check is asked again first: the proposal
 * is still open and still the conversation's last word, the hash is the one
 * they were shown, each switch is still on, the count is still under the cap,
 * and each row a change names still holds what the preview said. Anything
 * that differs is stored and thrown back as a conflict that carries the
 * proposal as it now stands; nothing is written.
 *
 * Then the proposal is taken, in one guarded statement, and each action is
 * sent through the door in order: the screen's own route, as the person, with
 * the values the row was seen to hold. One row's refusal does not stop the
 * next; "too many requests" stops the run. The outcome is stored after every
 * row, so a process that dies leaves what it did.
 */
export async function applyProposal(input: ApplyProposalInput): Promise<{ proposal: StoredProposal; handOver: ProposalHandOver }> {
  const { now, store, turnId } = input;
  const keep = (proposal: StoredProposal): Promise<boolean> => store.recordAnswer(turnId, { ...input.answer, proposal });

  if (input.proposal.state === 'unchecked') throw new ValidationFailedError('That proposal has not been checked yet.', { turnId });
  const lived = await checkProposal(input);
  if (lived.changed) await keep(lived.proposal);
  const proposal = lived.proposal;
  if (proposal.state !== 'open') throw conflict('proposal-spent', 'That proposal can no longer be confirmed.', proposal);
  if (proposal.hash !== input.hash) throw conflict('proposal-changed', 'That proposal has changed since it was shown.', proposal);

  const able = proposal.actions.map((action, index) => (action.preview === undefined ? -1 : index)).filter((index) => index >= 0);
  const picked = [...new Set(input.pick ?? able)].sort((a, b) => a - b);
  if (picked.length === 0 || picked.some((index) => !Number.isInteger(index) || !able.includes(index))) {
    throw new ValidationFailedError('Pick at least one change, and only ones that can be done.', { fields: { pick: { code: 'invalid' } } });
  }

  // The switches, the cap and the rows, as they are NOW.
  const settings = settingsRepo(input.meta);
  const abilities = await settings.get('assistant.abilities');
  const cap = await settings.get('assistant.maxRows');
  if (picked.length > cap) {
    const refused: StoredProposal = {
      state: 'refused',
      title: proposal.title,
      actions: bare(proposal.actions),
      madeAt: proposal.madeAt,
      checkedAt: now,
      refusal: { code: 'OVER_CAP', message: `That is ${String(picked.length)} changes; at most ${String(cap)} can be confirmed at once.`, count: picked.length, cap },
    };
    await keep(refused);
    throw conflict('proposal-changed', 'That is more than can be confirmed at once.', refused);
  }
  const place = await placeFor(input.deps);
  const through = throughFor(input);
  const actions = [...proposal.actions];
  let differs = false;
  for (const index of picked) {
    const shown = actions[index]!;
    const { preview: _preview, refused: _refused, seen: _seen, ...asked } = shown;
    // A new row has nothing to have moved since; the write runs every check the trial ran.
    if (shown.do === 'row.create' && abilities.create) continue;
    // A change whose row still reads as the preview said needs no second trial: one read, not two requests.
    const still = shown.do === 'row.change' && abilities.change && shown.preview?.kind === 'change' ? await place(shown) : null;
    if (shown.do === 'row.change' && shown.preview?.kind === 'change' && still !== null && still.ok && still.connectionId === shown.connectionId && still.table === shown.table) {
      try {
        const read = await through('row.read', { connectionId: shown.connectionId, table: shown.table, recordId: shown.id });
        const row = read.status === 200 ? clip((read.body as { data?: unknown }).data) : null;
        const was = shown.preview.before;
        if (row !== null && Object.keys(was).every((column) => same(row[column], was[column]))) continue;
      } catch (error) {
        if (!(error instanceof DoorRefusedError)) throw error;
      }
    }
    const again = await checkOne({ action: asked as CheckedAction, abilities, place, through });
    if (JSON.stringify(sortKeys(again.checked)) === JSON.stringify(sortKeys(shown))) continue;
    actions[index] = again.checked;
    differs = true;
    if (again.stop !== undefined) break;
  }
  if (differs) {
    const moved: StoredProposal = { ...proposal, actions, hash: proposalHash(actions), checkedAt: now };
    await keep(moved);
    throw conflict('proposal-changed', 'Something changed since this was shown. Look again before confirming.', moved);
  }

  // Taken, once. A second click, a retry or a second window finds it gone.
  if (!(await store.claimProposal(turnId, now))) throw conflict('proposal-spent', 'That proposal was already confirmed.', proposal);

  const outcome: ProposalOutcome = { done: [], failed: [], notTried: [] };
  const handOver: ProposalHandOver = { undo: [], once: [] };
  const running = (): StoredProposal => ({ state: 'applying', title: proposal.title, actions: bare(proposal.actions), madeAt: proposal.madeAt, picked, outcome });
  await keep(running());
  let stopped = false;
  for (const index of picked) {
    if (stopped) {
      outcome.notTried.push(index);
      continue;
    }
    const action = proposal.actions[index]!;
    try {
      const where = { connectionId: (action as { connectionId: string }).connectionId, table: (action as { table: string }).table };
      const reply =
        action.do === 'row.create'
          ? await through('row.create', where, { values: action.values })
          : action.do === 'row.change'
            ? await through('row.change', { ...where, recordId: action.id }, { values: action.values, ...(action.seen === undefined || Object.keys(action.seen).length === 0 ? {} : { seen: action.seen }) })
            : action.do === 'row.delete'
              ? // "Yes, with what refers to it" is said only for a row whose references the person was shown.
                await through(action.preview?.kind === 'delete' && action.preview.references.length > 0 ? 'row.delete.confirmed' : 'row.delete', { ...where, recordId: action.id })
              : null;
      if (reply === null) {
        outcome.failed.push({ index, code: 'NOT_OFFERED', message: 'That cannot be done from here.' });
      } else if (reply.status === 200 || reply.status === 201) {
        const body = reply.body as { data?: Record<string, unknown> | null; undoToken?: unknown; once?: unknown };
        const key = action.do === 'row.change' || action.do === 'row.delete' ? action.id : input.keyColumn === undefined ? undefined : body.data?.[input.keyColumn];
        outcome.done.push({ index, id: key === undefined || key === null ? null : String(key) });
        if (typeof body.undoToken === 'string' && body.undoToken !== '') handOver.undo.push({ index, token: body.undoToken });
        if (Array.isArray(body.once)) handOver.once.push(...(body.once as unknown[]));
      } else {
        const refused = refusalOf(reply);
        outcome.failed.push({ index, code: refused.code, message: refused.message });
        // The person's own request budget is spent: the rest are left, and said so.
        if (reply.status === 429) stopped = true;
      }
    } catch (error) {
      if (!(error instanceof DoorRefusedError)) throw error;
      outcome.failed.push({ index, code: error.code, message: error.message });
    }
    await keep(running());
  }
  const applied: StoredProposal = { ...running(), state: 'applied', appliedAt: now };
  await store.finishProposal(turnId, { ...input.answer, proposal: applied }, now);
  return { proposal: applied, handOver };
}

/**
 * A proposal whose confirm died with its process: what it had written is
 * kept, the row it was on is marked as not known, and the rest as not tried.
 */
export function interruptedProposal(proposal: StoredProposal): StoredProposal {
  const picked = proposal.picked ?? [];
  const outcome = proposal.outcome ?? { done: [], failed: [], notTried: [] };
  const settled = new Set([...outcome.done.map((entry) => entry.index), ...outcome.failed.map((entry) => entry.index), ...outcome.notTried]);
  const open = picked.filter((index) => !settled.has(index));
  return {
    ...proposal,
    state: 'interrupted',
    outcome: { ...outcome, unsure: open.slice(0, 1), notTried: [...outcome.notTried, ...open.slice(1)] },
  };
}

/** At start: every proposal a confirm took and never finished is ended as interrupted. */
export async function endInterruptedProposals(
  store: Pick<ProposalStore, 'finishProposal'> & { listUnfinishedProposals: () => Promise<{ id: string; answer: Record<string, unknown> | null }[]> },
  now: number,
): Promise<number> {
  let ended = 0;
  for (const turn of await store.listUnfinishedProposals()) {
    const stored = storedProposalOf(turn.answer);
    // A proposal that no longer reads has nothing to say; the turn is only marked as ended.
    if (stored === null) {
      if (await store.finishProposal(turn.id, turn.answer ?? {}, now)) ended += 1;
      continue;
    }
    // Still `open`: the claim landed and the run never began, so nothing was written.
    const proposal = interruptedProposal(stored.state === 'applying' ? stored : { ...stored, picked: [], outcome: { done: [], failed: [], notTried: [] } });
    if (await store.finishProposal(turn.id, { ...(turn.answer ?? {}), proposal }, now)) ended += 1;
  }
  return ended;
}

