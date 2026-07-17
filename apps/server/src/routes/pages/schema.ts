/** Zod request/response schemas for `routes/pages/` (08-server-api.md §2.6). */

import { z } from 'zod';

import { pageLayoutSchema } from './layout-schema.js';

export const pageParams = z.object({ pageId: z.string().min(1) });

/**
 * The stored envelope is returned verbatim (07-meta-store.md §3.17: the
 * envelope persists into `adminium_pages.config` unchanged) — the client
 * validates it against `pageEnvelopeSchema` after running config migrations,
 * so the transport schema stays permissive by design (never-crash, 09 §3.1).
 * On read the server resolves `config.layout` (per-user override wins over the
 * shared default, 04-widget-registry.md §6.3) before returning it.
 */
export const pageReply = z.object({
  data: z.unknown(),
  /** Whether the caller holds `page:<id>:edit` — the dashboard builder routes
   *  edits to the shared default (true) vs. a personal override (false). */
  canEditLayout: z.boolean(),
  /**
   * Present (true) only when the served layout is the caller's per-user
   * override AND the shared document's revision moved past the one stamped on
   * the override at PUT time — the page was regenerated (or its default
   * re-edited) out from under the override. The client can offer "Reset
   * layout" (DELETE /me/views/:pageId/layout) instead of leaving the user on
   * silently dead bindings.
   */
  layoutStale: z.boolean().optional(),
});

/**
 * `PATCH /pages/:pageId/layout` writes the SHARED default layout into
 * `adminium_pages.config.layout`. Body is a full `pageLayout` document
 * (04-widget-registry.md §6.1). Reply echoes the persisted layout.
 */
export const pageLayoutPatchBody = pageLayoutSchema;
export const pageLayoutReply = z.object({ data: z.object({ layout: pageLayoutSchema }) });
