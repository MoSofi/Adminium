// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The byte-driver contract.
 *
 * Six methods, one shape, three implementations — `local` (this server's disk
 * or a directory the operator names), `s3` (any S3-compatible endpoint) and
 * `webdav` (a NAS, a Storage Box, nine lines of nginx). Everything above this
 * line — the store facade, the routes, the sweep, the migrate job — is written
 * once against this interface, which is what makes "the same e2e passes
 * against three drivers" a criterion rather than an aspiration.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *  • No `list()`. The row is the index. A driver that could enumerate its own
 *    objects would tempt a reconciliation pass, and reconciling a bucket
 *    against a table is a feature with its own conflict rules, not a method.
 *  • No `copy()`. The migrate job (D20) reads through one driver and writes
 *    through another, verifying sha256 on landing; a server-side copy would be
 *    S3-only and would skip the verification.
 *  • No `exists()` beyond `head()`, which returns the size a caller needs
 *    anyway.
 *  • `put` takes a PATH, not a stream. Every byte is spooled first (D4), so
 *    the driver is handed a finished file with a known length and hash — which
 *    is what a signed remote PUT requires and what lets the local driver
 *    implement `put` as a rename.
 */

import type { Readable } from 'node:stream';

import type { StorageDriverKind } from '@adminium/meta';

export type { StorageDriverKind };

/** The finished spool file a driver is asked to take. */
export interface PutSource {
  /** Absolute path to the spooled bytes. The driver must not delete it. */
  path: string;
  sizeBytes: number;
  mime: string;
  /** Lowercase hex sha256 of the whole file — signed into a remote PUT. */
  sha256: string;
}

export interface OpenedBytes {
  stream: Readable;
  /** Bytes in THIS response: the whole object, or the length of the range. */
  sizeBytes: number;
  /** `bytes <start>-<end>/<total>` when a range was served; absent otherwise. */
  contentRange?: string;
}

export interface ByteRange {
  start: number;
  /** Inclusive, RFC 7233 style. Absent = to the end. */
  end?: number;
}

/** What the Test button reports (D2's `status`/`last_error`). */
export type ProbeResult = { ok: true; latencyMs: number } | { ok: false; error: string };

/** Facts about where a destination's bytes physically are (D23's usage strip). */
export interface DriverUsage {
  /** Free bytes on the underlying filesystem. Local only; remote drivers cannot know. */
  available?: number;
}

/** The key layout a NEW file gets on this driver (D19). */
export interface KeyRequest {
  id: string;
  kind: string;
  filename: string;
  createdAt: number;
}

export class FileDriverError extends Error {
  override readonly name: string = 'FileDriverError';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

/** A key names no object on this driver. Distinct from a transport failure. */
export class FileNotFoundError extends FileDriverError {
  override readonly name: string = 'FileNotFoundError';
}

export interface FileDriver {
  readonly kind: StorageDriverKind;
  /**
   * The key a NEW row gets. Called once, at upload; afterwards the row's
   * stored `storage_key` is the authority and this is never consulted again —
   * which is what lets the layout change without stranding old objects.
   */
  keyFor(file: KeyRequest): string;
  put(key: string, source: PutSource): Promise<void>;
  open(key: string, range?: ByteRange): Promise<OpenedBytes>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  /** Idempotent: a missing object is success — the GC discipline the repo already assumes. */
  remove(key: string): Promise<void>;
  /** put + head + open + remove of a 1 KiB probe. Never throws; reports. */
  probe(): Promise<ProbeResult>;
  usage?(): Promise<DriverUsage>;
}

/**
 * `fetch` for a remote storage endpoint, with redirects refused.
 *
 * The default `redirect: 'follow'` lets an endpoint answer
 * `302 http://169.254.169.254/…` and have the cloud's credentials streamed
 * back as the file; the guard only ever saw the first address. So nothing is
 * followed, and a 3xx is a driver error naming where it pointed. `allow`
 * keeps a redirect a protocol treats as an answer (WebDAV's MKCOL 301 for a
 * collection that already exists) as a plain response, still unfollowed.
 */
export function fetchWithoutRedirects(
  doFetch: typeof fetch,
  allow: (method: string, status: number) => boolean = () => false,
): typeof fetch {
  return async (input, init) => {
    const response = await doFetch(input, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status > 399) return response;
    const method = init?.method ?? 'GET';
    if (allow(method, response.status)) return response;
    await response.arrayBuffer().catch(() => undefined);
    let to = '';
    try {
      const location = response.headers.get('location');
      if (location !== null) to = ` to ${new URL(location, String(input)).origin}`;
    } catch {
      // an unreadable Location is still a redirect
    }
    throw new FileDriverError(
      `${method} answered a redirect (HTTP ${String(response.status)}${to}). A storage endpoint may not redirect; set the destination to the address it redirects to.`,
    );
  };
}
