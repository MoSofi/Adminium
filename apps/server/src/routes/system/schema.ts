/**
 * Zod schemas for the system resource (naming per 08-server-api.md §1.5:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
 */
import { z } from 'zod';

/** Meta-store dialects (07-meta-store.md); `null` until meta wiring (wave 2). */
export const metaDialect = z.enum(['postgres', 'mysql', 'sqlite']);

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

export const systemInfoReply = z.object({
  version: z.string(),
  node: z.string(),
  dialect: metaDialect.nullable(),
});
export type SystemInfoReply = z.infer<typeof systemInfoReply>;
