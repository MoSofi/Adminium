/**
 * BackupCoordinator — native dialogs, "show in folder", restore intake
 * (11-electron.md §9).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STUB. **11-T12 owns this file.** 11-T01 created it so the §3 tree exists │
 * │ and the scaffold builds; nothing calls `createBackupCoordinator` yet.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * SCOPE, from §1 principle 2 ("The server is the only data owner"): this module
 * runs DIALOGS, not backups. The archive itself is produced inside the server
 * (`POST /api/v1/desktop/backup`), which already holds the connections and can
 * snapshot each SQLite file with better-sqlite3's online `backup()` API without
 * locking live writers. The single sanctioned exception is reading a backup zip
 * READ-ONLY to validate its manifest and checksums before a restore.
 *
 * And from §9: a restore never deletes. Current data moves to
 * `<dataDir>/pre-restore-<ts>/` and stays there for the user to empty.
 */

export interface CreateBackupCoordinatorOptions {
  // 11-T12: the server base URL + session for the backup route, the window (for
  // dialogs), the config port (dataDir, autoBackup), and the ServerManager
  // (a restore stops and restarts the child).
  placeholder?: never;
}

export interface BackupCoordinator {
  /** File → "Back up now…": `saveFile` dialog, then the server does the work. */
  backupNow(): Promise<void>;
  /** File → "Restore from backup…", and the §2.2 step-1 launch-argument path. */
  restoreFrom(zipPath: string): Promise<void>;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- 11-T12 scaffold stub: the
   parameter list is the contract 11-T01 wired against and must survive until
   11-T12 implements the body. */
export function createBackupCoordinator(
  _opts: CreateBackupCoordinatorOptions,
): BackupCoordinator {
  throw new Error('src/main/backup.ts is a scaffold stub — 11-T12 implements it.');
}
