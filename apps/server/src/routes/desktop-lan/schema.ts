// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire schema for `GET /api/v1/desktop/lan-share`.
 *
 * READ-ONLY, and there is no sibling POST. Turning sharing on is not something
 * this process can do: the mechanics are "flipping the toggle updates
 * `config.lanShare` … and gracefully restarts the utilityProcess with
 * `ADMINIUM_HOST=0.0.0.0`", and both halves belong to the main process —
 * `config.json` is its file and the utilityProcess is its child. A server route
 * that "enabled LAN share" could at best write a value nobody reads and at worst
 * ask this process to re-listen on a socket its supervisor knows nothing about.
 * The SPA writes the toggle through the `setConfig` bridge; this route answers
 * the two questions the bridge cannot.
 */
import { z } from 'zod';

export const desktopLanShareReply = z.object({
  data: z.object({
    /**
     * Is this process ACTUALLY bound to every interface right now?
     *
     * Deliberately not named `enabled`: `config.lanShare.enabled` is the user's
     * intent and this is the state of the socket. They differ for a whole server
     * lifetime after a toggle that has not been applied yet, and the panel needs
     * to show what is true, not what was asked for.
     */
    active: z.boolean(),
    /** The bind address, so the panel can say something specific when they disagree. */
    host: z.string(),
    /** Sessions held right now by a peer that is not this machine. */
    lanSessions: z.number().int().nonnegative(),
    /**
     * Active non-super-admin users — precondition ("at least one non-super-admin
     * user exists *or* the admin acknowledges they'll invite users next"). A
     * count and not a boolean: the panel says "2 people can sign in", which is
     * the sentence that makes the precondition make sense, and a bare `true`
     * cannot be rendered as one.
     */
    otherUsers: z.number().int().nonnegative(),
  }),
});

export type DesktopLanShareReply = z.infer<typeof desktopLanShareReply>;
