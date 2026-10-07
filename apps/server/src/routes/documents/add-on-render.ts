// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /add-ons/:key/documents/render` — AN ADD-ON'S OWN PAGE ASKS FOR A
 * DOCUMENT.
 *
 * The twin of the app's route beside it: a page of an add-on that keeps
 * tables of its own (a purchase order, a count sheet) names what it knows —
 * its own short name for the table, the row's key, the kind, and optionally
 * the paper — and is handed where the bytes are. The document is the
 * add-on's own profile for that kind on that table, drawn now, or the one
 * already drawn while the row is unchanged.
 *
 * The record page's rule, exactly: signed in, and able to read every table
 * the document reads and every column it prints. Anything that is not there
 * or not theirs is the one 404; a document that is switched off is said as
 * such (409 FEATURE_OFF); a paper the kind does not list is refused by name
 * (400 DOCUMENT_VALUE_REFUSED, slot `paper`).
 */
import type { Manifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type DocumentProfile, type DocumentRow, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readViewFor } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { appProfileFor, ownedDocumentOff } from '../../documents/app-documents.js';
import { renderDocument, type RenderDeps } from '../../documents/render.js';
import { AppError } from '../../errors.js';
import { canReadTableFor } from '../../rbac/table-grants.js';
import { recordKeyOf } from '../public/documents.js';
import { appDocumentRenderReply } from './schema.js';

export const addOnDocumentParams = z.object({ key: z.string().min(1).max(80) }).strict();

export const addOnDocumentRenderBody = z
  .object({
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(40),
    /** The add-on's own short name for the table (`purchase_orders`), not the real one. */
    table: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
    /** The row's key. */
    key: z.union([z.string().min(1).max(200), z.number()]),
    /** The paper to draw on: one the kind lists. Absent: the profile's, else the kind's first. */
    paper: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(40).optional(),
    locale: z.string().max(35).optional(),
    /** Values for slots the profile lets a request fill, by slot id. */
    values: z.record(z.string().max(64), z.union([z.string().max(400), z.number(), z.boolean()])).optional(),
  })
  .strict();

export interface AddOnRenderDeps {
  meta: MetaDb;
  runtime: () => AddOnRuntimeState | null;
  pipeline?: RenderDeps | undefined;
}

/** What the documents routes already know how to do, handed over rather than written twice. */
export interface AddOnRenderHelpers {
  apiPrefix: string;
  notFound(): never;
  /** Every table a document of this profile reads. */
  documentReads(profile: DocumentProfile, viewOf: () => Promise<SnapshotView | null>): Promise<readonly string[]>;
  /** A table whose column the document prints and this reader's view hides, or null. */
  documentColumnRefused(profile: DocumentProfile, view: SnapshotView): string | null;
  toReply(row: DocumentRow): z.infer<typeof appDocumentRenderReply>['document'];
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('documents never store a credential');
  },
  decrypt: (): string => {
    throw new Error('documents never read a credential');
  },
};

/**
 * The add-on's own profile for a kind on one of its tables, the table as it
 * stands here, and the row's key — or the one 404 for anything that is not
 * there. Shared with the door that draws a document kept nowhere.
 */
export async function addOnDocumentFor(
  deps: Pick<AddOnRenderDeps, 'meta'>,
  helpers: Pick<AddOnRenderHelpers, 'notFound'>,
  input: { addOnKey: string; table: string; kind: string; key: string | number },
): Promise<{ manifest: Manifest; connectionId: string; view: SnapshotView; tableId: string; profile: DocumentProfile; pk: Readonly<Record<string, unknown>> }> {
  const installed = await manifestsRepo(deps.meta, NO_SECRETS).findByKey(input.addOnKey);
  const manifest = installed?.document as Manifest | undefined;
  const connectionId = installed?.row.connectionId ?? null;
  if (installed === null || installed === undefined || installed.row.kind !== 'add-on' || installed.row.status !== 'installed' || connectionId === null || manifest?.kind !== 'add-on') helpers.notFound();

  // The table by the add-on's own name, then its real one through its own records.
  const own = (manifest.requiredSchema?.tables ?? []).some((table) => table.ref === input.table);
  const declared = ((manifest as { documents?: { table: string; kind: string }[] }).documents ?? []).some((entry) => entry.table === input.table && entry.kind === input.kind);
  if (!own || !declared) helpers.notFound();
  const records = await appTablesRepo(deps.meta).forConnection(connectionId);
  const record = records.find((one) => one.appKey === input.addOnKey && one.ref === input.table && (one.state === 'created' || one.state === 'adopted'));
  const view = await loadSnapshotView(deps.meta, connectionId).catch(() => null);
  const tableId = record === undefined ? undefined : view?.model.tables.find((table) => table.name === record.tableName)?.id;
  if (view === null || tableId === undefined) helpers.notFound();

  const profile = await appProfileFor(deps.meta, connectionId, input.addOnKey, tableId, input.kind);
  if (profile === null) helpers.notFound();
  const pk = recordKeyOf(view.table(tableId), input.key);
  if (pk === null) helpers.notFound();
  return { manifest, connectionId, view, tableId, profile, pk };
}

/** Whether this caller reads every table the document reads, and every column it prints. */
export async function readsWholeDocument(deps: Pick<AddOnRenderDeps, 'meta'>, helpers: Pick<AddOnRenderHelpers, 'documentReads' | 'documentColumnRefused'>, request: FastifyRequest, profile: DocumentProfile, connectionId: string, view: SnapshotView): Promise<boolean> {
  const canRead = await canReadTableFor(deps.meta, request.user?.id ?? null, connectionId);
  for (const table of await helpers.documentReads(profile, async () => view)) if (!(await canRead(table))) return false;
  return helpers.documentColumnRefused(profile, await readViewFor(request, view)) === null;
}

export function registerAddOnRender(instance: FastifyInstance, deps: AddOnRenderDeps, helpers: AddOnRenderHelpers): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/add-ons/:key/documents/render',
    {
      preHandler: app.requireAuth,
      // The pipeline writes `document.rendered` itself, with the number.
      config: { audit: audited('rbac') },
      schema: { params: addOnDocumentParams, body: addOnDocumentRenderBody, response: { 200: appDocumentRenderReply, 201: appDocumentRenderReply } },
    },
    async (request, reply) => {
      const pipeline = deps.pipeline;
      if (pipeline === undefined) throw new AppError(503, 'DOCUMENTS_UNAVAILABLE', 'Documents cannot be drawn on this server.');
      const body = request.body;
      const found = await addOnDocumentFor(deps, helpers, { addOnKey: request.params.key, table: body.table, kind: body.kind, key: body.key });
      const { profile } = found;
      if (!(await readsWholeDocument(deps, helpers, request, profile, found.connectionId, found.view))) helpers.notFound();

      // Declared, readable — and switched on?
      const off = await ownedDocumentOff(deps.meta, profile, deps.runtime);
      if (off !== null || !profile.enabled) {
        throw new AppError(409, 'FEATURE_OFF', `This document is not available right now: ${off?.reason ?? 'its profile is switched off'}.`, { addOn: off?.addOn ?? profile.addOnKey, feature: off?.feature ?? null });
      }

      const outcome = await renderDocument(pipeline, {
        profileId: profile.id,
        pk: found.pk,
        requestedBy: request.user?.id ?? null,
        actorKind: 'user',
        reuse: true,
        ...(body.paper === undefined ? {} : { paper: body.paper }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.values === undefined ? {} : { values: body.values }),
      });
      if (outcome.status === 'skipped') {
        if (outcome.reason === 'row-gone') helpers.notFound();
        if (outcome.reason === 'not-for-row') throw new AppError(409, 'DOCUMENT_NOT_FOR_ROW', `This row has no ${profile.kind} document.`, { kind: profile.kind });
        throw new AppError(409, 'FEATURE_OFF', 'This document is not available right now: its add-on draws nothing.', { addOn: profile.addOnKey, feature: null });
      }
      if (outcome.status === 'failed') throw new AppError(422, 'DOCUMENT_NOT_DRAWN', `The document could not be drawn: ${outcome.error}`, { documentId: outcome.document?.id ?? null });
      const id = outcome.document.id;
      return reply.code(outcome.reused === true ? 200 : 201).send({
        id,
        contentUrl: `${helpers.apiPrefix}/documents/${encodeURIComponent(id)}/content`,
        printUrl: `${helpers.apiPrefix}/documents/${encodeURIComponent(id)}/print`,
        reused: outcome.reused === true,
        document: helpers.toReply(outcome.document),
      });
    },
  );
}
