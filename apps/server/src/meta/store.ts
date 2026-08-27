// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Meta-store resolution + connection (01-architecture.md §3.1, §7.1, §7.2).
 *
 * The single place that answers "where does the meta store live, and how do I
 * open it?" — shared by every front door (`adminium start`, `adminium migrate`,
 * the init wizard, and, later, Docker/Electron wrappers), so none of them can
 * disagree about precedence.
 *
 * Precedence (§7.2 "Environment always wins over this file"):
 *   1. `ADMINIUM_META_URL`                       → source `env`
 *   2. `<dataDir>/adminium.json` `metaUrl`       → source `bootstrap`
 *      (AES-256-GCM token, decrypted with the ADMINIUM_SECRET-derived key)
 *   3. embedded SQLite `<dataDir>/meta.db`       → source `embedded`
 *      — the §3.1 OD-1 fallback for a bare non-interactive `adminium start`;
 *      callers surface the documented startup warning.
 *
 * Drivers are imported dynamically and only for the dialect actually in use: a
 * SQLite install must not need `pg` on disk, and a missing driver has to say
 * which package to install rather than throw a bare MODULE_NOT_FOUND.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  destroyMetaDb,
  initMetaDb,
  postgresInt8AsNumber,
  type MetaDb,
} from '@adminium/meta';

import { bootstrapPath, readBootstrap } from '../config/bootstrap.js';
import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

/**
 * HKDF purpose scope for the bootstrap `metaUrl` token. Distinct from
 * `adminium:dsn:v1` (source DSNs) and the LLM key salt so the three ciphertexts
 * can never be decrypted with each other's key (01 §7.1 purpose-scoping).
 */
export const META_URL_KEY_SALT = 'adminium:meta-url:v1';

export interface MetaUrlCrypto {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

/** The AES-256-GCM closures the bootstrap `metaUrl` is stored under. */
export function metaUrlCryptoFromSecret(masterSecret: string): MetaUrlCrypto {
  const key = deriveKey(masterSecret, META_URL_KEY_SALT);
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    decrypt: (token) => decryptSecret(token, key),
  };
}

/** Meta dialects the v1 self-host build supports (BRIEF §3). */
export type MetaEngine = 'postgres' | 'mysql' | 'sqlite';

/** Which layer supplied the meta DSN — drives the §3.1 OD-1 startup warning. */
export type MetaUrlSource = 'env' | 'bootstrap' | 'embedded';

export interface ResolvedMetaUrl {
  /** The DSN to connect with (`sqlite:<path>` for the embedded fallback). */
  url: string;
  engine: MetaEngine;
  source: MetaUrlSource;
}

export class MetaUrlError extends Error {
  override readonly name = 'MetaUrlError';
}

/**
 * `<dataDir>/adminium.json` exists but its `metaUrl` will not decrypt under the
 * current `ADMINIUM_SECRET` (§7.2).
 *
 * WHY THIS DESERVES ITS OWN ERROR. The underlying failure is a
 * `SecretIntegrityError` reading "decryption failed — token was tampered with
 * or the key is wrong", which is true and completely unactionable: it names no
 * file, no variable, and no way out. It is also the single most likely thing to
 * go wrong on a second run, because the documented way to obtain a secret —
 * `export ADMINIUM_SECRET=$(openssl rand -hex 32)` — produces a DIFFERENT value
 * every time it is evaluated. Anyone who opens a new terminal and re-runs the
 * quickstart lands here, having done exactly what they were told.
 *
 * The message is written to be complete on its own rather than relying on a CLI
 * hint, because the same failure surfaces from `adminium start`, `migrate`, and
 * the Docker image's CMD — where the only thing anyone sees is a log line.
 */
export class MetaSecretMismatchError extends Error {
  override readonly name = 'MetaSecretMismatchError';
  constructor(
    readonly bootstrapFile: string,
    cause?: unknown,
  ) {
    super(
      `Could not read ${bootstrapFile} — it was encrypted with a different ADMINIUM_SECRET.\n` +
        '\n' +
        'That file remembers where Adminium keeps its own data. It is encrypted with the\n' +
        'ADMINIUM_SECRET that was set the first time you ran setup, and the current one\n' +
        'does not match. Note that `openssl rand -hex 32` produces a new value every time\n' +
        'you run it — re-running the quickstart in a fresh terminal is the usual cause.\n' +
        '\n' +
        'Either:\n' +
        `  • set ADMINIUM_SECRET back to the value used before, or\n` +
        `  • delete ${bootstrapFile} and set up again.\n` +
        '\n' +
        'Deleting it only makes Adminium forget where its own store lives — your database\n' +
        'is untouched. If that store was PostgreSQL or MySQL, point ADMINIUM_META_URL at\n' +
        'the same DSN afterwards so the existing users and pages are picked back up.',
      cause === undefined ? undefined : { cause },
    );
  }
}

export class MetaDriverMissingError extends Error {
  override readonly name = 'MetaDriverMissingError';
  constructor(
    readonly engine: MetaEngine,
    readonly pkg: string,
    cause?: unknown,
  ) {
    super(
      `The ${engine} meta store needs the "${pkg}" package, which is not installed. ` +
        `Install it (\`npm install ${pkg}\`) or point ADMINIUM_META_URL at a different engine.`,
      cause === undefined ? undefined : { cause },
    );
  }
}

/** Docs entry for the placement decision — the one page this error is short for. */
const META_STORE_DOCS = 'https://docs.adminium.dev/self-hosting/meta-store/';

/** The two supported placements, spelled as copy-pasteable DSNs. */
const PLACEMENT_CHOICES =
  '  • a separate database — recommended\n' +
  "      ADMINIUM_META_URL='postgres://adminium:pass@meta-host:5432/adminium_meta'\n" +
  '  • or your source database, with a dedicated schema\n' +
  "      ADMINIUM_META_URL='postgres://adminium_rw:pass@your-db:5432/mydb'";

/** Where a configured (non-fallback) SQLite path came from, so the fix names a knob. */
function configuredOrigin(source: Exclude<MetaUrlSource, 'embedded'>): string {
  return source === 'env'
    ? 'That path came from ADMINIUM_META_URL.'
    : 'That path came from the metaUrl remembered in adminium.json under ADMINIUM_DATA_DIR.\n' +
        'ADMINIUM_META_URL overrides it — the environment always wins (§7.2).';
}

/**
 * The SQLite meta store's file could not be created or opened: a read-only
 * container mount, a serverless filesystem (Vercel, Lambda), a volume the
 * process user cannot write — or, rarely, a full disk.
 *
 * WHY THIS DESERVES ITS OWN ERROR. Same charge as {@link MetaSecretMismatchError},
 * and this path never got the same treatment. The raw failure is a bare
 * `EACCES: permission denied, mkdir '/var/task/data'` from the mkdir, or — when
 * the directory exists but is not writable, so the recursive mkdir no-ops —
 * better-sqlite3's even barer `unable to open database file`. Both are true and
 * unactionable: neither names the meta store, ADMINIUM_META_URL, or the fact
 * that two supported placements exist.
 *
 * It is also the one failure {@link embeddedMetaWarning} cannot reach. That
 * warning — "set ADMINIUM_META_URL for production" — prints only when the
 * fallback SUCCEEDS, so in the single environment where the fallback is
 * impossible, the sentence that resolves it never fires.
 *
 * Worth stating precisely because the fix is so cheap: with ADMINIUM_META_URL
 * pointed at Postgres or MySQL, an unwritable ADMINIUM_DATA_DIR does not block
 * boot at all. Nothing writes there eagerly — `writeBootstrap` runs only from
 * `init`/`relocate`, and file storage mkdirs lazily on first write. This error is
 * the only thing standing between a read-only filesystem and a working server.
 *
 * The OS reason is quoted verbatim rather than paraphrased: the catch is broad
 * enough to see ENOSPC or ENOTDIR too, and the headline must not out-claim it.
 */
export class MetaStoreUnwritableError extends Error {
  override readonly name = 'MetaStoreUnwritableError';
  constructor(
    /**
     * ABSOLUTE. ADMINIUM_DATA_DIR defaults to a relative `./data`, and this
     * message is typically read from a container log on another machine — see
     * the same note on {@link MetaSecretMismatchError}.
     */
    readonly file: string,
    readonly source: MetaUrlSource,
    cause?: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
    super(
      `Could not open Adminium's meta store at ${file}.\n` +
        `The filesystem said: ${reason}\n` +
        '\n' +
        "The meta store is where Adminium keeps its OWN tables (adminium_*: users, roles,\n" +
        'connections, page config, saved views, the audit log). It is not the database you\n' +
        'are building an admin panel for.\n' +
        '\n' +
        (source === 'embedded'
          ? 'Nothing configured one, so Adminium fell back to a SQLite file under\n' +
            'ADMINIUM_DATA_DIR, and this filesystem will not take it. Read-only container\n' +
            'mounts, serverless filesystems (Vercel, Lambda), and volumes the process user\n' +
            'cannot write all land here.\n' +
            '\n' +
            'Set ADMINIUM_META_URL to a real database instead:\n' +
            PLACEMENT_CHOICES +
            '\n\n' +
            'With either set, Adminium starts without a writable ADMINIUM_DATA_DIR — nothing\n' +
            'is written there at boot. (File storage and backups still need one when used.)\n'
          : configuredOrigin(source) +
            '\n\n' +
            'Point it at a writable path, or at a database that needs no local disk:\n' +
            PLACEMENT_CHOICES +
            '\n') +
        '\n' +
        META_STORE_DOCS,
      cause === undefined ? undefined : { cause },
    );
  }
}

/** `sqlite:./data/meta.db`, `sqlite::memory:`, `file:./meta.db` → the file path. */
export function sqlitePathFromUrl(url: string): string {
  const withoutScheme = url.replace(/^(sqlite3?|file):(\/\/)?/, '');
  return withoutScheme === '' ? ':memory:' : withoutScheme;
}

/**
 * Classify a meta DSN by scheme. Unknown/unsupported schemes fail fast with the
 * three supported forms spelled out — the CLI prints this verbatim.
 */
export function metaEngineFromUrl(url: string): MetaEngine {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
    case 'sqlite3':
    case 'file':
      return 'sqlite';
    default:
      throw new MetaUrlError(
        `Unsupported meta-store DSN "${url}". Use postgres://…, mysql://…, or sqlite:<path>.`,
      );
  }
}

export interface ResolveMetaUrlOptions {
  /** `ADMINIUM_META_URL`, when set. */
  metaUrl?: string | undefined;
  /** `ADMINIUM_DATA_DIR` — hosts the bootstrap file and the embedded meta.db. */
  dataDir: string;
  /** `ADMINIUM_SECRET` — derives the key that decrypts the bootstrap `metaUrl`. */
  secret: string;
}

/**
 * Apply the §7.2 precedence and return the DSN to connect with. Never connects
 * and never writes — the wizard decides whether to persist a chosen placement.
 */
export async function resolveMetaUrl(opts: ResolveMetaUrlOptions): Promise<ResolvedMetaUrl> {
  if (opts.metaUrl !== undefined && opts.metaUrl !== '') {
    return { url: opts.metaUrl, engine: metaEngineFromUrl(opts.metaUrl), source: 'env' };
  }

  const bootstrap = await readBootstrap(opts.dataDir);
  if (bootstrap?.metaUrl !== undefined) {
    let url: string;
    try {
      url = metaUrlCryptoFromSecret(opts.secret).decrypt(bootstrap.metaUrl);
    } catch (error) {
      // The only realistic cause is a changed ADMINIUM_SECRET, and the raw
      // crypto error names neither the file nor the variable — see
      // MetaSecretMismatchError.
      // ABSOLUTE, not `bootstrapPath(opts.dataDir)` as-is: ADMINIUM_DATA_DIR
      // defaults to the relative `./data`, so the message used to end with
      // "delete data/adminium.json" — a path that only resolves if you are
      // standing in the directory you happened to launch from. The remedy has
      // to be copy-pasteable from anywhere, including a Docker log read on
      // another machine.
      throw new MetaSecretMismatchError(resolve(bootstrapPath(opts.dataDir)), error);
    }
    return { url, engine: metaEngineFromUrl(url), source: 'bootstrap' };
  }

  // §3.1 OD-1: nothing configured → embedded SQLite under the data dir.
  return {
    url: `sqlite:${join(resolve(opts.dataDir), 'meta.db')}`,
    engine: 'sqlite',
    source: 'embedded',
  };
}

/** The §3.1 OD-1 warning callers print when the embedded fallback is in play. */
export function embeddedMetaWarning(url: string): string {
  return (
    `Using embedded SQLite meta store at ${sqlitePathFromUrl(url)} — ` +
    'set ADMINIUM_META_URL for production.'
  );
}

export interface MetaStoreHandle {
  meta: MetaDb;
  /** The DSN this handle was opened with (fed to ConnectionManager `metaDsn`). */
  url: string;
  engine: MetaEngine;
  source: MetaUrlSource;
  /** Release the pool/handle. Safe to call twice. */
  close(): Promise<void>;
}

/**
 * Dynamic driver import. The specifier is computed so the module graph carries
 * no static edge to a driver an install may not have (01 §2.3 keeps `@adminium/meta`
 * driver-free; the composing layer — this one — injects them).
 */
async function importDriver(pkg: string, engine: MetaEngine): Promise<Record<string, unknown>> {
  const specifier = pkg;
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch (error) {
    throw new MetaDriverMissingError(engine, pkg, error);
  }
}

function defaultExport<T>(mod: Record<string, unknown>): T {
  return (mod.default ?? mod) as T;
}

/**
 * Pick a named export off a CJS driver, tolerating both the namespace and the
 * `default` interop shapes (`pg` and `mysql2` differ under NodeNext ESM).
 * Returns `never`-typed factories: the drivers are untyped here on purpose —
 * `@adminium/meta` owns the real Kysely config contract.
 */
function driverExport<T>(mod: Record<string, unknown>, name: string, engine: MetaEngine, pkg: string): T {
  const direct = mod[name];
  const viaDefault = (mod.default as Record<string, unknown> | undefined)?.[name];
  const found = direct ?? viaDefault;
  if (typeof found !== 'function') {
    throw new MetaDriverMissingError(engine, pkg);
  }
  return found as T;
}

export interface ConnectMetaStoreOptions {
  /** Postgres/MySQL pool size; the single-process topology stays small (01 §4.1). */
  poolSize?: number | undefined;
}

/**
 * Open the meta store named by `resolved` and run {@link initMetaDb} (the SQLite
 * FK pragma). Does NOT migrate — `adminium migrate` and the boot sequence decide
 * when the ledger runs.
 */
export async function connectMetaStore(
  resolved: ResolvedMetaUrl,
  opts: ConnectMetaStoreOptions = {},
): Promise<MetaStoreHandle> {
  const poolSize = opts.poolSize ?? 10;
  let meta: MetaDb;

  switch (resolved.engine) {
    case 'postgres': {
      const mod = await importDriver('pg', 'postgres');
      const Pool = driverExport<new (config: unknown) => never>(mod, 'Pool', 'postgres', 'pg');
      meta = createPostgresMetaDb({
        pool: new Pool({
          connectionString: resolved.url,
          max: poolSize,
          types: postgresInt8AsNumber(mod),
        }),
      });
      break;
    }
    case 'mysql': {
      const mod = await importDriver('mysql2', 'mysql');
      const createPool = driverExport<(config: unknown) => never>(mod, 'createPool', 'mysql', 'mysql2');
      meta = createMysqlMetaDb({ pool: createPool({ uri: resolved.url, connectionLimit: poolSize }) });
      break;
    }
    case 'sqlite': {
      const mod = await importDriver('better-sqlite3', 'sqlite');
      const Database = defaultExport<new (path: string) => never>(mod);
      const file = sqlitePathFromUrl(resolved.url);
      // Split out so a `:memory:` store can never be described with a path.
      if (file === ':memory:') {
        meta = createSqliteMetaDb({ database: new Database(file) });
        break;
      }
      try {
        // A first `adminium start` points at <dataDir>/meta.db before <dataDir>
        // exists; better-sqlite3 will not create the parent directory itself.
        mkdirSync(dirname(resolve(file)), { recursive: true });
        // The open is inside the try on purpose: when <dataDir> already exists
        // but is not writable, the recursive mkdir succeeds as a no-op and the
        // failure moves here, as `unable to open database file`.
        meta = createSqliteMetaDb({ database: new Database(file) });
      } catch (error) {
        // Neither raw error names the meta store, the variable that replaces
        // it, or the two placements that work — see MetaStoreUnwritableError.
        throw new MetaStoreUnwritableError(resolve(file), resolved.source, error);
      }
      break;
    }
  }

  await initMetaDb(meta);

  let closed = false;
  return {
    meta,
    url: resolved.url,
    engine: resolved.engine,
    source: resolved.source,
    async close() {
      if (closed) return;
      closed = true;
      await destroyMetaDb(meta);
    },
  };
}

/** Resolve + connect in one step — what every front door actually calls. */
export async function openMetaStore(
  opts: ResolveMetaUrlOptions & ConnectMetaStoreOptions,
): Promise<MetaStoreHandle> {
  const resolved = await resolveMetaUrl(opts);
  return connectMetaStore(resolved, { poolSize: opts.poolSize });
}
