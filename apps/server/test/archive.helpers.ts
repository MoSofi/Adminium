// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fixtures for the instance-archive suites: a meta store on each engine (an
 * EMPTY one too, the shape a fresh target has), a data dir and project folder
 * in a temp dir, and a seeded source instance holding one of everything the
 * archive rules talk about.
 *
 * Postgres and MySQL legs gate on TEST_POSTGRES_URL / TEST_MYSQL_URL like
 * `meta-dialects.ts`; their databases are named `adminium_p75arch_<hex>` so
 * parallel lanes on one server never meet.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  apiKeysRepo,
  connectionsRepo,
  createFirstSuperAdmin,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  filesRepo,
  firstRun,
  newId,
  pagesRepo,
  passwordResetsRepo,
  postgresInt8AsNumber,
  sessionsRepo,
  settingsRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { archiveSigningKey } from '../src/archive/mac.js';
import { encryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { emailSecretKey } from '../src/email/config.js';

export const SECRET = 'archive-test-secret-0123456789abcdef';
export const OTHER_SECRET = 'another-secret-entirely-9876543210';
export const SIGNING = archiveSigningKey({ ADMINIUM_SECRET: SECRET });
export const CRYPTO = dsnCryptoFromSecret(SECRET);

export type EngineName = 'sqlite' | 'postgres' | 'mysql';

export interface Store {
  meta: MetaDb;
  destroy: () => Promise<void>;
}

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

export const AVAILABLE: Record<EngineName, boolean> = { sqlite: true, postgres: PG !== undefined, mysql: MYSQL !== undefined };

const freshName = (): string => `adminium_p75arch_${randomBytes(4).toString('hex')}`;

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** A meta store on `engine`; `migrated: false` is a fresh target (no tables at all). */
export async function makeStore(engine: EngineName, migrated: boolean): Promise<Store> {
  if (engine === 'sqlite') {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    if (migrated) await firstRun(meta);
    return { meta, destroy: async () => meta.db.destroy() };
  }
  if (engine === 'postgres') {
    const base = PG as string;
    const { default: pg } = await import('pg');
    const database = freshName();
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    const meta = createPostgresMetaDb({
      pool: new pg.Pool({
        connectionString: withDatabase(base, database),
        max: 4,
        types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>),
      }),
    });
    if (migrated) await firstRun(meta);
    return {
      meta,
      destroy: async () => {
        await meta.db.destroy();
        const drop = new pg.Client({ connectionString: base });
        await drop.connect();
        await drop.query(`DROP DATABASE IF EXISTS "${database}"`);
        await drop.end();
      },
    };
  }
  const base = MYSQL as string;
  const mysqlP = await import('mysql2/promise');
  const database = freshName();
  const admin = await mysqlP.createConnection({ uri: base });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.end();
  const { createPool } = await import('mysql2');
  const meta = createMysqlMetaDb({ pool: createPool({ uri: withDatabase(base, database), connectionLimit: 4 }) });
  if (migrated) await firstRun(meta);
  return {
    meta,
    destroy: async () => {
      await meta.db.destroy();
      const drop = await mysqlP.createConnection({ uri: base });
      await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await drop.end();
    },
  };
}

export interface Dirs {
  root: string;
  dataDir: string;
  projectRoot: string;
  cleanup: () => Promise<void>;
}

/** A temp folder with a data dir and a project folder side by side (`project/data` would also work). */
export async function makeDirs(): Promise<Dirs> {
  const root = await mkdtemp(join(tmpdir(), 'adminium-archive-'));
  const dataDir = join(root, 'data');
  const projectRoot = join(root, 'project');
  await mkdir(dataDir, { recursive: true });
  return { root, dataDir, projectRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export interface Seeded {
  admin: User;
  sessionTokenHash: string;
  pageId: string;
  fileId: string;
  fileBytes: Buffer;
  sqliteConnectionId: string;
  remoteConnectionId: string;
}

export const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$ZmFrZWhhc2hmb3J0ZXN0cw';

/**
 * One of everything: a super admin with a session, a reset token and an API
 * key; add-on trust and the Designer's live id; an encrypted SMTP setting; app
 * domains (one valid, one not); a page; an upload on disk; a local SQLite
 * source with a row in it; a Postgres source on loopback; and a project folder
 * with the things an archive must leave out.
 */
export async function seedInstance(meta: MetaDb, dirs: Dirs): Promise<Seeded> {
  const admin = await createFirstSuperAdmin(meta, { email: 'ava@example.com', name: 'Ava', passwordHash: PASSWORD_HASH });
  const sessionTokenHash = createHash('sha256').update('cookie-before-archive').digest('hex');
  await sessionsRepo(meta).create({ userId: admin.id, tokenHash: sessionTokenHash, expiresAt: Date.now() + 86_400_000 });
  await passwordResetsRepo(meta).create({ userId: admin.id, kind: 'reset', tokenHash: 'f'.repeat(64), expiresAt: Date.now() + 3_600_000 });
  const roles = await meta.db.selectFrom('adminium_roles').select(['id', 'slug']).execute();
  const viewer = roles.find((role) => role.slug === 'viewer') ?? roles[0];
  await apiKeysRepo(meta).create({ name: 'ci', prefix: 'adm_test', tokenHash: 'e'.repeat(64), roleId: String(viewer?.id) });

  const settings = settingsRepo(meta);
  await settings.set('addOns.deciderTrust', { 'stamps@1.0.0': `sha512-${'A'.repeat(86)}==` });
  await settings.set('designer.live', true);
  await settings.set('designer.liveId', 'live-1234');
  // A project the desktop app made: who it signs in without a password on its own computer.
  await settings.set('designer.ownerId', admin.id);
  await settings.set('designer.localOwnerId', admin.id);
  await settings.set('publicApi.enabled', true);
  await settings.set('email.smtp', {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'mailer',
    passEncrypted: encryptSecret('smtp-password', emailSecretKey(SECRET)),
    from: 'Shop <shop@example.com>',
  } as never);
  await settings.set('surfaces.domains', {
    'shop.example.com': { appKey: 'shop', side: 'customer' },
    'bad host/with-path': { appKey: 'shop', side: 'customer' },
  } as never);

  const page = await pagesRepo(meta).create({ slug: 'orders', type: 'dashboard', title: 'Orders', config: { v: 1, widgets: [] } });

  const fileBytes = Buffer.from('%PDF-1.4 a small invoice\n');
  const fileId = newId('file');
  await filesRepo(meta).create({
    id: fileId,
    filename: 'invoice.pdf',
    mime: 'application/pdf',
    sizeBytes: fileBytes.length,
    sha256: createHash('sha256').update(fileBytes).digest('hex'),
    kind: 'upload',
  });
  await mkdir(join(dirs.dataDir, 'files'), { recursive: true });
  await writeFile(join(dirs.dataDir, 'files', fileId), fileBytes);

  const sqlitePath = join(dirs.root, 'shop.sqlite');
  const db = new BetterSqlite3(sqlitePath);
  db.exec("create table products (id integer primary key, name text); insert into products (name) values ('Teapot');");
  db.close();
  const connections = connectionsRepo(meta, CRYPTO);
  // Both were tested and answered, as connections in use have.
  const local = await connections.create({ name: 'Shop', engine: 'sqlite', introspectDsn: `sqlite:${sqlitePath}`, dataDsn: `sqlite:${sqlitePath}`, status: 'connected' });
  const remote = await connections.create({
    name: 'Warehouse',
    engine: 'postgres',
    status: 'connected',
    introspectDsn: 'postgres://app:pw@127.0.0.1:5432/warehouse',
    dataDsn: 'postgres://app:pw@127.0.0.1:5432/warehouse',
  });

  const project = dirs.projectRoot;
  await mkdir(join(project, 'apps', 'shop', 'site'), { recursive: true });
  await mkdir(join(project, '.adminium', 'designer'), { recursive: true });
  await mkdir(join(project, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(join(project, 'adminium.config.ts'), 'export default {};\n');
  await writeFile(join(project, 'apps', 'shop', 'manifest.json'), '{"key":"shop"}\n');
  await writeFile(join(project, 'apps', 'shop', 'site', 'index.html'), '<h1>Shop</h1>\n');
  await writeFile(join(project, 'apps', '.designer-live.json'), '{"id":"live-1234"}\n');
  await writeFile(join(project, '.env'), 'ADMINIUM_AI_ANTHROPIC_API_KEY=sk-not-for-archives\n');
  await writeFile(join(project, '.adminium', 'designer', 'live.json'), '{"id":"live-1234"}\n');
  await writeFile(join(project, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  await symlink(join(dirs.root, 'shop.sqlite'), join(project, 'linked.sqlite'));

  return { admin, sessionTokenHash, pageId: page.id, fileId, fileBytes, sqliteConnectionId: local.id, remoteConnectionId: remote.id };
}
