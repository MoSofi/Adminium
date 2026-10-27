// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's e-mail consent, for the consent part on an app's own screen:
 * the same four calls the dashboard's record page makes (`ConsentClient`),
 * made here with the person's own session and nothing of the dashboard's.
 *
 * Every call is same-origin under `/api/v1/consent` and carries the
 * session's cookie and the CSRF token the side's config gave the app (each
 * is a POST: the server takes none from a browser without it). Each route
 * asks the person's own rights on the table and the row, so somebody whose
 * role opens only the app's screens is served or refused as in the
 * dashboard.
 *
 * A refusal is thrown as an `Error` whose `message` is the server's sentence,
 * with its `code`, `details` and the reply's `status` on it: the panel reads
 * `details.reason` to say an erased person's refusal in the reader's words.
 */
import type { ConsentClient, ConsentEventView, ConsentPanelView, ConsentRecordRef } from '../consent/consentTypes.js';
import type { KitFetch } from './import-client.js';

/** A refusal as the panel reads one. */
export class ConsentRefused extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = 'ConsentRefused';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const CSRF_HEADER = 'x-adminium-csrf';

/** The client. `token` and `fetcher` are read at each call, so a new token (the person signed in again) is used at once. */
export function consentClient(token: () => string, fetcher: () => KitFetch | undefined): ConsentClient {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const send = fetcher() ?? ((input: string, options?: RequestInit) => fetch(input, options));
    const reply = await send(`/api/v1/consent/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json', [CSRF_HEADER]: token() },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await reply.json();
    } catch {
      // No JSON: said below by the status alone.
    }
    if (!reply.ok) {
      const error = ((parsed ?? {}) as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
      throw new ConsentRefused(
        reply.status,
        typeof error?.code === 'string' ? error.code : 'INTERNAL',
        typeof error?.message === 'string' && error.message !== '' ? error.message : `The server answered ${String(reply.status)}.`,
        error?.details,
      );
    }
    return (parsed as { data: T }).data;
  }
  return {
    panel: (record: ConsentRecordRef) => post<ConsentPanelView>('panel', record),
    recordConsent: async (record, input) => (await post<{ event: ConsentEventView }>('record-consent', { ...record, ...input })).event,
    replied: async (record) => (await post<{ event: ConsentEventView }>('replied', record)).event,
    saidNo: (record) => post<{ added: boolean }>('said-no', record),
  };
}
