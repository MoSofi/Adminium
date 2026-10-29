// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one door a picture service is called through: the host's checked
 * `fetch` for the address (`outboundFetch`), no redirect followed, a
 * timeout, the caller's own signal, and the answer read with a byte bound
 * on the success path and the error path alike.
 *
 * An error is a {@link PictureError} with a code and nothing the service
 * said: its body is read only to tell a content-filter refusal and a
 * billing refusal from the rest, and is then dropped.
 */
import { AnswerTooLargeError, outboundFetch, readBounded } from '../providers/http.js';
import { PictureError, type PictureErrorCode } from './types.js';

/** How much of an error answer is read to tell what kind of no it is. */
const ERROR_READ_BYTES = 16 * 1024;

export interface PictureCall {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

const codeFor = (status: number): PictureErrorCode => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'http';
};

/**
 * What an error answer says it is, by the codes the services use (read, never
 * kept): OpenAI's `moderation_blocked` and `content_policy_violation`, its
 * `insufficient_quota` and `billing_hard_limit_reached`; Google's `SAFETY`
 * block and `RESOURCE_EXHAUSTED` with a billing reason.
 */
export function refusalOf(status: number, text: string): PictureErrorCode {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the status alone says what it is.
  }
  const error = ((parsed ?? {}) as { error?: unknown }).error;
  const fields = (error !== null && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const code = typeof fields['code'] === 'string' ? fields['code'] : '';
  const type = typeof fields['type'] === 'string' ? fields['type'] : '';
  const statusWord = typeof fields['status'] === 'string' ? fields['status'] : '';
  const message = typeof fields['message'] === 'string' ? fields['message'].slice(0, 400).toLowerCase() : '';
  if (code === 'moderation_blocked' || code === 'content_policy_violation' || type === 'image_generation_user_error' || /safety|blocked by|content polic/.test(message)) return 'refused';
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached' || code === 'billing_not_active' || /billing|credit balance/.test(message)) return 'billing';
  // A per-minute limit ("Quota exceeded for metric …", RESOURCE_EXHAUSTED): wait and try again, not "no credit".
  if (status === 429 || statusWord === 'RESOURCE_EXHAUSTED') return 'rate_limit';
  if (statusWord === 'PERMISSION_DENIED' || statusWord === 'UNAUTHENTICATED') return 'auth';
  // The route answered and the model is not there (a 404 about a model, Google's NOT_FOUND for an unknown model): not the route missing.
  if (code === 'model_not_found' || statusWord === 'NOT_FOUND' || (status === 404 && /\bmodel\b/.test(message))) return 'model_gone';
  return codeFor(status);
}

/** Calls a picture service and answers its JSON, or throws a {@link PictureError}. */
export async function pictureCall<T>(call: PictureCall): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs);
  const onAbort = (): void => controller.abort();
  if (call.signal?.aborted === true) controller.abort();
  else call.signal?.addEventListener('abort', onAbort, { once: true });
  const stopped = (): PictureError | null =>
    call.signal?.aborted === true ? new PictureError('aborted', 'the request was stopped') : controller.signal.aborted ? new PictureError('timeout', `no answer after ${String(call.timeoutMs)} ms`) : null;
  try {
    const init: RequestInit = { method: call.method, headers: call.headers, signal: controller.signal, redirect: 'manual' };
    if (call.body !== undefined) init.body = JSON.stringify(call.body);
    let res: Response;
    try {
      res = await outboundFetch(call.url)(call.url, init);
    } catch {
      throw stopped() ?? new PictureError('network', 'the service could not be reached');
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => undefined);
      throw new PictureError('http', `the service answered a redirect (HTTP ${String(res.status)}), which is never followed`, { status: res.status });
    }
    if (!res.ok) {
      let text = '';
      try {
        text = await readBounded(res, ERROR_READ_BYTES);
      } catch {
        // Too long, or cut: the status says enough.
      }
      throw new PictureError(refusalOf(res.status, text), `the service answered HTTP ${String(res.status)}`, { status: res.status });
    }
    let text: string;
    try {
      text = await readBounded(res, call.maxBytes);
    } catch (error) {
      throw stopped() ?? new PictureError('bad_response', error instanceof AnswerTooLargeError ? `the answer was larger than ${String(call.maxBytes)} bytes` : 'the answer could not be read', { status: res.status });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PictureError('bad_response', 'the answer was not JSON', { status: res.status });
    }
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener('abort', onAbort);
  }
}
