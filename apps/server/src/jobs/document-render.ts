// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `document.render` job handler.
 *
 * ─── WHY THERE IS A JOB AT ALL, GIVEN D55 ──────────────────────────────────
 *
 * A TRIGGERED render is a step inside an automation's own run job, so it
 * needs no job of its own. This one is for every OTHER way a document gets
 * asked for:
 *
 *   · `POST /documents/render` — an operator pressing Make on a record page;
 * · a public request-shaped intent; · a retry of either.
 *
 * None of those may render inline in the request. A render reads a row and
 * its children, calls into an add-on's bundle, writes one or two files and
 * claims a number — seconds of work with side effects, in a handler somebody
 * is waiting on. So the route enqueues and answers, and this drains it.
 *
 * ─── IT IS A THIN WRAPPER, AND THAT IS THE DESIGN ──────────────────────────
 *
 * Everything is in `documents/render.ts`, called identically from here and
 * from the automation action. Two entry points, one implementation: "the same
 * profile produces the same document however it was asked for" is a fact when
 * there is one code path and a hope when there are two.
 */

import { z } from 'zod';

import { renderDocument, type RenderDeps } from '../documents/render.js';
import type { JobRegistry } from './registry.js';

export const DOCUMENT_RENDER_KIND = 'document.render';

export const documentRenderPayloadSchema = z
  .object({
    profileId: z.string().min(1).max(36),
    /** The source row's primary key, as the enqueuer read it. */
    pk: z.record(z.string(), z.unknown()),
    /** Who asked — their grants are what the source is read with (D16). */
    requestedBy: z.string().max(36).nullable().default(null),
    actorKind: z.enum(['user', 'system', 'api-key']).default('system'),
    /** Overrides the profile's own locale option, for a per-request language. */
    locale: z.string().max(16).optional(),
  })
  .strict();

export type DocumentRenderPayload = z.infer<typeof documentRenderPayloadSchema>;

export function registerDocumentRenderHandler(registry: JobRegistry, deps: RenderDeps): void {
  registry.registerJobHandler(
    DOCUMENT_RENDER_KIND,
    documentRenderPayloadSchema,
    async (payload, ctx) => {
      ctx.progress(10, { step: 'reading', message: 'reading the record' });

      const outcome = await renderDocument(deps, {
        profileId: payload.profileId,
        pk: payload.pk,
        requestedBy: payload.requestedBy,
        actorKind: payload.actorKind,
        jobId: ctx.jobId,
        ...(payload.locale === undefined ? {} : { locale: payload.locale }),
      });

      switch (outcome.status) {
        case 'rendered':
          ctx.progress(100, { step: 'done', message: outcome.document.number ?? 'drawn' });
          ctx.log('document.render: drawn', {
            documentId: outcome.document.id,
            number: outcome.document.number,
          });
          return { documentId: outcome.document.id, number: outcome.document.number };

        case 'skipped':
          /*
           * A SKIP IS A SUCCESSFUL JOB. A disabled profile, an uninstalled
           * add-on and a row that was deleted inside the undo window are all
           * ordinary outcomes, and retrying any of them would produce the same
           * skip every time until the attempts ran out — filling the failed-
           * jobs list with things nobody did wrong.
           */
          ctx.progress(100, { step: 'skipped', message: outcome.reason });
          ctx.log('document.render: skipped', { reason: outcome.reason });
          return { skipped: outcome.reason };

        case 'failed':
          /*
           * A FAILURE THROWS, so the worker's own retry applies. The register
           * row is already written and already says why — throwing does not
           * lose that, it adds the queue's retry on top of it, which is what
           * a transient storage or provider fault needs.
           */
          ctx.log('document.render: failed', { error: outcome.error });
          throw new Error(outcome.error);
      }
    },
  );
}
