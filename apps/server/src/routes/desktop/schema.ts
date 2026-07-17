/**
 * Wire schemas for `POST /api/v1/desktop/backup` (11-electron.md §9).
 *
 * The reply carries the whole manifest rather than a summary, because the two
 * callers both need it and neither can re-derive it: the Electron main process
 * puts `metaMigrationVersion` and the local-database list in front of the user
 * before a restore, and the M10 CLI reads the same manifest out of the archive.
 * One shape, described once, in `backup/format.ts`.
 */
import { z } from 'zod';

import { backupManifestSchema } from '../../backup/format.js';
import { DEFAULT_AUTO_BACKUP_KEEP } from '../../backup/backup-service.js';

/**
 * §9's two trigger paths, as the one thing that actually differs between them:
 * where the archive lands and what happens afterwards.
 *
 *  - `staged`: File → "Back up now…" and Settings → Desktop → Backups. The
 *    archive goes to a staging directory and the MAIN PROCESS moves it to the
 *    path the user picked in the save dialog. Not rotated (it is leaving the
 *    data dir) and not notified (main reveals it in the file manager, which is
 *    a better answer than a notification about a file already on screen).
 *  - `auto`: the §9 scheduler. Lands in `<dataDir>/backups/`, rotates to
 *    `keep`, and raises the notification — because nobody is watching.
 *
 * NOTE WHAT IS NOT IN THIS BODY: a destination path. The save dialog's result
 * never reaches the server. See the route header — this is the same rule
 * `main/ipc.ts`'s `saveFileSchema` states when it refuses a separator inside
 * `defaultName`: the renderer does not choose paths.
 */
export const desktopBackupBody = z.strictObject({
  destination: z.enum(['staged', 'auto']),
  /** §9's `autoBackup.keep`. Ignored for `staged`. Bounds match `config.json`. */
  keep: z.number().int().min(1).max(365).default(DEFAULT_AUTO_BACKUP_KEEP),
  /**
   * The desktop `config.json`, ALREADY REDACTED by its owner (§2.3: the main
   * process is that file's only reader). Passed in rather than read here
   * because this process cannot see `<userData>` — it only knows `dataDir`.
   *
   * `unknown` on the wire and re-asserted in the service (`assertNoSecrets`):
   * a schema here would be a second copy of `main/config.ts`'s, in a package
   * that must not know that shape, and it would drift. What this boundary
   * enforces is not the config's shape but the one property that matters — no
   * secret leaves in the archive — and it enforces it by inspection, not by
   * trusting the caller to have used `redactConfig`.
   */
  config: z.unknown().optional(),
});

export type DesktopBackupBody = z.infer<typeof desktopBackupBody>;

export const desktopBackupReply = z.object({
  data: z.object({
    /** Absolute path of the archive on this machine. */
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    manifest: backupManifestSchema,
    /** Archive filenames rotation removed. Empty for `staged`. */
    rotated: z.array(z.string()),
  }),
});

export type DesktopBackupReply = z.infer<typeof desktopBackupReply>;
