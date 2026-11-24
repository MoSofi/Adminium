// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls a stranger's page makes to its own host (`/x/forms/api/*`).
 * On the install's own page (never in a frame) the reads and the answer go
 * with this host's cookies, so "Per visitor" can see a visitor who said yes
 * (`__Host-adm_v` on the whole host over https, `adm_v` on `/x/` over plain
 * http); in a frame, never a cookie. A form block on a landing page sends
 * `on=<page key>` on the read, the human check, its files and the answer: the
 * door then answers by the block's own form (another forms install may hold
 * the same slug), and the check is bound to that form.
 *
 * WHAT IS ASKED.
 *   GET  /x/forms/api/<slug>?lang=…[&frame=1][&t=…]   the form, in one of its languages, and who the business is;
 *                                               `&preview=1`: its draft, for staff (with their session; sends nothing)
 *                                               a named survey only with its invitation's token (`t`, which each
 *                                               call below carries too), answered `already` or `dead` otherwise
 *   GET  /x/forms/api/<slug>/challenge          the human check, solved when Send is pressed
 *   POST /x/forms/api/<slug>/answers            the answer, with the solved check in `x-adminium-proof`, and the
 *                                               boxes for texts ticked (`texts`)
 *   POST /x/forms/api/<slug>/files?q=…&name=…   one file for a file question, as the body, with a check of its own
 *
 * THE ANSWER'S REPLY, as the page reads it (the answer door says these):
 *   200 `{ state: 'sent' }`                     taken; the page shows the form's ending
 *   400 `{ state: 'refused', errors: { <question id or *>: <code> } }`   the codes of the forms vocabulary
 *   403                                         the human check did not pass (asked once more, silently)
 *   429 `{ state: 'too-many', retryAfter: <seconds>, window: 'hour' | 'day' }` (or a Retry-After header)
 *   `{ state: 'closed' | 'already' | 'dead' | 'unavailable' }`    with any status: a named survey's invitation
 *                                               answered already (409), its link not working (410)
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
  /** The app's own boxes for texts, drawn unticked under the questions; absent when there are none. */
  textBoxes?: XTextBox[];
}

/** A box for texts: the app's words in the form's language, and what it agrees to. Never required. */
export interface XTextBox {
  class: 'service' | 'marketing';
  label: string;
  version: number;
}

/** A named survey's invitation, as the page may say it: whom it greets, and what the survey is about. */
export interface XInvitation {
  firstName: string | null;
  about: string | null;
}

/** "Per visitor", as the install's own page is told it: the banner's words in the page's language, and whether this browser said yes. */
export interface XVisitor {
  banner: { language: string; title: string; text: string; yes: string; no: string; version: string };
  said: 'yes' | null;
}

export type XPage =
  | { state: 'live'; business: XBusiness; accent: string; form: XForm; today: string; frameOrigins?: string[]; invitation?: XInvitation; visitor?: XVisitor }
  | { state: 'closed' | 'unavailable' | 'already' | 'dead'; business: XBusiness; accent: string };

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
  /** `day`: an address's daily cap, which opens again tomorrow; an hour's cap otherwise. */
  | { state: 'too-many'; retryAfter: number | null; day?: boolean }
  | { state: 'closed' | 'already' | 'dead' | 'unavailable' };

/** What the page sends: the answers to the questions shown, the address's hidden values, and the trap field. */
export interface XAnswer {
  language: FormLanguage;
  values: Record<string, unknown>;
  query: Record<string, string>;
  website: string;
  /** In a frame, the website it sits on (a listed one's origin), which the answer keeps as where it was sent from. */
  from?: string;
  /** A named survey's token, from its link. */
  t?: string;
  /** The boxes for texts ticked, by class. */
  texts?: ('service' | 'marketing')[];
}

const HEADERS = { accept: 'application/json' };

export class XApiError extends Error {
  constructor(readonly status: number) {
    super(`The page's request was answered ${String(status)}.`);
  }
}

const base = (slug: string): string => `/x/forms/api/${encodeURIComponent(slug)}`;

/**
 * The form as a stranger is shown it; a page that is not there is an answer
 * too (404). A preview is the builder's look at the draft: the one read that
 * carries the staff member's own session, on this host.
 */
export async function fetchForm(slug: string, opts: { lang: string | null; frame: boolean; token: string | null; preview?: boolean | undefined; on?: string | null | undefined }): Promise<XPage> {
  const query = new URLSearchParams();
  if (opts.lang !== null) query.set('lang', opts.lang);
  if (opts.frame) query.set('frame', '1');
  if (opts.token !== null) query.set('t', opts.token);
  if (opts.preview === true) query.set('preview', '1');
  // A landing page's form block, asking as it nears the screen: the page's key (counted as "opened" there).
  if (opts.on !== undefined && opts.on !== null) query.set('on', opts.on);
  const search = query.toString();
  const response = await fetch(`${base(slug)}${search === '' ? '' : `?${search}`}`, { credentials: opts.preview === true || !opts.frame ? 'same-origin' : 'omit', headers: HEADERS });
  if (!response.ok && response.status !== 404) throw new XApiError(response.status);
  return (await response.json()) as XPage;
}

export async function fetchChallenge(slug: string, token: string | null, on: string | null = null): Promise<XChallenge> {
  const query = new URLSearchParams();
  if (token !== null) query.set('t', token);
  if (on !== null) query.set('on', on);
  const search = query.toString();
  const response = await fetch(`${base(slug)}/challenge${search === '' ? '' : `?${search}`}`, { credentials: 'omit', headers: HEADERS });
  if (!response.ok) throw new XApiError(response.status);
  return (await response.json()) as XChallenge;
}

const STATES = new Set(['sent', 'refused', 'too-many', 'closed', 'already', 'dead', 'unavailable']);

/** Sends an answer with a solved check; every reply the door gives is read into one of the page's states. */
export async function postAnswer(slug: string, answer: XAnswer, proof: string, opts: { frame?: boolean; on?: string | null } = {}): Promise<XSendReply> {
  const response = await fetch(`${base(slug)}/answers${opts.on === undefined || opts.on === null ? '' : `?on=${encodeURIComponent(opts.on)}`}`, {
    method: 'POST',
    credentials: opts.frame === true ? 'omit' : 'same-origin',
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
    return { state: 'too-many', retryAfter: given, ...(body['window'] === 'day' ? { day: true } : {}) };
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

