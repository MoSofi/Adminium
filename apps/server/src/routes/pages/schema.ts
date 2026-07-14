/** Zod request/response schemas for `routes/pages/` (08-server-api.md §2.6). */

import { z } from 'zod';

export const pageParams = z.object({ pageId: z.string().min(1) });

/**
 * The stored envelope is returned verbatim (07-meta-store.md §3.17: the
 * envelope persists into `adminium_pages.config` unchanged) — the client
 * validates it against `pageEnvelopeSchema` after running config migrations,
 * so the transport schema stays permissive by design (never-crash, 09 §3.1).
 */
export const pageReply = z.object({ data: z.unknown() });
