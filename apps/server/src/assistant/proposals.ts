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

import { dataPageOf } from './data-page.js';
import { DoorRefusedError, type Door, type DoorReply } from './door.js';
import type { AssistantToolDeps } from './types.js';

/** How long a checked proposal may be confirmed. After it, the person asks again. */
export const PROPOSAL_LIFETIME_MS = 30 * 60_000;
/** Columns of a change the stale-row guard carries: the route's own limit. */
export const PROPOSAL_SEEN_MAX = 8;
/** The longest text one previewed cell keeps. */
const PREVIEW_CELL_MAX = 300;

export type ProposalState = 'unchecked' | 'open' | 'refused' | 'superseded' | 'expired';

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
}

const storedProposalSchema = assistantProposalSchema.extend({
  state: z.enum(['unchecked', 'open', 'refused', 'superseded', 'expired']),
  madeAt: z.number(),
  hash: z.string().optional(),
  checkedAt: z.number().optional(),
  expiresAt: z.number().optional(),
  refusal: z.record(z.string(), z.unknown()).optional(),
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
  const page = await dataPageOf(input.deps);
  const through = (route: Parameters<Door['replay']>[1]['route'], params: Record<string, string>, payload?: Record<string, unknown>): Promise<DoorReply> =>
    input.door.replay(input.request, { route, params, sessionId: input.sessionId, turnId: input.turnId, ...(payload === undefined ? {} : { payload }) });

  const checked: CheckedAction[] = [];
  let stopped: ProposalRefusal | null = null;
  for (const action of bare(proposal.actions)) {
    if (stopped !== null) {
      checked.push({ ...action, refused: stopped });
      continue;
    }
    if (action.do !== 'row.create' && action.do !== 'row.change' && action.do !== 'row.delete') {
      checked.push({ ...action, refused: { code: 'NOT_OFFERED', message: 'That cannot be done from here.' } });
      continue;
    }
    if (!abilities[ABILITY_OF[action.do]]) {
      checked.push({ ...action, refused: { code: 'SWITCHED_OFF', message: 'This is switched off for the assistant in this workspace.' } });
      continue;
    }
    // The page's own table, by the page's own ids: from here on nothing of the model's names a table.
    if (page === null || page.connectionId === null || page.table === null || action.connectionId !== page.connectionId || action.table !== page.table) {
      checked.push({ ...action, refused: { code: 'NOT_THIS_TABLE', message: 'Changes can be proposed on the table of the page they were asked on, and no other.' } });
      continue;
    }
    const placed = { ...action, connectionId: page.connectionId, table: page.table };
    const where = { connectionId: page.connectionId, table: page.table };
    try {
      if (placed.do === 'row.create') {
        const tried = await through('row.create.try', where, { values: placed.values });
        if (tried.status === 429) stopped = refusalOf(tried);
        checked.push(tried.status === 200 ? { ...placed, preview: { kind: 'create', after: clip((tried.body as { data?: unknown }).data) } } : { ...placed, refused: refusalOf(tried) });
        continue;
      }
      const row = { ...where, recordId: placed.id };
      const read = await through('row.read', row);
      if (read.status !== 200) {
        if (read.status === 429) stopped = refusalOf(read);
        checked.push({ ...placed, refused: refusalOf(read) });
        continue;
      }
      const before = clip((read.body as { data?: unknown }).data);
      if (placed.do === 'row.delete') {
        const tried = await through('row.delete.try', row);
        if (tried.status === 429) stopped = refusalOf(tried);
        if (tried.status !== 200) {
          checked.push({ ...placed, refused: refusalOf(tried) });
          continue;
        }
        const references = ((tried.body as { references?: { table?: unknown; count?: unknown }[] }).references ?? [])
          .filter((entry) => typeof entry.count === 'number' && entry.count > 0)
          .map((entry) => ({ table: String(entry.table), count: Number(entry.count) }));
        checked.push({ ...placed, preview: { kind: 'delete', row: before, references } });
        continue;
      }
      const tried = await through('row.change.try', row, { values: placed.values });
      if (tried.status === 429) stopped = refusalOf(tried);
      if (tried.status !== 200) {
        checked.push({ ...placed, refused: refusalOf(tried) });
        continue;
      }
      const after = clip((tried.body as { data?: unknown }).data);
      // Everything the change would leave different, not only the columns the model named:
      // a figure a rule works out moves with them, and the person is shown that too.
      const moved = Object.keys(after).filter((column) => !same(before[column], after[column]));
      if (moved.length === 0) {
        checked.push({ ...placed, refused: { code: 'NO_CHANGE', message: 'The row already holds these values.' } });
        continue;
      }
      const named = Object.keys(placed.values).filter((column) => column in before).slice(0, PROPOSAL_SEEN_MAX);
      checked.push({
        ...placed,
        seen: Object.fromEntries(named.map((column) => [column, before[column]])),
        preview: { kind: 'change', before: Object.fromEntries(moved.map((column) => [column, before[column] ?? null])), after: Object.fromEntries(moved.map((column) => [column, after[column] ?? null])) },
      });
    } catch (error) {
      if (!(error instanceof DoorRefusedError)) throw error;
      checked.push({ ...placed, refused: { code: error.code, message: error.message } });
    }
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
