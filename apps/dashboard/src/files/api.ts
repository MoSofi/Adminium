// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files transport.
 *
 * WHY `XMLHttpRequest` AND NOT `fetch`. `fetch` has no upload-progress event —
 * it has never had one, and the streams-based request bodies that would
 * approximate it are not usable here (they need `duplex: 'half'`, are
 * unsupported in Safari, and cannot report bytes SENT in any case). A 200 MB
 * upload with no progress is an upload the user assumes has frozen. XHR is the
 * only browser API that reports it, so it is the one this uses — a deliberate
 * choice, not a leftover.
 *
 * THE BODY IS THE FILE. Metadata rides the query string (D5), matching the
 * three raw-body calls this dashboard already makes (`app/branding.ts`,
 * `data-io/api.ts`) rather than introducing multipart for one surface.
 *
 * UPLOAD PROGRESS IS NOT A JOB. `UploadProgressList`'s docblock imagines job
 * rows; there are none. An upload is one HTTP request and its progress is this
 * client's own state — no polling, no realtime channel, nothing to clean up if
 * the tab closes mid-flight.
 */

import { api, ApiError, csrfHeaders } from '../app/api.js';

/** One file as every surface here renders it — the server's `FileView`. */
export interface FileDto {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  kind: string;
  destinationId: string | null;
  uploadedBy: string | null;
  createdAt: number;
  attachedAt: number | null;
  deletedAt: number | null;
  /**
   * The connection this file belongs to — present whether or not a record
   * claims it. `entity` below repeats it when there IS a record; this is what
   * a library file carries instead.
   */
  connectionId: string | null;
  entity: { connectionId: string; table: string; recordId: string } | null;
  /** Same-origin path. Never a destination's public URL — the CSP blocks it. */
  contentPath: string;
}

export interface UploadFileInput {
  file: File;
  connectionId: string;
  /**
   * The table this file is for, when it is for one.
   *
   * OMITTED = a LIBRARY upload: the file belongs to the connection and to no
   * record, is authorised by `files.manage` rather than by a table grant, and
   * is claimed at creation so the unattached sweep leaves it alone. Named =
   * 37's rules, unchanged.
   */
  table?: string | undefined;
  /** Attaches on upload; omit for the create form, where the record is not there yet. */
  recordId?: string | undefined;
  /**
   * Narrows the allowlist and picks the reference shape the reply returns.
   * Requires {@link UploadFileInput.table} — a column belongs to a table, and
   * the server refuses the pair without it.
   */
  column?: string | undefined;
  destinationId?: string | undefined;
  onProgress?: ((fraction: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * `POST /files` replies `{ data, ref? }`: the stored file's view under `data`
 * (the envelope every files route uses), plus the value a column write stores
 * when the upload named one. The key is `data`, not `file` — the shape the
 * server sends (`routes/files/index.ts`), which the two record bindings read
 * as `file` for a wave and got `undefined`.
 */
export interface UploadFileResult {
  data: FileDto;
  /** The value to write into the column. Absent when no column was named. */
  ref?: string;
}

/** The upload was cancelled by the caller — not a failure to report. */
export class UploadAbortedError extends Error {
  override readonly name = 'UploadAbortedError';
  constructor() {
    super('The upload was cancelled.');
  }
}

/** `{error: {code, message, requestId}}` → `ApiError`, the envelope defines. */
function toApiError(status: number, body: string): ApiError {
  let code = 'INTERNAL';
  let message = `Request failed with status ${String(status)}`;
  let requestId: string | null = null;
  let details: unknown;
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown };
    };
    if (typeof parsed.error?.code === 'string') code = parsed.error.code;
    if (typeof parsed.error?.message === 'string') message = parsed.error.message;
    if (typeof parsed.error?.requestId === 'string') requestId = parsed.error.requestId;
    details = parsed.error?.details;
  } catch {
    // A non-JSON body (a proxy's 413 page, say) keeps the generic message.
  }
  return new ApiError(status, code, message, requestId, details);
}

export function uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
  const query = new URLSearchParams({
    filename: input.file.name,
    connectionId: input.connectionId,
  });
  if (input.table !== undefined) query.set('table', input.table);
  if (input.recordId !== undefined) query.set('recordId', input.recordId);
  if (input.column !== undefined) query.set('column', input.column);
  if (input.destinationId !== undefined) query.set('destinationId', input.destinationId);

  return new Promise<UploadFileResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/files?${query.toString()}`);
    xhr.withCredentials = true;
    // The client's claim is advisory — the server sniffs the bytes (D8) — but
    // sending it costs nothing and helps a proxy in between.
    xhr.setRequestHeader('content-type', input.file.type === '' ? 'application/octet-stream' : input.file.type);
    for (const [header, value] of Object.entries(csrfHeaders())) xhr.setRequestHeader(header, value);

    const onAbort = (): void => xhr.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = (): void => input.signal?.removeEventListener('abort', onAbort);

    xhr.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false while the browser is still measuring; a
      // fraction derived from a zero total would flash 100%.
      if (event.lengthComputable && event.total > 0) input.onProgress?.(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadFileResult);
        } catch {
          reject(new ApiError(xhr.status, 'INTERNAL', 'The upload reply was not readable.', null));
        }
        return;
      }
      reject(toApiError(xhr.status, xhr.responseText));
    });
    xhr.addEventListener('error', () => {
      cleanup();
      // Indistinguishable from offline at this layer, and mapped the same way
      // the fetch client maps a `TypeError`.
      reject(new ApiError(0, 'NETWORK', 'The upload could not reach the server.', null));
    });
    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new UploadAbortedError());
    });

    xhr.send(input.file);
  });
}

// --- the JSON half ------------------------------------------------------------
//
// EVERY PATH HERE IS ABSOLUTE, and it has to be: `apiFetch` hands its argument
// straight to `fetch` and adds no base (`app/api.ts`), so a relative `/files/…`
// resolves against the SPA's current route and 404s. The upload XHR above
// already spelled `/api/v1/…` in full; these four did not, which made Delete,
// Restore and the batch resolve dead on the wire while every unit test that
// mocked this module still passed. (Caught by the 37e review.)

/**
 * Resolve a page of stored values in ONE call.
 *
 * Batched deliberately: a grid of fifty rows with a file column would
 * otherwise be fifty requests, and the whole reason the reply is keyed by the
 * stored VALUE rather than by a file id is that the caller has values, not ids
 * — it does not know which of them are ours until the server says.
 *
 * A value the server does not recognise, or that names a file this reader may
 * not see, comes back `null` and renders as the plain link it was before.
 */
export async function resolveFiles(refs: readonly string[]): Promise<Map<string, FileDto | null>> {
  const out = new Map<string, FileDto | null>();
  if (refs.length === 0) return out;
  // The route caps a batch at 200; a page larger than that is chunked here
  // rather than refused, because the cap is about one request's size and not
  // about how many files a page may show.
  for (let index = 0; index < refs.length; index += 200) {
    const chunk = refs.slice(index, index + 200);
    const reply = await api.post<{ data: Record<string, FileDto | null> }>('/api/v1/files/resolve', { refs: chunk });
    for (const [ref, file] of Object.entries(reply.data)) out.set(ref, file);
  }
  return out;
}

/** Files attached to one record — the Attachments panel's list. */
export async function listRecordFiles(input: {
  connectionId: string;
  table: string;
  recordId: string;
}): Promise<FileDto[]> {
  const query = new URLSearchParams({
    connectionId: input.connectionId,
    table: input.table,
    recordId: input.recordId,
    limit: '200',
  });
  const reply = await api.get<{ data: FileDto[] }>(`/api/v1/files?${query.toString()}`);
  return reply.data;
}

/** Move a file to the trash. Reversible for `retention.filesTrashDays` (D12). */
export async function deleteFile(fileId: string): Promise<FileDto> {
  return (await api.delete<{ data: FileDto }>(`/api/v1/files/${encodeURIComponent(fileId)}`)).data;
}

/** Put a trashed file back — the panel's Undo. No token machinery (D12). */
export async function restoreFile(fileId: string): Promise<FileDto> {
  return (await api.post<{ data: FileDto }>(`/api/v1/files/${encodeURIComponent(fileId)}/restore`)).data;
}
