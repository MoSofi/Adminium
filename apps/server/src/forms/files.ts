// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S FILES: what the upload store (`public-uploads/store.ts`) is to a
 * forms add-on.
 *
 * A file a stranger picks for a file question is taken for that form (the
 * binding `form` + `<add-on>/<form id>`, and the stranger's address). The
 * answer that names it attaches it ({@link FormsFiles.attachToAnswer}, the
 * answer door's to call): the store's row then names the answer as its
 * owner, and the add-on's `files` table (when it names one) gets a row per
 * file with the answer's key, the question, the name, size and kind, and the
 * upload's id as `file_id` — what staff open it by
 * (`GET /api/v1/forms/files/:id`).
 *
 * REMOVED WITH ITS ANSWER, by whichever door the answer goes:
 *  - staff delete an answer (the data routes, one or many): the add-on's file
 *    rows let go of it in the delete's own statement ({@link FormsFiles.releasing},
 *    so the database lets the answer go), then its files go after
 *    ({@link FormsFiles.onRecordEvent});
 *  - a form is deleted: every file taken for it goes, attached or not;
 *  - an erasure or a keeping sweep that deletes answers itself calls
 *    {@link FormsFiles.removeAnswerFiles}, before or after the answers go.
 * Every removal here is best effort and never throws: it runs after the
 * row's own write committed, and a file left behind is logged.
 */
import { randomUUID } from 'node:crypto';

import { formsOf, type AddOnManifest } from '@adminium/manifest';
import type { PublicUpload, PublicUploadBinding } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { DataHandle } from '../connections/manager.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import type { ReleasedLink } from '../outbox/release.js';
import type { PublicUploads } from '../public-uploads/store.js';
import type { LiveForm } from './catalog.js';

/** What a form's files are taken for. */
export const FORM_UPLOAD_KIND = 'form';

/** A megabyte as a file question's `maxMb` counts it. */
export const FORM_FILE_MB = 1024 * 1024;

/** The key a form's files are bound to: its add-on and its own row. */
export function formUploadKey(live: Pick<LiveForm, 'addOn' | 'id'>): string {
  return `${live.addOn}/${live.id}`;
}

/** One forms add-on's tables on one connection, by id, with their key columns. */
export interface FormsTables {
  connectionId: string;
  addOn: string;
  forms: string;
  formsKey: string;
  answers: string;
  answersKey: string;
  /** The add-on's files table and its key, when it names one; `fill` when Adminium makes the key (an `id` or a `uuid`). */
  files: { table: string; key: string; fill: boolean } | null;
}

/** The primary-key column of one of the add-on's own tables, by the manifest. */
function primaryKeyOf(manifest: AddOnManifest, ref: string): string | null {
  return primaryColumnOf(manifest, ref)?.ref ?? null;
}

function primaryColumnOf(manifest: AddOnManifest, ref: string): { ref: string; type: string } | null {
  const table = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
  return table?.columns.find((column) => column.role === 'pk') ?? null;
}

/** Every forms add-on installed on a connection, with its tables as they stand. */
export function formsTablesOn(installs: AddOnInstalls, connectionId: string): FormsTables[] {
  const out: FormsTables[] = [];
  for (const key of installs.keys?.(connectionId) ?? []) {
    const installed = installs.installed(connectionId, key);
    const block = installed === null ? null : formsOf(installed.manifest);
    if (installed === null || block === null) continue;
    const forms = installs.tableOf(connectionId, key, block.forms);
    const answers = installs.tableOf(connectionId, key, block.answers);
    const formsKey = primaryKeyOf(installed.manifest, block.forms);
    const answersKey = primaryKeyOf(installed.manifest, block.answers);
    if (forms === null || answers === null || formsKey === null || answersKey === null) continue;
    const filesTable = block.files === undefined ? null : installs.tableOf(connectionId, key, block.files);
    const filesKey = block.files === undefined ? null : primaryColumnOf(installed.manifest, block.files);
    out.push({
      connectionId,
      addOn: key,
      forms,
      formsKey,
      answers,
      answersKey,
      // A key the database counts is left to it; an `id` or a `uuid` key is made here, as a save makes one.
      files: filesTable === null || filesKey === null ? null : { table: filesTable, key: filesKey.ref, fill: filesKey.type === 'id' || filesKey.type === 'uuid' },
    });
  }
  return out;
}

/** The files one file question's answer names. */
export interface QuestionFiles {
  question: string;
  ids: readonly string[];
}

export interface FormsFilesDeps {
  uploads: PublicUploads;
  /** What is installed where, read fresh (`keepAddOnInstalls`). */
  installs: () => Promise<AddOnInstalls>;
  data: (connectionId: string) => Promise<Pick<DataHandle, 'db' | 'dialect'>>;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined;
}

/**
 * A moment as a `timestamptz` column is written: the ISO instant, and on
 * MySQL (a `TIMESTAMP`, its sessions pinned to UTC) its UTC wall time.
 */
function instantOn(dialect: DataHandle['dialect'], at: number): string {
  const iso = new Date(at).toISOString();
  return dialect === 'mysql' ? iso.slice(0, 23).replace('T', ' ') : iso;
}

export function createFormsFiles(deps: FormsFilesDeps) {
  const warn = (fields: Record<string, unknown>, message: string) => deps.log?.warn(fields, message);

  async function tablesOf(connectionId: string, addOn: string): Promise<FormsTables | null> {
    return formsTablesOn(await deps.installs(), connectionId).find((one) => one.addOn === addOn) ?? null;
  }

  /** The add-on's file rows of these uploads (and of these answers), deleted. */
  async function dropFileRows(tables: FormsTables, uploadIds: readonly string[], answerKeys: readonly string[]): Promise<void> {
    if (tables.files === null || (uploadIds.length === 0 && answerKeys.length === 0)) return;
    const { db } = await deps.data(tables.connectionId);
    const files = tables.files;
    await db
      .deleteFrom(files.table)
      .where((eb) =>
        eb.or([
          ...(uploadIds.length === 0 ? [] : [eb(db.dynamic.ref('file_id'), 'in', [...uploadIds])]),
          ...(answerKeys.length === 0 ? [] : [eb(db.dynamic.ref('answer_id'), 'in', [...answerKeys])]),
        ]),
      )
      .execute();
  }

  /**
   * Every file of these answers of one forms add-on: the add-on's file rows,
   * then the bytes, the file rows and the store's rows. Before or after the
   * answers themselves go. Never throws; answers how many files went.
   */
  async function removeAnswerFiles(connectionId: string, addOn: string, answerKeys: readonly string[]): Promise<number> {
    if (answerKeys.length === 0) return 0;
    try {
      const tables = await tablesOf(connectionId, addOn);
      if (tables === null) return 0;
      const owned = await deps.uploads.list(connectionId, tables.answers, answerKeys);
      await dropFileRows(tables, owned.map((upload) => upload.id), answerKeys);
      return await deps.uploads.removeOwned(connectionId, tables.answers, answerKeys);
    } catch (error) {
      warn({ err: error, connectionId, addOn }, 'forms: an answer’s files could not be removed');
      return 0;
    }
  }

  /** Every file taken for one form, attached or not. Never throws. */
  async function removeFormFiles(connectionId: string, addOn: string, formId: string): Promise<number> {
    try {
      const tables = await tablesOf(connectionId, addOn);
      const bound = await deps.uploads.listBound(FORM_UPLOAD_KIND, formUploadKey({ addOn, id: formId }));
      if (tables !== null) await dropFileRows(tables, bound.map((upload) => upload.id), []);
      return await deps.uploads.removeBound(FORM_UPLOAD_KIND, formUploadKey({ addOn, id: formId }));
    } catch (error) {
      warn({ err: error, connectionId, addOn }, 'forms: a form’s files could not be removed');
      return 0;
    }
  }

  /** The binding of a file taken for `live` from `ip`: what the upload route stores and the answer door attaches with. */
  function bindingOf(live: Pick<LiveForm, 'addOn' | 'id'>, ip: string): PublicUploadBinding {
    return deps.uploads.bindingOf(FORM_UPLOAD_KIND, formUploadKey(live), ip);
  }

  return {
    removeAnswerFiles,
    removeFormFiles,
    bindingOf,

    /**
     * Attach the files an answer names to it, and write them into the
     * add-on's files table (`db`: the answer's own transaction, when the door
     * has one, as `on`). Every id must have been taken for this form from this
     * address, unattached and in time, and be of a kind and a size the
     * question it is named under takes (a file is uploaded for one question
     * and may be named under another), or nothing is attached and the answer
     * must be refused (`null`). The door calls this after the answer row is
     * written; if the answer then does not stand, {@link detachAnswer}.
     */
    async attachToAnswer(input: { live: LiveForm; ip: string; answerKey: string; files: readonly QuestionFiles[]; on?: Pick<DataHandle, 'db' | 'dialect'> }): Promise<PublicUpload[] | null> {
      const ids = input.files.flatMap((one) => [...one.ids]);
      if (ids.length === 0) return [];
      const tables = await tablesOf(input.live.connectionId, input.live.addOn);
      if (tables === null) return null;
      const owner = { connectionId: tables.connectionId, table: tables.answers, key: input.answerKey };
      const attached = await deps.uploads.attach(ids, bindingOf(input.live, input.ip), owner);
      if (attached === null) return null;
      // Each file judged again by the question it is named under: its kinds, and its size cap.
      const byUpload = new Map(attached.map((upload) => [upload.id, upload]));
      const fits = input.files.every((one) => {
        const question = input.live.form.definition.questions.find((candidate) => candidate.id === one.question);
        if (question === undefined || question.kind !== 'file') return false;
        return one.ids.every((id) => {
          const upload = byUpload.get(id);
          return upload !== undefined && (question.kinds as readonly string[]).includes(upload.kind) && upload.size <= question.maxMb * FORM_FILE_MB;
        });
      });
      if (!fits) {
        await deps.uploads.detach(ids, owner);
        return null;
      }
      if (tables.files !== null) {
        const byId = new Map(attached.map((upload) => [upload.id, upload]));
        try {
          const on = input.on ?? (await deps.data(tables.connectionId));
          for (const one of input.files) {
            for (const id of one.ids) {
              const upload = byId.get(id)!;
              const row = { ...(tables.files.fill ? { [tables.files.key]: randomUUID() } : {}), answer_id: input.answerKey, file_id: id, question: one.question, name: upload.name ?? 'file', size: upload.size, kind: upload.kind, uploaded_at: instantOn(on.dialect, upload.createdAt), expires_at: null };
              await on.db.insertInto(tables.files.table).values(row as never).execute();
            }
          }
        } catch (error) {
          await deps.uploads.detach(ids, owner);
          throw error;
        }
      }
      return attached;
    },

    /** Let go of an answer's files when its write did not stand: unattached again, for their stranger to send once more. */
    async detachAnswer(live: Pick<LiveForm, 'connectionId' | 'addOn'>, answerKey: string, ids: readonly string[]): Promise<number> {
      const tables = await tablesOf(live.connectionId, live.addOn);
      if (tables === null) return 0;
      return deps.uploads.detach(ids, { connectionId: tables.connectionId, table: tables.answers, key: answerKey });
    },

    /**
     * Whether a table is an installed forms add-on's answers or files table
     * on this database: rows Adminium alone writes (staff read and delete
     * them), which the write service refuses a person's create or change of.
     */
    async ownTable(connectionId: string, tableId: string): Promise<boolean> {
      return formsTablesOn(await deps.installs(), connectionId).some((one) => one.answers === tableId || one.files?.table === tableId);
    },

    /**
     * The links that let go of an answer as it is removed: its rows in the
     * add-on's files table lose their `answer_id` in the delete's own
     * statement (`outbox/release.ts`), so the database lets the answer go;
     * the files themselves go after ({@link onRecordEvent}).
     */
    async releasing(connectionId: string, tableId: string): Promise<ReleasedLink[]> {
      const tables = formsTablesOn(await deps.installs(), connectionId).find((one) => one.answers === tableId && one.files !== null);
      if (tables === undefined || tables.files === null) return [];
      return [{ outbox: tables.files.table, key: tables.files.key, link: 'answer_id' }];
    },

    /** A row removed: an answer's files go with it, and a form's with the form. Never throws. */
    async onRecordEvent(event: RecordWriteEvent): Promise<void> {
      if (event.action !== 'delete') return;
      let tables: FormsTables | undefined;
      try {
        tables = formsTablesOn(await deps.installs(), event.connectionId).find((one) => one.answers === event.table.id || one.forms === event.table.id);
      } catch (error) {
        warn({ err: error }, 'forms: what is installed could not be read');
        return;
      }
      if (tables === undefined) return;
      const pk = event.entity.pk as Record<string, unknown>;
      if (tables.answers === event.table.id) {
        const key = pk[tables.answersKey];
        if (key !== null && key !== undefined) await removeAnswerFiles(tables.connectionId, tables.addOn, [String(key)]);
        return;
      }
      const key = pk[tables.formsKey];
      if (key !== null && key !== undefined) await removeFormFiles(tables.connectionId, tables.addOn, String(key));
    },

    /** The forms add-on whose answers table owns a file, or null when no answer of a forms add-on does. */
    async answersOf(connectionId: string, tableId: string): Promise<FormsTables | null> {
      return formsTablesOn(await deps.installs(), connectionId).find((one) => one.answers === tableId) ?? null;
    },
  };
}

export type FormsFiles = ReturnType<typeof createFormsFiles>;
