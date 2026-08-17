// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §9 format, restated in two packages — pinned (11-electron.md §9).
 *
 * `apps/server/src/backup/format.ts` OWNS the archive format. The main process
 * has to agree with it byte for byte, and it may not import it at runtime: an
 * `import { backupManifestSchema } from '@adminium/server'` would drag Fastify,
 * Kysely and the whole route tree into the Electron main process to parse one
 * JSON file (`externalizeDeps` keeps it out of the BUNDLE, not out of MEMORY).
 * So `backup-archive.ts` restates the schema in zod, and `backup.ts` restates
 * two constants.
 *
 * ─── Which leaves drift, and drift here is silent and total ──────────────────
 *
 * A field added to the server's manifest and forgotten in the mirror would
 * compile on both sides, ship, and then be REJECTED at runtime by `strictObject`
 * — turning every restore into "this backup is corrupt" for backups that are
 * perfectly fine. The `Mutual<>` type assertions in `backup-archive.ts` catch
 * the SHAPE at typecheck; this file catches the VALUES, which types cannot.
 *
 * A TEST may import `@adminium/server` freely — it does not ship, and the
 * `desktop-shell-only` rule permits the edge anyway (`@adminium/server` is the
 * one workspace package this app may name). That asymmetry is the whole trick:
 * the cost we are avoiding is a runtime import in PRODUCTION, and a test has no
 * runtime to protect.
 */

import {
  BACKUP_CONFIG_PATH as SERVER_CONFIG_PATH,
  BACKUP_DATABASES_DIR as SERVER_DATABASES_DIR,
  BACKUP_FORMAT_VERSION as SERVER_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH as SERVER_MANIFEST_PATH,
  BACKUP_META_PATH as SERVER_META_PATH,
  BACKUP_SLUG_PATTERN as SERVER_SLUG_PATTERN,
  DEFAULT_AUTO_BACKUP_KEEP as SERVER_DEFAULT_KEEP,
  PRE_RESTORE_PREFIX,
  SESSION_COOKIE,
  backupManifestSchema as serverManifestSchema,
  compareMetaMigrationVersion as serverCompare,
  preRestoreDirName as serverPreRestoreDirName,
} from '@adminium/server';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_CONFIG_PATH,
  BACKUP_DATABASES_DIR,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  BACKUP_META_PATH,
  BACKUP_SLUG_PATTERN,
  backupManifestSchema,
  compareMetaMigrationVersion,
} from './backup-archive.js';
import { preRestoreDirName } from './backup.js';
import { DEFAULT_AUTO_BACKUP_KEEP, createDefaultConfig } from './config.js';
import { SESSION_COOKIE_NAME } from './index.js';

const AT = Date.parse('2026-07-12T14:30:05.123Z');

describe('§9 format parity: apps/desktop mirror ≡ @adminium/server', () => {
  it('agrees on the frozen formatVersion', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(SERVER_FORMAT_VERSION);
  });

  it('agrees on §9’s rotation default of 7', () => {
    // `config.json`'s schema owns this default; the server needs it as the
    // route's fallback. Neither module gets to invent it — §9 says 7.
    expect(DEFAULT_AUTO_BACKUP_KEEP).toBe(SERVER_DEFAULT_KEEP);
    expect(DEFAULT_AUTO_BACKUP_KEEP).toBe(7);
    expect(createDefaultConfig('/data').autoBackup).toEqual({ enabled: true, keep: 7 });
  });

  it('agrees on every archive member path', () => {
    expect(BACKUP_MANIFEST_PATH).toBe(SERVER_MANIFEST_PATH);
    expect(BACKUP_META_PATH).toBe(SERVER_META_PATH);
    expect(BACKUP_CONFIG_PATH).toBe(SERVER_CONFIG_PATH);
    expect(BACKUP_DATABASES_DIR).toBe(SERVER_DATABASES_DIR);
  });

  it('agrees on the slug grammar — the zip-slip guard', () => {
    // The reader re-validates every slug it reads. If its grammar were LOOSER
    // than the writer's, the re-validation would be theatre.
    expect(BACKUP_SLUG_PATTERN.source).toBe(SERVER_SLUG_PATTERN.source);
  });

  it('agrees on the pre-restore folder name', () => {
    expect(preRestoreDirName(AT)).toBe(serverPreRestoreDirName(AT));
    expect(preRestoreDirName(AT).startsWith(PRE_RESTORE_PREFIX)).toBe(true);
  });

  it('agrees on the session cookie main sends to the backup route', () => {
    // §9's route is session-guarded and main calls it with the window's cookie.
    // A typo here is not a crash — it is a backup that reports "sign in first"
    // forever, to a user who is signed in.
    expect(SESSION_COOKIE_NAME).toBe(SESSION_COOKIE);
  });

  it('agrees on migration-version ordering', () => {
    for (const [backup, app] of [
      ['0009_views_kind', '0009_views_kind'],
      ['0001_core_auth', '0009_views_kind'],
      ['0010_new', '0009_views_kind'],
    ] as const) {
      expect(compareMetaMigrationVersion(backup, app)).toBe(serverCompare(backup, app));
    }
  });

  it('parses the same manifests, and rejects the same ones', () => {
    // The assertion that matters. Both schemas are `strictObject`, so this
    // catches a field added on one side and forgotten on the other — in BOTH
    // directions, which is what `Mutual<>` cannot do for runtime shapes.
    const valid = {
      formatVersion: 1,
      appVersion: '1.2.3',
      serverVersion: '0.5.0',
      metaMigrationVersion: '0009_views_kind',
      createdAt: AT,
      meta: { file: 'meta.db', bytes: 4096, sha256: 'a'.repeat(64) },
      databases: [
        {
          kind: 'local',
          slug: 'orders',
          file: 'databases/orders.sqlite',
          bytes: 2048,
          sha256: 'b'.repeat(64),
          connectionId: 'conn_1',
          sourcePath: '/data/databases/orders.sqlite',
        },
        { kind: 'external', slug: 'northwind', connectionId: 'conn_2', engine: 'postgres' },
      ],
    };

    expect(backupManifestSchema.safeParse(valid).success).toBe(true);
    expect(serverManifestSchema.safeParse(valid).success).toBe(true);

    const hostile = [
      { ...valid, injectedField: 'surprise' },
      { ...valid, meta: { ...valid.meta, sha256: 'not-hex' } },
      { ...valid, databases: [{ ...valid.databases[0], slug: '../../etc/passwd' }] },
      { ...valid, databases: [{ kind: 'external', slug: 'x' }] },
    ];
    for (const body of hostile) {
      expect(backupManifestSchema.safeParse(body).success, JSON.stringify(body).slice(0, 60)).toBe(
        serverManifestSchema.safeParse(body).success,
      );
      expect(backupManifestSchema.safeParse(body).success).toBe(false);
    }
  });
});
