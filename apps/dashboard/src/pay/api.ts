// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's calls to its own API (`/pay/api/*`).
 *
 * WHICH CREDENTIALS. A live link's page sends no cookie at all
 * (`credentials: 'omit'`): the server ignores any staff session for it, and a
 * page that carries none cannot be made to act with one. A test link opens
 * only for signed-in staff, and the page cannot tell which kind it holds
 * before it asks. So it asks without the cookie first; only when the server
 * answers `test-staff-only` does it ask once more with it (`same-origin`),
 * and it keeps that choice for the rest of this test page's calls.
 */
export const PAY_STATES = [
  'ready',
  'unknown',
  'unavailable',
  'test-staff-only',
  'paid',
  'processing',
  'checking',
  'failed',
  'cancelled',
  'nothing-due',
  'voided',
  'no-ways',
  'locked',
  'expired',
  'shop-checks',
] as const;
export type PayState = (typeof PAY_STATES)[number];

export interface PayWay {
  source: string;
  method: string;
  label: Record<string, string> | null;
  details: unknown;
}

export interface PayLine {
  label: string;
  amount: string;
}

export interface PayPage {
  state: PayState;
  test: boolean;
  shop: { name: string; email: string | null; phone: string | null; hasLogo: boolean };
  payable: { label: string; currency: string; due: string; total: string; alreadyPaid: string | null; dueDate: string | null; lines: PayLine[] | null } | null;
  ways: PayWay[];
  processing: { method: string | null; startedAt: number } | null;
  /** On the way back: the service the customer paid with, and what it took. */
  attempt: { provider: string; amount: string; at: number; receiptSent: boolean } | null;
}

export type Credentials = 'omit' | 'same-origin';

export class PayApiError extends Error {
  constructor(readonly status: number) {
    super(`The pay page's request was answered ${String(status)}.`);
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok && response.status !== 403) throw new PayApiError(response.status);
  return (await response.json()) as T;
}

const headers = { accept: 'application/json' };

export async function fetchPage(token: string, credentials: Credentials): Promise<PayPage> {
  return json(await fetch(`/pay/api/${encodeURIComponent(token)}`, { credentials, headers }));
}

/** The page for a link, asking with the staff cookie only when the link turned out to be a test link. */
export async function openLink(token: string): Promise<{ page: PayPage; credentials: Credentials }> {
  const page = await fetchPage(token, 'omit');
  if (page.state !== 'test-staff-only') return { page, credentials: 'omit' };
  return { page: await fetchPage(token, 'same-origin'), credentials: 'same-origin' };
}

export async function fetchBack(nonce: string): Promise<PayPage> {
  const page = await json<PayPage>(await fetch(`/pay/api/back/${encodeURIComponent(nonce)}`, { credentials: 'omit', headers }));
  if (page.state !== 'unknown') return page;
  // A test payment comes back to staff, whose cookie the test link needed too.
  return json(await fetch(`/pay/api/back/${encodeURIComponent(nonce)}`, { credentials: 'same-origin', headers }));
}

/** Staff only: the pay page settings as a customer would see them, on a made-up invoice. */
export async function fetchPreview(): Promise<PayPage> {
  return json(await fetch('/pay/api/preview', { credentials: 'same-origin', headers }));
}

/** What Studio sends the preview while the settings are being edited (not saved yet). */
export interface PreviewEdit {
  type: 'adminium-pay-preview';
  shop: { name: string; email: string | null; phone: string | null };
  /** The logo file to show: the saved one, one just uploaded, or none. */
  logoFileId: string | null;
  showLines: boolean;
}

export function isPreviewEdit(data: unknown): data is PreviewEdit {
  if (typeof data !== 'object' || data === null) return false;
  const edit = data as Partial<PreviewEdit>;
  return edit.type === 'adminium-pay-preview' && typeof edit.shop?.name === 'string' && typeof edit.showLines === 'boolean';
}

export interface Challenge {
  id: string;
  salt: string;
  difficulty: number;
}

export async function fetchChallenge(token: string, credentials: Credentials): Promise<Challenge> {
  return json(await fetch(`/pay/api/${encodeURIComponent(token)}/challenge`, { credentials, headers }));
}

export type CheckoutAnswer = { url: string } | { state: PayState; message: string | null };

/** Starts paying with one service; `locale` is the page's language, handed to the service's own page. */
export async function postCheckout(token: string, source: string, proof: string, credentials: Credentials, locale: string): Promise<{ status: number; answer: CheckoutAnswer }> {
  const response = await fetch(`/pay/api/${encodeURIComponent(token)}/checkout`, {
    method: 'POST',
    credentials,
    headers: { ...headers, 'content-type': 'application/json', 'x-adminium-proof': proof },
    body: JSON.stringify({ source, locale }),
  });
  return { status: response.status, answer: await json<CheckoutAnswer>(response) };
}

export interface DemoCheckout {
  label: string;
  amount: string;
  currency: string;
  status: string;
}

export async function fetchDemo(attempt: string): Promise<DemoCheckout> {
  return json(await fetch(`/pay/api/demo/${encodeURIComponent(attempt)}`, { credentials: 'same-origin', headers }));
}

export async function driveDemo(attempt: string, action: string): Promise<{ back: string }> {
  return json(
    await fetch(`/pay/api/demo/${encodeURIComponent(attempt)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
  );
}

/**
 * Where the browser may be sent: an https page (the provider's, which the
 * server already checked against the provider's own hosts) or this server's
 * demo page. Anything else is refused here too.
 */
export function mayGoTo(url: string, here: string): boolean {
  try {
    const target = new URL(url, here);
    if (target.origin === new URL(here).origin) return target.pathname.startsWith('/pay/');
    return target.protocol === 'https:';
  } catch {
    return false;
  }
}
