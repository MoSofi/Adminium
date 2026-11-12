// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import { parseConnectUrl } from '../connect/providers.js';
import { parseDatabaseHost, type DatabaseHost } from '../connections/dsn.js';
import { addressKind } from '../net/address-guard.js';
import { NETWORK_POLICIES } from '../net/outbound-check.js';
import { invalidTrustedProxies } from '../security/trust-proxy.js';
import { readSecretFiles, SECRET_FILE_SUFFIX, withHeldSecrets, type SecretFileProblem } from './operator-secrets.js';

/**
 * Environment validation. `loadEnv()` is called first in the boot
 * sequence; on invalid input it prints a fail-fast table (variable |
 * problem | hint) to stderr and throws — it never calls `process.exit` so
 * callers (CLI, tests, Electron) decide how to die.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * The DEPLOYMENT WRAPPER this process is running under ("All four deployment
 * modes run the identical `@adminium/server` process; only the wrapper differs").
 * Only the wrapper sets it, and only `desktop` means anything today:
 * `POST /api/v1/auth/desktop-session` is registered ONLY under that
 * value, so a self-host or Docker instance does not expose the boot-token
 * exchange at all — it has no route to attack, not merely a guarded one.
 * Everything that is not the Electron shell is `self-host` (Docker and npx
 * included); `cloud` joins when lands.
 */
export const RUNTIMES = ['self-host', 'desktop'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/** The per-boot token is 32 random bytes, hex. */
export const BOOT_TOKEN_HEX_LENGTH = 64;

const TRUTHY = new Set(['on', 'true', '1']);
const BOOLEANISH = ['on', 'off', 'true', 'false', '1', '0'] as const;

/** Treat empty strings as unset so `FOO= adminium start` behaves like unset FOO. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * The one non-URL value `ADMINIUM_PUBLIC_API_ORIGINS` accepts: "this instance
 * itself".
 *
 * It exists because an origin allow-list CANNOT express same-origin. A
 * same-origin `GET` sends NO `Origin` header at all — the Fetch spec appends
 * one only for non-GET/HEAD methods and for cross-origin CORS requests — and a
 * page cannot add one, `Origin` being a forbidden header name. So no value
 * naming the instance's own origin could ever match, and a hosted customer
 * surface calling `/api/v1/public/*` from the page Adminium itself served was
 * refused with no way to allow it. `self` is a sentinel the GATE understands,
 * not an origin the header is compared against.
 *
 * Special-cased BEFORE the URL parse below: a bare `self` does not parse as a
 * URL and would otherwise be rejected at env-parse time.
 */
export const SELF_ORIGIN_SENTINEL = 'self';

/**
 * One `ADMINIUM_CSP_IMG_HOSTS` entry as the CSP host-source it becomes, or
 * `null` when it is not one this server will write into a header.
 *
 * Accepted: an explicit `https://` or `http://` scheme, a host (optionally led
 * by `*.` for its subdomains), an optional port, and an optional trailing
 * slash — normalized to lowercase with the slash dropped, so two spellings of
 * one origin compare equal.
 *
 * Refused, each for a reason that is about the header rather than taste:
 *
 *  - a bare `*`, or a scheme alone (`https:`) — either one allows images from
 *    ANY host, which is the exact thing this allow-list exists not to do: an
 *    injected script could beacon data out through image requests;
 *  - `*.com`-style wildcards (a single label after `*.`) — a whole top-level
 *    domain is not an image host;
 *  - a path — CSP would match it as a PREFIX, which reads like an exact rule
 *    and is not one;
 *  - quotes, keywords and whitespace — `'unsafe-inline'`, `data:` and friends
 *    are not hosts, and a stray `;` would start a new directive.
 */
export function parseImageHostSource(value: string): string | null {
  const match = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(value.trim());
  if (match === null) return null;
  const [, scheme = '', wildcard = '', host = '', port] = match;
  const labels = host.toLowerCase().split('.');
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((part) => label.test(part))) return null;
  if (wildcard !== '' && labels.length < 2) return null;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return `${scheme.toLowerCase()}://${wildcard}${labels.join('.')}${port === undefined ? '' : `:${port}`}`;
}

/** What `ADMINIUM_MAP_SERVER` and `ADMINIUM_ROUTING_SERVER` say when the operator wants none. */
export const MAP_SERVER_OFF = 'off';
export const DEFAULT_MAP_SERVER = 'https://tiles.openfreemap.org';
export const DEFAULT_ROUTING_SERVER = 'https://router.project-osrm.org';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** A server's host as the URL parser hands it back: a name or an IPv4 address, or an IPv6 address in its brackets. */
const SERVER_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/;

/**
 * One server's origin (`https://host[:port]`) as it is written into a header
 * or called, or `null` when it is not one.
 *
 * Refused: a path, a query, a wildcard, a name and password, a host with
 * anything in it but letters, digits, dots and hyphens (or an IPv6 address in
 * brackets), a port that is not digits, and anything that is not http(s). `http://` is for a server on this machine only, unless
 * `plainHttp` says the address is called by the server and never by a browser
 * (a routing server on the office network).
 */
export function parseServerOrigin(value: string, opts: { plainHttp?: boolean } = {}): string | null {
  const text = value.trim();
  // (A backslash is a slash to the URL parser: it is refused as written, not read as a path's start.)
  if (!/^https?:\/\/[^\s*@/?#\\]+\/?$/i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  // The origin is written into the content policy, where `;` ends a directive, `,` a policy and a quote
  // starts a keyword. A URL may hold all three in its host, so the host is held to what a name or an
  // address is made of, and the port to digits.
  if (!SERVER_HOST.test(url.hostname)) return null;
  const authority = text.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const port = authority.startsWith('[') ? authority.slice(authority.indexOf(']') + 1) : authority.slice(authority.includes(':') ? authority.indexOf(':') : authority.length);
  if (port !== '' && !/^:\d{1,5}$/.test(port)) return null;
  if (url.protocol === 'http:' && opts.plainHttp !== true && !LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.origin;
}

function serverOriginVar(fallback: string, opts: { plainHttp?: boolean }, problem: string) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return fallback;
        if (value.trim().toLowerCase() === MAP_SERVER_OFF) return MAP_SERVER_OFF;
        const origin = parseServerOrigin(value, opts);
        if (origin === null) {
          ctx.addIssue({ code: 'custom', message: problem });
          return z.NEVER;
        }
        return origin;
      }),
  );
}

/**
 * A comma-separated list of absolute folders (`ADMINIUM_SQLITE_DIRS`,
 * `ADMINIUM_STORAGE_DIRS`), resolved; unset or empty is undefined. A relative
 * one would depend on the folder the server was started from, so it fails.
 */
function folderListVar(example: string) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const dirs = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (dirs.length === 0) return undefined;
        const relative = dirs.filter((dir) => !isAbsolute(dir));
        if (relative.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `${relative.map((dir) => `"${dir}"`).join(', ')} ${relative.length === 1 ? 'is' : 'are'} not an absolute folder path, e.g. ${example}`,
          });
          return z.NEVER;
        }
        return dirs.map((dir) => resolve(dir));
      }),
  );
}

/** An on/off variable that is off (or on) when unset. */
function booleanVar(fallback: boolean) {
  return z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? fallback : TRUTHY.has(value))),
  );
}

/** A trial's pools (A6): each pool against a source at most this size, and its default. */
export const TRIAL_SOURCE_POOL_MAX = 3;
/** A trial's meta store pool, unless the operator sets another size. */
export const TRIAL_META_POOL_MAX = 3;

/** A whole number of megabytes, with its default when unset. */
function megabytesVar(fallback: number) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: 'must be a whole number of megabytes' })
      .int('must be a whole number of megabytes')
      .min(1, 'must be at least 1')
      .max(10_000_000, 'must be at most 10000000')
      .optional()
      .transform((value) => value ?? fallback),
  );
}

/** Milliseconds since the epoch of an ISO 8601 date and time WITH its zone, or null. A time with no zone is read differently on every server, so it is refused. */
export function parseZonedTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const [, , month = '', day = '', hour = '', minute = '', second = '0'] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const at = Date.parse(value.trim());
  return Number.isFinite(at) ? at : null;
}

/**
 * An address the server or a browser is sent to that the operator chose (the
 * Upgrade page, the events receiver): https, a host, any path and query, no
 * name and password, no fragment. Plain http only to `loopback`, or for
 * `operator-network` also to a private address (an address, never a name: a
 * name can be made to resolve anywhere). Never a cloud metadata address.
 */
export function parseOperatorUrl(value: string, opts: { plainHttp: 'loopback' | 'operator-network' }): string | null {
  const text = value.trim();
  if (/[\s\\]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '' || url.hostname === '') return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const kind = isIP(host) === 0 ? null : addressKind(host);
  if (kind === 'metadata') return null;
  if (url.protocol === 'http:') {
    const loopback = LOOPBACK_HOSTS.has(url.hostname) || kind === 'loopback';
    const network = kind === 'private';
    if (!(loopback || (opts.plainHttp === 'operator-network' && network))) return null;
  }
  return url.toString();
}

/** One plain mail address with a dotted domain and no name, as the relay pins it. */
const PLAIN_MAIL_ADDRESS = /^[^\s@,;:<>"()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** A report link: one https:// address with no name or password, or `mailto:` one plain address. */
function parseReportUrl(value: string): string | null {
  const text = value.trim();
  if (text.toLowerCase().startsWith('mailto:')) {
    const address = text.slice('mailto:'.length).toLowerCase();
    return PLAIN_MAIL_ADDRESS.test(address) ? `mailto:${address}` : null;
  }
  const url = parseOperatorUrl(text, { plainHttp: 'loopback' });
  return url !== null && url.startsWith('https:') ? url : null;
}

/** `smtp://` or `smtps://` with a host. */
function isSmtpUrl(value: string): boolean {
  if (/[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'smtp:' || url.protocol === 'smtps:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** A plain lower-case host name of two or more labels, its last not all digits: `shop.example.com`. */
export function isPlainDomain(value: string): boolean {
  if (value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((part) => label.test(part))) return false;
  return !/^\d+$/.test(labels[labels.length - 1] ?? '');
}

/** The operator token's floor: 32 random bytes. */
export const OPERATOR_TOKEN_MIN_BYTES = 32;

/**
 * How many bytes a token carries: hex at two characters a byte, base64 (or
 * base64url) at four characters to three. Anything else counts as nothing, and
 * so does one character repeated: that is a placeholder, not a random value.
 */
function tokenBytes(value: string): number {
  if (/^(.)\1*$/.test(value)) return 0;
  if (/^[0-9a-f]+$/i.test(value)) return value.length % 2 === 0 ? value.length / 2 : 0;
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return Math.floor((value.replace(/=+$/, '').length * 3) / 4);
  return 0;
}

/** `10.0.0.2:4601` or `[fd00::2]:4601`: one address (not every address) and a port. */
function parseListenAddress(value: string): { host: string; port: number } | null {
  const match = /^(?:\[([0-9a-fA-F:.]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})$/.exec(value.trim());
  if (match === null) return null;
  const host = (match[1] ?? match[2] ?? '').toLowerCase();
  const port = Number(match[3]);
  if (isIP(host) === 0 || port < 1 || port > 65535) return null;
  if (host === '0.0.0.0' || /^[0:]+$/.test(host)) return null;
  if (addressKind(host) === 'metadata') return null;
  return { host, port };
}

/** The start prompt's limit. */
export const START_PROMPT_MAX_CHARS = 2000;

/** A start prompt's text, or what is wrong with it: no control character but a line break or a tab, 2,000 characters at most. */
function checkStartPrompt(text: string): string | { problem: string } {
  const trimmed = text.replace(/\r?\n$/, '');
  if (trimmed.trim() === '') return { problem: 'holds no prompt' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(trimmed)) return { problem: 'holds a control character' };
  if ([...trimmed].length > START_PROMPT_MAX_CHARS) return { problem: `is longer than ${String(START_PROMPT_MAX_CHARS)} characters` };
  return trimmed;
}

function decodeStartPrompt(value: string): string | { problem: string } {
  const compact = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) return { problem: 'must be base64, e.g. `base64 -w0 prompt.txt`' };
  const bytes = Buffer.from(compact, 'base64');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { problem: 'must decode to UTF-8 text' };
  }
  return checkStartPrompt(text);
}

function readStartPromptFile(path: string): string | { problem: string } {
  if (!isAbsolute(path)) return { problem: `"${path}" is not an absolute file path, e.g. /run/adminium/start-prompt.txt` };
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { problem: `${path} is not a file` };
    // 4 bytes a character at most: a bigger file is the wrong file.
    if (stat.size > START_PROMPT_MAX_CHARS * 4 + 2) return { problem: `is longer than ${String(START_PROMPT_MAX_CHARS)} characters` };
    text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: code === 'ENOENT' ? `${path} does not exist` : code === undefined ? `${path} is not UTF-8 text` : `${path} cannot be read (${code})` };
  }
  return checkStartPrompt(text);
}

/**
 * The trial and operator variables: the operator's word, never a
 * project's. Every one is on `HOST_DECIDED_ENV` (`cli/start-project.ts`), so a
 * folder's `.env` or config cannot set it, and holding a control character
 * fails the boot under a profile ({@link profileIssues}).
 */
export const OPERATOR_DECIDED_ENV = [
  'ADMINIUM_TRIAL_MODE',
  'ADMINIUM_TRIAL_ENDS_AT',
  'ADMINIUM_TRIAL_DATA_MAX_MB',
  'ADMINIUM_TRIAL_UPLOAD_MAX_MB',
  'ADMINIUM_TRIAL_STORAGE_MAX_MB',
  'ADMINIUM_TRIAL_UPGRADE_URL',
  'ADMINIUM_TRIAL_SMTP_URL',
  'ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY',
  'ADMINIUM_TRIAL_MAIL_FROM',
  'ADMINIUM_TRIAL_MAIL_REPORT_URL',
  'ADMINIUM_OPERATOR_NAME',
  'ADMINIUM_HOSTED_MODE',
  'ADMINIUM_PUBLIC_ORIGIN',
  'ADMINIUM_DATABASE_HOSTS',
  'ADMINIUM_LOCAL_DATABASES',
  'ADMINIUM_NETWORK_POLICY',
  'ADMINIUM_SQLITE_DIRS',
  'ADMINIUM_STORAGE_DIRS',
  'ADMINIUM_SETUP_TOKEN',
  'ADMINIUM_DEPLOY_LINK',
  'ADMINIUM_OPERATOR_DOMAINS',
  'ADMINIUM_OPERATOR_TOKEN',
  'ADMINIUM_OPERATOR_LISTEN',
  'ADMINIUM_OPERATOR_EVENTS_URL',
  'ADMINIUM_AI_OPERATOR_ONLY',
  'ADMINIUM_AI_OPERATOR_SCOPE',
  'ADMINIUM_AI_OPERATOR_BUDGET_TOKENS',
  'ADMINIUM_SUPABASE_CONNECT_URL',
  'ADMINIUM_DESIGNER_START_PROMPT_B64',
  'ADMINIUM_DESIGNER_START_PROMPT_FILE',
] as const;

/** The ones that hold only for a trial: set without trial mode, they would do nothing, so the boot says so. */
const TRIAL_ONLY_ENV = OPERATOR_DECIDED_ENV.filter((name) => name.startsWith('ADMINIUM_TRIAL_') && name !== 'ADMINIUM_TRIAL_MODE');

/** The variables this plan added: a control character in one fails the boot on any server. */
const NEW_OPERATOR_ENV: readonly string[] = [
  ...OPERATOR_DECIDED_ENV.filter((name) => /^ADMINIUM_(TRIAL_|HOSTED_MODE|PUBLIC_ORIGIN|OPERATOR_|AI_OPERATOR_|DESIGNER_START_PROMPT)/.test(name)),
];

export const envSchema = z.object({
  ADMINIUM_SECRET: z
    .string({ error: 'is required' })
    .min(16, 'must be at least 16 characters'),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(1, 'must be between 1 and 65535')
      .max(65535, 'must be between 1 and 65535')
      .default(4600),
  ),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  /**
   * The first-boot source-connection seed: the database Adminium generates
   * the back office FROM, as opposed to {@link ADMINIUM_META_URL}, the store
   * it keeps its own state in.
   *
   * STILL NO `DATABASE_URL`, and the test that says so stays. That name was
   * validated here, passed through docker-compose.yml, and documented on two
   * self-hosting pages as "imported as the first source connection on the first
   * boot only" — while ZERO lines of product code read it. A Docker user who
   * followed our own quickstart set it, saw no connection, and had nothing to
   * debug, because there was nothing there to fail. It was removed rather than
   * retrofitted, on the grounds that a real seed has to answer four questions
   * first. It now does, in `connections/seed.ts`: it validates and probes the
   * DSN before storing it; a bad one leaves a connection row in `error` and does
   * NOT stop the boot; the healthy-seed claim makes it idempotent across
   * restarts; and a row deleted afterwards stays deleted.
   *
   * The name is new anyway. `ADMINIUM_*` is what every other variable this
   * schema validates is called, and the pair reads as what it is next to
   * `ADMINIUM_META_URL`. The generic spelling is also part of why the old one
   * looked plausible for so long while being dead — a `DATABASE_URL` in a
   * compose file next to a Postgres service reads as that service's own
   * variable, not as an instruction to us.
   *
   * Optional: an instance with no source configured is the normal first-run
   * wizard path, which is how every non-Docker install starts.
   */
  ADMINIUM_SOURCE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * The one-time setup token, chosen by whoever deploys (a template's generated
   * secret, a Droplet's first boot). Unset ⇒ the server derives one from
   * `ADMINIUM_SECRET` and prints it. Either way the first-run wizard asks for it
   * before it creates the first account (`setup/token.ts`). Spaces and dashes
   * do not count toward the 16.
   */
  ADMINIUM_SETUP_TOKEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(200)
      .refine((value) => value.replace(/[\s-]+/g, '').length >= 16, 'must be at least 16 characters, not counting spaces and dashes')
      .optional(),
  ),
  /**
   * Where uploaded and generated FILES live, seeded once on a boot that has no
   * storage destination configured.
   *
   *   s3://<bucket>[/<prefix>]?endpoint=&region=&accessKey=&secretKey=&pathStyle=1&publicBaseUrl=
   *   webdav://<user>:<pass>@<host>[/<path>]?publicBaseUrl=
   *   file:///abs/path
   *
   * Unset is the ordinary case and means this server's own disk
   * (`<ADMINIUM_DATA_DIR>/files`) — which is right everywhere with a volume and
   * wrong in exactly one place: a runtime with no persistent local disk, where
   * every export, the branding logo and every uploaded file is lost on each
   * redeploy. DigitalOcean App Platform is that place (`deploy/do-app.yaml`).
   *
   * The `ADMINIUM_SOURCE_URL` discipline applies: it runs ONCE, on an instance
   * with no destination rows; it never overrides one somebody configured in
   * Studio; and it logs what it did. A value that will not parse warns and lets
   * the boot continue, because the Studio is where it gets fixed.
   *
   * Fly.io needs none of this: `fly storage create` writes the AWS quartet
   * (`AWS_ENDPOINT_URL_S3`, `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`,
   * `AWS_SECRET_ACCESS_KEY`, plus `AWS_REGION`), which the same seed reads as a
   * fallback. Those five are validated here so a typo is reported rather than
   * silently ignored, and `config/storage-seed.ts` is the ONLY code in the
   * server that reads them — an ambient credential picked up anywhere else
   * would be a surprise, not a feature.
   */
  ADMINIUM_STORAGE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AWS_ENDPOINT_URL_S3: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AWS_REGION: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  BUCKET_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AWS_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AWS_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADMINIUM_META_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * How many connections the meta store's pool may open, on a Postgres or MySQL meta
   * store (an embedded SQLite one has no pool). Unset: 10. Lower it when the meta
   * database is shared, or its role carries a connection limit — a pool larger than
   * the limit fails its extra connections instead of waiting for a free one.
   */
  ADMINIUM_META_POOL_MAX: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
  /**
   * Signs and checks instance archives (`adminium archive`). Unset: a key made
   * from ADMINIUM_SECRET signs them. Set it, the same on every server, to
   * restore an archive into an instance with another secret.
   */
  ADMINIUM_ARCHIVE_KEY: z.preprocess(emptyToUndefined, z.string().min(32, 'must be at least 32 characters').optional()),
  /**
   * How many connections each pool opens against a source database. A source keeps
   * one long-lived pool for pages and the API, and opens short-lived ones to read its
   * schema and collect statistics; each is this size. Unset: 10 for the long-lived
   * pool and the statistics one, 5 for schema reads — up to 25 at once. For a source
   * reached through a tunnel, a pooler, or a role with a connection limit.
   */
  ADMINIUM_SOURCE_POOL_MAX: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
  /**
   * For test servers only: every request limit (the API's per-person and per-address
   * budgets, and the public API's) is multiplied by this. A browser suite that drives
   * one server as a handful of people otherwise spends most of its time waiting out a
   * person's minute. Unset: 1, the limits a real server keeps. Never set it on a server
   * people use: the limits are what stop password guessing and floods. Logged at boot.
   */
  ADMINIUM_RATE_LIMIT_SCALE: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1000).optional()),
  /**
   * Files, exports, backups, add-on packages, the bootstrap file and the
   * embedded meta store.
   *
   * `./data` is the default for an EMBEDDED boot — a container, the Electron
   * shell, a host importing `loadEnv()` — and all of those pass the variable
   * explicitly anyway. A CLI run with the variable unset resolves its own
   * default first (`cli/data-dir.ts`): beside a project, `./data` as ever;
   * launched from a shell in nobody's project, `~/.adminium`, so the instance
   * is still there when the next command runs one directory over.
   */
  ADMINIUM_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('./data')),
  ADMINIUM_LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(LOG_LEVELS).default('info')),
  /**
   * Explicit dashboard-build directory — `resolveStaticRoot`'s override, ahead
   * of the bundled-tarball and monorepo candidates (`cli/static-root.ts`).
   *
   * It is validated here because the implicit candidates can pick the WRONG
   * build: in a dev checkout a stale `apps/server/dashboard/` (a
   * `scripts/bundle-dashboard.mjs` leftover — gitignored, so invisible in
   * `git status`) shadows a fresh `apps/dashboard/dist`, and the resolver's
   * docblock named an override that no production caller actually passed. The
   * desktop shell already sets this exact variable to point its child server at
   * the packaged `resources/` copy (`apps/desktop/src/server/env.ts`); parsing
   * it here makes the same name work for `adminium start`. A directory without
   * `index.html` degrades the way an absent build always has — fall through,
   * else API-only — and `startServer` logs that the override missed.
   */
  ADMINIUM_STATIC_ROOT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * ─── The desktop block ────────────────────────────────────────────────────
   *
   * Set by `apps/desktop`'s `buildServerEnv` when it forks the utilityProcess,
   * and by nothing else. They live HERE, in the schema every front door
   * validates through, rather than being read off `process.env` at the point of
   * use, because {@link Runtime} decides whether a route EXISTS: a value that
   * changes the server's attack surface has to be parsed once, at the boot
   * everything else already fails fast in, not sampled from ambient state deep
   * inside a request handler where a typo reads as "not desktop" and silently
   * ships a server with no auto-login (or, worse, the reverse).
   */
  ADMINIUM_RUNTIME: z.preprocess(emptyToUndefined, z.enum(RUNTIMES).default('self-host')),
  /**
   * The per-boot token the desktop main process generated this launch, which
   * `POST /api/v1/auth/desktop-session` exchanges for a session. NEVER
   * persisted anywhere — it exists in the main process's memory, in this
   * child's environment, and in the one URL that opens the window.
   *
   * Optional even under `ADMINIUM_RUNTIME=desktop`: absent ⇒ the route is not
   * registered and the app lands on the normal login screen. That is a
   * degradation, not a failure, so it must not be a boot error — the desktop
   * shell's own schema (`apps/desktop/src/server/env.ts`) already requires the
   * variable, which is the right place to fail a desktop boot over it.
   */
  ADMINIUM_BOOT_TOKEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(
        new RegExp(`^[0-9a-fA-F]{${String(BOOT_TOKEN_HEX_LENGTH)}}$`),
        `must be ${String(BOOT_TOKEN_HEX_LENGTH)} hex characters (32 bytes)`,
      )
      .optional(),
  ),
  /**
   * The answer, mirrored out of the desktop's `config.json` (`singleUser`) on
   * every boot.
   *
   * Tri-state, for the same reason `ADMINIUM_TELEMETRY` is: `config.json` is the
   * source of truth for this value (the main process owns it, because the
   * settings panel writes it through the preload bridge), and the env var is the
   * only channel that reaches the child at boot. Set ⇒ compose mirrors it into
   * `adminium_settings.desktop.singleUser`, which is what the route reads. Unset
   * ⇒ NOTHING is written and the stored value stands, so a wrapper that has not
   * wired the mirror cannot silently flip a user's answer.
   */
  ADMINIUM_DESKTOP_SINGLE_USER: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? undefined : TRUTHY.has(value))),
  ),
  /**
   * Absolute path to `demo-seed.mjs` — the seed script, which ships in
   * `apps/desktop/resources/`.
   *
   * The server cannot find this itself and must not try: the script's location is
   * a fact about the SHELL's layout (`resources/demo/` in the repo, inside the
   * app bundle once packages it), and `@adminium/server` may not import
   * `@adminium/desktop` to ask. So the shell states it, the same way it states
   * the boot token — and, like the boot token, this being absent is a DEGRADATION
   * rather than an error: `compose.ts` skips the route and the wizard's demo card
   * has nothing to call, while every other first-run path still works. A missing
   * demo must not cost you your app.
   *
   * Only meaningful when {@link Runtime} is `desktop`; compose requires both.
   */
  ADMINIUM_DEMO_SEED_SCRIPT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * The telemetry OVERRIDE, and — unlike its siblings — deliberately tri-state:
   * `true` / `false` / `undefined` (unset).
   *
   * `undefined` MUST survive parsing. The real gate is the `telemetry.enabled`
   * setting, written by the first-run consent screen; an env var that collapsed
   * "unset" to `false` could not be layered over it without silently vetoing
   * every consenting instance. So: set ⇒ the environment wins outright; unset ⇒
   * the consent answer stands.
   *
   * It is layered at all because it was documented as the kill-switch
   * (`self-hosting/telemetry.md`, `env-vars.md`) while being read by NOTHING —
   * an org that put `ADMINIUM_TELEMETRY=off` in its compose file to enforce a
   * no-phone-home policy had exactly no protection if any user later clicked
   * "yes" on the consent screen. A documented control has to be a control.
   */
  ADMINIUM_TELEMETRY: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? undefined : TRUTHY.has(value))),
  ),
  /**
   * May this deployment use network-dependent features at all
   * (`networkFeaturesAllowed`)?
   *
   * READ THIS BEFORE USING IT: THIS IS A POLICY ANSWER, NOT A REACHABILITY
   * ANSWER. It does not mean "the internet is up" and must never be rendered as
   * if it did. The server cannot know whether the network is reachable without
   * making an outbound call, ("Offline is the default, network is the
   * exception. Every network touchpoint … is explicit, user-visible, and
   * individually disableable") is precisely the promise an unprompted
   * reachability probe would break — the desktop offline smoke test fails the
   * build over exactly that request. So the honest thing the server CAN report
   * is the one it owns: whether the operator has permitted outbound features
   * here. The webhooks row is written to match — those rows carry a
   * "Requires internet" HINT rather than a claim, because nothing in this
   * process is entitled to make the claim.
   *
   * Default `on`, because a self-host behind a normal internet connection is the
   * common case and webhooks/OAuth are ordinary features there. `off` is the
   * air-gap switch for the fleet admin who already reaches for
   * `ADMINIUM_DISABLE_UPDATES=1` and `ADMINIUM_TELEMETRY=off`: it tells the SPA
   * to stop offering what this network cannot do, instead of letting users
   * discover it one timeout at a time.
   *
   * NOT tri-state, unlike `ADMINIUM_TELEMETRY`: there is no stored setting
   * underneath for an unset value to defer to, so "unset" has exactly one
   * possible meaning and a boolean says it without pretending otherwise.
   */
  /*
   * Adminium Designer on a server that is not `adminium design`. `live` is
   * the operator allowing it; a Super Admin still has to switch it on in
   * Settings → AI. Unset and `off` are the same: its routes do not exist.
   */
  ADMINIUM_DESIGNER: z.preprocess(emptyToUndefined, z.enum(['off', 'live']).optional().transform((value) => value ?? 'off')),
  /*
   * "Put this online…": a link to adminium.dev/deploy in the user menu, on
   * Studio's Export everything page and on About. Default on; `off` hides it
   * everywhere, for an operator who offers their own hosting or rebrands.
   * Only a link: nothing is fetched from it.
   */
  ADMINIUM_DEPLOY_LINK: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? true : TRUTHY.has(value))),
  ),
  /*
   * "Connect Supabase": the address of the operator's connect service. Set,
   * the connect wizards offer the card and the instance redeems a one-time
   * code at `<url>/redeem` (connect/handoff.ts). https only, else the boot
   * fails: the answer can carry a database password. Unset, nothing changes.
   */
  ADMINIUM_SUPABASE_CONNECT_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const url = parseConnectUrl(value);
        if (url === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one https:// address with no name, password, query or fragment, e.g. https://connect.example.com/supabase' });
          return z.NEVER;
        }
        return url;
      }),
  ),
  ADMINIUM_NETWORK_FEATURES: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? true : TRUTHY.has(value))),
  ),
  /*
   * Model connections named by the environment: one per provider, and the
   * model in use as `<provider>/<model>`. A project keeps the same names in
   * its `.env`, where the Designer writes them; those are read from the file
   * and never copied in here, so what arrives through these seven is only what
   * the operator set themselves.
   */
  ADMINIUM_AI_ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  ADMINIUM_AI_OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  ADMINIUM_AI_COMPATIBLE_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().max(500).optional()),
  ADMINIUM_AI_COMPATIBLE_API_KEY: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  ADMINIUM_AI_OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().max(500).optional()),
  ADMINIUM_AI_GOOGLE_API_KEY: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  ADMINIUM_AI_MODEL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(300)
      .regex(/^(anthropic|openai|openai-compatible|ollama)\/.+$/, 'must be <provider>/<model>, e.g. anthropic/claude-sonnet-5-5')
      .optional(),
  ),
  ADMINIUM_TRUST_PROXY: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? false : TRUTHY.has(value))),
  ),
  /**
   * Which connections count as the reverse proxy while `ADMINIUM_TRUST_PROXY`
   * is on (`security/trust-proxy.ts`). A CSV of addresses, CIDR subnets and the
   * names `loopback`, `linklocal`, `uniquelocal`.
   *
   * Unset ⇒ `loopback,uniquelocal` (`DEFAULT_TRUSTED_PROXIES`), which covers a
   * proxy on this host and one on a Docker network. A value REPLACES that
   * default rather than adding to it, so naming the proxy's own address is how
   * an operator narrows trust to it.
   *
   * Refused while `ADMINIUM_TRUST_PROXY` is off (the object-level check below).
   * A list that silently does nothing is exactly how this setting failed
   * before, and the operator who wrote one clearly meant a proxy to be trusted.
   */
  ADMINIUM_TRUSTED_PROXIES: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const entries = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (entries.length === 0) return undefined;
        const refused = invalidTrustedProxies(entries);
        if (refused.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message:
              `${refused.map((entry) => `"${entry}"`).join(', ')} ` +
              `${refused.length === 1 ? 'is' : 'are'} not an address, a CIDR subnet, ` +
              'or one of loopback, linklocal, uniquelocal',
          });
          return z.NEVER;
        }
        return entries;
      }),
  ),
  // CORS is off by default — the SPA is same-origin.
  // A CSV of exact origins opts split deployments in; wildcard is rejected here
  // because responses are credentialed (cookies).
  ADMINIUM_CORS_ORIGINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
        if (origins.length === 0) return undefined;
        if (origins.includes('*')) {
          ctx.addIssue({
            code: 'custom',
            message: 'wildcard origin is not allowed with credentialed requests',
          });
          return z.NEVER;
        }
        return origins;
      }),
  ),
  /**
   * Exact origins allowed to hand a connection string to this instance
   * (`routes/bridge`). Unset ⇒ the bridge routes are not registered at all,
   * which is the default: `adminium --bridge` is the only thing that sets it.
   *
   * Wildcard is refused for a sharper reason than the CORS list above: this
   * resource accepts a credential-bearing string from a cross-origin page, so
   * "any site may hand my admin panel a database" is never a coherent setting.
   */
  ADMINIUM_BRIDGE_ORIGINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
        if (origins.length === 0) return undefined;
        for (const origin of origins) {
          if (origin === '*') {
            ctx.addIssue({
              code: 'custom',
              message: 'wildcard origin is not allowed for the local bridge',
            });
            return z.NEVER;
          }
          // An exact origin, i.e. scheme + host + optional port and nothing
          // else. A value carrying a path would silently never match the
          // browser's `Origin` header, which fails as "pairing is broken".
          try {
            if (new URL(origin).origin !== origin) {
              ctx.addIssue({
                code: 'custom',
                message: `"${origin}" must be an exact origin, e.g. https://adminium.dev`,
              });
              return z.NEVER;
            }
          } catch {
            ctx.addIssue({ code: 'custom', message: `"${origin}" is not a valid origin` });
            return z.NEVER;
          }
        }
        return origins;
      }),
  ),

  /**
   * Exact origins allowed to reach `/api/v1/public/*` (level 1).
   *
   * UNSET ⇒ the public routes are NEVER REGISTERED. Not registered-and-
   * refusing: an instance that never opted in has no door to probe, which is
   * the `ADMINIUM_BRIDGE_ORIGINS` pattern above and the same argument.
   *
   * SEPARATE FROM `ADMINIUM_CORS_ORIGINS` on purpose, and the two must be
   * DISJOINT. That list rejects wildcards *because its responses are
   * credentialed* — widening it makes the cookie-authenticated admin session
   * reachable cross-origin from every storefront domain. This list is for
   * uncredentialed responses and never emits `Allow-Credentials`. If one origin
   * appeared in both, `@fastify/cors` and the hand-rolled handler would each
   * emit `Access-Control-Allow-Origin` and the browser would reject the
   * duplicate — so overlap is refused here, at parse time, rather than
   * debugged later from a CORS error that names neither variable.
   *
   * THE ONE NON-ORIGIN VALUE is `self` — see {@link SELF_ORIGIN_SENTINEL}. It
   * registers the namespace for same-origin callers only, which is exactly the
   * posture of an instance whose only public consumers are the surfaces it
   * hosts itself. Cross-origin operators append real origins beside it:
   * `self,https://shop.example.com`.
   */
  ADMINIUM_PUBLIC_API_ORIGINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
        if (origins.length === 0) return undefined;
        for (const origin of origins) {
          if (origin === '*') {
            ctx.addIssue({
              code: 'custom',
              message:
                'wildcard origin is not allowed for the public API — name each origin exactly',
            });
            return z.NEVER;
          }
          // BEFORE the URL parse, deliberately: `self` is a sentinel the gate
          // reads (D2), not an origin, and `new URL('self')` throws.
          if (origin === SELF_ORIGIN_SENTINEL) continue;
          try {
            if (new URL(origin).origin !== origin) {
              ctx.addIssue({
                code: 'custom',
                message: `"${origin}" must be an exact origin, e.g. https://shop.example.com`,
              });
              return z.NEVER;
            }
          } catch {
            ctx.addIssue({ code: 'custom', message: `"${origin}" is not a valid origin` });
            return z.NEVER;
          }
        }
        return origins;
      }),
  ),

  /**
   * Extra image origins for the Content-Security-Policy `img-src` directive —
   * the dashboard's and every hosted app surface's, since the policy is one
   * header on everything this server sends.
   *
   * WHY AN OPERATOR NEEDS IT. The policy allows images from this origin (plus
   * the basemap tiles the map widgets draw), which is right for the dashboard's
   * own assets and wrong for the apps it hosts: a till's menu, a shop's
   * products and a studio's services store their pictures as URLs in the
   * operator's OWN tables, pointing wherever the operator keeps them. Under the
   * default the browser refuses every one, and the app shows broken images.
   *
   * AN ALLOW-LIST, NEVER A SCHEME. `https:` would have been one line and would
   * let any script that ever lands on this origin send data anywhere as an
   * image request. Naming hosts keeps that door as narrow as the operator's
   * actual image hosting — see {@link parseImageHostSource} for what counts.
   *
   * Unset ⇒ exactly the built-in policy, byte for byte.
   */
  ADMINIUM_CSP_IMG_HOSTS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const entries = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (entries.length === 0) return undefined;
        const hosts: string[] = [];
        const refused: string[] = [];
        for (const entry of entries) {
          const source = parseImageHostSource(entry);
          if (source === null) refused.push(entry);
          else if (!hosts.includes(source)) hosts.push(source);
        }
        if (refused.length > 0) {
          // Every bad entry named at once: fixing a list one boot at a time is
          // how a config ends up half-applied.
          ctx.addIssue({
            code: 'custom',
            message:
              `${refused.map((entry) => `"${entry}"`).join(', ')} ` +
              `${refused.length === 1 ? 'is' : 'are'} not an image origin — name a scheme and host, ` +
              'e.g. https://images.example.com',
          });
          return z.NEVER;
        }
        return hosts;
      }),
  ),
  /**
   * The database hosts a production server may reach on its own loopback:
   * `localhost:5432,postgres:5432,*.pooler.supabase.com:6543`. Production
   * refuses a source database on loopback (`connections/dsn.ts`), because with
   * host networking loopback is every service on the box; a one-server install
   * names the one database it runs there, by host AND port, and the rest stays
   * refused. A port left out is the engine's own (5432 / 3306).
   *
   * Source connections only, never the meta store's own URL. A cloud-metadata
   * address is refused here as well as at every dial: no list may name it.
   */
  ADMINIUM_DATABASE_HOSTS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const entries = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (entries.length === 0) return undefined;
        const hosts: DatabaseHost[] = [];
        const refused: string[] = [];
        const metadata: string[] = [];
        for (const entry of entries) {
          const parsed = parseDatabaseHost(entry);
          if (parsed.ok) hosts.push(parsed.entry);
          else (parsed.reason === 'metadata' ? metadata : refused).push(entry);
        }
        const quoted = (list: string[]): string => list.map((entry) => `"${entry}"`).join(', ');
        if (metadata.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `${quoted(metadata)} names a cloud metadata address, which Adminium never connects to. Remove it.`,
          });
        }
        if (refused.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `${quoted(refused)} ${refused.length === 1 ? 'is' : 'are'} not a host[:port], e.g. localhost:5432`,
          });
        }
        return metadata.length > 0 || refused.length > 0 ? z.NEVER : hosts;
      }),
  ),
  /*
   * Whether a Super Admin may switch on "Allow databases on this server"
   * (`connections.allowLocalDatabases`): any database on this server's own
   * loopback, for source connections. `setting` (the default) lets the switch
   * decide; `off` locks it off, and only ADMINIUM_DATABASE_HOSTS counts. Kept
   * undefined when unset, so a later check can tell an explicit `setting` from
   * the default (`connections/local-databases.ts`, `localDatabasesMode`).
   */
  ADMINIUM_LOCAL_DATABASES: z.preprocess(emptyToUndefined, z.enum(['setting', 'off']).optional()),
  /**
   * The folders a SQLite source database may lie in: `/srv/databases,/data/apps`.
   * Unset, a SQLite source may be any file the server can open, apart from
   * Adminium's own files (its meta store and the data dir's own folders,
   * `connections/sqlite-guard.ts`), which are refused either way. Set, the
   * file's real path (symlinks followed) must be under one of these. Absolute
   * paths only: a relative one would depend on the folder the server was
   * started from.
   */
  ADMINIUM_SQLITE_DIRS: folderListVar('/srv/databases'),
  /**
   * The folders a `local` storage destination's root may lie in:
   * `/srv/files,/mnt/uploads`. Unset, a root may be any folder apart from
   * Adminium's own (its meta store, the data dir's own folders, `/` and any
   * folder holding the data dir, `files/root-guard.ts`), which are refused
   * either way. Set, the root's real path must be under one of these.
   * Absolute paths only.
   */
  ADMINIUM_STORAGE_DIRS: folderListVar('/srv/files'),
  /**
   * `open` (default) or `strict`. `strict` also refuses the server's own
   * network (private ranges: 10/8, 172.16/12, 192.168/16, 100.64/10, IPv6
   * ULA) for source databases, webhooks and storage endpoints; a source host
   * in `ADMINIUM_DATABASE_HOSTS` still passes. Cloud metadata is refused
   * under both, and loopback follows its own rule (refused in production).
   */
  ADMINIUM_NETWORK_POLICY: z.preprocess(
    (value) => (typeof value === 'string' ? emptyToUndefined(value.trim().toLowerCase()) : value),
    z.enum(NETWORK_POLICIES).optional().transform((value) => value ?? 'open'),
  ),
  /*
   * Where maps come from. A map on a page makes each staff BROWSER fetch map
   * pictures from this server, so its origin is written into the content
   * security policy, and only while maps are on (geo/map-policy.ts). That is
   * why it is one named origin and an environment value: an address typed in
   * the dashboard and put in `connect-src` would be a door any settings admin
   * could open for every staff browser. `off` means no maps on this install,
   * whatever the setting says.
   */
  ADMINIUM_MAP_SERVER: serverOriginVar(
    DEFAULT_MAP_SERVER,
    {},
    'must be off or one https:// origin with no path, e.g. https://tiles.example.com (http:// only for this machine)',
  ),
  /*
   * Where the SERVER asks for a route along roads, and only once somebody
   * switched routing on in Settings → Maps. Never called by a browser, so a
   * plain-http host on the office network is fine. `off` means straight-line
   * estimates only.
   */
  ADMINIUM_ROUTING_SERVER: serverOriginVar(
    DEFAULT_ROUTING_SERVER,
    { plainHttp: true },
    'must be off or one http(s):// origin with no path, e.g. http://osrm.internal:5000',
  ),

  /*
   * ─── Trial mode, the hosted profile and the operator ───
   *
   * One block, parsed here and nowhere else; what each one allows is answered
   * by `trial/policy.ts`. The boot refusals that need more than one variable
   * are in the superRefine below and in {@link profileIssues}, and the values a
   * profile implies are enforced by {@link enforceProfile}, never defaulted.
   * Env only, never a setting: no route writes any of them, and a project's
   * `.env` cannot set them (`OPERATOR_DECIDED_ENV`, `cli/start-project.ts`).
   */

  /*
   * A trial instance for a stranger, on the operator's server: the switches of
   * trial (connections only to the host list, no own code, no outgoing traffic
   * but the operator's mail relay, public pages hidden from search engines,
   * banners, size caps). Needs an end date, a setup token, the public origin
   * and a host list, or the boot fails.
   */
  ADMINIUM_TRIAL_MODE: booleanVar(false),
  /* When the trial ends: an ISO 8601 date and time with its zone. Kept as the UTC ISO string. */
  ADMINIUM_TRIAL_ENDS_AT: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(64)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const at = parseZonedTime(value);
        if (at === null) {
          ctx.addIssue({ code: 'custom', message: 'must be a date and time with its zone, e.g. 2026-12-01T00:00:00Z' });
          return z.NEVER;
        }
        return new Date(at).toISOString();
      }),
  ),
  /*
   * The operator's address for this instance (`https://shop.try.example.com`):
   * where links in email point, and the host it answers on. One origin; http
   * only for this machine.
   */
  ADMINIUM_PUBLIC_ORIGIN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(500)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const origin = parseServerOrigin(value);
        if (origin === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one https:// origin with no path, e.g. https://shop.example.com (http:// only for this machine)' });
          return z.NEVER;
        }
        return origin;
      }),
  ),
  /* A6: the live data of each operator database (default 500), one uploaded file (10), the whole data dir (1,000). */
  ADMINIUM_TRIAL_DATA_MAX_MB: megabytesVar(500),
  ADMINIUM_TRIAL_UPLOAD_MAX_MB: megabytesVar(10),
  ADMINIUM_TRIAL_STORAGE_MAX_MB: megabytesVar(1000),
  /* The "Upgrade" button's address (O7). Unset: no button. https only; `?instance=` is added to it. */
  ADMINIUM_TRIAL_UPGRADE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const url = parseOperatorUrl(value, { plainHttp: 'loopback' });
        if (url === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one https:// address with no name, password or fragment, e.g. https://example.com/upgrade' });
          return z.NEVER;
        }
        return url;
      }),
  ),
  /*
   * The operator's mail relay, one credential per instance (O4 = C, S5):
   * `smtp://user:pass@relay:587` or `smtps://…`. A secret: held out of
   * `process.env` (`config/operator-secrets.ts`), and never printed back.
   */
  ADMINIUM_TRIAL_SMTP_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        if (!isSmtpUrl(value)) {
          ctx.addIssue({ code: 'custom', message: 'must be smtp:// or smtps:// with a host, e.g. smtp://user:password@relay.example.com:587' });
          return z.NEVER;
        }
        return value;
      }),
  ),
  /* User mail a day through the relay (default 50; 20 an hour on top). */
  ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: z.preprocess(
    emptyToUndefined,
    z.coerce.number({ error: 'must be a whole number' }).int('must be a whole number').min(1).max(100_000).optional().transform((value) => value ?? 50),
  ),
  /*
   * The address the relay pins for this instance, `i-<instance id>@<relay
   * domain>`: every mail through the relay goes From it, as
   * `"<instance name> via <operator name>" <address>`. One plain address.
   */
  ADMINIUM_TRIAL_MAIL_FROM: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(254)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const address = value.trim().toLowerCase();
        if (!PLAIN_MAIL_ADDRESS.test(address)) {
          ctx.addIssue({ code: 'custom', message: 'must be one plain address with no name, e.g. i-7f3a9c@relay.example.com' });
          return z.NEVER;
        }
        return address;
      }),
  ),
  /* Where a recipient reports a mail from this instance: https:// or mailto:. Unset: mailto:abuse@ the From address's domain. */
  ADMINIUM_TRIAL_MAIL_REPORT_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const url = parseReportUrl(value);
        if (url === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one https:// address, or mailto: with one address, e.g. https://example.com/report or mailto:abuse@example.com' });
          return z.NEVER;
        }
        return url;
      }),
  ),
  /* The operator's name, as mail from the relay says it: "<instance name> via <operator name>". Unset: the From address's domain. */
  ADMINIUM_OPERATOR_NAME: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(60)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const name = value.trim().replace(/\s+/g, ' ');
        if (name === '' || /[@<>"\\,;:()[\]]/.test(name)) {
          ctx.addIssue({ code: 'custom', message: 'must be a plain name of at most 60 characters with no @ < > " \\ , ; : ( ) [ ], e.g. Example Hosting' });
          return z.NEVER;
        }
        return name;
      }),
  ),
  /*
   * A paid installation on the operator's server (the hosted profile): the trial's
   * host list, network policy, own-code and origin rules stay; the clock,
   * banners, caps and the relay-only mail go.
   */
  ADMINIUM_HOSTED_MODE: booleanVar(false),
  /*
   * The user's own verified domains (version 2 W-N D4), honoured with or
   * without trial mode: plain lower-case host names, no wildcard, address,
   * port or path.
   */
  ADMINIUM_OPERATOR_DOMAINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(5000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const entries = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (entries.length === 0) return undefined;
        const refused = entries.filter((entry) => !isPlainDomain(entry));
        if (refused.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `${refused.map((entry) => `"${entry}"`).join(', ')} ${refused.length === 1 ? 'is' : 'are'} not a plain lower-case host name, e.g. shop.example.com (no wildcard, address, port or path)`,
          });
          return z.NEVER;
        }
        return [...new Set(entries)];
      }),
  ),
  /* The operator endpoint's bearer token: 32 random bytes or more, per instance. A secret. */
  ADMINIUM_OPERATOR_TOKEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(1000)
      .optional()
      .refine((value) => value === undefined || tokenBytes(value) >= OPERATOR_TOKEN_MIN_BYTES, `must be at least ${String(OPERATOR_TOKEN_MIN_BYTES)} random bytes, as hex or base64, e.g. \`openssl rand -hex 32\``),
  ),
  /*
   * The operator listener: `<address>:<port>` on the operator's
   * network. An address, never a name or every address (`0.0.0.0`, `::`):
   * the operator endpoint is never on the public listener.
   */
  ADMINIUM_OPERATOR_LISTEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(100)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const listen = parseListenAddress(value);
        if (listen === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one address and port on the operator network, e.g. 10.0.0.2:4601 or [fd00::2]:4601 (not 0.0.0.0, not a name)' });
          return z.NEVER;
        }
        return listen;
      }),
  ),
  /* Signed instance events: https, or plain http to an address on the operator network. */
  ADMINIUM_OPERATOR_EVENTS_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const url = parseOperatorUrl(value, { plainHttp: 'operator-network' });
        if (url === null) {
          ctx.addIssue({ code: 'custom', message: 'must be one https:// address, or http:// to a private address on the operator network, with no name, password or fragment' });
          return z.NEVER;
        }
        return url;
      }),
  ),
  /* Operator AI: AI connections saved in Settings → AI only as the user's own key to a fixed public provider; otherwise the operator's. */
  ADMINIUM_AI_OPERATOR_ONLY: booleanVar(false),
  /* What operator AI may build. `dashboard` is the only scope: no customer screens on the operator's connection. */
  ADMINIUM_AI_OPERATOR_SCOPE: z.preprocess(emptyToUndefined, z.enum(['dashboard']).optional()),
  /* Tokens operator AI may spend over the instance's life, counted for every feature. */
  ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: z.preprocess(
    emptyToUndefined,
    z.coerce.number({ error: 'must be a whole number' }).int('must be a whole number').min(1).max(1_000_000_000_000).optional(),
  ),
  /*
   * The Designer's first user turn after setup, as base64 (never a
   * raw value built from a visitor's text). Held decoded: 2,000 characters at
   * most, no control character but a line break or a tab.
   */
  ADMINIUM_DESIGNER_START_PROMPT_B64: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(12_000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const text = decodeStartPrompt(value);
        if (typeof text !== 'string') {
          ctx.addIssue({ code: 'custom', message: text.problem });
          return z.NEVER;
        }
        return text;
      }),
  ),
  /* The same prompt from a read-only mounted file: an absolute path, read once at boot. Held as the file's text. */
  ADMINIUM_DESIGNER_START_PROMPT_FILE: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(1000)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const text = readStartPromptFile(value);
        if (typeof text !== 'string') {
          ctx.addIssue({ code: 'custom', message: text.problem });
          return z.NEVER;
        }
        return text;
      }),
  ),
})
  .superRefine((env, ctx) => {
    // ─── Trial mode, the hosted profile, the operator ─────────
    // What one variable needs of another. The rest of the profile's refusals
    // read the raw environment (`profileIssues`): an explicit value that a
    // default here would hide.
    const need = (when: boolean, variable: string, message: string): void => {
      if (when) ctx.addIssue({ code: 'custom', path: [variable], message });
    };
    if (env.ADMINIUM_TRIAL_MODE && env.ADMINIUM_HOSTED_MODE) {
      need(true, 'ADMINIUM_HOSTED_MODE', 'is on as well as ADMINIUM_TRIAL_MODE: a server is a trial or a paid installation, not both. Switch one off.');
    }
    if (env.ADMINIUM_TRIAL_MODE) {
      need(
        env.ADMINIUM_SOURCE_POOL_MAX !== undefined && env.ADMINIUM_SOURCE_POOL_MAX > TRIAL_SOURCE_POOL_MAX,
        'ADMINIUM_SOURCE_POOL_MAX',
        `is above ${String(TRIAL_SOURCE_POOL_MAX)}: a trial opens at most ${String(TRIAL_SOURCE_POOL_MAX)} connections in each pool on the shared database server. Remove it, or set ${String(TRIAL_SOURCE_POOL_MAX)} or less.`,
      );
      need(env.ADMINIUM_TRIAL_ENDS_AT === undefined, 'ADMINIUM_TRIAL_ENDS_AT', 'is required in trial mode: when the trial ends, e.g. 2026-12-01T00:00:00Z');
      need(env.ADMINIUM_SETUP_TOKEN === undefined, 'ADMINIUM_SETUP_TOKEN', 'is required in trial mode: the welcome link carries it, so the trial user never reads a log');
      need(
        env.ADMINIUM_TRIAL_SMTP_URL !== undefined && env.ADMINIUM_TRIAL_MAIL_FROM === undefined,
        'ADMINIUM_TRIAL_MAIL_FROM',
        'is required with ADMINIUM_TRIAL_SMTP_URL: the address the relay pins for this instance, e.g. i-7f3a9c@relay.example.com',
      );
    }
    if (env.ADMINIUM_TRIAL_MODE || env.ADMINIUM_HOSTED_MODE) {
      const which = env.ADMINIUM_TRIAL_MODE ? 'trial mode' : 'hosted mode';
      need(env.ADMINIUM_PUBLIC_ORIGIN === undefined, 'ADMINIUM_PUBLIC_ORIGIN', `is required in ${which}: the operator's address for this instance, e.g. https://shop.example.com`);
      need((env.ADMINIUM_DATABASE_HOSTS ?? []).length === 0, 'ADMINIUM_DATABASE_HOSTS', `is required in ${which}: the only database hosts connections may reach, e.g. pg-trials:5432`);
    }
    need(
      env.ADMINIUM_OPERATOR_TOKEN !== undefined && env.ADMINIUM_OPERATOR_LISTEN === undefined,
      'ADMINIUM_OPERATOR_TOKEN',
      'is set, but ADMINIUM_OPERATOR_LISTEN is not, so the operator endpoint is served nowhere. Set the listener on the operator network as well.',
    );
    need(
      env.ADMINIUM_OPERATOR_LISTEN !== undefined && env.ADMINIUM_OPERATOR_TOKEN === undefined,
      'ADMINIUM_OPERATOR_LISTEN',
      'is set, but ADMINIUM_OPERATOR_TOKEN is not: the operator endpoint answers only a bearer token. Set one, e.g. `openssl rand -hex 32`.',
    );
    need(
      env.ADMINIUM_OPERATOR_LISTEN !== undefined && env.ADMINIUM_OPERATOR_LISTEN.port === env.PORT,
      'ADMINIUM_OPERATOR_LISTEN',
      'uses PORT, the public listener’s port: the operator endpoint needs a port of its own.',
    );
    need(
      env.ADMINIUM_OPERATOR_EVENTS_URL !== undefined && env.ADMINIUM_OPERATOR_TOKEN === undefined,
      'ADMINIUM_OPERATOR_EVENTS_URL',
      'is set, but ADMINIUM_OPERATOR_TOKEN is not: every event is signed with it. Set the token as well.',
    );
    need(
      env.ADMINIUM_DESIGNER_START_PROMPT_B64 !== undefined && env.ADMINIUM_DESIGNER_START_PROMPT_FILE !== undefined,
      'ADMINIUM_DESIGNER_START_PROMPT_FILE',
      'is set as well as ADMINIUM_DESIGNER_START_PROMPT_B64: give the start prompt one way.',
    );

    if (env.ADMINIUM_TRUSTED_PROXIES !== undefined && !env.ADMINIUM_TRUST_PROXY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMINIUM_TRUSTED_PROXIES'],
        message:
          'is set, but ADMINIUM_TRUST_PROXY is off, so no proxy is trusted. ' +
          'Set ADMINIUM_TRUST_PROXY=on as well, or remove this variable.',
      });
    }

    // The disjointness rule from ADMINIUM_PUBLIC_API_ORIGINS' comment. Checked
    // across the two fields, so it belongs on the object rather than either one.
    const admin = env.ADMINIUM_CORS_ORIGINS;
    const pub = env.ADMINIUM_PUBLIC_API_ORIGINS;
    if (admin === undefined || pub === undefined) return;
    // The sentinel is not an origin, so it cannot produce a duplicate
    // `Access-Control-Allow-Origin` — and it never emits one at all (D2).
    const overlap = pub.filter(
      (origin) => origin !== SELF_ORIGIN_SENTINEL && admin.includes(origin),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMINIUM_PUBLIC_API_ORIGINS'],
        message:
          `${overlap.join(', ')} appears in both ADMINIUM_CORS_ORIGINS and ` +
          'ADMINIUM_PUBLIC_API_ORIGINS. They must be disjoint: the admin list is credentialed and ' +
          'the public list is not, and a browser rejects the duplicate Access-Control-Allow-Origin ' +
          'header the overlap would produce.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** One problem with the environment, as the boot's table names it. */
export interface EnvProblem {
  variable: string;
  problem: string;
}

/** C0 and C1 control characters and DEL: never in an operator's value (S8). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

const isSet = (value: string | undefined): value is string => value !== undefined && value !== '';

/**
 * The boot refusals of a trial or hosted server that read the RAW environment:
 * an explicit value the parsed one would hide behind its
 * default, a variable the schema does not parse, a control character before
 * any trimming. The parsed half is the schema's superRefine.
 *
 *  - any trial or operator variable holding a control character: an operator
 *    value built from user input that smuggles in a second line;
 *  - a trial variable without trial mode, which would do nothing;
 *  - under either profile, what lets the stranger who is its Super Admin run
 *    code, widen limits or reach the operator's network: `ADMINIUM_ADD_ON_DEV_TRUST`
 *    (read raw by `add-ons/decider-trust.ts`), `ADMINIUM_RATE_LIMIT_SCALE`,
 *    `NODE_OPTIONS`, the bridge, the desktop's own variables, a seeded storage
 *    destination (A1b), and an explicit `ADMINIUM_NETWORK_POLICY=open` or
 *    `ADMINIUM_LOCAL_DATABASES=setting`;
 *  - in trial mode also telemetry, map and routing servers switched on (A2).
 *
 * Saying what a profile implies (`ADMINIUM_NETWORK_POLICY=strict`) is no
 * contradiction, and passes.
 */
export function profileIssues(raw: Readonly<Record<string, string | undefined>>): EnvProblem[] {
  const trial = TRUTHY.has(raw['ADMINIUM_TRIAL_MODE'] ?? '');
  const hosted = TRUTHY.has(raw['ADMINIUM_HOSTED_MODE'] ?? '');
  const problems: EnvProblem[] = [];
  for (const name of trial || hosted ? OPERATOR_DECIDED_ENV : NEW_OPERATOR_ENV) {
    const value = raw[name];
    const found = value === undefined ? null : CONTROL_CHARACTER.exec(value);
    if (found !== null) {
      const code = (found[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
      // The value is not printed: it may be a credential.
      problems.push({ variable: name, problem: `holds a control character (U+${code}). Pass each value as one line, through the Docker API's Env array.` });
    }
  }
  if (!trial) {
    for (const name of TRIAL_ONLY_ENV) {
      if (isSet(raw[name])) problems.push({ variable: name, problem: 'is set, but ADMINIUM_TRIAL_MODE is off, so it does nothing. Set ADMINIUM_TRIAL_MODE=on as well, or remove this variable.' });
    }
  }
  if (!trial && !hosted) return problems;

  const which = trial ? 'trial mode' : 'hosted mode';
  const refuse = (name: string, why: string): void => {
    problems.push({ variable: name, problem: `cannot be set in ${which}: ${why}` });
  };
  const word = (name: string): string => (raw[name] ?? '').trim().toLowerCase();
  if (isSet(raw['ADMINIUM_RATE_LIMIT_SCALE'])) refuse('ADMINIUM_RATE_LIMIT_SCALE', 'it widens the limits that stop password guessing and floods. Remove it.');
  if (isSet(raw['ADMINIUM_ADD_ON_DEV_TRUST'])) refuse('ADMINIUM_ADD_ON_DEV_TRUST', 'it would run add-on code no catalogue vouched for. Remove it.');
  if (isSet(raw['NODE_OPTIONS'])) refuse('NODE_OPTIONS', 'it changes what the server loads and is handed to every program it starts. Remove it.');
  if (isSet(raw['ADMINIUM_BRIDGE_ORIGINS'])) refuse('ADMINIUM_BRIDGE_ORIGINS', 'the local bridge hands this server a connection string from another site. Remove it.');
  if (isSet(raw['ADMINIUM_DEMO_SEED_SCRIPT'])) refuse('ADMINIUM_DEMO_SEED_SCRIPT', 'it is the desktop app’s, and runs a script. Remove it.');
  if (word('ADMINIUM_RUNTIME') === 'desktop') refuse('ADMINIUM_RUNTIME', 'this is a server people reach over a network, not the desktop app. Remove it.');
  for (const name of ['ADMINIUM_STORAGE_URL', 'AWS_ENDPOINT_URL_S3']) {
    if (isSet(raw[name])) refuse(name, 'files stay in the data folder, the one storage destination allowed (A1b). Remove it.');
  }
  if (word('ADMINIUM_NETWORK_POLICY') === 'open') refuse('ADMINIUM_NETWORK_POLICY', 'it is strict there. Remove it, or set strict.');
  if (word('ADMINIUM_LOCAL_DATABASES') === 'setting') refuse('ADMINIUM_LOCAL_DATABASES', 'databases on this server are off there, and only ADMINIUM_DATABASE_HOSTS counts. Remove it, or set off.');
  if (trial) {
    if (TRUTHY.has(word('ADMINIUM_TELEMETRY'))) refuse('ADMINIUM_TELEMETRY', 'a trial sends no usage data. Remove it, or set off.');
    for (const name of ['ADMINIUM_MAP_SERVER', 'ADMINIUM_ROUTING_SERVER']) {
      if (isSet(raw[name]) && word(name) !== MAP_SERVER_OFF) refuse(name, 'a trial makes no outgoing calls but the operator’s. Remove it, or set off.');
    }
  }
  return problems;
}

/**
 * `env` with what its profile implies ENFORCED: set as the
 * profile says whatever the variable held, so nothing that fills an unset
 * variable later (a project's `.env`, a default) can change it. The explicit
 * contradictions have already failed the boot ({@link profileIssues}); this is
 * what an unset variable reads as.
 *
 *  - both profiles: `ADMINIUM_NETWORK_POLICY=strict`, `ADMINIUM_LOCAL_DATABASES=off` (A1);
 *  - trial mode: `ADMINIUM_TELEMETRY=off` and no map or routing server (A2);
 *    pools of 3 against a source and the meta store unless set lower (A6).
 */
export function enforceProfile(env: Env): Env {
  if (!env.ADMINIUM_TRIAL_MODE && !env.ADMINIUM_HOSTED_MODE) return env;
  const enforced: Env = { ...env, ADMINIUM_NETWORK_POLICY: 'strict', ADMINIUM_LOCAL_DATABASES: 'off' };
  if (env.ADMINIUM_TRIAL_MODE) {
    // Small pools on the operator's shared servers (A6): what an unset variable reads as; the operator may set less.
    enforced.ADMINIUM_SOURCE_POOL_MAX = env.ADMINIUM_SOURCE_POOL_MAX ?? TRIAL_SOURCE_POOL_MAX;
    enforced.ADMINIUM_META_POOL_MAX = env.ADMINIUM_META_POOL_MAX ?? TRIAL_META_POOL_MAX;
    enforced.ADMINIUM_TELEMETRY = false;
    enforced.ADMINIUM_MAP_SERVER = MAP_SERVER_OFF;
    enforced.ADMINIUM_ROUTING_SERVER = MAP_SERVER_OFF;
  }
  return enforced;
}

/** Problems found outside the schema, as the schema's own issues, so one table prints them all. */
export function problemIssues(problems: readonly EnvProblem[]): z.core.$ZodIssue[] {
  return problems.map((problem) => ({ code: 'custom', path: [problem.variable], message: problem.problem, input: undefined }) as z.core.$ZodIssue);
}

const ENV_HINTS: Record<string, string> = {
  ADMINIUM_SECRET: 'set a random string of at least 16 characters, e.g. `openssl rand -hex 32`',
  ADMINIUM_SETUP_TOKEN:
    'optional one-time token the first-run wizard asks for, at least 16 characters (default: derived from ADMINIUM_SECRET and printed at boot)',
  ADMINIUM_ARCHIVE_KEY: 'a random string of at least 32 characters, e.g. `openssl rand -hex 32`, the same on every server that restores the archives',
  PORT: 'integer between 1 and 65535 (default 4600)',
  HOST: 'bind address, e.g. 0.0.0.0 or 127.0.0.1',
  ADMINIUM_AI_ANTHROPIC_API_KEY: 'an Anthropic API key',
  ADMINIUM_AI_OPENAI_API_KEY: 'an OpenAI API key',
  ADMINIUM_AI_COMPATIBLE_BASE_URL: 'the address of an OpenAI-compatible server, e.g. http://localhost:8000/v1',
  ADMINIUM_AI_COMPATIBLE_API_KEY: 'the key for that server, when it wants one',
  ADMINIUM_AI_OLLAMA_BASE_URL: 'the address of Ollama, e.g. http://localhost:11434',
  ADMINIUM_AI_GOOGLE_API_KEY: 'a Google AI Studio key, for making pictures with Gemini',
  ADMINIUM_AI_MODEL: '<provider>/<model>, e.g. anthropic/claude-sonnet-5-5',
  ADMINIUM_META_URL: 'optional meta-store DSN: postgres://, mysql://, or sqlite:<path>',
  ADMINIUM_DATA_DIR:
    'writable directory for files, exports, backups, and add-on packages (default ./data beside a project, otherwise ~/.adminium)',
  ADMINIUM_STORAGE_URL:
    'optional first-boot storage destination: s3://<bucket>?endpoint=&region=&accessKey=&secretKey=, webdav://<user>:<pass>@<host>/<path>, or file:///abs/path',
  AWS_ENDPOINT_URL_S3: 'S3-compatible endpoint (set by `fly storage create`; read only by the first-boot storage seed)',
  AWS_REGION: 'region for the AWS storage variables (default auto)',
  BUCKET_NAME: 'bucket for the AWS storage variables',
  AWS_ACCESS_KEY_ID: 'access key for the AWS storage variables',
  AWS_SECRET_ACCESS_KEY: 'secret key for the AWS storage variables',
  ADMINIUM_LOG_LEVEL: `one of ${LOG_LEVELS.join(', ')} (default info)`,
  ADMINIUM_STATIC_ROOT:
    'directory holding a dashboard build (its index.html) — overrides the bundled copy',
  ADMINIUM_RUNTIME: `one of ${RUNTIMES.join(', ')} (default self-host; set to desktop only by the Electron shell)`,
  ADMINIUM_BOOT_TOKEN: `${String(BOOT_TOKEN_HEX_LENGTH)} hex characters, generated per boot by the desktop shell`,
  ADMINIUM_DESKTOP_SINGLE_USER: `one of ${BOOLEANISH.join(', ')} (desktop only; mirrors config.json's singleUser)`,
  ADMINIUM_DEMO_SEED_SCRIPT:
    'absolute path to the desktop shell’s demo-seed.mjs (desktop only; enables the first-run demo card)',
  ADMINIUM_TELEMETRY: `one of ${BOOLEANISH.join(', ')} (default off)`,
  ADMINIUM_DESIGNER: 'off or live (default off; live lets a Super Admin switch Adminium Designer on for this server)',
  ADMINIUM_DEPLOY_LINK: `one of ${BOOLEANISH.join(', ')} (default on; off hides the "Put this online" link to adminium.dev/deploy)`,
  ADMINIUM_SUPABASE_CONNECT_URL:
    'the https:// address of the operator\'s connect service, e.g. https://connect.example.com/supabase (unset: no "Connect Supabase" card)',
  ADMINIUM_NETWORK_FEATURES: `one of ${BOOLEANISH.join(', ')} (default on; set off on air-gapped installs so the UI stops offering webhooks/OAuth)`,
  ADMINIUM_TRUST_PROXY: `one of ${BOOLEANISH.join(', ')} (default off; enable behind Caddy/TLS)`,
  ADMINIUM_TRUSTED_PROXIES:
    'CSV of proxy addresses, CIDR subnets, or loopback, linklocal, uniquelocal (default loopback,uniquelocal; needs ADMINIUM_TRUST_PROXY=on)',
  ADMINIUM_CORS_ORIGINS:
    'CSV of exact origins for split deployments, e.g. https://admin.acme.io — no wildcard',
  ADMINIUM_BRIDGE_ORIGINS:
    'CSV of exact origins allowed to hand this instance a connection string, e.g. https://adminium.dev — unset disables the bridge entirely',
  ADMINIUM_PUBLIC_API_ORIGINS:
    'CSV of exact origins allowed to reach /api/v1/public, plus the literal `self` for surfaces this instance hosts itself — unset means the public API is not registered at all; must be disjoint from ADMINIUM_CORS_ORIGINS',
  ADMINIUM_CSP_IMG_HOSTS:
    'CSV of image origins the dashboard and hosted app surfaces may load pictures from, e.g. https://images.example.com — a leading *. covers subdomains; no bare *, scheme alone or path',
  ADMINIUM_DATABASE_HOSTS:
    'CSV of host[:port] a production server may reach on its own loopback, e.g. localhost:5432 (port defaults to 5432 / 3306; *.suffix for a provider\'s names; never a cloud metadata address)',
  ADMINIUM_SQLITE_DIRS:
    'CSV of absolute folders a SQLite source database must lie in, e.g. /srv/databases (unset: any file except Adminium\'s own)',
  ADMINIUM_STORAGE_DIRS:
    'CSV of absolute folders a local storage destination must lie in, e.g. /srv/files (unset: any folder except Adminium\'s own)',
  ADMINIUM_NETWORK_POLICY: `one of ${NETWORK_POLICIES.join(', ')} (default open; strict also refuses private ranges for source databases, webhooks and storage endpoints)`,
  ADMINIUM_LOCAL_DATABASES:
    'setting (default: a Super Admin may allow databases on this server in Studio) or off (only ADMINIUM_DATABASE_HOSTS counts)',
  ADMINIUM_TRIAL_MODE: `one of ${BOOLEANISH.join(', ')} (default off; on runs a trial for a stranger: needs ADMINIUM_TRIAL_ENDS_AT, ADMINIUM_SETUP_TOKEN, ADMINIUM_PUBLIC_ORIGIN and ADMINIUM_DATABASE_HOSTS)`,
  ADMINIUM_TRIAL_ENDS_AT: 'when the trial ends, with its zone, e.g. 2026-12-01T00:00:00Z (trial mode only)',
  ADMINIUM_PUBLIC_ORIGIN: 'the operator\'s address for this instance, e.g. https://shop.example.com',
  ADMINIUM_TRIAL_DATA_MAX_MB: 'whole megabytes of live data per operator database (default 500; trial mode only)',
  ADMINIUM_TRIAL_UPLOAD_MAX_MB: 'whole megabytes per uploaded file (default 10; trial mode only)',
  ADMINIUM_TRIAL_STORAGE_MAX_MB: 'whole megabytes for the whole data folder (default 1000; trial mode only)',
  ADMINIUM_TRIAL_UPGRADE_URL: 'the https:// address of the operator\'s Upgrade page (unset: no Upgrade button; trial mode only)',
  ADMINIUM_TRIAL_SMTP_URL: 'the operator\'s mail relay for this instance, smtp://user:password@relay:587 (trial mode only)',
  ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: 'user emails a day through the relay (default 50; trial mode only)',
  ADMINIUM_TRIAL_MAIL_FROM: 'the address the relay pins for this instance, e.g. i-7f3a9c@relay.example.com (needed with ADMINIUM_TRIAL_SMTP_URL; trial mode only)',
  ADMINIUM_TRIAL_MAIL_REPORT_URL: 'where a recipient reports a mail: https://… or mailto:… (default mailto:abuse@ the From address\'s domain; trial mode only)',
  ADMINIUM_OPERATOR_NAME: 'the operator\'s name in the From of relay mail, "<instance> via <name>", at most 60 characters (default: the From address\'s domain)',
  ADMINIUM_HOSTED_MODE: `one of ${BOOLEANISH.join(', ')} (default off; on runs a paid installation on the operator's server: needs ADMINIUM_PUBLIC_ORIGIN and ADMINIUM_DATABASE_HOSTS)`,
  ADMINIUM_OPERATOR_DOMAINS: 'CSV of the user\'s own verified domains: plain lower-case host names, e.g. shop.example.com',
  ADMINIUM_OPERATOR_TOKEN: 'the operator endpoint\'s bearer token, 32 random bytes or more, e.g. `openssl rand -hex 32` (needs ADMINIUM_OPERATOR_LISTEN)',
  ADMINIUM_OPERATOR_LISTEN: 'address:port of the operator listener on the operator network, e.g. 10.0.0.2:4601 (needs ADMINIUM_OPERATOR_TOKEN)',
  ADMINIUM_OPERATOR_EVENTS_URL: 'where signed instance events go: https://…, or http:// to a private address (needs ADMINIUM_OPERATOR_TOKEN)',
  ADMINIUM_AI_OPERATOR_ONLY: `one of ${BOOLEANISH.join(', ')} (default off; on: AI runs on the operator's connection unless the user adds their own key)`,
  ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard: operator AI builds dashboards only (unset: no scope)',
  ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: 'whole number of tokens operator AI may spend over the instance\'s life',
  ADMINIUM_DESIGNER_START_PROMPT_B64: `the Designer's first prompt after setup, base64, at most ${String(START_PROMPT_MAX_CHARS)} characters decoded`,
  ADMINIUM_DESIGNER_START_PROMPT_FILE: `absolute path to a read-only file holding the Designer's first prompt, at most ${String(START_PROMPT_MAX_CHARS)} characters`,
  ADMINIUM_ADD_ON_DEV_TRUST: 'developer machines only; never with ADMINIUM_TRIAL_MODE or ADMINIUM_HOSTED_MODE',
  NODE_OPTIONS: 'never set with ADMINIUM_TRIAL_MODE or ADMINIUM_HOSTED_MODE',
  ADMINIUM_MAP_SERVER: `off, or the one origin map pictures come from (default ${DEFAULT_MAP_SERVER})`,
  ADMINIUM_ROUTING_SERVER: `off, or the origin of an OSRM routing server (default ${DEFAULT_ROUTING_SERVER}; asked only when routing is switched on)`,
};

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  readonly issues: readonly z.core.$ZodIssue[];
  readonly table: string;

  constructor(issues: readonly z.core.$ZodIssue[], table: string) {
    super(`invalid environment configuration (${String(issues.length)} problem(s)):\n${table}`);
    this.issues = issues;
    this.table = table;
  }
}

/** Renders the fail-fast `variable | problem | hint` table. */
export function formatEnvErrorTable(issues: readonly z.core.$ZodIssue[]): string {
  return formatEnvProblems(
    issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.map(String).join('.') : '(env)',
      problem: issue.message,
    })),
  );
}

/** The same table for a problem found after parsing, by a check that needs more than the environment. */
export function formatEnvProblems(problems: readonly { variable: string; problem: string }[]): string {
  const header = ['variable', 'problem', 'hint'];
  const rows = problems.map(({ variable, problem }) => [variable, problem, ENV_HINTS[variable] ?? '—']);
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)));
  const line = (row: string[]): string =>
    `| ${row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join(' | ')} |`;
  const separator = `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`;
  return [line(header), separator, ...rows.map(line)].join('\n');
}

export interface EnvWriter {
  write(chunk: string): unknown;
}

/**
 * Parses and validates the process environment. On failure, prints the
 * problem table to stderr and throws `EnvValidationError`.
 */
export function loadEnv(
  env: Record<string, string | undefined> = process.env,
  stderr: EnvWriter = process.stderr,
): Env {
  // `process.env` after an earlier boot in this process has none of the secrets: the held ones are read back.
  // A secret given as a file (`<NAME>_FILE`) is read as if it had been set in `<NAME>`.
  const files = readSecretFiles(withHeldSecrets(env));
  const result = envSchema.safeParse(files.env);
  const issues = [...secretFileIssues(files.problems, result.success ? [] : result.error.issues), ...problemIssues(profileIssues(files.env))];
  if (!result.success || issues.length > 0) {
    const table = formatEnvErrorTable(issues);
    stderr.write(`Adminium failed to start — invalid environment configuration:\n\n${table}\n`);
    throw new EnvValidationError(issues, table);
  }
  return enforceProfile(result.data);
}

/**
 * The problems with `<NAME>_FILE` variables as rows of the boot's table, first, then the schema's own, less a
 * second row for a secret whose file is the problem (it reads as missing because its file could not be used).
 */
export function secretFileIssues(problems: readonly SecretFileProblem[], issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] {
  const fromFiles = problems.map(
    (problem) => ({ code: 'custom', path: [problem.variable], message: problem.problem, input: undefined }) as z.core.$ZodIssue,
  );
  const covered = new Set(problems.map((problem) => problem.variable.slice(0, -SECRET_FILE_SUFFIX.length)));
  return [...fromFiles, ...issues.filter((issue) => !covered.has(String(issue.path[0])))];
}
