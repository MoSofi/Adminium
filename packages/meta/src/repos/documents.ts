// SPDX-License-Identifier: AGPL-3.0-only
/**
 * documentsRepo — adminium_documents (34-invoices-add-on.md §3.3; wave 0031).
 *
 * THE REGISTER: what was issued, frozen. Not `adminium_invoice_documents`,
 * which holds what a person typed and can edit again. A row here carries the
 * whole `subject` it was rendered from, so the document stays what it was
 * after the source row is edited, archived or deleted — which is the only
 * behaviour an issued document can have (25 D12).
 *
 * ─── REDACTION IS A READ MODE, NOT A SECOND QUERY ──────────────────────────
 *
 * A document's `subject` is a frozen copy of somebody's data: a customer's
 * name, their address, what they bought and what it cost. Whether a caller
 * may see that depends on grants over the tables the profile MAPPED — which
 * this repo cannot resolve, because grants live in RBAC and mapped tables
 * live in the profile.
 *
 * So the repo does not decide. It offers `redacted: true` on every read, and
 * the route resolves the grants and asks for the mode it is entitled to. That
 * split matters: a repo that took a caller and resolved grants itself would
 * be a second RBAC implementation, and a repo that always returned everything
 * would leave redaction to whichever route remembered.
 *
 * A REDACTED ROW IS STILL A ROW. It keeps its id, kind, number, status,
 * delivery and timestamps and loses `subject`, `entity` and `claim`. That is
 * deliberate: "three invoices were issued for this order, and you may not read
 * them" is useful and true, while hiding their existence would make the record
 * page lie about what happened.
 */

import type { Kysely, Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { AUDIT_ENTITY_KEY_MAX, type RecordRef } from '../schema/json-payloads.js';
import type { AdminiumDocumentsTable, MetaDB } from '../schema/tables.js';
import { affected, packJson, readJson, readJsonOrNull } from './util.js';

export type DocumentStatus = 'rendered' | 'failed' | 'voided' | 'skipped';

export interface DocumentRow {
  id: string;
  profileId: string | null;
  addOnKey: string;
  kind: string;
  connectionId: string | null;
  /** Null for a request-shaped intent, and null on a REDACTED read. */
  entity: RecordRef | null;
  entityTable: string | null;
  entityId: string | null;
  /** The frozen subject. Absent on a redacted read — never an empty object. */
  subject: Record<string, unknown> | null;
  number: string | null;
  fileId: string | null;
  htmlFileId: string | null;
  locale: string;
  format: string;
  status: DocumentStatus;
  error: string | null;
  delivery: string | null;
  sentAt: number | null;
  jobId: string | null;
  requestedBy: string | null;
  actorKind: string;
  claim: { column: string; value: string } | null;
  renderedAt: number | null;
  voidedAt: number | null;
  voidReason: string | null;
  createdAt: number;
  /** True when this read withheld `subject`, `entity` and `claim`. */
  redacted: boolean;
}

/** The 0016 clamp, applied on the WRITE side and again on the query side. */
function clampKey(value: string): string {
  return value.length > AUDIT_ENTITY_KEY_MAX ? value.slice(0, AUDIT_ENTITY_KEY_MAX) : value;
}

/**
 * A stable string for a `RecordRef`'s primary key.
 *
 * SORTED BY KEY, because `jsonb` reorders object keys on PostgreSQL and MySQL
 * and a composite pk read back from one dialect would not match the same row's
 * key written on another. That is not hypothetical — it is a defect this
 * repository has already met once — so the ordering is imposed here rather
 * than inherited from whatever the driver hands back.
 */
export function entityKeyOf(pk: Readonly<Record<string, unknown>>): string {
  const parts = Object.keys(pk)
    .sort()
    .map((column) => `${column}=${String(pk[column])}`);
  return clampKey(parts.join('|'));
}

function hydrate(row: Selectable<AdminiumDocumentsTable>, redacted: boolean): DocumentRow {
  return {
    id: row.id,
    profileId: row.profileId,
    addOnKey: row.addOnKey,
    kind: row.kind,
    connectionId: row.connectionId,
    entity: redacted ? null : readJsonOrNull<RecordRef>(row.entity),
    entityTable: row.entityTable,
    entityId: row.entityId,
    subject: redacted ? null : readJson<Record<string, unknown>>(row.subject),
    number: row.number,
    fileId: row.fileId,
    htmlFileId: row.htmlFileId,
    locale: row.locale,
    format: row.format,
    status: row.status as DocumentStatus,
    error: row.error,
    delivery: row.delivery,
    sentAt: row.sentAt,
    jobId: row.jobId,
    requestedBy: row.requestedBy,
    actorKind: row.actorKind,
    claim: redacted ? null : readJsonOrNull<{ column: string; value: string }>(row.claim),
    renderedAt: row.renderedAt,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
    redacted,
  };
}

export interface CreateDocumentInput {
  profileId: string | null;
  addOnKey: string;
  kind: string;
  connectionId: string | null;
  entity: RecordRef | null;
  subject: Record<string, unknown>;
  locale: string;
  format: string;
  requestedBy?: string | null | undefined;
  actorKind?: string | undefined;
  jobId?: string | null | undefined;
  claim?: { column: string; value: string } | null | undefined;
  delivery?: string | null | undefined;
}

/** Optional fields carry `| undefined`; see `CreateDocumentProfileInput`. */
export interface ListDocumentsFilter {
  entityTable?: string | undefined;
  entityId?: string | undefined;
  profileId?: string | undefined;
  addOnKey?: string | undefined;
  /** Claim-visible rows only — the public surface's read. */
  claim?: { column: string; value: string } | undefined;
  requestedBy?: string | undefined;
  limit?: number | undefined;
}

export function documentsRepo(meta: MetaDb) {
  const db = meta.db as unknown as Kysely<MetaDB>;

  async function findById(id: string, opts: { redacted?: boolean } = {}): Promise<DocumentRow | null> {
    const row = await db
      .selectFrom('adminium_documents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? null : hydrate(row, opts.redacted ?? false);
  }

  async function list(
    filter: ListDocumentsFilter = {},
    opts: { redacted?: boolean } = {},
  ): Promise<DocumentRow[]> {
    let query = db.selectFrom('adminium_documents').selectAll();
    if (filter.entityTable !== undefined) {
      query = query.where('entityTable', '=', clampKey(filter.entityTable));
    }
    if (filter.entityId !== undefined) query = query.where('entityId', '=', clampKey(filter.entityId));
    if (filter.profileId !== undefined) query = query.where('profileId', '=', filter.profileId);
    if (filter.addOnKey !== undefined) query = query.where('addOnKey', '=', filter.addOnKey);
    if (filter.requestedBy !== undefined) query = query.where('requestedBy', '=', filter.requestedBy);

    const rows = await query
      .orderBy('createdAt', 'desc')
      .limit(Math.min(filter.limit ?? 100, 500))
      .execute();

    const hydrated = rows.map((row) => hydrate(row, opts.redacted ?? false));
    if (filter.claim === undefined) return hydrated;

    /*
     * THE CLAIM MATCH IS DONE IN MEMORY, ON PURPOSE.
     *
     * A claim lives inside a json column, and matching it in SQL would mean a
     * json path expression written three ways for three dialects — the exact
     * portability trap the sequence's CAS avoided. The set being filtered is
     * already bounded by the query above, and a public caller's claim is one
     * value, so the cost is a scan of at most `limit` rows.
     *
     * The claim is read from the UNREDACTED row regardless of the read mode:
     * a caller that may not see the subject can still be the owner of the
     * claim, which is exactly the public surface's case.
     */
    const wanted = filter.claim;
    return hydrated.filter((_, at) => {
      const claim = readJsonOrNull<{ column: string; value: string }>(rows[at]!.claim);
      return claim !== null && claim.column === wanted.column && claim.value === wanted.value;
    });
  }

  async function create(input: CreateDocumentInput, at = Date.now()): Promise<DocumentRow> {
    const entityTable = input.entity === null ? null : clampKey(input.entity.table);
    const entityId = input.entity === null ? null : entityKeyOf(input.entity.pk);
    const row = {
      id: newId('doc'),
      profileId: input.profileId,
      addOnKey: input.addOnKey,
      kind: input.kind,
      connectionId: input.connectionId,
      entity: input.entity === null ? null : packJson(input.entity),
      entityTable,
      entityId,
      subject: packJson(input.subject),
      number: null,
      fileId: null,
      htmlFileId: null,
      locale: input.locale,
      format: input.format,
      // A row exists before its bytes do. `failed` is where a render that
      // never finishes stops, which is why the status starts here rather than
      // at `rendered` — nothing may look successful before it has succeeded.
      status: 'failed' as const,
      error: null,
      delivery: input.delivery ?? null,
      sentAt: null,
      jobId: input.jobId ?? null,
      requestedBy: input.requestedBy ?? null,
      actorKind: input.actorKind ?? 'system',
      claim: input.claim == null ? null : packJson(input.claim),
      renderedAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: at,
    };
    await db.insertInto('adminium_documents').values(row).execute();
    return (await findById(row.id))!;
  }

  /**
   * Mark a render successful and attach its bytes.
   *
   * `number` is passed in rather than claimed here: the sequence is claimed
   * only after the provider has returned bytes (D11), so a failed render
   * burns no number, and this repo never touches the sequence at all.
   */
  async function markRendered(
    id: string,
    input: {
      number: string | null;
      fileId: string | null;
      htmlFileId: string | null;
      format: string;
      delivery?: string | null;
    },
    at = Date.now(),
  ): Promise<DocumentRow | null> {
    const values: Record<string, unknown> = {
      status: 'rendered',
      error: null,
      number: input.number,
      fileId: input.fileId,
      htmlFileId: input.htmlFileId,
      format: input.format,
      renderedAt: at,
    };
    if (input.delivery !== undefined) values.delivery = input.delivery;
    const rows = await db
      .updateTable('adminium_documents')
      .set(values as never)
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  async function markFailed(id: string, error: string): Promise<DocumentRow | null> {
    const rows = await db
      .updateTable('adminium_documents')
      .set({ status: 'failed', error: error.slice(0, 2000) } as never)
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  /**
   * Void a document, keeping every byte of it.
   *
   * VOID, NEVER DELETE. An issued document that turned out to be wrong is
   * still a thing that was issued; the correction is a credit note, not an
   * erasure. So the row keeps its number, its subject and its files, and
   * gains a reason — `source-undone` when the write it came from was taken
   * back inside the undo window, or an operator's own.
   */
  async function markVoided(
    id: string,
    reason: string,
    at = Date.now(),
  ): Promise<DocumentRow | null> {
    const rows = await db
      .updateTable('adminium_documents')
      .set({ status: 'voided', voidReason: reason.slice(0, 40), voidedAt: at } as never)
      .where('id', '=', id)
      // A document already voided stays as it was: the FIRST reason is the
      // true one, and a second void would overwrite it with a later story.
      .where('status', '!=', 'voided')
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  /**
   * Bind a drawn document to the claim that asked for it (34 §7.6).
   *
   * SEPARATE from `create`, and called last, because a document that failed to
   * draw must not be claimable: a `failed` row a customer can list turns "your
   * invoice could not be made" from a sentence the operator says into a status
   * a stranger discovers.
   */
  async function stampClaim(
    id: string,
    claim: { column: string; value: string },
  ): Promise<DocumentRow | null> {
    const rows = await db
      .updateTable('adminium_documents')
      .set({ claim: packJson(claim) } as never)
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  async function markDelivery(
    id: string,
    delivery: string,
    at: number | null = Date.now(),
  ): Promise<DocumentRow | null> {
    const rows = await db
      .updateTable('adminium_documents')
      .set({ delivery, sentAt: delivery === 'sent' ? at : null } as never)
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  /** Every rendered document for one source row — the record page's panel. */
  async function listForEntity(
    entity: { table: string; pk: Readonly<Record<string, unknown>> },
    opts: { redacted?: boolean } = {},
  ): Promise<DocumentRow[]> {
    return await list(
      { entityTable: entity.table, entityId: entityKeyOf(entity.pk) },
      opts,
    );
  }

  /** Rows older than `before` whose bytes may be swept (`retention.documentsDays`). */
  async function listExpiredBefore(before: number, limit = 100): Promise<DocumentRow[]> {
    const rows = await db
      .selectFrom('adminium_documents')
      .selectAll()
      .where('createdAt', '<', before)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .execute();
    return rows.map((row) => hydrate(row, false));
  }

  return {
    findById,
    list,
    listForEntity,
    listExpiredBefore,
    create,
    markRendered,
    markFailed,
    markVoided,
    markDelivery,
    stampClaim,
  };
}

export type DocumentsRepo = ReturnType<typeof documentsRepo>;
