// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The server's import doors, for the import part on an app's own screen: the
 * same seven calls the dashboard's page makes (`ImportClient`), made here
 * with the person's own session and nothing of the dashboard's.
 *
 * Every call is same-origin under `/api/v1/imports` and `/api/v1/jobs`, which
 * a mapped staff host passes, and carries the session's cookie. The four that
 * change something carry the CSRF token the side's config gave the app: the
 * server takes no change from a browser without it. Each door checks the
 * person's own rights on the table, so somebody whose role opens only an
 * app's screens is served or refused exactly as in the dashboard.
 *
 * A refusal is thrown as an `Error` whose `message` is the server's sentence,
 * with the server's `code`, its `details` and the reply's `status` on it: the
 * wizard reads those to say a refused right in the reader's own words.
 */
import type { ImportClient } from '../data-io/ImportWizard.js';

/** What the app may give in place of the browser's `fetch`. */
export type KitFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A refusal as the wizard reads one. */
export class ImportRefused extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = 'ImportRefused';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const CSRF_HEADER = 'x-adminium-csrf';

/**
 * The client. `token` and `fetcher` are read at each call, so an app that
 * hands over a new token (the person signed in again) is heard at once.
 */
export function importClient(token: () => string, fetcher: () => KitFetch | undefined): ImportClient {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const send = fetcher() ?? ((input: string, options?: RequestInit) => fetch(input, options));
    const changes = init.method !== undefined && init.method !== 'GET';
    const reply = await send(path, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...(changes ? { [CSRF_HEADER]: token() } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
    let body: unknown = null;
    try {
      body = await reply.json();
    } catch {
      // No JSON: said below by the status alone.
    }
    if (!reply.ok) {
      const error = ((body ?? {}) as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
      throw new ImportRefused(
        reply.status,
        typeof error?.code === 'string' ? error.code : reply.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL',
        typeof error?.message === 'string' && error.message !== '' ? error.message : `The server answered ${String(reply.status)}.`,
        error?.details,
      );
    }
    return body as T;
  }
  const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const one = (id: string): string => `/api/v1/imports/${encodeURIComponent(id)}`;

  return {
    uploadImportFile: async (file, opts = {}) =>
      (
        await call<{ data: Awaited<ReturnType<ImportClient['uploadImportFile']>> }>(
          `/api/v1/imports/upload?filename=${encodeURIComponent(file.name === '' ? 'upload.csv' : file.name)}${opts.header === 'none' ? '&header=none' : ''}`,
          { method: 'POST', headers: { 'content-type': 'text/csv' }, body: file },
        )
      ).data,
    createImport: (input) => call('/api/v1/imports', json(input)),
    previewImport: async (id, page = {}) =>
      (await call<{ data: Awaited<ReturnType<ImportClient['previewImport']>> }>(`${one(id)}/preview?offset=${String(page.offset ?? 0)}&limit=${String(page.limit ?? 100)}`)).data,
    // No body, as the dashboard sends it: the door takes none.
    runImport: (id) => call(`${one(id)}/run`, { method: 'POST' }),
    getImport: async (id) => (await call<{ data: Awaited<ReturnType<ImportClient['getImport']>> }>(one(id))).data,
    getJob: async (jobId) => (await call<{ data: Awaited<ReturnType<ImportClient['getJob']>> }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)).data,
    errorReportHref: (id) => `${one(id)}/error-report`,
  };
}
