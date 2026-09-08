// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AWS Signature Version 4 — header signing and query presigning, zero
 * dependencies (37-files-and-storage.md D32/O2, §3.10).
 *
 * WHY NOT `@aws-sdk/client-s3`. It is the heavy choice, not the safe one:
 * dozens of packages into the Docker image and the Electron bundle for four
 * verbs. And since v3.729 its default request checksums broke several
 * S3-compatible targets until `requestChecksumCalculation: 'WHEN_REQUIRED'`
 * was set — exactly the targets this feature exists to reach. Four verbs plus
 * a presign is this file, signed against AWS's own published test vectors.
 *
 * THE FOUR PLACES A HAND-ROLLED SIGNER GOES WRONG, all of which a 403 with no
 * hint tells you nothing about:
 *
 *  1. Header ORDER. Signed headers are sorted by lowercased name, and the
 *     canonical request must list them in that order in both the header block
 *     and the `SignedHeaders` line.
 *  2. Header VALUES. Trimmed, inner runs of whitespace collapsed — but only
 *     outside quotes, which is why the collapse here is deliberately simple
 *     and the signer never signs a header that could contain one.
 *  3. PATH encoding. Each segment is URI-encoded, `/` is NOT encoded, and for
 *     S3 the path is encoded exactly ONCE (unlike every other AWS service,
 *     which double-encodes). Getting this wrong breaks precisely the keys this
 *     plan generates — dated paths with separators.
 *  4. The PAYLOAD hash. This signer always signs the real sha256, never
 *     `UNSIGNED-PAYLOAD`, so a plain-HTTP MinIO in dev is signed identically
 *     to production TLS. The spool (D4) is what makes that free: the hash is
 *     known before the request starts.
 */

import { createHash, createHmac } from 'node:crypto';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Temporary credentials add `x-amz-security-token`; supported, never minted here. */
  sessionToken?: string | undefined;
}

export interface SigV4Request {
  method: string;
  /** Full URL. Query parameters are taken from it and re-canonicalised. */
  url: string;
  /** Header names in any case; the signer lowercases and sorts. */
  headers: Record<string, string>;
  /** Lowercase hex sha256 of the body — `EMPTY_SHA256` for a bodyless request. */
  payloadSha256: string;
  region: string;
  service?: string;
  /** Injectable for the test vectors, which pin an exact timestamp. */
  now?: Date;
}

/** sha256 of the empty string — the payload hash of every GET/HEAD/DELETE here. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * RFC 3986 unreserved-only encoding. `encodeURIComponent` leaves `!'()*`
 * unescaped and AWS requires them escaped; it also escapes `~`, which AWS
 * requires left alone. Both differences produce a signature mismatch on
 * exactly the filenames a human uploads.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === '/' && !encodeSlash) {
      out += char;
    } else {
      for (const byte of Buffer.from(char, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

/** `20260904T131415Z` and its `20260904` date half. */
export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** The four-step derivation; the last HMAC is over the literal `aws4_request`. */
export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
}

/** Sorted `k=v&k=v` with both halves URI-encoded — AWS's canonical query string. */
export function canonicalQuery(params: Iterable<[string, string]>): string {
  return [...params]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Path with each segment encoded once and `/` preserved — the S3 rule (see header). */
export function canonicalPath(pathname: string): string {
  return uriEncode(decodeURIComponent(pathname), false);
}

export interface CanonicalParts {
  canonicalRequest: string;
  stringToSign: string;
  signedHeaders: string;
  credentialScope: string;
  signature: string;
}

/**
 * The full canonicalisation, exported so the AWS test vectors can assert every
 * intermediate string rather than only the final signature. A vector that
 * checks only the signature tells you it is wrong, never which of the four
 * traps you hit.
 */
export function canonicalize(
  request: SigV4Request,
  credentials: SigV4Credentials,
  headers: Record<string, string>,
  stamp: { amzDate: string; dateStamp: string },
): CanonicalParts {
  const url = new URL(request.url);
  const service = request.service ?? 's3';

  const lowered = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = lowered.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = lowered.map(([k]) => k).join(';');

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    request.payloadSha256,
  ].join('\n');

  const credentialScope = `${stamp.dateStamp}/${request.region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp.amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, stamp.dateStamp, request.region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return { canonicalRequest, stringToSign, signedHeaders, credentialScope, signature };
}

/**
 * Sign a request with headers. Returns the COMPLETE header set to send —
 * including the `host`, `x-amz-date` and `x-amz-content-sha256` it added — so
 * a caller cannot accidentally send a header it did not sign.
 */
export function signRequest(request: SigV4Request, credentials: SigV4Credentials): Record<string, string> {
  const url = new URL(request.url);
  const stamp = amzDate(request.now ?? new Date());

  const headers: Record<string, string> = {
    ...request.headers,
    // `host` is mandatory in the signature. `URL.host` keeps a non-default
    // port, which a MinIO on :9000 needs and which `hostname` would drop.
    host: url.host,
    'x-amz-date': stamp.amzDate,
    'x-amz-content-sha256': request.payloadSha256,
    ...(credentials.sessionToken === undefined ? {} : { 'x-amz-security-token': credentials.sessionToken }),
  };

  const parts = canonicalize(request, credentials, headers, stamp);
  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${parts.credentialScope}, ` +
      `SignedHeaders=${parts.signedHeaders}, Signature=${parts.signature}`,
  };
}

/**
 * A time-limited GET URL that carries its own signature.
 *
 * WRITTEN, UNIT-TESTED, AND WITHOUT A CALLER IN v1 — deliberately (D34/O4). v1
 * proxies every byte through the server so the grant check, the audit row and
 * `nosniff` always apply; direct transfers are a phase-2 per-destination flag.
 * It lives here now because a presigner written later, against a signer that
 * has meanwhile grown assumptions from four callers, is a signer nobody trusts.
 */
export function presignGet(
  input: { url: string; region: string; service?: string; expiresInSeconds: number; now?: Date },
  credentials: SigV4Credentials,
): string {
  const url = new URL(input.url);
  const stamp = amzDate(input.now ?? new Date());
  const service = input.service ?? 's3';
  const credentialScope = `${stamp.dateStamp}/${input.region}/${service}/aws4_request`;

  url.searchParams.set('X-Amz-Algorithm', ALGORITHM);
  url.searchParams.set('X-Amz-Credential', `${credentials.accessKeyId}/${credentialScope}`);
  url.searchParams.set('X-Amz-Date', stamp.amzDate);
  url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  if (credentials.sessionToken !== undefined) {
    url.searchParams.set('X-Amz-Security-Token', credentials.sessionToken);
  }

  // A presigned URL signs the literal `UNSIGNED-PAYLOAD` — the recipient has
  // no body to hash and never sees one. This is the ONE place that string is
  // correct, and it is why it appears nowhere in `signRequest`.
  const parts = canonicalize(
    { method: 'GET', url: url.toString(), headers: {}, payloadSha256: 'UNSIGNED-PAYLOAD', region: input.region, service },
    credentials,
    { host: url.host },
    stamp,
  );
  url.searchParams.set('X-Amz-Signature', parts.signature);
  return url.toString();
}
