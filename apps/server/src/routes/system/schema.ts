// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the system resource (naming per 08-server-api.md §1.5:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
 */
import { z } from 'zod';

import { RUNTIMES } from '../../config/env.js';

/** Meta-store dialects (07-meta-store.md); `null` until meta wiring (wave 2). */
export const metaDialect = z.enum(['postgres', 'mysql', 'sqlite']);

/**
 * The deployment wrapper, straight off `Env.ADMINIUM_RUNTIME` — the SAME enum,
 * imported rather than re-spelled. 11-electron.md §4 makes this reply the
 * authority the SPA gates on ("the SPA trusts the server for feature gating and
 * the bridge only for native affordances"), so a copy that drifted from the env
 * schema would be a gate that disagrees with the server it is gating.
 */
export const systemRuntime = z.enum(RUNTIMES);

export const systemHealthzReply = z.object({
  /** Liveness only — always `true` when the process answers at all. */
  ok: z.literal(true),
  version: z.string(),
  /** Seconds since process start. */
  uptime: z.number().nonnegative(),
});
export type SystemHealthzReply = z.infer<typeof systemHealthzReply>;

/** Per-dependency readiness verdicts (01-architecture.md §4.1 `/readyz`). */
export const systemReadyzChecks = z.object({
  /** `not-configured` = booted without a meta store; `unreachable` = it failed. */
  meta: z.enum(['ok', 'unreachable', 'not-configured']),
});

export const systemReadyzReply = z.object({
  /** `false` ⇒ the route answers 503; take this instance out of rotation. */
  ok: z.boolean(),
  version: z.string(),
  checks: systemReadyzChecks,
});
export type SystemReadyzReply = z.infer<typeof systemReadyzReply>;

/**
 * Build/runtime info + the 11-electron.md §8.2 CAPABILITY FLAGS the SPA gates
 * on. Unauthenticated, like its two sibling probes — deliberately, because the
 * surfaces that need the answers earliest are pre-auth (`/login`, `/forgot`,
 * `/setup`), and every field here is either already public (`version`, `node`)
 * or a yes/no about this deployment's own configuration. Nothing names a host, a
 * credential, or a user.
 *
 * WHAT EACH FLAG IS ENTITLED TO CLAIM — the schema is only honest if the
 * handler can actually answer it:
 *
 *  - `runtime` — parsed at boot from `ADMINIUM_RUNTIME`. Certain.
 *  - `smtpConfigured` — is `adminium_settings.email.smtp` set? Certain, and it
 *    is the exact question §8.2's email row asks. It is NOT "email will
 *    succeed": a configured-but-wrong SMTP host still fails at send time, and no
 *    flag can promise otherwise. The gap is narrow and the alternative — a probe
 *    connection per page load — is worse.
 *  - `networkFeaturesAllowed` — POLICY, from `ADMINIUM_NETWORK_FEATURES`, never
 *    reachability. See that variable's comment in `config/env.ts`; the short
 *    version is that a server which promises to make zero unprompted outbound
 *    calls cannot also report whether outbound calls would work.
 *  - `lanShare` — is this desktop process bound to every interface (§8.3)?
 *    Certain, and the strongest kind of certain available: it is read off the
 *    bind this process was booted with, not off a config file describing what
 *    somebody meant to happen. See `desktop/lan-share.ts`.
 */
export const systemInfoReply = z.object({
  version: z.string(),
  node: z.string(),
  dialect: metaDialect.nullable(),
  /** Which wrapper booted this process (11-electron.md §4 detection contract). */
  runtime: systemRuntime,
  /** `email.smtp` is set ⇒ §8.2 email actions are offered. False without a meta store. */
  smtpConfigured: z.boolean(),
  /** Operator policy for outbound features. NOT a reachability claim — see above. */
  networkFeaturesAllowed: z.boolean(),
  /**
   * 11-electron.md §8.3: this desktop process is bound to every interface, so
   * other devices on the LAN can reach it. Always `false` off the desktop
   * runtime — see `desktop/lan-share.ts` for why a `0.0.0.0` Docker bind is not
   * this fact.
   *
   * THIS FIELD IS WHY §8.1's CHIP CAN EXIST. §8.1 spends a sentence forbidding
   * the obvious source — "fed by `GET /api/v1/system/info` + a lightweight
   * connection-health poll — no preload involvement" — and neither of those two
   * feeds carried a bind address until this line. Without it the `lan-share`
   * chip state is unreachable: the component renders it, the precedence function
   * ranks it, and nothing can ever pass `true`.
   *
   * Unauthenticated, like the rest of this reply, and that is sound rather than
   * tolerated: a caller who reached this route over the LAN has already proved
   * the answer is `true` by the act of connecting, and a loopback caller is the
   * person who owns the machine. The field discloses nothing a peer does not
   * already hold.
   */
  lanShare: z.boolean(),
  /**
   * 11-electron.md §6 step 2 card 4: can this build seed the demo database?
   *
   * The SAME condition `compose.ts` registers the route on — desktop runtime AND
   * an `ADMINIUM_DEMO_SEED_SCRIPT` that exists — so a `true` here means
   * `POST /desktop/demo-database` is mounted, and a `false` means it would 404.
   * Deriving it twice would be a flag that disagrees with the router it
   * describes; `demoSeedAvailable()` is the one predicate, imported by both.
   *
   * IT EXISTS FOR §8.2's RULE: "never hide, always explain". The wizard's fourth
   * source card must either work or say why it does not, and without this field
   * the SPA has no way to tell the two apart — it would offer a card whose button
   * 404s, which is worse than a card that explains itself. `desktopDemoEnabled`
   * on `composeServer`'s return value is the same fact, but only the process that
   * called compose can see it, and the SPA is not that process.
   */
  desktopDemo: z.boolean(),
});
export type SystemInfoReply = z.infer<typeof systemInfoReply>;
