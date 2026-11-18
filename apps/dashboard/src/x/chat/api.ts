// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls a live chat's window makes to its own host, the chat door
 * (`/x/chat/api/<addOn>/…`). Never a cookie: a visitor answers nobody's
 * session, and a preview's one read carries the staff member's own.
 *
 * WHAT IS ASKED.
 *   GET  config?lang=…[&frame=1|&preview=1]   who the business is, its look, hours, languages, what runs
 *   POST challenge                           the human check, solved before a first message or a question
 *   POST start                               the first message, with the solved check in `x-adminium-proof`
 *   POST messages                            a message, or "Talk to a person" (`talk: true`)
 *   GET  messages?after=…                    what came after a key; the token in `x-adminium-chat`
 *   POST details                             the visitor's name, e-mail or language
 *   POST question                            a question left outside hours, with a solved check
 *
 * THE REPLIES, as the window reads them: a refused token is 410 `lost`, a
 * write on a closed chat 409 (`write-closed` here: a closed chat's poll is
 * an answer, never a refusal), a tripped cap 429 `too-many` with
 * which cap and its wait, a failed check 403. A network failure throws
 * {@link ChatOffline}; any other refusal throws {@link ChatApiError}.
 */
import type { XBusiness } from '../api.js';

export type ChatState = 'bot' | 'waiting' | 'open' | 'closed';
export type ChatTheme = 'light' | 'dark' | 'visitor';
export type ChatCap = 'minute' | 'hour' | 'conversation' | 'new-conversations' | 'details';

/** How the door names the day a chat opens next. */
export type OpensDay = 'today' | 'tomorrow' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'date';

export interface NextOpen {
  /** The instant, ISO. */
  at: string;
  /** The business's own day (`yyyy-mm-dd`) and clock (`HH:MM`) then. */
  date: string;
  time: string;
  day: OpensDay;
}

export interface ChatHours {
  open: boolean;
  /** While open: when today's hours end (ISO). */
  closesAt: string | null;
  /** While closed: when it opens next; null when it never does. */
  nextOpen: NextOpen | null;
}

export interface ChatConfig extends ChatHours {
  state: 'live';
  business: XBusiness;
  accent: string;
  language: string;
  languages: string[];
  defaultLanguage: string;
  theme: ChatTheme;
  timeZone: string;
  welcome: string | null;
  outsideWords: string | null;
  /** Whether automatic answers run now (switched on, in hours, a day's tokens left, AI usable). */
  automatic: boolean;
  miloDrafts: boolean;
  /** The AI service a visitor's words would go to, named only while something sends them there. */
  aiService: string | null;
  /** Whether the business can send e-mail. */
  mail: boolean;
  frameOrigins?: string[];
  preview?: true;
}

export interface ChatAuthor {
  firstName: string;
  initials: string;
}

export interface ChatMessage {
  id: string;
  kind: 'visitor' | 'staff' | 'automatic' | 'system';
  body: string;
  /** ISO. */
  sentAt: string;
  event?: string;
  by?: 'visitor' | 'automatic';
  author?: ChatAuthor;
  language?: string;
}

export interface ChatChallenge {
  id: string;
  salt: string;
  difficulty: number;
}

export interface ChatStarted extends ChatHours {
  token: string;
  conversation: { state: ChatState; language: string };
  messages: ChatMessage[];
  cursor: string;
}

export interface ChatPolled extends ChatHours {
  state: ChatState;
  staff: boolean;
  messages: ChatMessage[];
  cursor: string;
}

/** Every refusal the door gives a window, as one shape. */
export type ChatRefusal =
  | { state: 'lost' }
  /** A write on a closed chat (409). Not a closed chat's poll, which answers `state: 'closed'` as a reply. */
  | { state: 'write-closed' }
  | { state: 'proof' }
  | { state: 'too-many'; cap: ChatCap; retryAfter: number | null }
  | { state: 'refused'; errors: Record<string, string> }
  | { state: 'in-hours' }
  | { state: 'unavailable' };

/** The door could not be reached at all: the window waits and tries again. */
export class ChatOffline extends Error {
  constructor() {
    super('The chat could not be reached.');
  }
}

/** The door answered something the window has no state for. */
export class ChatApiError extends Error {
  constructor(readonly status: number) {
    super(`The chat's request was answered ${String(status)}.`);
  }
}

const HEADERS = { accept: 'application/json' };
const CAPS = new Set<ChatCap>(['minute', 'hour', 'conversation', 'new-conversations', 'details']);

const base = (addOn: string): string => `/x/chat/api/${encodeURIComponent(addOn)}`;

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'omit', ...init, headers: { ...HEADERS, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new ChatOffline();
  }
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const read = (await response.json()) as unknown;
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A refusal the door gave, read into the window's states; null when the answer was not one. */
function refusalOf(response: Response, body: Record<string, unknown>): ChatRefusal | null {
  const state = body['state'];
  if (response.status === 410 || state === 'lost') return { state: 'lost' };
  if (response.status === 403 || state === 'proof') return { state: 'proof' };
  if (response.status === 429 || state === 'too-many') {
    const header = Number(response.headers.get('retry-after'));
    const given = typeof body['retryAfter'] === 'number' ? body['retryAfter'] : Number.isFinite(header) && header > 0 ? header : null;
    const cap = typeof body['cap'] === 'string' && CAPS.has(body['cap'] as ChatCap) ? (body['cap'] as ChatCap) : 'minute';
    return { state: 'too-many', cap, retryAfter: cap === 'conversation' ? null : given };
  }
  if (state === 'closed' && response.status === 409) return { state: 'write-closed' };
  if (state === 'in-hours') return { state: 'in-hours' };
  if (state === 'refused') return { state: 'refused', errors: typeof body['errors'] === 'object' && body['errors'] !== null ? (body['errors'] as Record<string, string>) : {} };
  if (response.status === 404 || state === 'unavailable') return { state: 'unavailable' };
  return null;
}

async function json<T>(response: Response): Promise<T | ChatRefusal> {
  const body = await bodyOf(response);
  if (response.ok && body['state'] !== undefined && !['lost', 'proof', 'too-many', 'refused', 'unavailable', 'in-hours'].includes(body['state'] as string)) return body as T;
  const refused = refusalOf(response, body);
  if (refused !== null) return refused;
  throw new ChatApiError(response.status);
}

/** Whether a reply is one of the door's refusals. */
export function isRefusal(value: unknown): value is ChatRefusal {
  return typeof value === 'object' && value !== null && ['lost', 'write-closed', 'proof', 'too-many', 'refused', 'in-hours', 'unavailable'].includes((value as { state?: string }).state ?? '');
}

export interface ChatDoorClient {
  config(opts: { lang: string | null; frame: boolean; preview: boolean }): Promise<ChatConfig | null>;
  challenge(): Promise<ChatChallenge>;
  start(proof: string, sent: { body: string; language: string; cameFrom: string | null }): Promise<ChatStarted | ChatRefusal>;
  post(token: string, sent: { body: string } | { talk: true }): Promise<{ state: 'sent'; message?: ChatMessage; conversation: { state: ChatState }; token: string } | ChatRefusal>;
  poll(token: string, after: string): Promise<ChatPolled | ChatRefusal>;
  details(token: string, sent: { name?: string; email?: string; language?: string }): Promise<{ state: 'saved'; conversation: { state: ChatState; language: string }; token: string } | ChatRefusal>;
  question(proof: string, sent: { question: string; name: string; email: string; language: string; cameFrom: string | null }): Promise<{ state: 'sent'; token: string } | ChatRefusal>;
}

/** The door of one chat, as the window calls it. */
export function chatDoor(addOn: string): ChatDoorClient {
  const at = base(addOn);
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    call(`${at}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return {
    async config({ lang, frame, preview }) {
      const query = new URLSearchParams();
      if (lang !== null) query.set('lang', lang);
      if (frame) query.set('frame', '1');
      if (preview) query.set('preview', '1');
      const search = query.toString();
      const response = await call(`${at}/config${search === '' ? '' : `?${search}`}`, { method: 'GET', credentials: preview ? 'same-origin' : 'omit' });
      if (response.status === 404) return null;
      const body = await bodyOf(response);
      if (!response.ok || body['state'] !== 'live') throw new ChatApiError(response.status);
      return body as unknown as ChatConfig;
    },
    async challenge() {
      const response = await post('challenge', {});
      if (!response.ok) throw new ChatApiError(response.status);
      return (await response.json()) as ChatChallenge;
    },
    start: async (proof, sent) => json<ChatStarted>(await post('start', sent, { 'x-adminium-proof': proof })),
    post: async (token, sent) => json(await post('messages', { token, ...sent })),
    poll: async (token, after) => json<ChatPolled>(await call(`${at}/messages?after=${encodeURIComponent(after)}`, { method: 'GET', headers: { 'x-adminium-chat': token } })),
    details: async (token, sent) => json(await post('details', { token, ...sent })),
    question: async (proof, sent) => json(await post('question', sent, { 'x-adminium-proof': proof })),
  };
}
