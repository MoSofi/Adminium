// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in": where an email template, a report layout or an invoice layout
 * is listed. Every item starts shown in all workspaces; a person may choose
 * some instead (possibly none, which is what deleting an item's last chosen
 * workspace leaves: never widened back to all).
 *
 * It narrows lists and pickers only. A send never asks: a rule that names a
 * template hidden in this workspace still sends it, and the item reads as
 * hidden there, with its chips.
 *
 * An email template is chosen as a family: every language of one key is
 * shown in the same workspaces, because a rule names the key, not a language.
 */
import { workspacesRepo, type MetaDb, type ShownInKind } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { workspaceConnections } from './visibility.js';

export const shownInMode = z.enum(['all', 'chosen']);

/** An item's "Shown in", as every reply carries it. `workspaceIds` is empty when the mode is `all`. */
export const shownInView = z.object({
  mode: shownInMode,
  /** The chosen workspaces; empty for `all`, and for "chosen, none". */
  workspaceIds: z.array(z.string()),
});
export type ShownInView = z.infer<typeof shownInView>;

/** What an edit route takes. With `all`, `workspaceIds` is ignored; ids of workspaces that do not exist are left out. */
export const shownInInput = z.object({
  mode: shownInMode,
  workspaceIds: z.array(z.string().min(1).max(36)).max(500).default([]),
});
export type ShownInInput = z.infer<typeof shownInInput>;

/** One item's view from its row's mode and the kind's links. */
export function shownInOf(mode: 'all' | 'chosen', links: ReadonlyMap<string, readonly string[]>, itemId: string): ShownInView {
  return mode === 'all' ? { mode: 'all', workspaceIds: [] } : { mode: 'chosen', workspaceIds: [...(links.get(itemId) ?? [])] };
}

/**
 * Set "Shown in" on items (one, or an email template's whole family). Only
 * workspaces that exist count: an id of one deleted meanwhile is left out,
 * as its delete would have taken its link anyway. Returns what it was (the
 * first item's) and what it is now, for the audit.
 */
export async function saveShownIn(
  meta: MetaDb,
  kind: ShownInKind,
  itemIds: readonly string[],
  input: ShownInInput,
): Promise<{ before: ShownInView; after: ShownInView }> {
  const workspaces = workspacesRepo(meta);
  const first = itemIds[0];
  const was = first === undefined ? null : await workspaces.shownIn(kind, first);
  const before: ShownInView = was ?? { mode: 'all', workspaceIds: [] };
  const chosen = input.mode === 'all' ? null : (await workspaces.existing(input.workspaceIds)).sort();
  for (const id of itemIds) await workspaces.setShownIn(kind, id, chosen);
  return { before, after: chosen === null ? { mode: 'all', workspaceIds: [] } : { mode: 'chosen', workspaceIds: chosen } };
}

/**
 * A list's `?workspaceId=`, as a test of an item: shown in all, or chosen
 * there. `null` when no workspace is named (the list is not cut). A
 * workspace the person cannot see is not found, as on every narrowing list.
 * It only narrows: the route reads its rows as before, then drops these.
 */
export async function shownInFilter(
  meta: MetaDb,
  request: FastifyRequest,
  kind: ShownInKind,
  workspaceId: string | undefined,
): Promise<((item: { id: string; shownIn: 'all' | 'chosen' }) => boolean) | null> {
  if (workspaceId === undefined || workspaceId === '') return null;
  if ((await workspaceConnections(meta, request, workspaceId)) === null) throw new NotFoundError('There is no such workspace.', { workspaceId });
  const chosen = await workspacesRepo(meta).chosenIn(kind, workspaceId);
  return (item) => item.shownIn === 'all' || chosen.has(item.id);
}
