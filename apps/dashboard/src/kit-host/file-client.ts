// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The server's file doors, for the signature pad and the photo field on an
 * app's own screen: an upload for one column of one table, and throwing away
 * an upload no record holds yet. Made with the person's own session and the
 * CSRF token the side's config gave the app, or through the app's own fetch.
 *
 * What the server answers a refused upload with is said in the reader's own
 * words by its kind (too large, not a kind the column takes, not theirs to
 * add), never in the server's English.
 */
import type { KitFileTarget } from './contract.js';

const CSRF_HEADER = 'x-adminium-csrf';

/** Why an upload was refused, as a part says it. */
export type FileRefusal = 'tooLarge' | 'wrongType' | 'notAllowed' | 'notSent';

export class FileRefused extends Error {
  readonly reason: FileRefusal;
  readonly status: number;
  constructor(reason: FileRefusal, status: number) {
    super(reason);
    this.name = 'FileRefused';
    this.reason = reason;
    this.status = status;
  }
}

/** The reason a reply's status stands for. */
export function refusalOf(status: number): FileRefusal {
  if (status === 413) return 'tooLarge';
  if (status === 415) return 'wrongType';
  if (status === 401 || status === 403 || status === 404) return 'notAllowed';
  return 'notSent';
}

/** Where a kept file is read from, with the person's session: for an `<img>`. */
export function contentHref(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/content`;
}

export interface FileClient {
  /** Sends one file for the target's column; answers its id. Throws `FileRefused`. */
  upload(file: Blob, filename: string): Promise<string>;
  /** Throws away an upload no record holds yet. A refusal (a record holds it now) is let be: the file is the record's. */
  discard(fileId: string): Promise<void>;
}

/** The client; `target` is read at each call, so a new token or fetch given by `update` is used by the next one. */
export function fileClient(target: () => KitFileTarget): FileClient {
  const send = (path: string, init: RequestInit): Promise<Response> => {
    const now = target();
    const fetcher = now.fetch ?? ((input: string, options?: RequestInit) => fetch(input, options));
    return fetcher(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', [CSRF_HEADER]: now.csrfToken, ...(init.headers as Record<string, string> | undefined) } });
  };
  return {
    async upload(file, filename) {
      const now = target();
      const query = new URLSearchParams({ connectionId: now.connectionId, table: now.table, column: now.column, filename });
      let reply: Response;
      try {
        reply = await send(`/api/v1/files?${query.toString()}`, { method: 'POST', headers: { 'content-type': file.type === '' ? 'application/octet-stream' : file.type }, body: file });
      } catch {
        throw new FileRefused('notSent', 0);
      }
      if (!reply.ok) throw new FileRefused(refusalOf(reply.status), reply.status);
      const body = (await reply.json().catch(() => null)) as { data?: { id?: unknown } } | null;
      const id = body?.data?.id;
      if (typeof id !== 'string') throw new FileRefused('notSent', reply.status);
      return id;
    },
    async discard(fileId) {
      try {
        await send(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch {
        // Left on the server, where nothing names it: the daily sweep takes it.
      }
    },
  };
}
