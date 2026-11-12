// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The guard on a meta-store DSN that somebody TYPED INTO A ROUTE:
 * `POST /setup/probe`, `POST /setup/adopt` and `POST /meta/relocate`.
 *
 * ── WHY THESE NEED ONE ──────────────────────────────────────────────────────
 * All three open the string they are given with the meta store's own drivers,
 * which never went through the source-connection guard. So `?host=` could move
 * the dial elsewhere, the cloud metadata address was a valid target, and a
 * SQLite path could name any file the server can open. The setup pair is open
 * to whoever holds the setup token, which on a hosted trial is a stranger.
 *
 * ── WHAT IT RUNS ────────────────────────────────────────────────────────────
 * The source-connection parser itself (`guardDsn`): the query-parameter
 * allow-list, the scheme that must match the engine, the host read the way
 * the resolver reads it, and the metadata check. Then the host is looked up
 * the way the driver will (`checkHost`, `net/address-guard.ts`), so a NAME
 * that answers with a metadata address is refused too, and a name that does
 * not resolve is a 502 `HOST_LOOKUP_FAILED`, as on the other guards. A SQLite
 * path must be a file inside the data dir, with no `..` and no link that
 * leads out of it.
 *
 * ── WHAT IT DOES NOT ────────────────────────────────────────────────────────
 * Loopback and private addresses stay allowed. A meta store on the same server
 * (a local Postgres beside Adminium) is the ordinary operator setup, and the
 * database-host list only governs source connections. The env URL
 * (`ADMINIUM_META_URL`) is operator configuration and never comes through
 * here: it is also the way to keep a store outside the data dir.
 *
 * Trial mode and the hosted profile close all three routes outright: each
 * answers 403 `OFF_BY_OPERATOR` first thing, before the setup token is even
 * read, because on a trial the stranger holds that token ({@link META_FIXED}).
 *
 * The URL the server boots on (`ADMINIUM_META_URL`, or the bootstrap file a
 * relocation or adoption wrote) is checked at boot by {@link guardBootMetaUrl}.
 */
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { guardDsn } from '../connections/dsn.js';
import { HostLookupFailedError, ValidationFailedError } from '../errors.js';
import { checkHost, type HostLookup } from '../net/address-guard.js';
import { metaEngineFromUrl, sqlitePathFromUrl, type MetaEngine } from './store.js';

export interface TypedMetaDsnOptions {
  /** `ADMINIUM_DATA_DIR`, as the server was started with it. */
  dataDir: string;
  /** Test seam: the host lookup. Default: the one the drivers make. */
  lookup?: HostLookup | undefined;
}

/** Why the meta store cannot move under trial mode and the hosted profile: the operator's environment fixes it. */
export const META_FIXED = 'The operator fixes where this installation keeps its own data, so it cannot be moved or adopted here.';

const OUTSIDE_DATA_DIR =
  'A SQLite meta store chosen here must be a file inside the data folder (ADMINIUM_DATA_DIR). Pick a path inside it, or set ADMINIUM_META_URL to keep the store somewhere else.';

/**
 * The real path `path` would have once created: the deepest part that exists,
 * links resolved, plus the rest as typed. `null` when a part of it is a link
 * whose target is missing, because opening it would create that target,
 * wherever it is.
 */
async function realPathOfTarget(path: string): Promise<string | null> {
  const tail: string[] = [];
  let existing = path;
  for (;;) {
    try {
      return join(await realpath(existing), ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A file where a folder should be: nothing could be created there.
      if (code === 'ENOTDIR') return null;
      if (code !== 'ENOENT') throw error;
    }
    const isDanglingLink = await lstat(existing).then(
      () => true,
      () => false,
    );
    if (isDanglingLink) return null;
    const parent = dirname(existing);
    if (parent === existing) return null;
    tail.unshift(basename(existing));
    existing = parent;
  }
}

async function assertInsideDataDir(file: string, dataDir: string): Promise<void> {
  // `file:` left over after the scheme is a SQLite URI filename, which can name
  // another file or a VFS when URI handling is switched on.
  if (/^file:/i.test(file)) {
    throw new ValidationFailedError('Write the SQLite path without a second "file:" in front of it.', {});
  }
  if (file.split(/[\\/]/).includes('..')) {
    throw new ValidationFailedError(
      'The SQLite path may not contain "..". Write the file\'s full path inside the data folder (ADMINIUM_DATA_DIR).',
      {},
    );
  }
  // Relative paths are opened from the working directory, as the driver opens them.
  const target = await realPathOfTarget(resolve(file));
  const root = await realpath(resolve(dataDir)).catch(() => resolve(dataDir));
  if (target === null || !target.startsWith(`${root}${sep}`)) {
    throw new ValidationFailedError(OUTSIDE_DATA_DIR, {});
  }
}

/**
 * Refuse a typed meta-store DSN before anything dials it. Returns the engine
 * it names. Throws `MetaUrlError` for a scheme no meta store speaks (the
 * routes answer that 400 `META_DSN_INVALID`, as they always have) and a 422
 * `VALIDATION_FAILED` naming what to remove or change for everything else.
 */
export async function guardTypedMetaDsn(dsn: string, opts: TypedMetaDsnOptions): Promise<MetaEngine> {
  const engine = metaEngineFromUrl(dsn);
  if (engine !== 'sqlite') {
    const parsed = guardDsn(dsn, { engine, blockLoopback: false });
    if (parsed.host !== null) {
      // Loopback and private pass (an operator's own store); metadata never does, however the name answers.
      const check = await checkHost(parsed.host, { failClosed: true, lookup: opts.lookup });
      if (!check.ok) {
        if (check.reason === 'unresolved') throw new HostLookupFailedError(check.host);
        throw new ValidationFailedError('Host resolves to a blocked address range.', { host: check.host, address: check.address });
      }
    }
    return engine;
  }
  const file = sqlitePathFromUrl(dsn);
  // Nothing on disk: the probe uses it, and relocation refuses it on its own.
  if (file === ':memory:') return engine;
  await assertInsideDataDir(file, opts.dataDir);
  return engine;
}
