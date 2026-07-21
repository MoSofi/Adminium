/**
 * M10-T03 — the config bundle: export, re-import, version replay, and the
 * secret guarantee.
 *
 * The suite is built around the four claims the milestone makes about a bundle:
 *   1. it round-trips (export a seeded instance → import into a fresh store →
 *      pages/nav/settings/roles match);
 *   2. it never carries a plaintext secret;
 *   3. a bundle from version N imports into an instance at ≥ N (version replay);
 *   4. it is configuration — no application source rides along.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  initMetaDb,
  isBootstrapRequired,
  newId,
  pagesRepo,
  settingsRepo,
  usersRepo,
  writeBool,
  type MetaDb,
} from '@adminium/meta';
import type { ConfigMigration } from '@adminium/engine/config';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { encryptSecret, deriveKey } from '../src/config/secrets.js';
import {
  MANIFEST_PATH,
  README_PATH,
  bundleManifestSchema,
  resourcePath,
  type BundleManifest,
} from '../src/export/bundle.js';
import { importZip, ImportZipError } from '../src/export/import-service.js';
import { NPM_PACKAGE_NAME } from '../src/version.js';
import {
  EXPORTED_COLUMNS,
  PlaintextSecretError,
  assertNoCredentialColumns,
  redactSettings,
} from '../src/export/redaction.js';
import { exportZip } from '../src/export/zip-service.js';

// ─── sentinels ───────────────────────────────────────────────────────────────
// Deliberately absurd, unique strings. If any of these ever appears in a bundle
// the export leaked a credential — there is no innocent explanation for the
// bytes "SENTINEL-DSN-PASSWORD-…" showing up in a config archive.
const DSN_SENTINEL = 'SENTINEL-DSN-PASSWORD-9f3a1c7e';
const API_KEY_SENTINEL = 'SENTINEL-LLM-APIKEY-4b8d2e6f';
const SMTP_SENTINEL = 'SENTINEL-SMTP-PASSWORD-71ac93bd';
const DATA_DSN = `postgres://ava:${DSN_SENTINEL}@db.internal:5432/northwind`;

const MASTER_SECRET = 'test-secret-that-is-at-least-32-chars-long';

/** A page config envelope at v1 — the shape `packages/engine/src/generate/*` writes. */
function pageEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'page',
    id: 'page_customers',
    template: 'page-crud',
    title: { key: 'nav.customers', fallback: 'Customers' },
    source: { connectionId: 'conn_x', table: 'public.customers' },
    nav: { group: 'library', icon: 'users', order: 20, slug: 'customers' },
    access: { minRole: 'viewer', permissions: ['table:public.customers:read'] },
    config: {
      columns: [{ column: 'name', widget: 'cell-text', sortable: true }],
      defaultSort: [{ column: 'created_at', dir: 'desc' }],
      pageSize: 50,
    },
    ...overrides,
  };
}

interface Seeded {
  meta: MetaDb;
  connectionId: string;
  pageId: string;
  destroy: () => Promise<void>;
}

/** A meta store that looks like a real instance: roles, settings, a connection
 *  with an encrypted DSN, an active snapshot, an override, pages, and views. */
async function seedInstance(): Promise<Seeded> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);

  const settings = settingsRepo(meta);
  await settings.set('branding.appName', 'Ava Ops');
  await settings.set('appearance.accent', 'violet');
  await settings.set('locale.default', 'fr_FR');
  await settings.set('telemetry.enabled', true);

  // Secrets, stored exactly the way the app stores them: AES-256-GCM at rest.
  await settings.set('llm.provider', 'anthropic');
  await settings.set(
    'llm.apiKey',
    encryptSecret(API_KEY_SENTINEL, deriveKey(MASTER_SECRET, 'adminium:llm-key:v1')),
  );
  await settings.set('email.smtp', {
    host: 'smtp.internal',
    port: 587,
    user: 'ava',
    passEncrypted: encryptSecret(SMTP_SENTINEL, deriveKey(MASTER_SECRET, 'adminium:smtp:v1')),
    from: 'ops@example.com',
    secure: true,
  });

  const connections = connectionsRepo(meta, dsnCryptoFromSecret(MASTER_SECRET));
  const connection = await connections.create({
    name: 'Northwind',
    engine: 'postgres',
    introspectDsn: DATA_DSN,
    dataDsn: DATA_DSN,
    readOnly: false,
    ssl: { mode: 'require', caFileId: 'file_01ABC' },
    settings: { intent: 'full-admin', includedTables: ['public.customers'] },
    status: 'connected',
  });

  const snapshotId = newId('snap');
  await meta.db
    .insertInto('adminium_schema_snapshots')
    .values({
      id: snapshotId,
      connectionId: connection.id,
      source: 'introspection',
      importFormat: null,
      engineVersion: '16.2',
      schema: JSON.stringify({ tables: [{ name: 'public.customers', columns: [] }] }),
      stats: JSON.stringify({ tables: 1 }),
      checksum: 'sha256:abc',
      isActive: writeBool(meta, true),
      createdBy: null,
      createdAt: Date.now(),
    })
    .execute();

  await meta.db
    .insertInto('adminium_schema_overrides')
    .values({
      id: newId('ovr'),
      connectionId: connection.id,
      op: 'rename-column',
      tableName: 'public.customers',
      columnName: 'nm',
      value: JSON.stringify({ label: 'Name' }),
      origin: 'llm',
      llmRunId: null,
      status: 'active',
      confidence: 0.92,
      createdBy: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .execute();

  const pages = pagesRepo(meta);
  const page = await pages.create({
    connectionId: connection.id,
    slug: 'customers',
    type: 'page-crud',
    title: 'Customers',
    icon: 'users',
    navGroup: 'library',
    navOrder: 20,
    config: pageEnvelope(),
    origin: 'generated',
  });

  // A shared view (exported) and a per-user view (must NOT be exported).
  await meta.db
    .insertInto('adminium_views')
    .values({
      id: newId('view'),
      pageId: page.id,
      userId: null,
      kind: 'filters',
      name: 'Active only',
      config: JSON.stringify({ filters: [{ column: 'status', op: 'eq', value: 'active' }] }),
      isDefault: writeBool(meta, true),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .execute();

  const userId = newId('usr');
  await meta.db
    .insertInto('adminium_users')
    .values({
      id: userId,
      email: 'ava@example.com',
      name: 'Ava Reyes',
      passwordHash: 'argon2id$SENTINEL-PASSWORD-HASH',
      status: 'active',
      totpSecretEncrypted: null,
      totpEnabled: writeBool(meta, false),
      recoveryCodes: null,
      avatarFileId: null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .execute();
  await meta.db
    .insertInto('adminium_views')
    .values({
      id: newId('view'),
      pageId: page.id,
      userId,
      kind: 'filters',
      name: 'My private view',
      config: JSON.stringify({ filters: [] }),
      isDefault: writeBool(meta, false),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .execute();

  return {
    meta,
    connectionId: connection.id,
    pageId: page.id,
    destroy: async () => {
      await meta.db.destroy();
    },
  };
}

/** A fresh, migrated store — what you would import into on a new machine. */
async function freshInstance(): Promise<{ meta: MetaDb; destroy: () => Promise<void> }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);
  return { meta, destroy: async () => meta.db.destroy() };
}

let dir: string;
let source: Seeded;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-zip-'));
  source = await seedInstance();
});

afterEach(async () => {
  await source.destroy();
  await rm(dir, { recursive: true, force: true });
});

function outPath(name = 'bundle.zip'): string {
  return join(dir, name);
}

async function readEntries(path: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await readFile(path)));
}

async function readManifest(path: string): Promise<BundleManifest> {
  const entries = await readEntries(path);
  return bundleManifestSchema.parse(JSON.parse(strFromU8(entries[MANIFEST_PATH] as Uint8Array)));
}

// ─── re-import into a CONFIGURED instance ────────────────────────────────────

describe('re-import into an instance that already has credentials', () => {
  // Every other round-trip test imports into a FRESH target, which takes the
  // INSERT path. The endorsed flow the docs describe — "a re-import updates what
  // is already there instead of duplicating it", "putting your admin-panel config
  // in source control" — takes the UPDATE path, which nothing covered.

  it('does not wipe live DSNs when the bundle omits secrets', async () => {
    // THE BUG THIS PINS. A default bundle omits secrets, so `dataDsnEncrypted`
    // is `undefined` — "not carried", not "there is none". `?? null` on the
    // UPDATE path turned that into an erase: re-importing your own shareable
    // bundle NULLed the encrypted DSN columns and flipped every connection to
    // `unconfigured`. The plaintext existed only as ciphertext in the meta
    // store and was never in the bundle, so it was unrecoverable — working
    // credentials destroyed by a config sync, silently.
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      includeSecrets: false,
    });
    expect((await readManifest(result.path)).secrets.policy).toBe('omitted');

    const before = await source.meta.db
      .selectFrom('adminium_connections')
      .select(['id', 'dataDsnEncrypted', 'introspectDsnEncrypted', 'status'])
      .where('id', '=', source.connectionId)
      .executeTakeFirstOrThrow();
    expect(before.dataDsnEncrypted).not.toBeNull();

    // Re-import the bundle into the SAME (already configured) instance.
    const imported = await importZip({ meta: source.meta, inPath: result.path });

    const after = await source.meta.db
      .selectFrom('adminium_connections')
      .select(['id', 'dataDsnEncrypted', 'introspectDsnEncrypted', 'status'])
      .where('id', '=', source.connectionId)
      .executeTakeFirstOrThrow();

    expect(after.dataDsnEncrypted).toBe(before.dataDsnEncrypted);
    expect(after.introspectDsnEncrypted).toBe(before.introspectDsnEncrypted);
    expect(after.status).toBe(before.status);
    // And it must SAY so, rather than describing the target as if it were fresh.
    expect(imported.warnings.join('\n')).toMatch(/Kept the existing connection string/);

    // The DSN still decrypts to the real thing — not merely non-null.
    const dsns = await connectionsRepo(source.meta, dsnCryptoFromSecret(MASTER_SECRET)).getDsns(
      source.connectionId,
    );
    expect(dsns?.dataDsn).toBe(DATA_DSN);
  });

  it('still carries config changes through on that same re-import', async () => {
    // The preservation above must not become "the update path does nothing":
    // syncing page/override changes is the entire point of a re-import.
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    await connectionsRepo(source.meta, dsnCryptoFromSecret(MASTER_SECRET)).update(
      source.connectionId,
      { name: 'Renamed locally' },
    );

    await importZip({ meta: source.meta, inPath: result.path });

    const after = await source.meta.db
      .selectFrom('adminium_connections')
      .select(['name'])
      .where('id', '=', source.connectionId)
      .executeTakeFirstOrThrow();
    expect(after.name).toBe('Northwind');
  });

  it('DOES replace the DSNs when the bundle actually carries them', async () => {
    // The other direction: `--include-secrets` means the bundle is authoritative.
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath('with-secrets.zip'),
      dataDir: dir,
      includeSecrets: true,
    });
    expect((await readManifest(result.path)).secrets.policy).not.toBe('omitted');

    const target = await freshInstance();
    try {
      await importZip({ meta: target.meta, inPath: result.path });
      const dsns = await connectionsRepo(target.meta, dsnCryptoFromSecret(MASTER_SECRET)).getDsns(
        source.connectionId,
      );
      expect(dsns?.dataDsn).toBe(DATA_DSN);
    } finally {
      await target.destroy();
    }
  });
});

// ─── round-trip ──────────────────────────────────────────────────────────────

describe('export → import round-trip', () => {
  it('restores pages, nav, settings and roles into a fresh meta store', async () => {
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      appVersion: '0.5.0',
    });
    expect(result.counts.pages).toBe(1);
    expect(result.counts.connections).toBe(1);

    const target = await freshInstance();
    try {
      const imported = await importZip({ meta: target.meta, inPath: result.path });
      expect(imported.dryRun).toBe(false);

      // pages + nav placement
      const pages = await target.meta.db.selectFrom('adminium_pages').selectAll().execute();
      expect(pages).toHaveLength(1);
      const page = pages[0];
      expect(page?.slug).toBe('customers');
      expect(page?.title).toBe('Customers');
      expect(page?.navGroup).toBe('library');
      expect(page?.navOrder).toBe(20);
      expect(page?.type).toBe('page-crud');
      expect(JSON.parse(page?.config as string)).toMatchObject({ v: 1, template: 'page-crud' });

      // settings — non-secret values survive verbatim
      const targetSettings = settingsRepo(target.meta);
      expect(await targetSettings.get('branding.appName')).toBe('Ava Ops');
      expect(await targetSettings.get('appearance.accent')).toBe('violet');
      expect(await targetSettings.get('locale.default')).toBe('fr_FR');
      expect(await targetSettings.get('telemetry.enabled')).toBe(true);

      // roles — the source's built-ins matched the target's by slug
      const sourceRoles = await source.meta.db.selectFrom('adminium_roles').select('slug').execute();
      const targetRoles = await target.meta.db.selectFrom('adminium_roles').select('slug').execute();
      expect(targetRoles.map((r) => r.slug).sort()).toEqual(sourceRoles.map((r) => r.slug).sort());

      // connection definition, minus the credential
      const connections = await target.meta.db.selectFrom('adminium_connections').selectAll().execute();
      expect(connections).toHaveLength(1);
      expect(connections[0]?.name).toBe('Northwind');
      expect(connections[0]?.engine).toBe('postgres');
      expect(connections[0]?.dataDsnEncrypted).toBeNull();
      expect(connections[0]?.status).toBe('unconfigured');

      // the schema snapshot + override travelled
      const snapshots = await target.meta.db.selectFrom('adminium_schema_snapshots').selectAll().execute();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.checksum).toBe('sha256:abc');
      const overrides = await target.meta.db.selectFrom('adminium_schema_overrides').selectAll().execute();
      expect(overrides).toHaveLength(1);
      expect(overrides[0]?.op).toBe('rename-column');
    } finally {
      await target.destroy();
    }
  });

  it('exports shared views but never per-user views', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    expect(result.counts.views).toBe(1);

    const target = await freshInstance();
    try {
      await importZip({ meta: target.meta, inPath: result.path });
      const views = await target.meta.db.selectFrom('adminium_views').selectAll().execute();
      expect(views).toHaveLength(1);
      expect(views[0]?.name).toBe('Active only');
      expect(views[0]?.userId).toBeNull();
    } finally {
      await target.destroy();
    }
  });

  it('is idempotent — importing the same bundle twice does not duplicate config', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const target = await freshInstance();
    try {
      await importZip({ meta: target.meta, inPath: result.path });
      await importZip({ meta: target.meta, inPath: result.path });
      const pages = await target.meta.db.selectFrom('adminium_pages').selectAll().execute();
      expect(pages).toHaveLength(1);
      const views = await target.meta.db.selectFrom('adminium_views').selectAll().execute();
      expect(views).toHaveLength(1);
      // Matched on (connection_id, slug), so the second import updated rather
      // than inserted — and bumped the optimistic-concurrency revision.
      expect(pages[0]?.revision).toBe(2);
    } finally {
      await target.destroy();
    }
  });

  it('writes byte-identical archives for identical config', async () => {
    const now = () => 1_700_000_000_000;
    const a = await exportZip({ meta: source.meta, outPath: outPath('a.zip'), dataDir: dir, now, appVersion: '0.5.0' });
    const b = await exportZip({ meta: source.meta, outPath: outPath('b.zip'), dataDir: dir, now, appVersion: '0.5.0' });
    expect(await readFile(a.path)).toEqual(await readFile(b.path));
  });

  it('--dry-run validates without writing', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const target = await freshInstance();
    try {
      const imported = await importZip({ meta: target.meta, inPath: result.path, dryRun: true });
      expect(imported.dryRun).toBe(true);
      expect(imported.counts.pages).toBe(1);
      const pages = await target.meta.db.selectFrom('adminium_pages').selectAll().execute();
      expect(pages).toHaveLength(0);
    } finally {
      await target.destroy();
    }
  });
});

// ─── the secret guarantee ────────────────────────────────────────────────────

describe('secrets never leak into the bundle', () => {
  /**
   * Scan EVERY layer a secret could hide in. Checking only the raw archive
   * bytes would be worse than useless: DEFLATE would hide a plaintext sentinel
   * behind compression and the test would pass while the bundle leaked. So the
   * decompressed content of every entry is scanned too, plus the entry names.
   */
  async function scanForSentinels(path: string): Promise<string[]> {
    const hits: string[] = [];
    const sentinels = [DSN_SENTINEL, API_KEY_SENTINEL, SMTP_SENTINEL, 'SENTINEL-PASSWORD-HASH'];
    const raw = await readFile(path);

    // 1. the raw archive bytes (catches anything stored uncompressed)
    const rawText = raw.toString('latin1');
    for (const sentinel of sentinels) {
      if (rawText.includes(sentinel)) hits.push(`raw archive bytes contain ${sentinel}`);
    }

    // 2. every entry, decompressed — the layer DEFLATE would otherwise mask
    const entries = unzipSync(new Uint8Array(raw));
    for (const [name, bytes] of Object.entries(entries)) {
      const text = strFromU8(bytes);
      for (const sentinel of sentinels) {
        if (text.includes(sentinel)) hits.push(`${name} contains ${sentinel}`);
        if (name.includes(sentinel)) hits.push(`entry name ${name} contains ${sentinel}`);
      }
    }
    return hits;
  }

  it('carries no plaintext secret by default', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    expect(await scanForSentinels(result.path)).toEqual([]);
  });

  it('carries no plaintext secret even with --include-secrets', async () => {
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      includeSecrets: true,
    });
    // The whole point: secrets travelled, but only ever as ciphertext.
    expect(await scanForSentinels(result.path)).toEqual([]);

    const manifest = await readManifest(result.path);
    expect(manifest.secrets.policy).toBe('encrypted');
    expect(manifest.secrets.encrypted.length).toBeGreaterThan(0);

    const entries = await readEntries(result.path);
    const connections = JSON.parse(strFromU8(entries[resourcePath('connections')] as Uint8Array));
    expect(connections[0].dataDsnEncrypted).toMatch(/^enc:v1:/);
  });

  it('omits secret settings entirely without --include-secrets', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const settings = JSON.parse(strFromU8(entries[resourcePath('settings')] as Uint8Array)) as {
      key: string;
    }[];
    const keys = settings.map((row) => row.key);

    expect(keys).not.toContain('llm.apiKey');
    expect(keys).not.toContain('email.smtp');
    // …but the non-secret siblings still travel, so the target is configured.
    expect(keys).toContain('llm.provider');
    expect(keys).toContain('branding.appName');

    const manifest = await readManifest(result.path);
    expect(manifest.secrets.policy).toBe('omitted');
    expect(manifest.secrets.omitted.sort()).toEqual(['email.smtp', 'llm.apiKey']);
  });

  it('omits the connection DSN columns entirely without --include-secrets', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const connections = JSON.parse(strFromU8(entries[resourcePath('connections')] as Uint8Array));
    expect(connections[0]).not.toHaveProperty('dataDsnEncrypted');
    expect(connections[0]).not.toHaveProperty('introspectDsnEncrypted');
  });

  it('never exports users, sessions, api keys or the audit log', async () => {
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      includeSecrets: true,
    });
    const entries = Object.keys(await readEntries(result.path));
    for (const forbidden of ['users', 'sessions', 'apiKeys', 'auditLog', 'llmRuns']) {
      expect(entries.some((name) => name.includes(forbidden))).toBe(false);
    }
  });

  it('drops the instance identity rather than fusing two installs', async () => {
    await settingsRepo(source.meta).set('system.instanceId', 'inst_source_01');
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const settings = JSON.parse(strFromU8(entries[resourcePath('settings')] as Uint8Array)) as {
      key: string;
    }[];
    expect(settings.map((row) => row.key)).not.toContain('system.instanceId');
  });

  it('never carries the bootstrap claim, so a restored instance can still be set up', async () => {
    // THE BUG THIS PINS. `system.superAdminCreatedAt` is the once-only first-boot
    // CLAIM: its mere presence closes /setup/* forever, user count irrelevant.
    // It was a valid, non-secret settings key that the hand-written
    // INSTANCE_IDENTITY_SETTINGS deny-list did not name, so every full-instance
    // bundle carried it — and importing one into a fresh install produced an
    // instance with zero users and setup permanently closed. Unusable, and
    // unrecoverable without hand-editing the database.
    //
    // The old suite could not see this: its fixture inserts its user with a raw
    // `insertInto('adminium_users')` rather than `createFirstSuperAdmin`, so the
    // claim row — the only thing at issue — never existed in test data. Put the
    // instance in the state a REAL bootstrapped install is in. Written the way
    // `createFirstSuperAdmin`'s transaction writes it (a direct row insert; the
    // registry forbids `set()`ing this key from application code), because the
    // helper itself refuses once the fixture's user exists.
    await source.meta.db
      .insertInto('adminium_settings')
      .values({
        key: 'system.superAdminCreatedAt',
        value: JSON.stringify(1_700_000_000_000),
        updatedAt: Date.now(),
        updatedBy: null,
      })
      .execute();
    const claim = await source.meta.db
      .selectFrom('adminium_settings')
      .select('key')
      .where('key', '=', 'system.superAdminCreatedAt')
      .executeTakeFirst();
    expect(claim, 'fixture precondition: the source really is bootstrapped').toBeDefined();

    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const settings = JSON.parse(strFromU8(entries[resourcePath('settings')] as Uint8Array)) as {
      key: string;
    }[];
    expect(settings.map((row) => row.key)).not.toContain('system.superAdminCreatedAt');

    // The consequence, asserted where a self-hoster would feel it.
    const target = await freshInstance();
    try {
      await importZip({ meta: target.meta, inPath: result.path });
      expect(await usersRepo(target.meta).count()).toBe(0);
      expect(
        await isBootstrapRequired(target.meta),
        'an imported-into instance with no users must still accept a super admin',
      ).toBe(true);
    } finally {
      await target.destroy();
    }
  });

  it('refuses to export a secret that was somehow stored in plaintext', async () => {
    // Simulate a broken write path putting a raw key in the settings row.
    await source.meta.db
      .updateTable('adminium_settings')
      .set({ value: JSON.stringify(`plain-${API_KEY_SENTINEL}`) })
      .where('key', '=', 'llm.apiKey')
      .execute();

    await expect(
      exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir, includeSecrets: true }),
    ).rejects.toThrow(PlaintextSecretError);
  });

  it('nulls the ssl CA file reference rather than leaving it dangling', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const connections = JSON.parse(strFromU8(entries[resourcePath('connections')] as Uint8Array));
    expect(connections[0].ssl).toEqual({ mode: 'require', caFileId: null });
  });
});

describe('the allow-list itself', () => {
  it('contains no credential-shaped column', () => {
    expect(() => {
      assertNoCredentialColumns();
    }).not.toThrow();
  });

  it('does not name a table outside the config set', () => {
    // The bundle is configuration. If a future edit adds `adminium_users` here,
    // this fails before anyone's users can be exported.
    expect(Object.keys(EXPORTED_COLUMNS).sort()).toEqual([
      'adminium_connections',
      'adminium_pages',
      'adminium_role_permissions',
      'adminium_roles',
      'adminium_schema_overrides',
      'adminium_schema_snapshots',
      'adminium_settings',
      'adminium_views',
    ]);
  });

  it('classifies secret settings from the registry, not a local list', () => {
    // `email.smtp` is secret because the registry says so — a new secret setting
    // is protected the day it is declared, with no edit to the export.
    const rows = [
      { key: 'branding.appName', value: 'X' },
      { key: 'email.smtp', value: null },
      { key: 'llm.apiKey', value: null },
    ];
    const redacted = redactSettings(rows, false);
    expect(redacted.droppedSecretKeys.sort()).toEqual(['email.smtp', 'llm.apiKey']);
    expect(redacted.rows.map((r) => r.key)).toEqual(['branding.appName']);
  });
});

// ─── it is config, not source ────────────────────────────────────────────────

describe('the bundle is configuration, not source code', () => {
  it('contains no application source', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = Object.keys(await readEntries(result.path));

    for (const name of entries) {
      expect(name).not.toMatch(/\.(ts|tsx|js|jsx|mjs|cjs|map)$/);
    }
    expect(entries.some((name) => name.includes('node_modules'))).toBe(false);
    expect(entries.some((name) => name.includes('/src/'))).toBe(false);
  });

  it('carries only the manifest, the readme, the version pin and config JSON', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    expect(result.entries).toEqual([
      'adminium-export/README.md',
      'adminium-export/config/connections.json',
      'adminium-export/config/overrides.json',
      'adminium-export/config/pages.json',
      'adminium-export/config/rolePermissions.json',
      'adminium-export/config/roles.json',
      'adminium-export/config/settings.json',
      'adminium-export/config/snapshots.json',
      'adminium-export/config/views.json',
      'adminium-export/manifest.json',
      'adminium-export/package.json',
    ]);
  });

  it("says so in the README's first heading, so nobody reads it as a source download", async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const readme = strFromU8(entries[README_PATH] as Uint8Array);

    expect(readme).toContain('This is configuration, not source code');
    expect(readme).toContain('Adminium does not emit code');
    expect(readme).toContain('adminium import-zip');
    // and it must be honest about what it does NOT contain
    expect(readme).toContain('your database contents');
  });

  it('pins the exact adminium version rather than shipping a copy of the runtime', async () => {
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      appVersion: '0.5.0',
    });
    const entries = await readEntries(result.path);
    const pkg = JSON.parse(strFromU8(entries['adminium-export/package.json'] as Uint8Array));
    // Scoped, never the bare `adminium`: that unscoped npm name is an
    // unrelated third party's package, so a bundle pinning it would tell the
    // restorer to install a stranger's library.
    expect(pkg.dependencies).toEqual({ [NPM_PACKAGE_NAME]: '0.5.0' });
    expect(NPM_PACKAGE_NAME).not.toBe('adminium');
  });
});

// ─── version replay (§8.2) ───────────────────────────────────────────────────

describe('version replay', () => {
  /**
   * A synthetic v2 build. The shipped chain is empty (CONFIG_VERSION === 1), so
   * simulating the next version is the only honest way to prove the replay path
   * works *today* rather than the day the first real migration lands.
   *
   * Both halves move together, because in a real v2 build they would: the
   * migration produces v2 documents AND the envelope accepts v2. Injecting only
   * the migration would describe a build that cannot exist — one whose migration
   * emits documents its own validator rejects.
   */
  const v1ToV2: ConfigMigration = {
    from: 1,
    to: 2,
    migrate: (doc) => ({
      ...doc,
      config: { ...(doc.config as Record<string, unknown>), pageSize: 100 },
    }),
  };
  const v2EnvelopeSchema = { safeParse: (doc: unknown) => v2Shape.safeParse(doc) };
  const v2Shape = z.object({
    v: z.literal(2),
    kind: z.string(),
    id: z.string(),
    template: z.string(),
    config: z.record(z.string(), z.unknown()),
  });

  it('imports an older bundle by replaying its config documents forward', async () => {
    // A bundle exported at config v1 …
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      appVersion: '0.5.0',
    });
    expect((await readManifest(result.path)).configVersion).toBe(1);

    const target = await freshInstance();
    try {
      // … imported into a build whose latest config version is 2.
      const imported = await importZip({
        meta: target.meta,
        inPath: result.path,
        configMigrations: [v1ToV2],
        envelopeSchema: v2EnvelopeSchema,
      });
      expect(imported.migratedDocuments).toBe(1);

      const page = await target.meta.db.selectFrom('adminium_pages').selectAll().executeTakeFirst();
      const config = JSON.parse(page?.config as string) as Record<string, unknown>;
      // upgraded to the running build's version …
      expect(config.v).toBe(2);
      // … by the migration, not by a rewrite
      expect((config.config as Record<string, unknown>).pageSize).toBe(100);
    } finally {
      await target.destroy();
    }
  });

  it('refuses a bundle from a newer build rather than silently half-reading it', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });

    // Forge a manifest claiming config v9 — what a future export would look like.
    const entries = await readEntries(result.path);
    const manifest = JSON.parse(strFromU8(entries[MANIFEST_PATH] as Uint8Array));
    manifest.configVersion = 9;
    manifest.appVersion = '9.9.9';
    entries[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(manifest));
    const forged = join(dir, 'forged.zip');
    await writeFile(forged, zipSync(entries));

    const target = await freshInstance();
    try {
      await expect(importZip({ meta: target.meta, inPath: forged })).rejects.toThrow(
        /config version 9.*supports up to 1/s,
      );
      // nothing was written
      const pages = await target.meta.db.selectFrom('adminium_pages').selectAll().execute();
      expect(pages).toHaveLength(0);
    } finally {
      await target.destroy();
    }
  });

  it('replays with the registered chain when none is injected', async () => {
    // Regression guard. The version check and the replay must read the SAME
    // chain. If the default ever diverges — the guard using the registered
    // migrations while the replay runs an empty list — a v1 document would be
    // accepted into a v2 build and stored un-migrated, silently. Here the
    // injected chain says the build is at v2, so an un-replayed v1 document
    // would fail the v2 validator and this test would go red.
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const target = await freshInstance();
    try {
      const imported = await importZip({
        meta: target.meta,
        inPath: result.path,
        configMigrations: [v1ToV2],
        envelopeSchema: v2EnvelopeSchema,
      });
      expect(imported.migratedDocuments).toBe(1);
      const page = await target.meta.db.selectFrom('adminium_pages').selectAll().executeTakeFirst();
      expect((JSON.parse(page?.config as string) as { v: number }).v).toBe(2);
    } finally {
      await target.destroy();
    }
  });

  it('leaves documents at the shipped version untouched when no migration applies', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const target = await freshInstance();
    try {
      // No injection: the real, registered chain (empty at v1) must be used and
      // the document must still validate against the real envelope schema.
      const imported = await importZip({ meta: target.meta, inPath: result.path });
      expect(imported.migratedDocuments).toBe(0);
      const page = await target.meta.db.selectFrom('adminium_pages').selectAll().executeTakeFirst();
      expect((JSON.parse(page?.config as string) as { v: number }).v).toBe(1);
    } finally {
      await target.destroy();
    }
  });

  it('records the meta-schema high-water mark for the target migrator', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const manifest = await readManifest(result.path);
    // The last migration the SOURCE actually applied (§8.2 metaVersion).
    expect(manifest.metaVersion).toMatch(/^\d{4}_/);
  });
});

// ─── malformed input ─────────────────────────────────────────────────────────

describe('import rejects malformed bundles', () => {
  it('rejects a non-zip file', async () => {
    const path = join(dir, 'not-a-zip.zip');
    await writeFile(path, 'this is not a zip');
    const target = await freshInstance();
    try {
      await expect(importZip({ meta: target.meta, inPath: path })).rejects.toThrow(ImportZipError);
    } finally {
      await target.destroy();
    }
  });

  it('rejects a zip that is not an Adminium bundle', async () => {
    const path = join(dir, 'other.zip');
    await writeFile(path, zipSync({ 'hello.txt': new TextEncoder().encode('hi') }));
    const target = await freshInstance();
    try {
      await expect(importZip({ meta: target.meta, inPath: path })).rejects.toThrow(
        /not an Adminium configuration bundle/,
      );
    } finally {
      await target.destroy();
    }
  });

  it('rejects a bundle whose layout version is from the future', async () => {
    const result = await exportZip({ meta: source.meta, outPath: outPath(), dataDir: dir });
    const entries = await readEntries(result.path);
    const manifest = JSON.parse(strFromU8(entries[MANIFEST_PATH] as Uint8Array));
    manifest.formatVersion = 99;
    entries[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(manifest));
    const forged = join(dir, 'forged-layout.zip');
    await writeFile(forged, zipSync(entries));

    const target = await freshInstance();
    try {
      await expect(importZip({ meta: target.meta, inPath: forged })).rejects.toThrow(
        /layout version 99/,
      );
    } finally {
      await target.destroy();
    }
  });
});

// ─── connection scoping ──────────────────────────────────────────────────────

describe('--connection scoping', () => {
  it('exports one connection without instance-level settings or roles', async () => {
    const result = await exportZip({
      meta: source.meta,
      outPath: outPath(),
      dataDir: dir,
      connectionId: source.connectionId,
    });
    expect(result.counts.connections).toBe(1);
    expect(result.counts.pages).toBe(1);
    // Instance-level config is not this connection's to carry.
    expect(result.counts.settings).toBe(0);
    expect(result.counts.roles).toBe(0);

    const manifest = await readManifest(result.path);
    expect(manifest.connectionId).toBe(source.connectionId);
  });
});
