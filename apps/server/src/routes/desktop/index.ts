// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/desktop/backup` — the §9 backup, run where the data lives
 * (11-electron.md §9, §1 principle 2).
 *
 * ─── The gates, in order, mirroring `routes/auth/desktop-session.ts` ─────────
 *
 *  1. EXISTENCE. `compose.ts` registers this factory only when
 *     `ADMINIUM_RUNTIME=desktop`. A self-host, Docker or npx instance does not
 *     have the route at all — an absent route cannot be misconfigured or
 *     bypassed, which is why §5's sibling takes the same shape. It is also
 *     simply correct: `<dataDir>/backups` and `config.json` are desktop
 *     concepts, and self-host's answer to "back up my instance" is
 *     `adminium export-zip` plus whatever backs up its Postgres.
 *  2. PEER. The SOCKET's `remoteAddress` must be loopback. Not `request.ip` —
 *     see `auth/desktop-session.ts` for why that distinction is the difference
 *     between a check and a vulnerability. It matters here for the same reason
 *     it matters there: §8.3 binds `0.0.0.0` whenever LAN share is on, and a
 *     backup archive is every row in every database plus every user record.
 *     Whoever can call this can exfiltrate the whole install in one request.
 *  3. SESSION + RBAC. `system:settings:manage`, i.e. Super Admin. There is no
 *     `backups.manage` in meta's closed set (`SYSTEM_ACTION_KEYS`) and this
 *     route is not the place to invent one; `settings:manage` is the strictest
 *     grant that exists and a backup deserves the strictest. A LAN user with a
 *     real super-admin account CAN take a backup — that is §8.3's RBAC promise
 *     working, not a hole — but gate 2 means they cannot: they are not loopback.
 *     Both gates, and the AND is the point.
 *
 * ─── The save dialog's path never reaches this process ───────────────────────
 *
 * §9's manual flow is "saveFile dialog → server does the work", which reads like
 * the chosen path should be the request body. It is not, and this is the one
 * design decision in the route worth arguing with. An `outPath` parameter would
 * make this endpoint an arbitrary-file-write primitive with the server's
 * privileges: post `{ outPath: "~/.zshrc" }` and the reply tells you it worked.
 * Every gate above would have to hold forever for that to stay safe, and gates
 * are exactly the things that get relaxed.
 *
 * So the server writes only inside `<dataDir>/backups`, and `destination:
 * "staged"` puts the archive somewhere the MAIN PROCESS can then move to the
 * path the user picked. Main is allowed to write there — the user just chose it
 * in a native dialog — and main is where §4 already puts every other path
 * decision (`main/ipc.ts`'s `saveFileSchema` refuses a separator inside
 * `defaultName` for precisely this reason). The cost is one rename; the benefit
 * is that the API surface has no path in it to abuse.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DsnCrypto, MetaDb } from '@adminium/meta';

import { isLoopbackPeer } from '../../auth/desktop-session.js';
import {
  createBackup,
  rotateBackupsOnDisk,
  type RotateBackupsResult,
} from '../../backup/backup-service.js';
import { notifyBackupCompleted } from '../../backup/notify.js';
import { AppError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { desktopBackupBody, desktopBackupReply, type DesktopBackupReply } from './schema.js';

export interface DesktopRoutesDeps {
  meta: MetaDb;
  /** Decrypts source DSNs so local SQLite files can be located. */
  crypto: DsnCrypto;
  /** `ADMINIUM_DATA_DIR`. */
  dataDir: string;
  /** Absolute path of the live meta store file (`<dataDir>/meta.db` on desktop). */
  metaPath: string;
  /** The shell's `app.getVersion()`, forwarded through the fork env. */
  appVersion?: string | null | undefined;
  now?: (() => number) | undefined;
}

export function desktopRoutes(deps: DesktopRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/desktop/backup',
      {
        // Gate 3. `rbac.require` runs `requireAuth` semantics for us: an
        // anonymous request has no principal to resolve and is refused before
        // the handler exists.
        preHandler: [app.requireMeta, app.rbac.require(PERMISSIONS.settingsManage)],
        // §7 item 4. The one caller is the Electron MAIN process, which reads
        // `adminium_session` out of Electron's cookie jar and POSTs by hand
        // through Node's `fetch` (apps/desktop/src/main/index.ts): it is a
        // cookie-authenticated non-GET caller that can carry neither a
        // session-bound token nor an Origin, so both the File-menu backup and
        // the nightly schedule would 403. Gate 2 above is the substitute
        // control, and a loopback socket peer is a stronger one than a token.
        config: { csrf: 'exempt' },
        schema: { body: desktopBackupBody, response: { 200: desktopBackupReply } },
      },
      async (request): Promise<DesktopBackupReply> => {
        // Gate 2. Before any work: a non-loopback caller learns nothing about
        // this install, not even how long a backup takes.
        if (!isLoopbackPeer(request.raw.socket)) {
          throw new AppError(
            403,
            'FORBIDDEN',
            'Backups can only be taken from the computer Adminium is running on.',
          );
        }

        const { destination, keep } = request.body;

        const result = await createBackup({
          meta: deps.meta,
          crypto: deps.crypto,
          dataDir: deps.dataDir,
          metaPath: deps.metaPath,
          redactedConfig: request.body.config ?? null,
          appVersion: deps.appVersion ?? null,
          destination,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        });

        let rotated: RotateBackupsResult = { kept: [], removed: [] };
        if (destination === 'auto') {
          rotated = await rotateBackupsOnDisk(deps.dataDir, keep);
          await raiseNotification(request, result.path, result.bytes, result.manifest);
        }

        // A backup is a `system`-category event with no `changes` worth
        // recording: the archive's contents are the manifest, and the manifest
        // is in the reply. What an audit reader needs is that it HAPPENED, by
        // whom, from where — which is what `audit` already writes.
        await app.rbac.audit(request, {
          action: 'desktop_backup_created',
          category: 'system',
          changes: {
            after: {
              destination,
              databases: result.manifest.databases.filter((entry) => entry.kind === 'local').length,
              bytes: result.bytes,
            },
          },
        });

        return {
          data: {
            path: result.path,
            bytes: result.bytes,
            manifest: result.manifest,
            rotated: rotated.removed,
          },
        };
      },
    );
  };

  /**
   * §9's "Completion raises an `adminium_notifications` entry".
   *
   * Best-effort, and deliberately so: the archive is already on disk and its
   * path is already in the reply. Failing the request because a courtesy row
   * did not insert would turn a successful backup into a reported failure — and
   * the scheduler, seeing a failure, would try again, and take another backup.
   * Logged at `warn` so it is not silent.
   */
  async function raiseNotification(
    request: RequestLike,
    path: string,
    bytes: number,
    manifest: { databases: readonly { kind: string }[] },
  ): Promise<void> {
    const userId = request.user?.id;
    // An API-key principal has no notification inbox (`user_id` is NOT NULL).
    // Not an error: a fleet script taking backups wants the archive, not a bell.
    if (userId === undefined) return;
    try {
      await notifyBackupCompleted({
        meta: deps.meta,
        userId,
        path,
        bytes,
        databases: manifest.databases.filter((entry) => entry.kind === 'local').length,
      });
    } catch (error) {
      request.log.warn(
        { err: error },
        'backup completed but its notification could not be written',
      );
    }
  }
}

/** The slice of a request {@link raiseNotification} reads. */
interface RequestLike {
  user: { id: string } | null;
  log: { warn(payload: unknown, message: string): void };
}
