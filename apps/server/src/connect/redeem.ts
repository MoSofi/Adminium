// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Redeeming a hand-off code at the operator, and reading what comes back.
 *
 * THE ANSWER IS UNTRUSTED INPUT. The operator is configured by whoever
 * runs this server, but its answer is shaped by a sign-in at a third party and
 * travels over a network, and it becomes a database connection this server
 * dials. So:
 *
 *  - the call goes to the operator's fixed address only, looked up once,
 *    checked and pinned (`net/outbound-check.ts`): cloud metadata always
 *    refused, a name that does not resolve refused; it follows no redirect,
 *    gives up after 10 seconds and reads at most 64 KB;
 *  - the answer is read field by field against a strict schema: engine
 *    `postgres` only; the host a plain DNS name (no address literal, no
 *    port, no path); the port an integer; `sslmode` `require` or
 *    `verify-full`; the database and user plain identifiers (letters,
 *    digits, `_`, `.`, `-`), so no `?`, `/`, `@`, `#` or `%` can carry a
 *    parameter or a second host into the connection string; a password of
 *    printable characters, or none;
 *  - the connection string is then BUILT from those fields, each part
 *    encoded, and read back into its fields before it is used: anything that
 *    does not come back exactly as it went in is refused. The host still has
 *    to pass the database guard (`ADMINIUM_DATABASE_HOSTS`, the network
 *    policy, the lookup) when the connection is tested, like a typed one.
 *
 * Nothing here logs the answer: it can hold a password.
 */
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';

import { databaseEndpointFromDsn } from '@adminium/engine/adapter';
import { z } from 'zod';

import { AppError } from '../errors.js';
import { checkOutboundUrl, type OutboundPolicy } from '../net/outbound-check.js';
import { pinnedFetch } from '../net/pinned-fetch.js';

/** The longest the whole redeem may take, the answer's body included. */
export const REDEEM_TIMEOUT_MS = 10_000;

/** The most bytes of answer read; one more ends the call. */
export const REDEEM_MAX_BYTES = 64 * 1024;

/** The operator refused the code, or answered something this instance does not take. 502: nothing the person typed was wrong. */
export class ConnectRefusedError extends AppError {
  override readonly name = 'ConnectRefusedError';

  constructor(reason: string, message: string) {
    super(502, 'CONNECT_REFUSED', message, { reason });
  }
}

/** The hand-off is spent, expired, or not this person's. 410: start again. */
export class ConnectExpiredError extends AppError {
  override readonly name = 'ConnectExpiredError';

  constructor() {
    super(410, 'CONNECT_EXPIRED', 'This connection hand-off has expired or was already used. Start it again.');
  }
}

/** A host as the schema takes it: a DNS name of letters, digits and hyphens, lower case, never an address. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isPlainHostName(host: string): boolean {
  if (host.length === 0 || host.length > 253 || isIP(host) !== 0) return false;
  const labels = host.split('.');
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  // `127.1`, `0x7f.1`, `2130706433`: a last label of digits reads as an address to the resolver.
  return !/^\d+$/.test(labels[labels.length - 1] as string) && !/^0x[0-9a-f]*$/.test(labels[labels.length - 1] as string);
}

/** A database or user name the connection string cannot misread. */
const IDENTIFIER = /^[A-Za-z0-9_.-]{1,63}$/;

/** Printable, no control characters; a password, a project's display name. */
const PRINTABLE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

/**
 * The redeem answer. Unknown fields are dropped, never read: an operator may
 * add one, and this instance takes only what it knows.
 */
export const redeemAnswerSchema = z.object({
  engine: z.literal('postgres'),
  host: z.string().refine(isPlainHostName, 'must be a plain host name'),
  port: z.number().int().min(1).max(65_535),
  database: z.string().regex(IDENTIFIER, 'must be letters, digits, _, . or -'),
  user: z.string().regex(IDENTIFIER, 'must be letters, digits, _, . or -'),
  password: z.string().min(1).max(1024).regex(PRINTABLE, 'must be printable').optional(),
  sslmode: z.enum(['require', 'verify-full']),
  /** The project's name, shown on the password step and used to name the connection. */
  project: z.string().trim().min(1).max(80).regex(PRINTABLE, 'must be printable').optional(),
});

export type RedeemedConnection = z.infer<typeof redeemAnswerSchema>;

/**
 * The connection string for an answer, built from its fields and read back.
 *
 * `require` keeps libpq's meaning (encrypted, the certificate not checked),
 * which `pg` takes only with `uselibpqcompat`; on its own `pg` reads `require`
 * as `verify-full`, and a provider's own certificate chain (Supabase's pooler)
 * would fail against the system's CAs. `verify-full` checks the certificate
 * and the name. Both parameters are on the DSN allow-list.
 */
export function connectionDsn(answer: RedeemedConnection, password: string | undefined): string {
  const auth = password === undefined ? encodeURIComponent(answer.user) : `${encodeURIComponent(answer.user)}:${encodeURIComponent(password)}`;
  const tls = answer.sslmode === 'require' ? 'sslmode=require&uselibpqcompat=true' : 'sslmode=verify-full';
  const dsn = `postgres://${auth}@${answer.host}:${String(answer.port)}/${encodeURIComponent(answer.database)}?${tls}`;
  const back = databaseEndpointFromDsn(dsn, 'uri');
  const same =
    back !== null &&
    back.host === answer.host &&
    back.port === answer.port &&
    back.database === answer.database &&
    back.user === answer.user &&
    back.password === (password ?? null) &&
    Object.keys(back.params).length === (answer.sslmode === 'require' ? 2 : 1);
  if (!same) throw new ConnectRefusedError('fields', 'The operator answered connection details this instance cannot use.');
  return dsn;
}

export interface RedeemOptions {
  /** The operator's `<url>/redeem`. */
  url: string;
  code: string;
  verifier: string;
  /** The rule the operator's address is checked against. */
  policy: OutboundPolicy;
  timeoutMs?: number;
  maxBytes?: number;
  /** Test seam: the certificate authority the operator's certificate is checked against, beside the system's. */
  ca?: string | undefined;
}

/** Read a body up to `max` bytes; one more and the call is over. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Buffer> {
  if (body === null) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectRefusedError('too-large', 'The operator answered more than this instance reads.');
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

/**
 * Redeem `code` with `verifier` and return the checked answer. Throws
 * {@link ConnectExpiredError} when the operator says the code is spent or
 * unknown (4xx), {@link ConnectRefusedError} for everything else that is not
 * a good answer, and the outbound check's own errors for an address this
 * server does not call.
 */
export async function redeem(opts: RedeemOptions): Promise<RedeemedConnection> {
  const pins = await checkOutboundUrl(opts.url, opts.policy);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? REDEEM_TIMEOUT_MS);
  const agent = opts.ca === undefined ? undefined : new HttpsAgent({ ca: opts.ca, keepAlive: false });
  const call = pinnedFetch(pins, agent === undefined ? {} : { agent });
  let raw: Buffer;
  let status: number;
  try {
    const response = await call(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Adminium' },
      body: JSON.stringify({ code: opts.code, verifier: opts.verifier }),
      signal,
    });
    status = response.status;
    if (status >= 300 && status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new ConnectRefusedError('redirect', 'The operator answered with a redirect, which this instance does not follow.');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > (opts.maxBytes ?? REDEEM_MAX_BYTES)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ConnectRefusedError('too-large', 'The operator answered more than this instance reads.');
    }
    raw = await readCapped(response.body, opts.maxBytes ?? REDEEM_MAX_BYTES);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) throw new ConnectRefusedError('timeout', 'The operator did not answer in time.');
    throw new ConnectRefusedError('network', 'The operator could not be reached.');
  } finally {
    agent?.destroy();
  }
  if (status === 400 || status === 404 || status === 410) throw new ConnectExpiredError();
  if (status < 200 || status >= 300) throw new ConnectRefusedError('status', `The operator refused the hand-off (${String(status)}).`);
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ConnectRefusedError('malformed', 'The operator answered something that is not JSON.');
  }
  const parsed = redeemAnswerSchema.safeParse(json);
  if (!parsed.success) {
    // The field names only: the values can hold a password.
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'answer')))];
    throw new ConnectRefusedError('fields', `The operator answered connection details this instance does not take (${fields.join(', ')}).`);
  }
  return parsed.data;
}
