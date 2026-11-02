// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls a stranger's page makes to its own host (`/x/forms/api/*`).
 * Never a cookie: a form answers nobody's session.
 *
 * WHAT IS ASKED.
 *   GET  /x/forms/api/<slug>?lang=…[&frame=1]   the form, in one of its languages, and who the business is
 *   GET  /x/forms/api/<slug>/challenge          the human check, solved when Send is pressed
 *   POST /x/forms/api/<slug>/answers            the answer, with the solved check in `x-adminium-proof`
 *   POST /x/forms/api/<slug>/files?q=…&name=…   one file for a file question, as the body, with a check of its own
 *
 * THE ANSWER'S REPLY, as the page reads it (the answer door says these):
 *   200 `{ state: 'sent' }`                     taken; the page shows the form's ending
 *   400 `{ state: 'refused', errors: { <question id or *>: <code> } }`   the codes of the forms vocabulary
 *   403                                         the human check did not pass (asked once more, silently)
 *   429 `{ state: 'too-many', retryAfter: <seconds> }` (or a Retry-After header)
 *   `{ state: 'closed' | 'already' | 'dead' | 'unavailable' }`    with any status
 */
import type { FormDefinition, FormLanguage } from '@adminium/add-on-contracts/forms';

export interface XBusiness {
  name: string;
  legalName: string | null;
  email: string | null;
  privacyNotice: string | null;
  hasLogo: boolean;
}

export interface XForm {
  kind: 'form' | 'survey';
  language: FormLanguage;
  languages: FormLanguage[];
  definition: FormDefinition;
  anonymous: boolean;
}

export type XPage =
  | { state: 'live'; business: XBusiness; accent: string; form: XForm; today: string; frameOrigins?: string[] }
  | { state: 'closed' | 'unavailable'; business: XBusiness; accent: string };

export interface XChallenge {
  id: string;
  salt: string;
  difficulty: number;
  expiresAt: number;
}

export type XSendReply =
  | { state: 'sent' }
  | { state: 'refused'; errors: Record<string, string> }
  | { state: 'proof' }
  | { state: 'too-many'; retryAfter: number | null }
  | { state: 'closed' | 'already' | 'dead' | 'unavailable' };

/** What the page sends: the answers to the questions shown, the address's hidden values, and the trap field. */
export interface XAnswer {
  language: FormLanguage;
  values: Record<string, unknown>;
  query: Record<string, string>;
  website: string;
}

const HEADERS = { accept: 'application/json' };

export class XApiError extends Error {
  constructor(readonly status: number) {
    super(`The page's request was answered ${String(status)}.`);
  }
}

const base = (slug: string): string => `/x/forms/api/${encodeURIComponent(slug)}`;

/** The form as a stranger is shown it; a page that is not there is an answer too (404). */
export async function fetchForm(slug: string, opts: { lang: string | null; frame: boolean }): Promise<XPage> {
  const query = new URLSearchParams();
  if (opts.lang !== null) query.set('lang', opts.lang);
  if (opts.frame) query.set('frame', '1');
  const search = query.toString();
  const response = await fetch(`${base(slug)}${search === '' ? '' : `?${search}`}`, { credentials: 'omit', headers: HEADERS });
  if (!response.ok && response.status !== 404) throw new XApiError(response.status);
  return (await response.json()) as XPage;
}

export async function fetchChallenge(slug: string): Promise<XChallenge> {
  const response = await fetch(`${base(slug)}/challenge`, { credentials: 'omit', headers: HEADERS });
  if (!response.ok) throw new XApiError(response.status);
  return (await response.json()) as XChallenge;
}

const STATES = new Set(['sent', 'refused', 'too-many', 'closed', 'already', 'dead', 'unavailable']);

/** Sends an answer with a solved check; every reply the door gives is read into one of the page's states. */
export async function postAnswer(slug: string, answer: XAnswer, proof: string): Promise<XSendReply> {
  const response = await fetch(`${base(slug)}/answers`, {
    method: 'POST',
    credentials: 'omit',
    headers: { ...HEADERS, 'content-type': 'application/json', 'x-adminium-proof': proof },
    body: JSON.stringify(answer),
  });
  if (response.status === 403) return { state: 'proof' };
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // No body: the status alone says it.
  }
  const state = typeof body['state'] === 'string' && STATES.has(body['state']) ? body['state'] : null;
  if (response.status === 429 || state === 'too-many') {
    const header = Number(response.headers.get('retry-after'));
    const given = typeof body['retryAfter'] === 'number' ? body['retryAfter'] : Number.isFinite(header) && header > 0 ? header : null;
    return { state: 'too-many', retryAfter: given };
  }
  if (state === 'refused') {
    const errors = typeof body['errors'] === 'object' && body['errors'] !== null ? (body['errors'] as Record<string, string>) : {};
    return { state: 'refused', errors };
  }
  if (state === 'sent' && response.ok) return { state: 'sent' };
  if (state === 'closed' || state === 'already' || state === 'dead') return { state };
  if (response.status === 404 || state === 'unavailable') return { state: 'unavailable' };
  throw new XApiError(response.status);
}

