// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Destination rows → byte drivers.
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

import { guardOutboundUrl } from '../connections/dsn.js';
import { ValidationFailedError } from '../errors.js';
import { checkOutboundUrl, outboundFetch, type OutboundPolicy } from '../net/outbound-check.js';
import { createLocalDriver } from './drivers/local.js';
import { createS3Driver, s3BucketUrl } from './drivers/s3.js';
import { createWebdavDriver } from './drivers/webdav.js';
import type { FileDriver } from './drivers/driver.js';
import { assertStorageRootAllowed, type StorageRootPolicy } from './root-guard.js';

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
  /** Refuse a config whose address this server may not call (422), by how it is written. */
  assertAllowed(driver: StorageDestination['driver'], config: StorageDestination['config']): void;
  /**
   * The whole check, before a config is stored or tested: an S3 or WebDAV
   * address looked up and every address it gives checked (cloud metadata
   * always, this machine in production, the server's own network under
   * `ADMINIUM_NETWORK_POLICY=strict`), and a `local` root against Adminium's
   * own folders and `ADMINIUM_STORAGE_DIRS`. Throws 422 for a refusal, 502
   * `HOST_LOOKUP_FAILED` for a name that could not be looked up.
   */
  checkAllowed(driver: StorageDestination['driver'], config: StorageDestination['config']): Promise<void>;
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

/** The address an S3 or WebDAV destination's requests go to (the S3 bucket host included); null for `local`. */
function destinationAddress(driver: StorageDestination['driver'], config: StorageDestination['config']): string | null {
  if (driver === 's3' && 'bucket' in config) {
    try {
      return s3BucketUrl(config);
    } catch {
      throw new ValidationFailedError('The storage address is not a valid URL.', { config: 'endpoint' });
    }
  }
  if (driver === 'webdav' && 'url' in config) return config.url;
  return null;
}

/**
 * The address a remote destination's requests go to must not be the cloud
 * metadata service (always), or this machine (in production), or, under
 * `ADMINIUM_NETWORK_POLICY=strict`, the server's own network: a file read
 * would stream back whatever answers there. The S3 address is the one the
 * requests use, bucket host included. Judged by how it is WRITTEN, with no
 * lookup: {@link checkDestinationAddress} adds that, and every request the
 * drivers make does it again. Throws 422.
 */
export function assertDestinationAddressAllowed(
  driver: StorageDestination['driver'],
  config: StorageDestination['config'],
  opts: { blockLoopback: boolean; blockPrivate?: boolean | undefined },
): void {
  const address = destinationAddress(driver, config);
  if (address !== null) guardOutboundUrl(address, opts);
}

/**
 * {@link assertDestinationAddressAllowed}, then the name looked up and every
 * address it gives checked under `policy`. For a config about to be stored,
 * tested or seeded. Throws 422, or 502 `HOST_LOOKUP_FAILED`.
 */
export async function checkDestinationAddress(
  driver: StorageDestination['driver'],
  config: StorageDestination['config'],
  policy: OutboundPolicy,
): Promise<void> {
  assertDestinationAddressAllowed(driver, config, policy);
  const address = destinationAddress(driver, config);
  if (address !== null) await checkOutboundUrl(address, policy);
}

/** A `local` config's folder, checked when the policy is known (every composed server passes it). */
function assertLocalRootAllowed(driver: StorageDestination['driver'], config: StorageDestination['config'], roots: StorageRootPolicy | undefined): void {
  if (driver === 'local' && roots !== undefined && 'root' in config) assertStorageRootAllowed(config.root, roots);
}

function buildDriver(
  driver: StorageDestination['driver'],
  config: StorageDestination['config'],
  secret: Record<string, string>,
  localRootFallback: string,
  outbound: OutboundPolicy,
  roots: StorageRootPolicy | undefined,
): FileDriver {
  assertDestinationAddressAllowed(driver, config, outbound);
  // Every request the driver makes looks the host up again, checks it, and connects to what passed.
  const fetchImpl = outboundFetch(outbound);
  // Every time a driver is built, not only at the save: a folder can become a symlink into the data dir later.
  assertLocalRootAllowed(driver, config, roots);
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
        fetchImpl,
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
        fetchImpl,
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
  /** Refuse this machine's own address as a remote destination; default: in production. */
  blockLoopback?: boolean | undefined;
  /** `ADMINIUM_NETWORK_POLICY=strict`: refuse the server's own network too. Default: no. */
  blockPrivate?: boolean | undefined;
  /** Test seam: how an endpoint's host is looked up. Default the system resolver's. */
  lookup?: OutboundPolicy['lookup'];
  /**
   * Where Adminium's own files are, and `ADMINIUM_STORAGE_DIRS`: a `local`
   * destination's root is refused on them (`root-guard.ts`). Unset: no root is
   * refused (tests that build a resolver by hand).
   */
  roots?: StorageRootPolicy | undefined;
}

export function createDestinationResolver(opts: DestinationResolverOptions): DestinationResolver {
  const { repo, localRoot, roots } = opts;
  const blockLoopback = opts.blockLoopback ?? process.env.NODE_ENV === 'production';
  const outbound: OutboundPolicy = { blockLoopback, blockPrivate: opts.blockPrivate === true, lookup: opts.lookup };
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
      const driver = buildDriver(row.driver, row.config, secret, localRoot, outbound, roots);
      cache.set(row.id, { updatedAt: row.updatedAt, driver });
      return driver;
    },

    driverForDraft(draft) {
      return buildDriver(draft.driver, draft.config, parseSecret(draft.driver, draft.secret ?? null), localRoot, outbound, roots);
    },

    assertAllowed(driver, config) {
      assertDestinationAddressAllowed(driver, config, outbound);
    },

    async checkAllowed(driver, config) {
      assertLocalRootAllowed(driver, config, roots);
      await checkDestinationAddress(driver, config, outbound);
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
