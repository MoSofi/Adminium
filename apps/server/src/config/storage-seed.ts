// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-boot storage-destination seed (37-files-and-storage.md §3.11,
 * D15, 37-T08).
 *
 * WHY A SEED EXISTS AT ALL. On DigitalOcean App Platform there is no
 * persistent local disk — `deploy/do-app.yaml` says so in its own header — so
 * an operator there needs a durable destination BEFORE the first file of any
 * kind is written, not after they notice their logo vanished on a redeploy.
 * The same is true of any ephemeral runtime. Studio can configure one, but the
 * window between "the container came up" and "somebody opened Studio" is
 * exactly when the first export runs.
 *
 * TWO SOURCES, ONE FUNCTION.
 *
 *  1. `ADMINIUM_STORAGE_URL` — explicit, and the grammar carries everything:
 *       s3://<bucket>[/<prefix>]?endpoint=&region=&accessKey=&secretKey=&pathStyle=1&publicBaseUrl=
 *       webdav://<user>:<pass>@<host>[/<path>]?publicBaseUrl=
 *       file:///abs/path
 *  2. The `AWS_*` quartet — implicit, and it exists for one reason: `fly
 *     storage create` writes `AWS_ENDPOINT_URL_S3`, `AWS_REGION`,
 *     `BUCKET_NAME`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` into the
 *     app's secrets and tells the user they are done. Reading them makes Fly +
 *     Tigris genuinely zero-config. This is the ONLY place in the server that
 *     reads an `AWS_*` variable, deliberately: an ambient credential picked up
 *     somewhere else would be a surprise, not a feature.
 *
 * THE `ADMINIUM_SOURCE_URL` DISCIPLINE, VERBATIM: it runs once, on a boot where
 * NO destination row exists; it never overrides; it never re-creates; and it
 * logs exactly what it did. An instance where somebody has already configured
 * storage ignores the variable and says so. There is no second key here (unlike
 * the source seed's retry) because a destination that fails to probe is still a
 * usable row an operator can FIX in Studio — a wrong bucket name is editable,
 * where a wrong DSN was not.
 */

import { destinationsRepo, type MetaDb, type DsnCrypto, type StorageDestination } from '@adminium/meta';

export interface StorageSeedEnv {
  ADMINIUM_STORAGE_URL?: string | undefined;
  AWS_ENDPOINT_URL_S3?: string | undefined;
  AWS_REGION?: string | undefined;
  BUCKET_NAME?: string | undefined;
  AWS_ACCESS_KEY_ID?: string | undefined;
  AWS_SECRET_ACCESS_KEY?: string | undefined;
}

export interface SeedStorageDestinationOptions {
  meta: MetaDb;
  crypto: DsnCrypto;
  env: StorageSeedEnv;
  log: (message: string) => void;
  warn: (message: string) => void;
  now?: number | undefined;
}

export type SeedStorageDestinationResult =
  | { kind: 'skipped'; reason: 'nothing-configured' | 'already-configured' }
  | { kind: 'refused'; message: string }
  | { kind: 'seeded'; destination: StorageDestination; source: 'url' | 'aws-env' };

/** What a parsed source amounts to, before it becomes a row. */
interface SeedPlan {
  name: string;
  driver: StorageDestination['driver'];
  config: Record<string, unknown>;
  secret?: Record<string, string> | undefined;
  /** For the log line — never the credential. */
  describe: string;
}

class SeedRefusal extends Error {}

function requireParam(params: URLSearchParams, key: string, what: string): string {
  const value = params.get(key);
  if (value === null || value === '') throw new SeedRefusal(`${what} is required (${key}=…)`);
  return value;
}

/**
 * `s3://<bucket>[/<prefix>]?…`
 *
 * The bucket is the HOST, not the first path segment, so a prefix is expressed
 * the way a path is and a bucket name cannot be confused with one. `endpoint`
 * is optional — absent means AWS, whose endpoint the driver derives from the
 * region.
 */
function planS3(url: URL): SeedPlan {
  const bucket = url.hostname;
  if (bucket === '') throw new SeedRefusal('the bucket name is missing (s3://<bucket>)');
  const prefix = url.pathname.replace(/^\/+|\/+$/g, '');
  const endpoint = url.searchParams.get('endpoint');
  const publicBaseUrl = url.searchParams.get('publicBaseUrl');
  const pathStyle = url.searchParams.get('pathStyle');

  return {
    name: bucket,
    driver: 's3',
    config: {
      ...(endpoint === null || endpoint === '' ? {} : { endpoint }),
      // `auto` is what R2 and Tigris want, and it is the safer default for a
      // custom endpoint than guessing an AWS region name.
      region: url.searchParams.get('region') ?? (endpoint === null ? 'us-east-1' : 'auto'),
      bucket,
      ...(prefix === '' ? {} : { prefix }),
      // A custom endpoint means a self-hosted or single-host target far more
      // often than not, so path-style is the default there; AWS gets
      // virtual-host. Either can be forced.
      forcePathStyle: pathStyle === null ? endpoint !== null : pathStyle === '1' || pathStyle === 'true',
      ...(publicBaseUrl === null || publicBaseUrl === '' ? {} : { publicBaseUrl }),
    },
    secret: {
      accessKeyId: requireParam(url.searchParams, 'accessKey', 'the access key'),
      secretAccessKey: requireParam(url.searchParams, 'secretKey', 'the secret key'),
    },
    describe: `s3 bucket ${bucket}${endpoint === null ? '' : ` at ${endpoint}`}`,
  };
}

/** `webdav://<user>:<pass>@<host>[/<path>]?publicBaseUrl=` */
function planWebdav(url: URL): SeedPlan {
  if (url.hostname === '') throw new SeedRefusal('the host is missing (webdav://<host>/<path>)');
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const publicBaseUrl = url.searchParams.get('publicBaseUrl');
  // `webdav://` and `webdavs://` decide the transport; the stored config is an
  // http(s) URL because that is what the driver dials.
  const scheme = url.protocol === 'webdavs:' ? 'https' : 'http';
  const path = url.pathname.replace(/\/+$/, '');

  return {
    name: url.hostname,
    driver: 'webdav',
    config: {
      url: `${scheme}://${url.host}${path}`,
      ...(publicBaseUrl === null || publicBaseUrl === '' ? {} : { publicBaseUrl }),
    },
    ...(username === '' ? {} : { secret: { username, password } }),
    describe: `webdav ${scheme}://${url.host}${path}`,
  };
}

/** `file:///abs/path` — a directory on this box that is not the default one. */
function planLocal(url: URL): SeedPlan {
  // THREE SLASHES, and the third is load-bearing. WHATWG parses
  // `file://relative/path` as host `relative` + pathname `/path`, so a missing
  // slash would silently seed the root `/path` — a real directory, on the wrong
  // machine's idea of the filesystem, that the operator never named. A host is
  // never part of this grammar, so its presence is the typo.
  if (url.hostname !== '') {
    throw new SeedRefusal(
      `an absolute path is required (file:///abs/path — note the three slashes; "${url.hostname}" was read as a host name)`,
    );
  }
  const root = decodeURIComponent(url.pathname);
  if (root === '' || !root.startsWith('/')) throw new SeedRefusal('an absolute path is required (file:///abs/path)');
  return {
    name: root.split('/').filter(Boolean).at(-1) ?? 'files',
    driver: 'local',
    config: { root },
    describe: `local directory ${root}`,
  };
}

export function parseStorageUrl(raw: string): SeedPlan {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SeedRefusal('it is not a URL');
  }
  switch (url.protocol) {
    case 's3:':
      return planS3(url);
    case 'webdav:':
    case 'webdavs:':
      return planWebdav(url);
    case 'file:':
      return planLocal(url);
    default:
      throw new SeedRefusal(
        `the scheme ${url.protocol.replace(':', '')} is not one Adminium stores files with (use s3://, webdav:// or file://)`,
      );
  }
}

/** The Fly/Tigris quartet, which `fly storage create` writes for you (D15). */
function planFromAwsEnv(env: StorageSeedEnv): SeedPlan | null {
  const endpoint = env.AWS_ENDPOINT_URL_S3;
  const bucket = env.BUCKET_NAME;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  // All four or none: three of them is a half-configured environment, and
  // guessing the fourth is how a seed writes a destination nobody meant.
  if (
    endpoint === undefined ||
    endpoint === '' ||
    bucket === undefined ||
    bucket === '' ||
    accessKeyId === undefined ||
    accessKeyId === '' ||
    secretAccessKey === undefined ||
    secretAccessKey === ''
  ) {
    return null;
  }
  return {
    name: bucket,
    driver: 's3',
    config: {
      endpoint,
      region: env.AWS_REGION ?? 'auto',
      bucket,
      // Tigris and R2 both issue per-bucket hostnames.
      forcePathStyle: false,
    },
    secret: { accessKeyId, secretAccessKey },
    describe: `s3 bucket ${bucket} at ${endpoint}`,
  };
}

/**
 * Run the seed. Safe to call on every boot, and from every boot path: it
 * decides for itself whether there is anything to do, and it never throws.
 *
 * THE CATCH-ALL IS THE SIBLING'S, FOR THE SIBLING'S REASON
 * (`connections/seed.ts`). This runs inside `adminium start`, which is a
 * container's PID 1, and the once-only gate below reads
 * `adminium_storage_destinations` — a table that arrives with migration 0024.
 * `adminium start --skip-migrate` against a store older than that, or any meta
 * store that will not answer, would otherwise throw straight out of `run()`
 * and crash-loop the container over a variable whose entire job is to save an
 * operator a trip to Studio. An unmigrated store is not a reason for the
 * dashboard not to come up; it is a boot-log line.
 */
export async function seedStorageDestination(
  opts: SeedStorageDestinationOptions,
): Promise<SeedStorageDestinationResult> {
  try {
    return await runSeed(opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts.warn(`Could not seed the storage destination: ${message}`);
    return { kind: 'refused', message };
  }
}

async function runSeed(opts: SeedStorageDestinationOptions): Promise<SeedStorageDestinationResult> {
  const { meta, crypto, env, log, warn } = opts;
  const repo = destinationsRepo(meta, crypto);

  const raw = env.ADMINIUM_STORAGE_URL;
  let plan: SeedPlan | null;
  let source: 'url' | 'aws-env';
  if (raw !== undefined && raw !== '') {
    source = 'url';
    try {
      plan = parseStorageUrl(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A bad value does not stop the boot, for the source seed's reason: the
      // Studio is the only place to see and fix it, and a crash loop hides it.
      warn(`ADMINIUM_STORAGE_URL was not usable: ${message}`);
      return { kind: 'refused', message };
    }
  } else {
    source = 'aws-env';
    plan = planFromAwsEnv(env);
  }
  if (plan === null) return { kind: 'skipped', reason: 'nothing-configured' };

  // ONCE. Not "no default" — ANY destination row means somebody has configured
  // storage, and a seed that added a second one would be exactly the surprise
  // the source seed's fourth answer rules out.
  if (!(await repo.isEmpty())) {
    // WARN, not `log`. "I set the variable and nothing happened" is the one
    // outcome here an operator has to act on, and `composeServer` routes `log`
    // to debug — which on desktop and every embedder is the ONLY call site, at
    // a default level of `info`. At `log` this line would be invisible exactly
    // where it is the only explanation.
    warn(
      source === 'url'
        ? 'ADMINIUM_STORAGE_URL ignored — this instance already has a storage destination.'
        : 'AWS storage variables ignored — this instance already has a storage destination.',
    );
    return { kind: 'skipped', reason: 'already-configured' };
  }

  const destination = await repo.create(
    {
      name: plan.name,
      driver: plan.driver,
      config: plan.config,
      ...(plan.secret === undefined ? {} : { secret: plan.secret }),
      makeDefault: true,
    },
    opts.now,
  );
  log(
    source === 'url'
      ? `storage destination seeded from ADMINIUM_STORAGE_URL: ${plan.name} (${plan.describe})`
      : `storage destination seeded from the AWS storage variables: ${plan.name} (${plan.describe})`,
  );
  return { kind: 'seeded', destination, source };
}
