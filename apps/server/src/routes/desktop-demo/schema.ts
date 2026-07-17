/** Zod schemas for the desktop demo-database resource (11-T08, §6 step 2 card 4). */

import { z } from 'zod';

export const desktopDemoBody = z.object({
  /** The name the connection appears under in Data Connections. */
  name: z.string().min(1).max(80).default('Demo'),
});
export type DesktopDemoBody = z.infer<typeof desktopDemoBody>;

export const desktopDemoReply = z.object({
  data: z.object({
    connectionId: z.string(),
    name: z.string(),
    /**
     * The absolute `<dataDir>/databases/demo.sqlite` path.
     *
     * Not a secret and deliberately unmasked: a SQLite DSN carries no
     * credentials (`maskDsn` reduces one to `sqlite:<file>` — the same string),
     * this route only ever names a file it just created inside the app's own
     * data directory, and the wizard's "Show in folder" affordance needs a path
     * to hand the preload bridge.
     */
    file: z.string(),
    /**
     * Whether this call seeded the file, or adopted one already on disk (see
     * `handlers.ts` — deleting the connection leaves the file behind).
     */
    seeded: z.boolean(),
    /** Rows written per table. Empty when `seeded` is false. */
    rows: z.record(z.string(), z.number().int().min(0)),
  }),
});
export type DesktopDemoReply = z.infer<typeof desktopDemoReply>;
