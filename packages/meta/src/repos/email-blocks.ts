// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailBlocksRepo — adminium_email_blocks (39-email-templates-and-campaigns.md
 * §3.2): the editor's "Save as reusable block" shelf, workspace-wide.
 *
 * A saved block is one `{ id, block, data, style }` record, stored as the
 * open envelope `emailBlocksSchema` uses for a document's blocks — the repo
 * validates that it is a record with a `block` kind and nothing more, for the
 * same reason the templates repo never validates block bodies. The editor
 * clones it with a fresh id on insert (comp `addSaved`, 1347-1352), so the
 * stored id is never the one a document ends up holding.
 */

import type { Selectable } from 'kysely';
import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumEmailBlocksTable } from '../schema/tables.js';
import { affected, packJson, readJson } from './util.js';

/** A record whose `block` names a kind; the rest is the editor's. */
export const savedEmailBlockSchema = z
  .object({ block: z.string().min(1).max(60) })
  .catchall(z.unknown());

export interface SavedEmailBlock {
  id: string;
  name: string;
  block: Record<string, unknown>;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSavedEmailBlockInput {
  name: string;
  block: Record<string, unknown>;
  createdBy?: string | null | undefined;
}

function decode(row: Selectable<AdminiumEmailBlocksTable>): SavedEmailBlock {
  return {
    id: row.id,
    name: row.name,
    block: savedEmailBlockSchema.parse(readJson(row.block)) as Record<string, unknown>,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function emailBlocksRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<SavedEmailBlock | null> {
    const row = await db.selectFrom('adminium_email_blocks').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    /** Newest first — the picker's "Saved blocks" group shows what was just saved on top. */
    async list(): Promise<SavedEmailBlock[]> {
      const rows = await db
        .selectFrom('adminium_email_blocks')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(decode);
    },

    async create(input: CreateSavedEmailBlockInput, at: number = Date.now()): Promise<SavedEmailBlock> {
      const id = newId('ebk');
      const block = savedEmailBlockSchema.parse(input.block) as Record<string, unknown>;
      await db
        .insertInto('adminium_email_blocks')
        .values({
          id,
          name: input.name,
          block: packJson(block),
          createdBy: input.createdBy ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .execute();
      return { id, name: input.name, block, createdBy: input.createdBy ?? null, createdAt: at, updatedAt: at };
    },

    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_email_blocks').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },
  };
}

export type EmailBlocksRepo = ReturnType<typeof emailBlocksRepo>;
