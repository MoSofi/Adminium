// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api-docs` — the public API catalogue.
 *
 * SYNC NOTE: the client mirror is `apps/dashboard/src/api-docs/apiDocsApi.ts`.
 */
import { z } from 'zod';

import { PUBLIC_AUTH_ROLES, PUBLIC_METHODS, RATE_WINDOWS, type RateWindow } from '../../public-api/endpoint.js';

const catalogueColumn = z.object({
  name: z.string(),
  type: z.string(),
  tags: z.array(z.enum(['pk', 'unique', 'fk'])),
});

const catalogueEndpoint = z.object({
  ref: z.string(),
  path: z.string(),
  singular: z.string().nullable(),
  methods: z.array(z.enum(PUBLIC_METHODS)),
  auth: z.enum(PUBLIC_AUTH_ROLES),
  limit: z.number().int(),
  maxLimit: z.number().int(),
  order: z.string(),
  rate: z.object({
    requests: z.number().int(),
    window: z.enum(Object.keys(RATE_WINDOWS) as [RateWindow, ...RateWindow[]]),
  }),
  response: z.enum(['wrapped', 'array', 'single']),
  columns: z.array(catalogueColumn),
  writable: z.array(z.string()),
});

export const apiDocsReply = z.object({
  /** `publicApi.enabled` — the page says "Disabled" when it is off. */
  apiEnabled: z.boolean(),
  /** Whether `ADMINIUM_PUBLIC_API_ORIGINS` opted this instance in at all. */
  registered: z.boolean(),
  /** `system.publicOrigin`, else this request's own host. Never `Origin`. */
  baseUrl: z.string(),
  connections: z.array(z.object({ label: z.string().nullable(), endpoints: z.array(catalogueEndpoint) })),
});
export type ApiDocsReply = z.infer<typeof apiDocsReply>;
