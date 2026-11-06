// SPDX-License-Identifier: AGPL-3.0-only
/**
 * workspacesRepo — `adminium_workspaces`, `adminium_workspace_connections`
 * and `adminium_item_workspaces` (wave 0075).
 *
 * A workspace is a named group of databases on one server. A database may sit
 * in several workspaces or in none; nothing is created on upgrade, and a
 * server with no workspace shows the menu it always showed. A workspace is a
 * way to organise, not a security wall: rights stay with roles, and nothing
 * here is ever read to grant anything.
 *
 * Memberships cascade from both sides: deleting a workspace leaves its
 * databases in place, deleting a connection takes it out of every workspace.
 *
 * "Shown in": an email template, a report layout or an invoice layout lists
 * in every workspace (`shown_in = 'all'`, every existing item) or in the
 * chosen ones (`chosen` + link rows here). It narrows lists and pickers only,
 * never a send.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumWorkspacesTable } from '../schema/tables.js';
import { affected, MetaValidationError } from './util.js';

export const WORKSPACE_NAME_MAX = 80;

/** The kinds of item a workspace can be chosen for. */
export const SHOWN_IN_KINDS = ['email-template', 'report', 'invoice'] as const;
export type ShownInKind = (typeof SHOWN_IN_KINDS)[number];

const SHOWN_IN_TABLE = {
  'email-template': 'adminium_email_templates',
  report: 'adminium_report_documents',
  invoice: 'adminium_invoice_documents',
} as const;

export interface WorkspaceSender {
  name: string | null;
  from: string | null;
  replyTo: string | null;
  postal: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  position: number;
  sender: WorkspaceSender;
  /** Its databases, by connection id. */
  connectionIds: string[];
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A name taken by another workspace (names are unique). */
export class WorkspaceNameTaken extends Error {
  override name = 'WorkspaceNameTaken';
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > WORKSPACE_NAME_MAX) {
    throw new MetaValidationError(`a workspace name is 1 to ${WORKSPACE_NAME_MAX} characters`, []);
  }
  return trimmed;
}

export function workspacesRepo(meta: MetaDb) {
  const { db } = meta;

  function decode(row: Selectable<AdminiumWorkspacesTable>, connectionIds: string[]): Workspace {
    return {
      id: row.id,
      name: row.name,
      position: Number(row.position),
      sender: { name: row.senderName, from: row.senderFrom, replyTo: row.senderReplyTo, postal: row.senderPostal },
      connectionIds,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Every membership: `{workspaceId, connectionId}`, in no order. */
  async function memberships(): Promise<{ workspaceId: string; connectionId: string }[]> {
    return db.selectFrom('adminium_workspace_connections').select(['workspaceId', 'connectionId']).execute();
  }

  async function list(): Promise<Workspace[]> {
    const rows = await db.selectFrom('adminium_workspaces').selectAll().orderBy('position', 'asc').orderBy('name', 'asc').execute();
    const links = await memberships();
    return rows.map((row) =>
      decode(
        row,
        links
          .filter((link) => link.workspaceId === row.id)
          .map((link) => link.connectionId)
          .sort(),
      ),
    );
  }

  async function findById(id: string): Promise<Workspace | null> {
    const row = await db.selectFrom('adminium_workspaces').selectAll().where('id', '=', id).executeTakeFirst();
    if (row === undefined) return null;
    const links = await db.selectFrom('adminium_workspace_connections').select('connectionId').where('workspaceId', '=', id).execute();
    return decode(row, links.map((link) => link.connectionId).sort());
  }

  async function nameTaken(name: string, except?: string): Promise<boolean> {
    let query = db.selectFrom('adminium_workspaces').select('id').where('name', '=', name);
    if (except !== undefined) query = query.where('id', '!=', except);
    return (await query.executeTakeFirst()) !== undefined;
  }

  return {
    list,
    findById,
    memberships,

    async count(): Promise<number> {
      const row = await db.selectFrom('adminium_workspaces').select((eb) => eb.fn.countAll<number | string>().as('n')).executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** A new workspace, last in the order, holding `connectionIds`. */
    async create(input: { name: string; connectionIds?: readonly string[]; createdBy?: string | null }, at: number = Date.now()): Promise<Workspace> {
      const name = cleanName(input.name);
      if (await nameTaken(name)) throw new WorkspaceNameTaken(name);
      const last = await db.selectFrom('adminium_workspaces').select((eb) => eb.fn.max('position').as('top')).executeTakeFirst();
      const id = newId('wsp');
      await db
        .insertInto('adminium_workspaces')
        .values({
          id,
          name,
          position: last?.top === null || last?.top === undefined ? 0 : Number(last.top) + 1,
          senderName: null,
          senderFrom: null,
          senderReplyTo: null,
          senderPostal: null,
          createdBy: input.createdBy ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .execute();
      for (const connectionId of new Set(input.connectionIds ?? [])) {
        await db.insertInto('adminium_workspace_connections').values({ workspaceId: id, connectionId, createdAt: at }).execute();
      }
      return (await findById(id))!;
    },

    async rename(id: string, name: string, at: number = Date.now()): Promise<Workspace | null> {
      const clean = cleanName(name);
      if (await nameTaken(clean, id)) throw new WorkspaceNameTaken(clean);
      const res = await db.updateTable('adminium_workspaces').set({ name: clean, updatedAt: at }).where('id', '=', id).executeTakeFirst();
      return affected(res.numUpdatedRows) === 0 ? null : findById(id);
    },

    async setSender(id: string, sender: WorkspaceSender, at: number = Date.now()): Promise<Workspace | null> {
      const res = await db
        .updateTable('adminium_workspaces')
        .set({ senderName: sender.name, senderFrom: sender.from, senderReplyTo: sender.replyTo, senderPostal: sender.postal, updatedAt: at })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 0 ? null : findById(id);
    },

    /** Delete a workspace: its databases stay, its memberships and links go (cascade). */
    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_workspaces').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    /**
     * Put the workspaces in this order. `ids` must name every workspace once:
     * a partial order would leave two at one position.
     */
    async reorder(ids: readonly string[], at: number = Date.now()): Promise<boolean> {
      const held = (await db.selectFrom('adminium_workspaces').select('id').execute()).map((row) => row.id).sort();
      if (new Set(ids).size !== ids.length || [...ids].sort().join('\n') !== held.join('\n')) return false;
      for (const [position, id] of ids.entries()) {
        await db.updateTable('adminium_workspaces').set({ position, updatedAt: at }).where('id', '=', id).execute();
      }
      return true;
    },

    /** The workspaces one database is in, by position. */
    async forConnection(connectionId: string): Promise<string[]> {
      const rows = await db
        .selectFrom('adminium_workspace_connections as l')
        .innerJoin('adminium_workspaces as w', 'w.id', 'l.workspaceId')
        .select('w.id')
        .where('l.connectionId', '=', connectionId)
        .orderBy('w.position', 'asc')
        .execute();
      return rows.map((row) => row.id);
    },

    /**
     * Put one database in exactly these workspaces (the "Workspaces…"
     * dialog). Unknown workspace ids are refused, not skipped.
     */
    async setForConnection(connectionId: string, workspaceIds: readonly string[], at: number = Date.now()): Promise<{ added: string[]; removed: string[] }> {
      const wanted = new Set(workspaceIds);
      const known = new Set((await db.selectFrom('adminium_workspaces').select('id').execute()).map((row) => row.id));
      const unknown = [...wanted].filter((id) => !known.has(id));
      if (unknown.length > 0) throw new MetaValidationError(`unknown workspaces: ${unknown.join(', ')}`, []);
      const held = new Set((await db.selectFrom('adminium_workspace_connections').select('workspaceId').where('connectionId', '=', connectionId).execute()).map((row) => row.workspaceId));
      const added = [...wanted].filter((id) => !held.has(id)).sort();
      const removed = [...held].filter((id) => !wanted.has(id)).sort();
      for (const workspaceId of added) {
        await db.insertInto('adminium_workspace_connections').values({ workspaceId, connectionId, createdAt: at }).execute();
      }
      if (removed.length > 0) {
        await db.deleteFrom('adminium_workspace_connections').where('connectionId', '=', connectionId).where('workspaceId', 'in', removed).execute();
      }
      if (added.length > 0 || removed.length > 0) {
        await db.updateTable('adminium_workspaces').set({ updatedAt: at }).where('id', 'in', [...added, ...removed]).execute();
      }
      return { added, removed };
    },

    // ─── "Shown in" ─────────────────────────────────────────────────────────

    /** An item's mode and its chosen workspaces. */
    async shownIn(kind: ShownInKind, itemId: string): Promise<{ mode: 'all' | 'chosen'; workspaceIds: string[] } | null> {
      const row = await db.selectFrom(SHOWN_IN_TABLE[kind]).select('shownIn').where('id', '=', itemId).executeTakeFirst();
      if (row === undefined) return null;
      const links = await db
        .selectFrom('adminium_item_workspaces')
        .select('workspaceId')
        .where('kind', '=', kind)
        .where('itemId', '=', itemId)
        .execute();
      return { mode: row.shownIn === 'chosen' ? 'chosen' : 'all', workspaceIds: links.map((link) => link.workspaceId).sort() };
    },

    /** Show an item in every workspace (`null`) or in the chosen ones (possibly none). */
    async setShownIn(kind: ShownInKind, itemId: string, workspaceIds: readonly string[] | null): Promise<boolean> {
      const res = await db
        .updateTable(SHOWN_IN_TABLE[kind])
        .set({ shownIn: workspaceIds === null ? 'all' : 'chosen' })
        .where('id', '=', itemId)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return false;
      await db.deleteFrom('adminium_item_workspaces').where('kind', '=', kind).where('itemId', '=', itemId).execute();
      for (const workspaceId of new Set(workspaceIds ?? [])) {
        await db.insertInto('adminium_item_workspaces').values({ kind, itemId, workspaceId }).execute();
      }
      return true;
    },

    /** Every chosen workspace of every item of one kind, by item id (each list sorted). One read for a whole list. */
    async linksOfKind(kind: ShownInKind): Promise<Map<string, string[]>> {
      const rows = await db.selectFrom('adminium_item_workspaces').select(['itemId', 'workspaceId']).where('kind', '=', kind).execute();
      const out = new Map<string, string[]>();
      for (const row of rows) out.set(row.itemId, [...(out.get(row.itemId) ?? []), row.workspaceId]);
      for (const list of out.values()) list.sort();
      return out;
    },

    /** The items of one kind chosen for one workspace (an item shown in all is not among them). */
    async chosenIn(kind: ShownInKind, workspaceId: string): Promise<Set<string>> {
      const rows = await db.selectFrom('adminium_item_workspaces').select('itemId').where('kind', '=', kind).where('workspaceId', '=', workspaceId).execute();
      return new Set(rows.map((row) => row.itemId));
    },

    /** Those of `ids` that name a workspace, in the order given, once each. */
    async existing(ids: readonly string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const known = new Set((await db.selectFrom('adminium_workspaces').select('id').where('id', 'in', [...new Set(ids)]).execute()).map((row) => row.id));
      return [...new Set(ids)].filter((id) => known.has(id));
    },

    /** The item went: its link rows go with it (there is no FK to cascade). */
    async forgetItem(kind: ShownInKind, itemId: string): Promise<void> {
      await db.deleteFrom('adminium_item_workspaces').where('kind', '=', kind).where('itemId', '=', itemId).execute();
    },

    /**
     * The items a workspace's delete would leave shown nowhere: chosen, and
     * this workspace their only one. They become "chosen, none" — never
     * widened to all.
     */
    async onlyIn(workspaceId: string): Promise<{ kind: ShownInKind; itemId: string }[]> {
      const mine = await db.selectFrom('adminium_item_workspaces').select(['kind', 'itemId']).where('workspaceId', '=', workspaceId).execute();
      const out: { kind: ShownInKind; itemId: string }[] = [];
      for (const link of mine) {
        const others = await db
          .selectFrom('adminium_item_workspaces')
          .select('workspaceId')
          .where('kind', '=', link.kind)
          .where('itemId', '=', link.itemId)
          .where('workspaceId', '!=', workspaceId)
          .executeTakeFirst();
        if (others === undefined) out.push({ kind: link.kind as ShownInKind, itemId: link.itemId });
      }
      return out.sort((a, b) => (a.kind + a.itemId).localeCompare(b.kind + b.itemId));
    },
  };
}

export type WorkspacesRepo = ReturnType<typeof workspacesRepo>;
