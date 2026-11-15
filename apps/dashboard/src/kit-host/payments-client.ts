// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments calls the kit's refund and pay-link parts make on an app's
 * own screen: the dashboard's own routes, same-origin, with the person's
 * session and the CSRF token the side's config gave the app. Each route asks
 * the person's own rights (the refund right, the record's update grant), so
 * the part is served or refused as the dashboard's panel is.
 */
import type { KitFetch } from './import-client.js';

const CSRF_HEADER = 'x-adminium-csrf';

/** A refusal: the server's sentence, with its code and status. */
export class PaymentRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentRefused';
  }
}

export function paymentsClient(token: () => string, fetcher: () => KitFetch | undefined) {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const send = fetcher() ?? ((input: string, options?: RequestInit) => fetch(input, options));
    const reply = await send(path, {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json', [CSRF_HEADER]: token() } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await reply.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
    if (!reply.ok) throw new PaymentRefused(reply.status, json?.error?.code ?? 'FAILED', json?.error?.message ?? 'That did not work.');
    return json?.data as T;
  }
  return {
    refundPreview: (attemptId: string) =>
      call<{ label: string; provider: string; test: boolean; taken: string; currency: string; refundable: string; paidWith: string | null; refusal: { code: string; message: string } | null }>(
        'GET',
        `/api/v1/payments/attempts/${encodeURIComponent(attemptId)}/refund`,
      ),
    refund: (input: { attemptId: string; amount: string; reason: string; note: null; key: string }) =>
      call<{ refund: { id: string; state: string; amount: string; currency: string }; fresh: boolean }>('POST', '/api/v1/payments/refunds', input),
    currentLink: (payable: { kind: string; connectionId: string; tableName: string; rowKey: string }) =>
      call<{ url: string; expiresAt: number } | null>('POST', '/api/v1/payments/links/current', payable),
    makeLink: (payable: { kind: string; connectionId: string; tableName: string; rowKey: string }) =>
      call<{ link: { url: string; expiresAt: number }; replaced: boolean }>('POST', '/api/v1/payments/links', payable),
  };
}
