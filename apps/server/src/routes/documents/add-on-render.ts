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
import { appTablesRepo, auditRepo, documentProfilesRepo, manifestsRepo, type DocumentProfile, type DocumentRow, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readViewFor } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { appProfileFor, ownedDocumentOff } from '../../documents/app-documents.js';
import { providerByKey } from '../../add-ons/runtime.js';
import { moneyCodeOf } from '../../documents/money-code.js';
import { printRow, printStore, type PrintStore } from '../../documents/print-tokens.js';
import { renderingProviderOf } from '../../documents/provider.js';
import { renderDocument, renderEphemeral, type RenderDeps } from '../../documents/render.js';
import { AppError, NotFoundError } from '../../errors.js';
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
    /** The print token a save handed its maker with a new row's code: lets that person print that row once, whatever their role reads. */
    once: z.string().min(20).max(100).optional(),
  })
  .strict();

/** A document kept nowhere is answered as an address that prints it once. */
export const ephemeralDocumentReply = z.object({ printUrl: z.string(), ephemeral: z.literal(true) });
export const printTicketParams = z.object({ ticket: z.string().min(20).max(100) }).strict();

/** The papers a profile's kind is drawn on, as the add-on that draws it says; null when it is not loaded. */
export function papersOf(runtime: AddOnRuntimeState | null, profile: Pick<DocumentProfile, 'addOnKey' | 'kind'>): readonly string[] | null {
  const entry = runtime === null ? null : providerByKey(runtime, 'document-render', 1, profile.addOnKey);
  const provider = entry === null ? null : renderingProviderOf(entry.module);
  return provider === null ? null : ((provider.kinds().find((kind) => kind.id === profile.kind)?.paper ?? []) as readonly string[]);
}

/**
 * The address that prints a money-code document once: a ticket for whoever
 * asked, good for a minute. A paper the kind does not list is refused here,
 * by name, before a ticket is made.
 */
export function printOnce(
  store: PrintStore,
  runtime: AddOnRuntimeState | null,
  apiPrefix: string,
  input: { userId: string; profile: DocumentProfile; pk: Readonly<Record<string, unknown>>; paper?: string | undefined; locale?: string | undefined; values?: Readonly<Record<string, string | number | boolean>> | undefined; once: boolean },
  /** The last thing before the ticket is made (a maker's token is spent here); false, and there is no ticket. */
  spend?: () => boolean,
): z.infer<typeof ephemeralDocumentReply> | null {
  const papers = papersOf(runtime, input.profile);
  if (input.paper !== undefined && papers !== null && !papers.includes(input.paper)) {
    throw new AppError(400, 'DOCUMENT_VALUE_REFUSED', `A ${input.profile.kind} is not drawn on "${input.paper}".`, { slot: 'paper' });
  }
  if (spend !== undefined && !spend()) return null;
  const ticket = store.mintTicket({ userId: input.userId, profileId: input.profile.id, pk: input.pk, once: input.once, ...(input.paper === undefined ? {} : { paper: input.paper }), ...(input.locale === undefined ? {} : { locale: input.locale }), ...(input.values === undefined ? {} : { values: input.values }) });
  return { printUrl: `${apiPrefix}/documents/print-once/${ticket}`, ephemeral: true };
}

export interface AddOnRenderDeps {
  meta: MetaDb;
  runtime: () => AddOnRuntimeState | null;
  pipeline?: RenderDeps | undefined;
  /** The print tokens and tickets of this process; a test's own otherwise. */
  prints?: PrintStore | undefined;
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
      schema: { params: addOnDocumentParams, body: addOnDocumentRenderBody, response: { 200: z.union([appDocumentRenderReply, ephemeralDocumentReply]), 201: appDocumentRenderReply } },
    },
    async (request, reply) => {
      const pipeline = deps.pipeline;
      if (pipeline === undefined) throw new AppError(503, 'DOCUMENTS_UNAVAILABLE', 'Documents cannot be drawn on this server.');
      const body = request.body;
      const found = await addOnDocumentFor(deps, helpers, { addOnKey: request.params.key, table: body.table, kind: body.kind, key: body.key });
      const { profile } = found;
      const prints = deps.prints ?? printStore;
      const userId = request.user?.id ?? null;
      // A document that prints a money code (a gift card's): drawn when asked, kept nowhere.
      const moneyCode = moneyCodeOf(found.view, profile);
      /*
       * Who may: a caller who reads every table the document reads and every
       * column it prints — or, for a money-code document only, the person who
       * made the row a moment ago, by the token that save handed them: a
       * cashier whose role does not read codes prints the card they just sold,
       * once.
       */
      const row = printRow(found.connectionId, found.tableId, body.key);
      let byToken = false;
      if (!(await readsWholeDocument(deps, helpers, request, profile, found.connectionId, found.view))) {
        // Looked at, not yet spent: a refusal further down must not cost the maker their one print.
        byToken = moneyCode !== null && body.once !== undefined && userId !== null && prints.holdsToken(body.once, userId, row);
        if (!byToken) helpers.notFound();
        // The token stands for the row they made — not for any other table the document reads.
        const canRead = await canReadTableFor(deps.meta, userId, found.connectionId);
        for (const table of await helpers.documentReads(profile, async () => found.view)) {
          if (table !== found.tableId && !(await canRead(table))) helpers.notFound();
        }
      }

      // Declared, readable — and switched on?
      const off = await ownedDocumentOff(deps.meta, profile, deps.runtime);
      if (off !== null || !profile.enabled) {
        throw new AppError(409, 'FEATURE_OFF', `This document is not available right now: ${off?.reason ?? 'its profile is switched off'}.`, { addOn: off?.addOn ?? profile.addOnKey, feature: off?.feature ?? null });
      }

      if (moneyCode !== null) {
        if (userId === null) helpers.notFound();
        // Spent now, when nothing is left that could refuse: taken by somebody else in the meantime, it is nothing.
        const spend = byToken ? () => prints.takeToken(body.once ?? '', userId, row) : undefined;
        return reply.code(200).send(printOnce(prints, deps.runtime(), helpers.apiPrefix, { userId, profile, pk: found.pk, paper: body.paper, locale: body.locale, values: body.values, once: byToken }, spend) ?? helpers.notFound());
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

  /*
   * `GET /documents/print-once/:ticket` — the bytes of a document kept
   * nowhere, once, for the person the ticket was handed to. The ticket is
   * spent before anything is drawn; unknown, spent, a minute old or another
   * person's, it is the one 404. Served as the print route serves a document:
   * sandboxed, and never cached.
   */
  app.get(
    '/documents/print-once/:ticket',
    // No HEAD of its own: asking about the address would spend it.
    { preHandler: app.requireAuth, exposeHeadRoute: false, schema: { params: printTicketParams } },
    async (request, reply) => {
      const pipeline = deps.pipeline;
      const userId = request.user?.id ?? null;
      const ticket = userId === null ? null : (deps.prints ?? printStore).takeTicket(request.params.ticket, userId);
      if (pipeline === undefined || ticket === null || userId === null) throw new NotFoundError('There is nothing to print here.');
      const outcome = await renderEphemeral(pipeline, {
        profileId: ticket.profileId,
        pk: ticket.pk,
        requestedBy: userId,
        actorKind: 'user',
        ...(ticket.paper === undefined ? {} : { paper: ticket.paper }),
        ...(ticket.locale === undefined ? {} : { locale: ticket.locale }),
        ...(ticket.values === undefined ? {} : { values: ticket.values }),
      });
      if (outcome.status === 'skipped') throw new NotFoundError('There is nothing to print here.');
      // Said in these words only: what an add-on says of a failed draw may quote what it was drawing.
      if (outcome.status === 'failed') {
        request.log.warn({ profileId: ticket.profileId }, 'a document kept nowhere could not be drawn');
        throw new AppError(422, 'DOCUMENT_NOT_DRAWN', 'The document could not be drawn.');
      }
      const page = outcome.rendered.find((one) => one.format === 'html') ?? outcome.rendered[0];
      if (page === undefined) throw new AppError(422, 'DOCUMENT_NOT_DRAWN', 'The document could not be drawn: its add-on answered no bytes.');
      const profile = await documentProfilesRepo(deps.meta).findById(ticket.profileId);
      // That it was printed, for which row, on what, by whom — never the code, the subject or the ticket.
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: userId,
        actorLabel: userId,
        category: 'data',
        action: 'document.printed',
        connectionId: profile?.connectionId ?? null,
        changes: { after: { addOn: profile?.addOnKey ?? null, kind: profile?.kind ?? null, table: profile?.table ?? null, key: ticket.pk, paper: outcome.paper, once: ticket.once } },
      });
      const pdf = page.format === 'pdf';
      // Bytes an add-on drew, full of text people typed: no script, no fetch, an origin that holds none of this server's cookies.
      if (!pdf) reply.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
      return reply
        .header('content-type', pdf ? 'application/pdf' : 'text/html; charset=utf-8')
        .header('content-disposition', 'inline')
        .header('x-content-type-options', 'nosniff')
        // Shown once: nothing between here and the screen keeps a copy.
        .header('cache-control', 'no-store')
        .send(Buffer.from(page.bytes));
    },
  );
}
