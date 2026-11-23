// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stub provider. Its replies are written from the providers' documentation
 * and cannot prove the live APIs.
 */
export const json = (status: number, value: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

export const twilioAccepted = (status = 'queued'): Response => json(201, { sid: `SM${'cd'.repeat(16)}`, status, num_segments: '1', price: '-0.0079', price_unit: 'USD' });
export const telnyxAccepted = (replayed = false): Response =>
  json(200, { data: { id: '40385f64-5717-4562-b3fc-2c963f66afa6', to: [{ status: 'queued' }], parts: 1, cost: { amount: '0.0040', currency: 'USD' } } }, replayed ? { 'idempotent-replayed': 'true' } : {});

export const networkError = (code: string): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });

/** What one POST does: answer, fail, or never answer (a timeout). */
export type ProviderStep = Response | Error | 'hang';

export interface ProviderPost {
  url: string;
  body: string;
  idempotencyKey: string | null;
}

/** Answers every account check, and each POST from `script` (accepted when it runs out). */
export function stubProvider(kind: 'twilio' | 'telnyx', profile: string, script: ProviderStep[] = []) {
  const posts: ProviderPost[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if ((init?.method ?? 'GET') === 'GET') {
      if (address.includes('messaging_profiles')) return json(200, { data: { id: profile, name: 'Lumen Bistro', enabled: true } });
      return json(200, { sid: /Accounts\/([^.]+)\.json/.exec(address)?.[1], friendly_name: 'Lumen Bistro', status: 'active', type: 'Full' });
    }
    posts.push({ url: address, body: typeof init?.body === 'string' ? init.body : '', idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    const step = script.shift() ?? (kind === 'twilio' ? twilioAccepted() : telnyxAccepted());
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
      });
    }
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { posts, fetchStub, script };
}
