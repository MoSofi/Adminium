// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Destination rows → byte drivers (37-files-and-storage.md §3.1, D2, D3).
 *
 * Everything above this line addresses a destination by ID (or by `null`, the
 * implicit local disk); everything below it is a driver. This module is the
 * only place that knows both, and the only place a stored credential is
 * decrypted.
 *
 * THE CACHE IS KEYED ON `id + updatedAt`. Constructing a driver is cheap, but
 * decrypting is not free and the download path resolves a destination per
 * request. Keying on `updatedAt` rather than just `id` is what makes an edit
 * take effect immediately: the operator who fixes a wrong secret in Studio and
 * retries must not be served the driver built from the old one, and a
 * time-based TTL would make "how long until my fix works" a thing to explain.
 *
 * A DISABLED DESTINATION STILL RESOLVES. Disabled means "take no NEW files",
 * not "the files there are gone" — every byte it holds must stay readable, or
 * disabling a destination would be a data-loss button (D2). The store is what
 * refuses to WRITE to one.
 */

import type { DestinationsRepo, StorageDestination } from '@adminium/meta';

import { createLocalDriver } from './drivers/local.js';
import { createS3Driver } from './drivers/s3.js';
import { createWebdavDriver } from './drivers/webdav.js';
import type { FileDriver } from './drivers/driver.js';

/** The implicit destination's sentinel on the wire (D3). */
export const LOCAL_DESTINATION_ID = 'local';

export class UnknownDestinationError extends Error {
  override readonly name = 'UnknownDestinationError';
  constructor(readonly destinationId: string) {
    super(`no storage destination ${JSON.stringify(destinationId)}`);
  }
}

export class DestinationConfigError extends Error {
  override readonly name = 'DestinationConfigError';
}

export interface DestinationResolver {
  /** The driver for a destination id; `null` is this server's disk. */
  driverFor(destinationId: string | null): Promise<FileDriver>;
  /** The row, or `null` for the implicit local destination. */
  rowFor(destinationId: string | null): Promise<StorageDestination | null>;
  /** Build a driver from an UNSAVED row + secret — the Test button before a first save. */
  driverForDraft(draft: DraftDestination): FileDriver;
  /** Where new bytes go: the default destination's id, or `null`. */
  defaultDestinationId(): Promise<string | null>;
  /** Enabled destinations that publish a public base — the ref parser's input. */
  publicBases(): Promise<{ id: string; publicBaseUrl?: string | null | undefined }[]>;
  /** Drop cached drivers (a secret rotation, a test that re-seeds). */
  clearCache(): void;
}

export interface DraftDestination {
  driver: StorageDestination['driver'];
  config: StorageDestination['config'];
  /** Plaintext, as typed into the editor. */
  secret?: string | null | undefined;
}

/**
 * The stored secret is a JSON object per driver, encrypted whole. Parsed here
 * rather than in the repo because the SHAPE is a driver fact and the repo is
 * deliberately driver-agnostic.
 */
function parseSecret(driver: string, raw: string | null): Record<string, string> {
  if (raw === null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DestinationConfigError(`the stored credential for a ${driver} destination is not readable`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DestinationConfigError(`the stored credential for a ${driver} destination is not an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function buildDriver(
  driver: StorageDestination['driver'],
  config: StorageDestination['config'],
  secret: Record<string, string>,
  localRootFallback: string,
): FileDriver {
  switch (driver) {
    case 'local': {
      const root = 'root' in config ? config.root : localRootFallback;
      return createLocalDriver({ root });
    }
    case 's3': {
      if (!('bucket' in config)) throw new DestinationConfigError('an s3 destination needs a bucket');
      const accessKeyId = secret['accessKeyId'];
      const secretAccessKey = secret['secretAccessKey'];
      if (accessKeyId === undefined || secretAccessKey === undefined) {
        throw new DestinationConfigError('an s3 destination needs an access key and a secret key');
      }
      return createS3Driver({
        config,
        credentials: {
          accessKeyId,
          secretAccessKey,
          ...(secret['sessionToken'] === undefined ? {} : { sessionToken: secret['sessionToken'] }),
        },
      });
    }
    case 'webdav': {
      if (!('url' in config)) throw new DestinationConfigError('a webdav destination needs a url');
      const username = secret['username'];
      const password = secret['password'];
      return createWebdavDriver({
        config,
        // Anonymous WebDAV is legal (a share behind a VPN, a read-only mirror),
        // so missing credentials are a valid configuration rather than an error.
        ...(username === undefined || password === undefined ? {} : { credentials: { username, password } }),
      });
    }
  }
}

export interface DestinationResolverOptions {
  repo: DestinationsRepo;
  /** `<dataDir>/files` — the implicit destination's root (D3). */
  localRoot: string;
}

export function createDestinationResolver(opts: DestinationResolverOptions): DestinationResolver {
  const { repo, localRoot } = opts;
  const local = createLocalDriver({ root: localRoot });
  const cache = new Map<string, { updatedAt: number; driver: FileDriver }>();

  async function rowFor(destinationId: string | null): Promise<StorageDestination | null> {
    if (destinationId === null || destinationId === LOCAL_DESTINATION_ID) return null;
    const row = await repo.findById(destinationId);
    if (row === null) throw new UnknownDestinationError(destinationId);
    return row;
  }

  return {
    rowFor,

    async driverFor(destinationId) {
      const row = await rowFor(destinationId);
      if (row === null) return local;

      const cached = cache.get(row.id);
      if (cached !== undefined && cached.updatedAt === row.updatedAt) return cached.driver;

      const secret = parseSecret(row.driver, row.hasSecret ? await repo.getSecret(row.id) : null);
      const driver = buildDriver(row.driver, row.config, secret, localRoot);
      cache.set(row.id, { updatedAt: row.updatedAt, driver });
      return driver;
    },

    driverForDraft(draft) {
      return buildDriver(draft.driver, draft.config, parseSecret(draft.driver, draft.secret ?? null), localRoot);
    },

    async defaultDestinationId() {
      const row = await repo.findDefault();
      // A default that has been disabled is not a default any more: new bytes
      // fall back to this server's disk rather than to a destination the
      // operator has switched off.
      return row === null || row.disabled ? null : row.id;
    },

    async publicBases() {
      const rows = await repo.list();
      return rows
        .filter((row) => !row.disabled && 'publicBaseUrl' in row.config && row.config.publicBaseUrl !== undefined)
        .map((row) => ({
          id: row.id,
          publicBaseUrl: 'publicBaseUrl' in row.config ? row.config.publicBaseUrl : undefined,
        }));
    },

    clearCache() {
      cache.clear();
    },
  };
}
