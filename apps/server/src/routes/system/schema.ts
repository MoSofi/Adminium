/**
 * Zod schemas for the system resource (naming per 08-server-api.md §1.5:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
 */
import { z } from 'zod';

/** Meta-store dialects (07-meta-store.md); `null` until meta wiring (wave 2). */
export const metaDialect = z.enum(['postgres', 'mysql', 'sqlite']);

export const systemHealthzReply = z.object({
  ok: z.literal(true),
  version: z.string(),
  /** Seconds since process start. */
  uptime: z.number().nonnegative(),
});
export type SystemHealthzReply = z.infer<typeof systemHealthzReply>;

export const systemInfoReply = z.object({
  version: z.string(),
  node: z.string(),
  dialect: metaDialect.nullable(),
});
export type SystemInfoReply = z.infer<typeof systemInfoReply>;
