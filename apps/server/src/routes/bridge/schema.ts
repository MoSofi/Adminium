/**
 * Zod schemas for the local-bridge resource (naming per 08-server-api.md §1.5:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
 *
 * `bridgeHandoffBody` is the only cross-origin write body in the API, so it is
 * `.strict()` for the same reason the setup bodies are: an unknown key near a
 * credential-bearing value should be a rejection, not something silently
 * dropped. The DSN is bounded rather than parsed here — the connection string
 * grammar has one owner (`connections/dsn.ts`, reached when the Studio wizard
 * actually submits the prefilled form), and a second, looser copy at the door
 * would be a second thing to keep in sync.
 */
import { z } from 'zod';

import { PAIRING_CODE_LENGTH } from '../../bridge/store.js';

/**
 * `GET /bridge/hello` — the discovery probe.
 *
 * Carries nothing an attacker could use to fingerprint the install beyond the
 * build version, which the site needs in order to know whether this Adminium
 * speaks the hand-off shape at all. No instance id, no connection count, and
 * emphatically not the pairing code.
 */
export const bridgeHelloReply = z.object({
  data: z.object({
    product: z.literal('adminium'),
    version: z.string(),
    /** Where to send the browser once a ticket is in hand. */
    connectPath: z.string(),
  }),
});
export type BridgeHelloReply = z.infer<typeof bridgeHelloReply>;

export const bridgeHandoffBody = z
  .object({
    /** The code the instance printed at boot. Case-insensitive on the way in. */
    code: z.string().trim().length(PAIRING_CODE_LENGTH),
    /**
     * The connection string, bounded but not parsed. 4 KB is far past any real
     * DSN (the longest plausible shape — full SSL parameters plus an inline
     * client certificate path — is a few hundred bytes) while staying small
     * enough that the cap is a meaningful limit on what can be parked in memory.
     */
    dsn: z.string().min(1).max(4096),
    /** What the site inferred from the scheme; advisory, re-derived server-side. */
    engine: z.enum(['postgres', 'mysql', 'sqlite']).optional(),
  })
  .strict();
export type BridgeHandoffBody = z.infer<typeof bridgeHandoffBody>;

export const bridgeHandoffReply = z.object({
  data: z.object({
    /** Opaque, single-use, short-lived. Worthless without an admin session. */
    ticket: z.string(),
    connectPath: z.string(),
  }),
});
export type BridgeHandoffReply = z.infer<typeof bridgeHandoffReply>;

export const bridgeSeedParams = z.object({ ticket: z.string().min(1).max(64) });
export type BridgeSeedParams = z.infer<typeof bridgeSeedParams>;

export const bridgeSeedReply = z.object({
  data: z.object({
    dsn: z.string(),
    engine: z.string().nullable(),
  }),
});
export type BridgeSeedReply = z.infer<typeof bridgeSeedReply>;
