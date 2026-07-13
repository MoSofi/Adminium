/**
 * DSN parsing, masking, and the connection-string SSRF guard
 * (08-server-api.md §7 item 2). Scheme allowlist `postgres|mysql|sqlite`;
 * cloud-metadata addresses are always refused. Loopback blocking is
 * production-only by default — a DB on the same box is the normal self-host
 * case (§7's `ADMINIUM_NETWORK_POLICY=strict` tightens it further at M15).
 */

import { AppError, ValidationFailedError } from '../errors.js';

export interface ParsedDsn {
  scheme: 'postgres' | 'mysql' | 'sqlite';
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  /** SQLite: the file path. */
  file: string | null;
}

const SCHEME_ALIASES: Readonly<Record<string, ParsedDsn['scheme']>> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlite: 'sqlite',
  file: 'sqlite',
};

const DEFAULT_PORTS: Readonly<Record<ParsedDsn['scheme'], number | null>> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: null,
};

/** Parse + allowlist a DSN; throws 422 `VALIDATION_FAILED` outside the grammar. */
export function parseDsn(dsn: string): ParsedDsn {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(dsn);
  const rawScheme = schemeMatch?.[1]?.toLowerCase();
  const scheme = rawScheme === undefined ? undefined : SCHEME_ALIASES[rawScheme];
  if (scheme === undefined) {
    throw new ValidationFailedError('Unsupported DSN scheme — postgres, mysql, or sqlite only.', {
      allowed: ['postgres', 'mysql', 'sqlite'],
    });
  }
  if (scheme === 'sqlite') {
    const file = dsn.replace(/^(sqlite:\/\/|sqlite:|file:)/i, '');
    return { scheme, host: null, port: null, database: null, user: null, file };
  }
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ValidationFailedError('Malformed DSN.', {});
  }
  const port = url.port.length > 0 ? Number(url.port) : DEFAULT_PORTS[scheme];
  return {
    scheme,
    host: url.hostname.length > 0 ? url.hostname : null,
    port,
    database: url.pathname.replace(/^\//, '') || null,
    user: url.username.length > 0 ? decodeURIComponent(url.username) : null,
    file: null,
  };
}

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

export interface DsnGuardOptions {
  /** Default: `NODE_ENV === 'production'` at the call site. */
  blockLoopback?: boolean | undefined;
}

/**
 * §7 item 2 guard, run before any dial. Cloud-metadata (169.254.0.0/16) is
 * always blocked; loopback per {@link DsnGuardOptions}. Throws 422.
 */
export function guardDsn(dsn: string, opts: DsnGuardOptions = {}): ParsedDsn {
  const parsed = parseDsn(dsn);
  if (parsed.scheme === 'sqlite') return parsed;
  const host = parsed.host?.toLowerCase() ?? '';
  const octets = ipv4Octets(host);
  if ((octets !== null && octets[0] === 169 && octets[1] === 254) || host === 'metadata.google.internal') {
    throw new ValidationFailedError('DSN host resolves to a blocked address range.', { host });
  }
  const loopback =
    host === 'localhost' || host === '::1' || host === '[::1]' || (octets !== null && octets[0] === 127);
  if (loopback && opts.blockLoopback === true) {
    throw new ValidationFailedError('Loopback DSN hosts are not allowed in production.', { host });
  }
  return parsed;
}

/** `postgres://ava:secret@db.acme.io:5432/prod` → `postgres://ava@db.acme.io:5432/prod`. */
export function maskDsn(dsn: string | null): string | null {
  if (dsn === null) return null;
  let parsed: ParsedDsn;
  try {
    parsed = parseDsn(dsn);
  } catch {
    return null; // never leak an unparseable (possibly credentialed) string
  }
  if (parsed.scheme === 'sqlite') return `sqlite:${parsed.file ?? ''}`;
  const auth = parsed.user === null ? '' : `${parsed.user}@`;
  const port = parsed.port === null ? '' : `:${String(parsed.port)}`;
  const db = parsed.database === null ? '' : `/${parsed.database}`;
  return `${parsed.scheme}://${auth}${parsed.host ?? ''}${port}${db}`;
}

/**
 * True when two DSNs point at the same physical database (host+port+db, or
 * the same SQLite file) — drives the meta-placement same-db check
 * (01-architecture.md §3.1).
 */
export function sameDatabase(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  let pa: ParsedDsn;
  let pb: ParsedDsn;
  try {
    pa = parseDsn(a);
    pb = parseDsn(b);
  } catch {
    return false;
  }
  if (pa.scheme !== pb.scheme) return false;
  if (pa.scheme === 'sqlite') return pa.file !== null && pa.file === pb.file;
  const hostA = pa.host?.toLowerCase() ?? '';
  const hostB = pb.host?.toLowerCase() ?? '';
  const localA = hostA === 'localhost' || hostA === '127.0.0.1' ? 'localhost' : hostA;
  const localB = hostB === 'localhost' || hostB === '127.0.0.1' ? 'localhost' : hostB;
  return localA === localB && pa.port === pb.port && pa.database === pb.database;
}

/** 409 `META_PLACEMENT_INVALID` (01-architecture.md §3.1, enforced server-side). */
export class MetaPlacementError extends AppError {
  override readonly name = 'MetaPlacementError';

  constructor(message: string, details?: unknown) {
    super(409, 'META_PLACEMENT_INVALID', message, details);
  }
}
