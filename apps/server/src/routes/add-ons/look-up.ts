// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /add-ons/:key/look-up` — one typed value across an add-on's code
 * tables (add-ons/look-up.ts).
 *
 * A POST, so a code never rides an address. Its own rate bucket: a desk
 * scans many codes, and a look-up is also the door somebody would guess
 * codes through. Not audited: it reads, and a row per scan would bury the
 * audit trail. The caller's own grants decide what the answer holds.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { lookUp, type LookUpDeps } from '../../add-ons/look-up.js';

const rowSchema = z.record(z.string(), z.unknown());

export const lookUpParams = z.object({ key: z.string().min(1).max(64) });
export const lookUpBody = z.object({ value: z.string().min(1).max(254) }).strict();
export const lookUpReply = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    /** The matched kind's id; `address` for a row found by a customer's address. */
    kind: z.string(),
    by: z.enum(['code', 'address']),
    /** The add-on's own name for the table, and the row's key. */
    table: z.string(),
    key: z.string(),
    /** The last four of the stored code; no reply carries more of it. */
    last4: z.string().nullable(),
    record: rowSchema,
    rows: z.array(rowSchema).nullable(),
    more: z.number().int().optional(),
  }),
]);

export function addOnLookUpRoutes(deps: LookUpDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/add-ons/:key/look-up',
      {
        preHandler: [app.requireAuth],
        config: { rateLimitBucket: 'look-up' },
        schema: { params: lookUpParams, body: lookUpBody, response: { 200: lookUpReply } },
      },
      async (request) => lookUp(deps, request, request.params.key, request.body.value),
    );
  };
}
