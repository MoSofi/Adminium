/**
 * Zod schemas for the per-user dashboard layout override routes
 * (04-widget-registry.md §6.3): `PUT`/`DELETE /api/v1/me/views/:pageId/layout`.
 * The body is a full `pageLayout` document — the same schema the shared-default
 * PATCH validates — so the two write paths never diverge on geometry rules.
 */

import { z } from 'zod';

import { pageLayoutSchema } from '../pages/layout-schema.js';

export const meLayoutParams = z.object({ pageId: z.string().min(1) });

export const meLayoutPutBody = pageLayoutSchema;

export const meLayoutReply = z.object({ data: z.object({ layout: pageLayoutSchema }) });
export const meLayoutOkReply = z.object({ data: z.object({ ok: z.literal(true) }) });
