// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/documents` — the register, its bytes, and the mappings behind
 * it.
 *
 * ─── EVERY ROUTE NAMES ITS OWN GUARD ───────────────────────────────────────
 *
 * This server has NO ambient auth hook: a route that names no `preHandler` has
 * none, and serves to anybody who asks. That is not a hypothetical — `GET
 * /add-ons` and the bundle route shipped for a fortnight with a docblock
 * saying "authenticated" and no guard, serving the full installed inventory
 * and then the bundle bytes. `documents-routes.test.ts` asks the registered
 * route options the same question this file answers in prose.
 *
 * ─── THE HARD PART IS NOT AUTHENTICATION, IT IS WHICH TABLES ───────────────
 *
 * A document is built from the tables its profile MAPS, which is usually more
 * than one — an invoice reads the order AND its lines, often a customer too.
 * So "may this caller read this document" is not one grant, it is every mapped
 * table's read grant, resolved together (D16). A caller holding `orders:read`
 * and not `order_lines:read` gets the row REDACTED, not hidden: its existence
 * is a fact the record page must not lie about, and its contents are not
 * theirs to read.
 *
 * ─── AND A ROW WITH NO MAPPED TABLES AT ALL ────────────────────────────────
 *
 * A request-shaped intent (D15) has no profile and no source row, so "every
 * mapped table's grant" resolves to an EMPTY set — which is vacuously true and
 * would let anybody read anybody's. The fallback the guard table names is
 * therefore explicit: such a row is visible to the person who asked for it, or
 * to `system:manifests:manage`.
 */

import {
  auditRepo,
  documentProfilesRepo,
  documentsRepo,
  filesRepo,
  type DocumentProfile,
  type DocumentRow,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { providersFor, type AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import {
  DOCUMENT_RENDER_CONTRACT,
  DOCUMENT_RENDER_VERSION,
} from '../../documents/render.js';
import { emailDocument } from '../../documents/deliver.js';
import { providerOf } from '../../documents/provider.js';
import { mappedTables, type ProfileMapping } from '../../documents/subject.js';
import { syncProfileTrigger } from '../../documents/trigger-sync.js';
import type { FileStore } from '../../files/store.js';
import { DOCUMENT_RENDER_KIND } from '../../jobs/document-render.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { canReadTableFor } from '../../rbac/table-grants.js';
import { AppError, ForbiddenError, NotFoundError } from '../../errors.js';
import {
  documentIdParams,
  documentKindsReply,
  documentProfileCreateBody,
  documentProfilePatchBody,
  documentProfileReply,
  documentProfilesListQuery,
  documentProfilesListReply,
  documentProvidersReply,
  documentRenderBody,
  documentRenderReply,
  documentSendReply,
  documentVoidBody,
  documentsListQuery,
  documentsListReply,
} from './schema.js';

export interface DocumentRoutesDeps {
  meta: MetaDb;
  storage: FileStore;
  runtime: () => AddOnRuntimeState | null;
  enqueue: (input: {
    kind: string;
    payload: Record<string, unknown>;
    runAt?: number;
    dedupeKey?: string;
  }) => Promise<{ id: string }>;
}

export function documentRoutes(deps: DocumentRoutesDeps): FastifyPluginAsyncZod {
  const documents = documentsRepo(deps.meta);
  const profiles = documentProfilesRepo(deps.meta);

  /**
   * May this caller read this document's CONTENTS?
   *
   * The answer for a profile-backed row is "every mapped table, all of them";
   * for a profile-less intent it is "you asked for it, or you administer
   * add-ons". Both branches return a boolean AND the table that refused, so a
   * 403 can name it instead of saying no.
   */
  async function readable(
    request: FastifyRequest,
    row: DocumentRow,
  ): Promise<{ ok: true } | { ok: false; table: string | null }> {
    const userId = request.user?.id ?? null;

    if (row.profileId === null || row.connectionId === null) {
      // No profile, no source row — the vacuous case the header names.
      if (row.requestedBy !== null && row.requestedBy === userId) return { ok: true };
      const admin = await request.can?.(PERMISSIONS.manifestsManage);
      return admin === true ? { ok: true } : { ok: false, table: null };
    }

    const profile = await profiles.findById(row.profileId);
    if (profile === null) {
      // The mapping is gone, so the set of tables cannot be resolved. The
      // document survives a deleted profile by design, and this is the price:
      // only an administrator can read one afterwards.
      const admin = await request.can?.(PERMISSIONS.manifestsManage);
      return admin === true ? { ok: true } : { ok: false, table: null };
    }

    const canRead = await canReadTableFor(deps.meta, userId, row.connectionId);
    for (const table of mappedTables(profile.mapping as ProfileMapping, profile.table)) {
      if (!(await canRead(table))) return { ok: false, table };
    }
    return { ok: true };
  }

  function toReply(row: DocumentRow) {
    return {
      id: row.id,
      profileId: row.profileId,
      addOnKey: row.addOnKey,
      kind: row.kind,
      connectionId: row.connectionId,
      entityTable: row.entityTable,
      entityId: row.entityId,
      subject: row.subject,
      number: row.number,
      locale: row.locale,
      format: row.format,
      status: row.status,
      error: row.error,
      delivery: row.delivery,
      renderedAt: row.renderedAt,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      createdAt: row.createdAt,
      redacted: row.redacted,
      hasContent: row.fileId !== null || row.htmlFileId !== null,
    };
  }

  /** The header table's `update` grant — the alternative to being an admin. */
  async function mayAdminister(request: FastifyRequest, row: DocumentRow): Promise<boolean> {
    if ((await request.can?.(PERMISSIONS.manifestsManage)) === true) return true;
    if (row.connectionId === null || row.entityTable === null) return false;
    const set = await canReadTableFor(deps.meta, request.user?.id ?? null, row.connectionId);
    // `canReadTableFor` resolves the whole permission set once; the update
    // grant is asked for through the request's own checker, which caches per
    // request the same way.
    void set;
    return (
      (await request.can?.(`table:${row.connectionId}:${row.entityTable}:update`)) === true
    );
  }

  /**
   * Make the rule match the mapping, and record which rule that is.
   *
   * TWO WRITES, not one transaction, and the ordering is what makes that safe:
   * the profile is already saved when this runs, so a failure here leaves a
   * mapping with no rule — which draws nothing until the next save, and is
   * visible as an absent rule. The reverse order could leave a rule firing at
   * a profile that was never stored, which draws documents from a mapping
   * nobody agreed to.
   *
   * `syncProfileTrigger` is a full reconcile, so the second write is also the
   * repair: a rule somebody deleted by hand comes back on the next save.
   */
  async function reconcile(
    request: FastifyRequest,
    profile: DocumentProfile,
    previous: DocumentProfile | null,
    userId: string | null,
  ): Promise<DocumentProfile> {
    let result: Awaited<ReturnType<typeof syncProfileTrigger>>;
    try {
      result = await syncProfileTrigger(deps.meta, profile, { previous, userId });
    } catch (error) {
      /*
       * THE MAPPING IS ALREADY SAVED when this runs. A bare 500 would tell an
       * operator their save failed when it did not, and they would make it
       * again — and have two mappings drawing the same document.
       *
       * It is not swallowed either: a trigger that was chosen and did not take
       * effect is exactly what somebody must be told about, or they wait for
       * documents that never come. So the refusal says both halves, and the
       * cause goes to the log rather than into a reply an operator cannot act
       * on.
       */
      request.log.warn(
        { err: error, profileId: profile.id },
        'the document mapping was stored but its automation could not be written',
      );
      /*
       * Not `ValidationFailedError`: nothing about the request was invalid, and
       * a 422 sends a form to highlight fields that are all fine. 409 is the
       * nearest true thing — the stored state and the state asked for disagree.
       *
       * The wording is deliberate on the CREATE path. "Save it again" would
       * read as "submit this form again", which is how you end up with two
       * mappings drawing the same document; the mapping is already in the list
       * by now, so the instruction is to open THAT one.
       */
      throw new AppError(
        409,
        'DOCUMENT_TRIGGER_NOT_WRITTEN',
        `The mapping “${profile.name}” was saved, but the rule that fires it could not be ` +
          'written — it will only draw on request. Open the mapping and save it again to add ' +
          'the rule.',
        { profileId: profile.id },
      );
    }
    const current = (profile.trigger ?? null) as { automationId?: string | null } | null;
    if (current === null || current.automationId === result.automationId) return profile;
    const updated = await profiles.patch(profile.id, {
      trigger: { ...profile.trigger!, automationId: result.automationId },
    });
    return updated ?? profile;
  }

  async function load(id: string): Promise<DocumentRow> {
    const row = await documents.findById(id);
    if (row === null) throw new NotFoundError(`Document ${id} not found.`);
    return row;
  }

  return async (app) => {
    // ── what a provider offers ───────────────────────────────────────────
    app.get(
      '/documents/kinds',
      { preHandler: app.requireAuth, schema: { response: { 200: documentKindsReply } } },
      async () => {
        const state = deps.runtime();
        if (state === null) return { kinds: [] };
        const kinds: {
          addOnKey: string;
          kind: string;
          label: Record<string, string>;
          formats: string[];
          paper: string[];
          coverage: string;
          outline: { slots: unknown[] };
        }[] = [];
        for (const entry of providersFor(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION)) {
          const provider = providerOf(entry.module);
          if (provider === null) continue;
          for (const kind of provider.kinds()) {
            kinds.push({
              addOnKey: entry.addOnKey,
              kind: kind.id,
              label: kind.label,
              formats: [...kind.formats],
              paper: [...kind.paper],
              coverage: kind.coverage,
              outline: { slots: [...provider.describe(kind.id).slots] },
            });
          }
        }
        return { kinds };
      },
    );

    app.get(
      '/documents/providers',
      { preHandler: app.requireAuth, schema: { response: { 200: documentProvidersReply } } },
      async () => {
        const state = deps.runtime();
        const entries =
          state === null
            ? []
            : providersFor(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION);
        return { installed: entries.length > 0, addOnKeys: entries.map((e) => e.addOnKey) };
      },
    );

    // ── the mappings ─────────────────────────────────────────────────────
    /*
     * `manifests.manage` and NOT a new key (O6). A profile decides what an
     * add-on may read and what it renders — the same authority as installing
     * one — so it rides the grant that already exists rather than un-reserving
     * a `documents.manage` nobody enforces yet. A lighter key stays deposited.
     *
     * These are registered BEFORE `/documents/:id` so that `profiles` is not
     * captured as an id. Fastify's radix tree prefers static segments over
     * parametric ones, so the order is belt and braces — but a reader
     * reordering this file should know why it looks deliberate.
     */
    app.get(
      '/documents/profiles',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { querystring: documentProfilesListQuery, response: { 200: documentProfilesListReply } },
      },
      async (request) => ({ profiles: (await profiles.list(request.query)).map(toProfileReply) }),
    );

    app.post(
      '/documents/profiles',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        // A profile decides what an add-on may read and what it renders —
        // the same weight as installing one, and audited the same way.
        config: { audit: audited('rbac') },
        schema: { body: documentProfileCreateBody, response: { 200: documentProfileReply } },
      },
      async (request) => {
        const profile = await profiles.create({
          ...request.body,
          createdBy: request.user?.id ?? null,
        });
        return toProfileReply(await reconcile(request, profile, null, request.user?.id ?? null));
      },
    );

    app.put(
      '/documents/profiles/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: documentIdParams,
          body: documentProfilePatchBody,
          response: { 200: documentProfileReply },
        },
      },
      async (request) => {
        // The PREVIOUS profile, read before the write: a patch that removes a
        // trigger leaves no `automationId` behind to find the rule by, so the
        // reconcile needs the state it is replacing.
        const previous = await profiles.findById(request.params.id);
        const profile = await profiles.patch(request.params.id, request.body);
        if (profile === null) throw new NotFoundError(`Profile ${request.params.id} not found.`);
        return toProfileReply(await reconcile(request, profile, previous, request.user?.id ?? null));
      },
    );

    app.delete(
      '/documents/profiles/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: documentIdParams },
      },
      async (request, reply) => {
        /*
         * The documents SURVIVE this (`profile_id → SET NULL`). Deleting a
         * mapping stops new documents being made from it; it does not unmake
         * the ones already issued, which is why this is a DELETE on the
         * profile rather than anything that touches the register.
         */
        const previous = await profiles.findById(request.params.id);
        if (!(await profiles.remove(request.params.id))) {
          throw new NotFoundError(`Profile ${request.params.id} not found.`);
        }
        // The rule goes with the mapping. A rule whose `document.render` step
        // names a profile that no longer exists would fire on every write and
        // skip every time.
        await syncProfileTrigger(deps.meta, null, { previous });
        return reply.status(204).send();
      },
    );

    // ── the register ─────────────────────────────────────────────────────
    app.get(
      '/documents',
      {
        preHandler: app.requireAuth,
        schema: { querystring: documentsListQuery, response: { 200: documentsListReply } },
      },
      async (request) => {
        const rows = await documents.list(request.query);
        const out = [];
        for (const row of rows) {
          const verdict = await readable(request, row);
          // A refusal REDACTS rather than removes: the row's existence is a
          // fact the record page must not lie about.
          out.push(
            toReply(verdict.ok ? row : (await documents.findById(row.id, { redacted: true }))!),
          );
        }
        return { documents: out };
      },
    );

    app.get(
      '/documents/:id',
      {
        preHandler: app.requireAuth,
        schema: { params: documentIdParams, response: { 200: documentReplyOrRedacted } },
      },
      async (request) => {
        const row = await load(request.params.id);
        const verdict = await readable(request, row);
        return toReply(
          verdict.ok ? row : (await documents.findById(row.id, { redacted: true }))!,
        );
      },
    );

    app.get(
      '/documents/:id/content',
      { preHandler: app.requireAuth, schema: { params: documentIdParams } },
      async (request, reply) => {
        const row = await load(request.params.id);
        const verdict = await readable(request, row);
        if (!verdict.ok) {
          // NAME THE TABLE. "You may not read this" sends an operator to
          // guess; "you may not read public.order_lines" sends them to the
          // grant that is missing.
          throw new ForbiddenError(
            verdict.table === null
              ? 'This document was not made for you.'
              : `This document is built from ${verdict.table}, which you may not read.`,
          );
        }
        return await serveBytes(reply, row, { inline: row.fileId !== null });
      },
    );

    app.get(
      '/documents/:id/print',
      { preHandler: app.requireAuth, schema: { params: documentIdParams } },
      async (request, reply) => {
        const row = await load(request.params.id);
        const verdict = await readable(request, row);
        if (!verdict.ok) throw new ForbiddenError('This document is not yours to read.');
        /*
         * The HTML half, sandboxed. These bytes came out of an add-on and are
         * full of customer-supplied text; served same-origin they would be a
         * stored-XSS primitive. `sandbox` with no allow-list means no script,
         * no forms, no navigation — a page that draws and prints and does
         * nothing else.
         */
        reply.header(
          'content-security-policy',
          "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        );
        return await serveBytes(reply, row, { inline: true, preferHtml: true });
      },
    );

    app.post(
      '/documents/render',
      {
        preHandler: app.requireAuth,
        /*
         * `worker`, not `rbac`. This route ENQUEUES; the audit row is written
         * when the job runs, by the pipeline, and carries the document id and
         * number that only exist by then. A row written here would say
         * somebody asked for a document, and a row written there says which
         * document they got.
         */
        config: { audit: audited('worker') },
        schema: { body: documentRenderBody, response: { 200: documentRenderReply } },
      },
      async (request) => {
        const profile = await profiles.findById(request.body.profileId);
        if (profile === null) throw new NotFoundError('That document mapping does not exist.');

        // The caller's grants over every table the mapping reads, checked
        // BEFORE anything is enqueued — a job that would be refused at read
        // time should never reach the queue.
        const canRead = await canReadTableFor(
          deps.meta,
          request.user?.id ?? null,
          profile.connectionId,
        );
        for (const table of mappedTables(profile.mapping as ProfileMapping, profile.table)) {
          if (!(await canRead(table))) {
            throw new ForbiddenError(`This document reads ${table}, which you may not read.`);
          }
        }

        const job = await deps.enqueue({
          kind: DOCUMENT_RENDER_KIND,
          payload: {
            profileId: profile.id,
            pk: request.body.pk,
            requestedBy: request.user?.id ?? null,
            actorKind: 'user',
            ...(request.body.locale === undefined ? {} : { locale: request.body.locale }),
          },
          // NO DELAY. The undo window exists for a write somebody might take
          // back; pressing Make is the taking of an action, not a side effect
          // of one, and waiting a minute to start it would be inexplicable.
          runAt: Date.now(),
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/documents/:id/void',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: { params: documentIdParams, body: documentVoidBody, response: { 200: documentReplyOrRedacted } },
      },
      async (request) => {
        const row = await load(request.params.id);
        if (!(await mayAdminister(request, row))) {
          throw new ForbiddenError('You may not void this document.');
        }
        const voided = await documents.markVoided(row.id, request.body.reason);
        if (voided === null) return toReply(row);
        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.id ?? 'user',
          category: 'data',
          action: 'document.voided',
          connectionId: row.connectionId,
          changes: { after: { documentId: row.id, reason: request.body.reason } },
        });
        return toReply(voided);
      },
    );

    app.post(
      '/documents/:id/send',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: { params: documentIdParams, response: { 200: documentSendReply } },
      },
      async (request) => {
        /*
         * THE HUMAN SETTLEMENT OF A `pending-review` ROW (D15).
         *
         * A public caller's document is never emailed unattended — that is the
         * whole reason `delivery` starts `pending-review` — so somebody with
         * authority over the record has to press this.
         *
         * Until 34d this route MARKED the row sent and sent nothing, which is
         * the worst of both: the operator has made their decision, the register
         * says it was delivered, and no message exists. It now queues the
         * message and records what actually happened — including the refusals,
         * which are outcomes an operator can act on rather than errors.
         */
        const row = await load(request.params.id);
        if (!(await mayAdminister(request, row))) {
          throw new ForbiddenError('You may not send this document.');
        }
        if (row.status !== 'rendered') {
          throw new ForbiddenError('Only a document that was drawn can be sent.');
        }
        const profile =
          row.profileId === null ? null : await profiles.findById(row.profileId);
        const delivery = await emailDocument(
          { meta: deps.meta, runtime: deps.runtime, logger: request.log },
          /*
           * No `to`. A mapped document goes to its mapping's address slot and
           * an intent goes to the claim that made it — both read from the row
           * by `emailDocument`. The person pressing send decides WHETHER, never
           * WHERE: an address taken from this request would make the route a
           * way to send somebody else's document anywhere.
           */
          { document: row, profile },
        );
        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.id ?? 'user',
          category: 'data',
          action: 'document.sent',
          connectionId: row.connectionId,
          changes: { after: { documentId: row.id, delivery } },
        });
        return { delivery };
      },
    );
  };

  function toProfileReply(profile: DocumentProfile) {
    return {
      id: profile.id,
      addOnKey: profile.addOnKey,
      kind: profile.kind,
      name: profile.name,
      connectionId: profile.connectionId,
      table: profile.table,
      mapping: profile.mapping,
      options: profile.options,
      trigger: profile.trigger,
      deliver: profile.deliver,
      enabled: profile.enabled,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /** Serve a document's bytes with the headers a document needs. */
  async function serveBytes(
    reply: FastifyReply,
    row: DocumentRow,
    opts: { inline: boolean; preferHtml?: boolean },
  ) {
    const fileId = opts.preferHtml === true ? (row.htmlFileId ?? row.fileId) : (row.fileId ?? row.htmlFileId);
    if (fileId === null) throw new NotFoundError('This document has no bytes.');
    const file = await filesRepo(deps.meta).findById(fileId);
    if (file === null) throw new NotFoundError('This document has no bytes.');

    const opened = await deps.storage.open(file);
    return reply
      .header('content-type', file.mime)
      .header('content-length', String(opened.sizeBytes))
      // A PDF renders inline; HTML is ALWAYS an attachment on the content
      // route, because HTML served same-origin from a document an add-on drew
      // is a stored-XSS primitive. `/print` is the one place it renders, and
      // only under a sandbox CSP.
      .header(
        'content-disposition',
        `${opts.inline && file.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, '')}"`,
      )
      .header('x-content-type-options', 'nosniff')
      // sha256 is the content's identity — a free, exact ETag.
      .header('etag', `"${file.sha256}"`)
      // Private and revalidated: a grant can be revoked, and a shared cache
      // must not hold somebody else's invoice.
      .header('cache-control', 'private, max-age=0, must-revalidate')
      .send(opened.stream);
  }
}

/** The get/void reply — the same shape as a list row. */
const documentReplyOrRedacted = documentsListReply.shape.documents.element;
