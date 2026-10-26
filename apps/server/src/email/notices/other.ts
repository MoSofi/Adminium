// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Another service": any mail service, or the owner's own script, that can
 * call an address with a small JSON body.
 *
 * There is no common way services prove their calls, so this one is proved
 * by the long random token in its address, and by a user name and password
 * when the owner asked Adminium to make them. The body is Adminium's own,
 * documented shape:
 *
 *   {"events": [
 *     {"address": "ana@example.com", "kind": "bounce", "permanent": true,
 *      "id": "evt-1", "at": "2026-10-26T10:00:00Z"}
 *   ]}
 *
 * `kind` is `bounce`, `complaint` or `unsubscribe`. `permanent` says whether
 * the address may never be mailed again; it is true when left out (say
 * `false` for a soft bounce). `id` and `at` (an ISO time, or epoch ms) are
 * optional. At most 1,000 events a call; nothing else is taken.
 */
import { z } from 'zod';

import { addressOf, basicMatches, jsonOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeRequest, NoticeVerdict } from './types.js';

export const OTHER_MAX_EVENTS = 1000;

export const otherNoticeSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            address: z.string().max(320),
            kind: z.enum(['bounce', 'complaint', 'unsubscribe']),
            permanent: z.boolean().optional(),
            id: z.string().max(255).optional(),
            at: z.union([z.iso.datetime({ offset: true }), z.number().int().nonnegative()]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(OTHER_MAX_EVENTS),
  })
  .strict();

export function otherEvents(body: unknown): NoticeEvent[] | null {
  const parsed = otherNoticeSchema.safeParse(body);
  if (!parsed.success) return null;
  const out: NoticeEvent[] = [];
  for (const event of parsed.data.events) {
    const address = addressOf(event.address);
    if (address === null) return null;
    const at = event.at === undefined ? null : typeof event.at === 'number' ? event.at : Date.parse(event.at);
    out.push({ address, kind: event.kind, permanent: event.permanent ?? true, relayEventId: event.id ?? null, at });
  }
  return out;
}

export function readOther(request: NoticeRequest, endpoint: NoticeEndpointConfig): NoticeVerdict {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  if (endpoint.basic !== null && !basicMatches(request, endpoint.basic)) return { genuine: false, why: 'wrong-credentials' };
  const events = otherEvents(jsonOf(request.body));
  return events === null ? { genuine: false, why: 'malformed' } : { genuine: true, events };
}
