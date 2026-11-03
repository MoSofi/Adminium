// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NAMED SURVEY'S INVITATION, AS THE DOOR READS IT: found by the token its
 * link carries (`?t=`), and spent once, by the answer that is sent with it.
 *
 * FINDING ONE ({@link SurveyInvitations.find}). The token is hashed as the
 * mail's link was made (`survey-token.ts`) and looked up in the forms
 * add-on's invitations table, for this survey only. Then:
 *  - no such invitation (a wrong, changed or replaced token, or one for
 *    another survey) → `dead`, "This link doesn't work";
 *  - answered already → `already`;
 *  - its time is up (`expires_at`, else `invited_at` plus the survey's
 *    `stopAfterDays`) → `dead`;
 *  - otherwise `open`, with what the page may say about it: the invitee's
 *    first name, after the name rule, and what the survey is about (the
 *    record the invitation names, by the name its table is known by, read as
 *    the system). Finding one writes nothing: a link scanner that opens it
 *    spends nothing.
 * The record is read only when its table is one a link column points at
 * among the columns an app's `forms` entry opens (the job a feedback row is
 * about): whoever writes invitations names no other row, and the page says
 * nothing of any other ("About" is left out, and no link column is filled;
 * the answer fills only its own "becomes" table's links to it).
 *
 * SPENDING ONE ({@link SurveyInvitations.spend}): `answered_at` set, only
 * while it is still empty, inside the answer's own transaction. Two sends
 * with one token: one sets it, the other changes nothing and is told the
 * survey was answered already.
 */
import { formsOf } from '@adminium/manifest';
import type { Form } from '@adminium/add-on-contracts/forms';
import { sql, type Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { labelColumnFor } from '../crud/labels.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk, parseRecordId } from '../crud/records.js';
import type { WriteTarget } from '../crud/write-service.js';
import { bindWriteValue } from '../crud/write-values.js';
import { instantOf } from '../outbox/survey-link.js';
import type { LiveForm } from './catalog.js';
import { firstNameOf } from './mail.js';
import type { FormsScopes } from './scope.js';
import { SURVEY_TOKEN, surveyTokenHash } from './survey-token.js';

const DAY_MS = 86_400_000;

/** The longest "About …" a page is told: a record's name, cut at a sentence's length. */
const ABOUT_MAX = 200;

/** The record an invitation names, resolved in its database. */
export interface InvitedRecord {
  table: ResolvedTable;
  row: Row;
}

/** An invitation the door may take an answer for. */
export interface OpenInvitation {
  table: ResolvedTable;
  /** Its key, by column. */
  pk: Row;
  /** Its key's one value, for the answer's `invitation_id`. */
  id: unknown;
  row: Row;
  /** The record it is about, when it names one that is still there. */
  record: InvitedRecord | null;
  /** What the page shows: the invitee's first name (after the name rule) and the record's name. */
  firstName: string | null;
  about: string | null;
}

export type InvitationFound = { state: 'open'; invitation: OpenInvitation } | { state: 'already' } | { state: 'dead' };

export interface SurveyInvitationsDeps {
  installs: () => Promise<AddOnInstalls>;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: WriteTarget['dialect'] }>;
  /** The tables the apps open to forms: which tables an invitation's record may be in. */
  scopes: Pick<FormsScopes, 'scopeFor'>;
}

/** Whether a form is a survey answered by invitation only. */
export function isNamedSurvey(form: Form): boolean {
  return form.settings.survey?.mode === 'named';
}

/** A record's name as a page may print it: its table's label column, never a key or a file's id. */
function recordName(view: SnapshotView, record: InvitedRecord): string | null {
  const column = labelColumnFor(view, record.table);
  const value = column === null ? null : record.row[column];
  if (value === null || value === undefined || typeof value === 'object') return null;
  const text = String(value).replace(/\s+/gu, ' ').trim();
  return text === '' ? null : [...text].slice(0, ABOUT_MAX).join('');
}

export function createSurveyInvitations(deps: SurveyInvitationsDeps) {
  /** The add-on's invitations table on the form's database, with the snapshot and the handle; null when it has none. */
  async function invitationsOf(live: Pick<LiveForm, 'connectionId' | 'addOn'>): Promise<{ table: ResolvedTable; view: SnapshotView; db: Kysely<SourceDatabase>; installs: AddOnInstalls } | null> {
    const installs = await deps.installs();
    const installed = installs.installed(live.connectionId, live.addOn);
    const block = installed === null ? null : formsOf(installed.manifest);
    if (block === null || block.invitations === undefined) return null;
    const tableId = installs.tableOf(live.connectionId, live.addOn, block.invitations);
    const view = await deps.viewFor(live.connectionId);
    if (tableId === null || view === null) return null;
    let table: ResolvedTable;
    try {
      table = view.table(tableId);
    } catch {
      return null;
    }
    if (table.primaryKey.length !== 1) return null;
    const { db } = await deps.data(live.connectionId);
    return { table, view, db, installs };
  }

  /**
   * The tables an invitation's record may be in: those a link column points
   * at, among the columns an app's `forms` entry opens on the add-on's
   * database (as an answer fills one). None when no entry opens a link.
   */
  async function linkedTables(live: LiveForm, view: SnapshotView): Promise<ReadonlySet<string>> {
    const out = new Set<string>();
    for (const opened of (await deps.scopes.scopeFor(live.connectionId, live.addOn)).tables.values()) {
      const decided = new Set(opened.entry.decided);
      for (const relation of view.model.relations) {
        if (relation.from.tableId !== opened.tableId || relation.through !== null || relation.from.columns.length !== 1) continue;
        const column = relation.from.columns[0]!;
        if (opened.resource.writable.has(column) && !decided.has(column)) out.add(relation.to.tableId);
      }
    }
    return out;
  }

  /** The record an invitation names (`record_table`, `record_key`), read as the system; null when it names none, it is gone, or its table is not one `linked` holds. */
  async function recordOf(where: { view: SnapshotView; db: Kysely<SourceDatabase>; installs: AddOnInstalls }, connectionId: string, row: Row, linked: ReadonlySet<string>): Promise<InvitedRecord | null> {
    const stored = row['record_table'];
    const key = row['record_key'];
    if (typeof stored !== 'string' || stored === '' || key === null || key === undefined || String(key) === '') return null;
    const tableId = where.installs.tableOfRef(connectionId, stored);
    if (tableId === null || !linked.has(tableId)) return null;
    try {
      const table = where.view.table(tableId);
      const found = await fetchByPk(where.db, table, parseRecordId(table, String(key)));
      return found === undefined ? null : { table, row: found };
    } catch {
      return null;
    }
  }

  return {
    /** The invitation a token opens for this survey (see the header). Nothing is written. */
    async find(live: LiveForm, token: string | null | undefined, now: number): Promise<InvitationFound> {
      if (typeof token !== 'string' || !SURVEY_TOKEN.test(token)) return { state: 'dead' };
      const where = await invitationsOf(live);
      if (where === null) return { state: 'dead' };
      const { table, db } = where;
      const rows = (await db
        .selectFrom(table.id as never)
        .selectAll()
        .where(sql.ref('token_hash'), '=', surveyTokenHash(token) as never)
        .where(sql.ref('form_id'), '=', live.id as never)
        .limit(2)
        .execute()) as Row[];
      // A hash two invitations share cannot say which one it opens.
      if (rows.length !== 1) return { state: 'dead' };
      const row = rows[0]!;
      if (row['answered_at'] !== null && row['answered_at'] !== undefined) return { state: 'already' };
      const stopAfter = live.form.settings.survey?.stopAfterDays ?? 30;
      const invitedAt = instantOf(row['invited_at']);
      const expiresAt = instantOf(row['expires_at']) ?? (invitedAt === null ? null : invitedAt + stopAfter * DAY_MS);
      if (expiresAt === null || expiresAt <= now) return { state: 'dead' };
      const pkColumn = table.primaryKey[0]!;
      const record = await recordOf(where, live.connectionId, row, await linkedTables(live, where.view));
      const name = typeof row['name'] === 'string' ? row['name'] : null;
      return {
        state: 'open',
        invitation: {
          table,
          pk: { [pkColumn]: row[pkColumn] },
          id: row[pkColumn],
          row,
          record,
          firstName: firstNameOf(name),
          about: record === null ? null : recordName(where.view, record),
        },
      };
    },

    /**
     * Marks the invitation answered on `db` (the answer's transaction), only
     * while it is still unanswered. False when another send got there first.
     */
    async spend(db: Kysely<SourceDatabase>, dialect: WriteTarget['dialect'], invitation: OpenInvitation, at: number): Promise<boolean> {
      const column = invitation.table.columns.get('answered_at');
      if (column === undefined) return false;
      let update = db.updateTable(invitation.table.id as never).set({ answered_at: bindWriteValue(column, new Date(at).toISOString(), dialect) } as never);
      for (const [name, value] of Object.entries(invitation.pk)) update = update.where(sql.ref(name), '=', value as never);
      const result = await update.where(sql.ref('answered_at'), 'is', null).executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },
  };
}

export type SurveyInvitations = ReturnType<typeof createSurveyInvitations>;
