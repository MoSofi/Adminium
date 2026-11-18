// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QUESTION LEFT OUTSIDE HOURS, AND THE ROW IT BECOMES.
 *
 * Outside hours nobody is in, so a visitor may leave a question with their
 * e-mail. It always becomes a conversation waiting for a person, marked
 * outside hours. When an app the chat add-on is attached to opens a table to
 * it (a `publicAccess` entry under the reserved key `chat`, as the CRM's
 * enquiries), it also becomes a new row of that table, exactly as a form's
 * answer becomes one (`forms/answer.ts` step 5, `forms/scope.ts`):
 *
 *  - only a table that entry opens, only its `writable` columns, with its
 *    `defaults` over whatever the visitor typed (the CRM's source `chat`),
 *    its plain-text rule and its anonymous limits, as origin `public`;
 *  - a create only, in the same transaction as the conversation, which links
 *    to it (`became_table`, `became_key`); neither is kept without the other;
 *  - refused (a plain-text rule, a limit, a value it must be given), nothing
 *    is written, and the visitor is told which field.
 *
 * A chat entry has no map of its own, so the row's columns are found by
 * name among the entry's `writable` ones: the question goes into the first of
 * `message`, `text`, `question` or `body`; the name into `name` or `person`;
 * the e-mail into `email`. An entry with none of the question's columns is
 * the app's to fix: the question is kept as a conversation alone, and logged.
 *
 * When several apps open a table to the chat, the first by app and table
 * name takes it. No mail is ever sent to the address the visitor typed.
 */
import { formMarksRepo, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService, WriteContext, WriteTarget } from '../crud/write-service.js';
import { ValidationFailedError } from '../errors.js';
import type { FormsScopes, FormsTable } from '../forms/scope.js';
import { appPartIsOn } from '../rbac/app-parts.js';
import { capKey } from '../public-api/anonymous-caps.js';
import { createPublicRow } from '../public-api/create-row.js';
import type { Switches } from '../public-api/switches.js';
import { prepareValues } from '../public-api/values.js';
import type { LiveChat } from './catalog.js';

/** The columns a question, a name and an e-mail go into, first found first. */
export const QUESTION_COLUMNS = ['message', 'text', 'question', 'body'] as const;
export const NAME_COLUMNS = ['name', 'person'] as const;
export const EMAIL_COLUMNS = ['email'] as const;

/** What the visitor left. */
export interface LeftQuestion {
  question: string;
  name: string | null;
  email: string;
  language: string;
}

/** Which of the visitor's fields a refused column came from. */
export type QuestionField = 'question' | 'name' | 'email';

export type BecomeOutcome =
  /** No table is opened to the chat, or the entry cannot be honoured: the conversation alone. */
  | { state: 'none' }
  | { state: 'made'; row: Row; table: string; key: string }
  | { state: 'refused'; errors: Partial<Record<QuestionField, string>> }
  | { state: 'limit' }
  /** The part of the app the entry belongs to is off, or a setting it needs: the conversation alone. */
  | { state: 'closed' };

export interface ChatQuestionDeps {
  meta: MetaDb;
  secret: string;
  scopes: FormsScopes;
  installs: () => Promise<AddOnInstalls>;
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: WriteTarget['dialect'] }>;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  writes: RecordWriteService;
  switches: Pick<Switches, 'isOn'>;
}

/** A refused write, by the columns named. */
class QuestionRefused extends Error {
  constructor(readonly columns: readonly string[]) {
    super('That question was refused.');
  }
}

/** The first of `names` the entry opens, or null. */
function columnFor(opened: FormsTable, names: readonly string[]): string | null {
  return names.find((name) => opened.resource.writable.has(name) && !opened.entry.decided.includes(name)) ?? null;
}

/** The table a chat's question becomes a row of: the first opened to it, by app and table. */
export async function questionTable(scopes: FormsScopes, chat: Pick<LiveChat, 'connectionId' | 'addOn'>): Promise<FormsTable | null> {
  const scope = await scopes.scopeFor(chat.connectionId, chat.addOn);
  const first = [...scope.byRef.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  return first?.[1] ?? null;
}

/**
 * Makes the row a question becomes, and runs `beside` in the same
 * transaction with it (the conversation, linked to the row). With no table
 * opened to the chat, nothing here is written and `beside` is not run: the
 * caller writes the conversation alone.
 */
export async function becomeRow(
  deps: ChatQuestionDeps,
  request: FastifyRequest,
  chat: LiveChat,
  left: LeftQuestion,
  beside: (db: Kysely<SourceDatabase>, became: { table: string; key: string }) => Promise<void>,
  at: number,
): Promise<BecomeOutcome> {
  const opened = await questionTable(deps.scopes, chat);
  if (opened === null) return { state: 'none' };
  const broken = (why: string): BecomeOutcome => {
    request.log.warn({ addOn: chat.addOn, app: opened.appKey, table: opened.ref, why }, 'chat door: the table opened to the chat cannot take a question; it is kept as a conversation alone');
    return { state: 'none' };
  };
  if (!(await appPartIsOn(deps.meta, opened.appKey, opened.entry.module ?? null, { installId: opened.installId, connectionId: opened.connectionId }))) return { state: 'closed' };
  for (const setting of opened.entry.requireSetting) {
    if (!(await deps.switches.isOn(opened.connectionId, setting.table, setting.column, setting.in))) return { state: 'closed' };
  }
  const view = await deps.viewFor(opened.connectionId);
  if (view === null) return broken('the database has no snapshot');
  let table;
  try {
    table = view.table(opened.tableId);
  } catch {
    return broken('the table is not in the snapshot');
  }
  const questionColumn = columnFor(opened, QUESTION_COLUMNS);
  if (questionColumn === null) return broken(`the entry opens none of ${QUESTION_COLUMNS.join(', ')}`);
  const nameColumn = columnFor(opened, NAME_COLUMNS);
  const emailColumn = columnFor(opened, EMAIL_COLUMNS);
  const fedBy = new Map<string, QuestionField>([[questionColumn, 'question']]);
  const raw: Row = { [questionColumn]: left.question };
  if (nameColumn !== null) {
    fedBy.set(nameColumn, 'name');
    if (left.name !== null) raw[nameColumn] = left.name;
  }
  if (emailColumn !== null) {
    fedBy.set(emailColumn, 'email');
    raw[emailColumn] = left.email;
  }
  // A link column is never filled by a visitor: a stranger never names another row.
  const links = new Set(view.model.relations.filter((relation) => relation.from.tableId === table.id && relation.through === null).flatMap((relation) => [...relation.from.columns]));
  for (const column of Object.keys(raw)) if (links.has(column)) return broken(`"${column}" links to another row`);

  const { db, dialect } = await deps.data(opened.connectionId);
  // The entry's own rules: only its writable columns and values, then its defaults over whatever the visitor typed.
  const values = prepareValues(opened.resource, raw, null, 'create', dialect, table.columns);
  if (values === null) return broken('a value is not one the entry takes');
  const missing = (opened.resource.requires ?? []).find((column) => values[column] === null || values[column] === undefined || (typeof values[column] === 'string' && (values[column] as string).trim() === ''));
  if (missing !== undefined) {
    const field = fedBy.get(missing);
    return field === undefined ? broken(`"${missing}" is required and nothing fills it`) : { state: 'refused', errors: { [field]: 'required' } };
  }

  const target: WriteTarget = { connectionId: opened.connectionId, view, table, db, dialect };
  const context: WriteContext = {
    origin: 'public',
    hops: 0,
    actor: { kind: 'public', id: null, label: `Chat: ${chat.name}`.slice(0, 200) },
    request,
    claimed: null,
    provedAddress: null,
    adjust: { locale: left.language.replace('-', '_') },
  };
  const installs = await deps.installs();
  const refused = (columns: readonly string[]): Partial<Record<QuestionField, string>> => {
    const errors: Partial<Record<QuestionField, string>> = {};
    for (const column of columns) {
      const field = fedBy.get(column);
      if (field !== undefined) errors[field] = 'text';
    }
    return Object.keys(errors).length > 0 ? errors : { question: 'text' };
  };
  let key = '';
  try {
    const made = await createPublicRow({
      app: request.server as FastifyInstance,
      writes: deps.writes,
      // The forms door's marks, read as the public door reads its markers: a chat answers nobody's key.
      challenges: formMarksRepo(deps.meta),
      capKey: capKey(deps.secret),
      target,
      values,
      context,
      caps: opened.resource.anonymous,
      // The app's limits, counted for every chat that writes through its entry.
      charge: { keyId: `chat:${opened.appKey}`, ref: opened.resource.ref, ip: request.ip },
      mapError: (error) => {
        const fields = error instanceof ValidationFailedError ? (error.details as { fields?: Record<string, unknown> } | undefined)?.fields : undefined;
        throw new QuestionRefused(fields === undefined ? [] : Object.keys(fields));
      },
      // The row and the conversation in one transaction: neither is kept without the other.
      run: async ({ create, announce }) => {
        let row: Row | null = null;
        const written = await deps.writes.transaction(target, [values], async (tdb) => {
          const one = await create({ ...target, db: tdb }, async (made) => {
            row = made;
          });
          key = table.primaryKey.length === 1 ? String(one[table.primaryKey[0]!]) : JSON.stringify(table.primaryKey.map((column) => one[column]));
          await beside(tdb, { table: installs.refOf(opened.connectionId, opened.tableId), key });
          return one;
        });
        if (row !== null) await announce(row);
        return written;
      },
      now: at,
    });
    if (!made.ok && made.why === 'plain-text') return { state: 'refused', errors: refused([made.column]) };
    if (!made.ok) return { state: 'limit' };
    return { state: 'made', row: made.row, table: installs.refOf(opened.connectionId, opened.tableId), key };
  } catch (error) {
    if (error instanceof QuestionRefused) return { state: 'refused', errors: refused(error.columns) };
    throw error;
  }
}
