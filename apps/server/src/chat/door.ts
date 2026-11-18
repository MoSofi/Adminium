// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT DOOR'S WORK: what a visitor's window may do, each step in order,
 * all of it judged before anything is written. The routes
 * (`routes/chat-door/index.ts`) only read the request and send the answer.
 *
 *  - config: what the window draws (who the business is, its hours, the
 *    first line's facts, the languages, whether mail works);
 *  - start: one `chat` proof spent (harder as the hour's starts pass half
 *    the chat's limit), the trap field, the address's caps and the chat's
 *    pause, then the conversation with the visitor's first message, and its
 *    token. In hours with automatic answers on it is with the answerer
 *    (`bot`), otherwise it waits for a person. The breaker counts it only
 *    once it is real: a second message, its details (`caps.counted`);
 *  - a message: the token, the conversation's caps, the message; with the
 *    answerer, it is asked; "Talk to a person" hands it over (`asked`);
 *  - a poll: the messages after a cursor, the state, the hours, and the
 *    visitor's heartbeat. A poll with nothing new reads none of the add-on's
 *    tables (`store.ts` keeps what it needs);
 *  - details: the name, the e-mail and the language the visitor gives, at
 *    most ten changes an hour; one that changes nothing writes nothing;
 *  - a question outside hours: one proof, a waiting conversation, and the
 *    row the app opened to it (`question.ts`). No mail goes to the address;
 *  - close: the visitor ends the chat.
 *
 * A body is cut to what a person typed: NFC, control characters but line
 * breaks and tabs removed, trimmed, then 1 to 2,000 characters (counted as
 * the visitor sees them, by code point). "Came from" is the page's origin,
 * with its path only on one of the business's listed websites: its query and
 * fragment never reach the conversation, and it is cut to 2,048 characters. The network address is never kept with a
 * conversation: only its keyed hash counts against the caps, for 3 hours.
 */
import { createHash, createHmac } from 'node:crypto';

import type { FormLanguage } from '@adminium/add-on-contracts/forms';
import { CHAT_MESSAGE_MAX } from '@adminium/manifest';
import { chatAiDayOf, chatAiTallyRepo, connectionTenantConfig, publicProofsRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { looksLikeAddress } from '../consent/service.js';
import { formsMailBlocked } from '../forms/mail.js';
import { strangerBusiness } from '../forms/view.js';
import { HOUR_MS } from '../public-api/anonymous-caps.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { rateAddress } from '../public-api/limiter.js';
import type { ListedWebsites } from '../forms/websites.js';
import { linkFreeText, NAME_RULE } from '../public-api/plain-text.js';
import { checkProof, PROOF_DIFFICULTY, proofKey } from '../public-api/proof.js';
import type { ChatAi } from './ai.js';
import { CHAT_PER_CONVERSATION } from './answerer.js';
import { ANSWERER_MESSAGES, answererAnswers, answerText, automaticLanguage, HAND_OVER_ANSWERER, readAnswers, type ChatAnswer, type ChatAnswerer } from './answering.js';
import { chatAiAddressKey, type ChatCapRefusal, type ChatCaps } from './caps.js';
import type { ChatCatalog, LiveChat } from './catalog.js';
import { hoursAt, knownZone, type HoursNow } from './hours.js';
import { becomeRow, type ChatQuestionDeps, type QuestionField } from './question.js';
import { chatLanguageOf, chatLanguages, visitorLanguage, wordsIn } from './settings.js';
import { STAFF_ONLY_EVENTS, SYSTEM_LINES, compareKeys, type ChatConversation, type ChatMessage, type ChatState, type ChatStore } from './store.js';
import { chatTokenKey, chatTokenRefusal, makeChatToken, readChatToken, type ChatClaim } from './token.js';

/** The longest "came from" kept: the conversations contract's width. */
export const CAME_FROM_MAX = 2048;
/** How often a poll writes the visitor's heartbeat: presence is read in minutes. */
export const HEARTBEAT_EVERY_MS = 60_000;
/** The most messages one poll hands back; the window asks again from the last. */
export const POLL_LIMIT = 200;
/** The longest name and e-mail kept (the conversations contract's widths). */
const NAME_MAX = 200;
const EMAIL_MAX = 320;

/** A body as a person typed it: NFC, no control characters but line breaks and tabs, trimmed; null when empty or longer than a message may be. */
export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Every control character goes, but a line break and a tab: a carriage return becomes a plain line break first.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const cleaned = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim();
  const length = [...cleaned].length;
  return length === 0 || length > CHAT_MESSAGE_MAX ? null : cleaned;
}

/**
 * "Came from": the page's origin, and its path only when the origin is one
 * of the business's listed websites (a path on someone else's site may carry
 * a reset token or an address, and is not the business's to keep); never its
 * query or fragment, cut to the column's width; null when it is no web page.
 */
export function cameFromOf(raw: unknown, listed: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!listed.includes(url.origin)) return url.origin.slice(0, CAME_FROM_MAX);
  return `${url.origin}${url.pathname}`.slice(0, CAME_FROM_MAX);
}

/** A name a visitor typed, as the name rule takes it; null when there is none, undefined when it is refused. */
function nameOf(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const name = raw.normalize('NFC').trim();
  if (name === '') return null;
  return name.length <= NAME_MAX && linkFreeText(name, NAME_RULE) ? name : undefined;
}

/** An address a visitor typed, as every door keeps one; null when there is none, undefined when it is no address. */
function emailOf(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  if (raw.trim() === '') return null;
  const address = normaliseAddress(raw);
  return address.length <= EMAIL_MAX && looksLikeAddress(address) ? address : undefined;
}

/** The key a chat's human check is bound to. */
export const chatProofKeyId = (addOn: string): string => `chat:${addOn}`;
/** The key a spent proof is kept under (`adminium_public_proofs.key_id` holds 36): the chat's key, hashed. */
const spentKeyOf = (addOn: string): string => `cht${createHash('sha256').update(chatProofKeyId(addOn)).digest('hex').slice(0, 33)}`;

/** A staff member as a visitor may read them: a first name and initials, never an id, an address or a surname. */
export interface ChatAuthor {
  firstName: string;
  initials: string;
}

/** A person's first name and initials from their full name. */
export function authorOf(name: string | null | undefined): ChatAuthor | null {
  const words = String(name ?? '').trim().split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0) return null;
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : '';
  const initial = (word: string) => [...word][0]?.toLocaleUpperCase() ?? '';
  return { firstName: first, initials: `${initial(first)}${initial(last)}` };
}

/** A message as the window is sent it. */
export interface WireMessage {
  id: string;
  kind: ChatMessage['kind'];
  body: string;
  /** ISO. */
  sentAt: string;
  /** A system line's word. A hand-over is always `handed-over`, with `by` saying whose it was. */
  event?: string;
  by?: 'visitor' | 'automatic';
  /** Who wrote a staff message, or whose act a system line says. */
  author?: ChatAuthor;
  /** The language an automatic answer's text is in. */
  language?: string;
}

/** The hours, as every answer that carries them says them. */
export interface WireHours {
  open: boolean;
  closesAt: string | null;
  nextOpen: HoursNow['nextOpen'];
}

/** A door answer: a status and a body. */
export interface DoorReply {
  status: number;
  body: Record<string, unknown>;
}

/** A token that does not read, names a conversation gone, or lapsed: the window's earlier chat is lost. */
const LOST: DoorReply = { status: 410, body: { state: 'lost' } };
/** A write on a closed conversation: it may be read until it lapses, never written. */
const CLOSED: DoorReply = { status: 409, body: { state: 'closed' } };

/** A tripped cap as the window is told it: which, and how long to wait. */
function tooMany(refused: Exclude<ChatCapRefusal, { cap: 'paused' }>): DoorReply {
  return { status: 429, body: { state: 'too-many', cap: refused.cap, retryAfter: refused.retryAfter } };
}

export interface ChatDoorDeps {
  meta: MetaDb;
  secret: string;
  catalog: ChatCatalog;
  store: ChatStore;
  caps: ChatCaps;
  /** Where a question left outside hours becomes a row. */
  questions: ChatQuestionDeps;
  /** The automatic answerer; every conversation goes to a person until it is wired. */
  answerer?: () => ChatAnswerer;
  /** Whether AI is usable now, and its service's name. */
  ai: () => Promise<ChatAi>;
  /** The business's listed websites ("Your websites"): a "came from" keeps its path only on one of them. None by default. */
  websites?: ListedWebsites;
  /** Whether the chat's day of automatic answers still has tokens left; the answerer's tally by default. */
  budgetLeft?: (chat: LiveChat, at: number) => Promise<boolean>;
  now?: () => number;
}

/** The zone a chat's hours are in: its own, else the business's database's, else UTC. */
export async function chatZoneOf(meta: MetaDb, chat: Pick<LiveChat, 'settings' | 'connectionId'>): Promise<string> {
  if (chat.settings.timeZone !== null) return knownZone(chat.settings.timeZone);
  return knownZone((await connectionTenantConfig(meta, chat.connectionId).catch(() => null))?.timezone ?? null);
}

export function createChatDoor(deps: ChatDoorDeps) {
  const { meta, store, caps } = deps;
  const now = deps.now ?? Date.now;
  const proofs = publicProofsRepo(meta);
  const proofSecret = proofKey(deps.secret);
  const tokenSecret = chatTokenKey(deps.secret);
  const addressSecret = chatAiAddressKey(deps.secret);
  const answerer = deps.answerer ?? (() => HAND_OVER_ANSWERER);
  /** "Came from" as kept, judged against the listed websites now. */
  const cameFrom = async (raw: unknown): Promise<string | null> => cameFromOf(raw, (await deps.websites?.().catch(() => [])) ?? []);
  /** Today's tokens not all spent, as the answerer's tally counts them (`chat_ai_days`, by UTC day). */
  const budgetLeft =
    deps.budgetLeft ??
    (async (chat: LiveChat, at: number): Promise<boolean> => {
      const day = await chatAiTallyRepo(meta).day({ installId: chat.installId, addOn: chat.addOn, day: chatAiDayOf(at) });
      return day === null || day.spent < chat.settings.dailyTokens;
    });
  /** The answerer's work still running, so a test (and a shutdown) can wait for it. */
  const running = new Set<Promise<void>>();
  const authors = new Map<string, { at: number; author: ChatAuthor | null }>();

  /** This server's own install (`system.instanceId`): what a token is bound to. */
  const thisInstall = async (): Promise<string> => String((await settingsRepo(meta).get('system.instanceId')) ?? '');

  /** "Not available", with who the business is, as every door says it. */
  const notAvailable = async (): Promise<DoorReply> => ({ status: 404, body: { state: 'unavailable', ...(await strangerBusiness(meta)) } });

  const zoneOf = (chat: LiveChat): Promise<string> => chatZoneOf(meta, chat);

  async function hoursOf(chat: LiveChat, at: number): Promise<HoursNow> {
    return hoursAt({ hours: chat.settings.hours, closedUntil: chat.settings.closedUntil, timeZone: await zoneOf(chat) }, at);
  }

  const wireHours = (hours: HoursNow): WireHours => ({ open: hours.open, closesAt: hours.closesAt, nextOpen: hours.nextOpen });

  /** The chat's default language: the workspace's own, as a chat names languages. */
  async function defaultLanguageOf(): Promise<FormLanguage> {
    return chatLanguageOf(await settingsRepo(meta).get('locale.default'));
  }

  /** Whether automatic answers run now: switched on, in hours, a day's tokens set, AI usable, and the day's not spent. */
  async function automaticNow(chat: LiveChat, hours: HoursNow, at: number): Promise<{ automatic: boolean; ai: ChatAi }> {
    const ai = await deps.ai();
    const on = chat.settings.automatic && hours.open && chat.settings.dailyTokens > 0 && ai.usable && (await budgetLeft(chat, at).catch(() => false));
    return { automatic: on, ai };
  }

  /** A staff member's first name and initials, kept a minute. */
  async function authorById(id: string, at: number): Promise<ChatAuthor | null> {
    const kept = authors.get(id);
    if (kept !== undefined && at - kept.at < 60_000) return kept.author;
    const user = await usersRepo(meta).findById(id).catch(() => null);
    const author = authorOf(user?.name ?? null);
    if (authors.size > 1000) authors.clear();
    authors.set(id, { at, author });
    return author;
  }

  /** Messages as the window is sent them: each staff author's first name, each automatic answer's language; the staff-only lines (`left`, `enquiry`) left out. */
  async function wire(chat: LiveChat, conversation: Pick<ChatConversation, 'language'>, messages: readonly ChatMessage[], at: number): Promise<WireMessage[]> {
    const refs = [...new Set(messages.flatMap((message) => (message.kind === 'automatic' && message.answerRef !== null ? [message.answerRef] : [])))];
    const answers: ChatAnswer[] = refs.length === 0 ? [] : await readAnswers(chat, refs).catch(() => []);
    const out: WireMessage[] = [];
    for (const message of messages) {
      if (message.kind === 'system' && message.event !== null && STAFF_ONLY_EVENTS.has(message.event)) continue;
      const one: WireMessage = { id: message.id, kind: message.kind, body: message.body, sentAt: new Date(message.sentAt).toISOString() };
      if (message.kind === 'system' && message.event !== null) {
        if (message.event === 'asked' || message.event === 'handed-over') {
          one.event = 'handed-over';
          one.by = message.event === 'asked' ? 'visitor' : 'automatic';
        } else {
          one.event = message.event;
        }
      }
      if ((message.kind === 'staff' || message.kind === 'system') && message.authorId !== null) {
        const author = await authorById(message.authorId, at);
        if (author !== null) one.author = author;
      }
      if (message.kind === 'automatic') {
        one.language = automaticLanguage(
          answers.find((answer) => answer.ref === message.answerRef),
          message.body,
          conversation.language,
        );
      }
      out.push(one);
    }
    return out;
  }

  /** A token for a conversation of this install, made now: held to its key AND its start. */
  async function tokenFor(chat: LiveChat, conversation: Pick<ChatConversation, 'id' | 'startedAt'>, at: number): Promise<string> {
    return makeChatToken(tokenSecret, await thisInstall(), { installId: chat.installId, addOn: chat.addOn, conversation: conversation.id, startedAt: conversation.startedAt, issuedAt: at });
  }
  /** The trap's token: names no conversation, so it opens nothing. */
  const NO_CONVERSATION = { id: '0', startedAt: 0 } as const;

  /** The keyed hash of a request's address, as the answerer counts it (under its own key, never the caps' value): never the address. */
  const addressHash = (ip: string): string => createHmac('sha256', addressSecret).update(rateAddress(ip)).digest('hex');

  /** A token read and held to its conversation; the conversation (written: never closed) or a refusal. */
  async function heldToken(chat: LiveChat, raw: unknown, write: boolean, at: number): Promise<{ claim: ChatClaim; conversation: ChatConversation } | DoorReply> {
    // A token of another install of this add-on is lost here: never read against this install's rows.
    const claim = readChatToken(tokenSecret, await thisInstall(), raw, chat);
    if (claim === null) return LOST;
    const conversation = await store.conversation(chat, claim.conversation);
    const refusal = chatTokenRefusal(claim, conversation, { now: at, write });
    if (refusal === 'closed') return CLOSED;
    if (refusal !== null || conversation === null) return LOST;
    return { claim, conversation };
  }

  /** A conversation became real (a second message, its details, a question): the breaker counts it, once. Never fails the write. */
  async function counted(chat: LiveChat, conversationId: string, at: number): Promise<void> {
    await caps.counted(chat.addOn, conversationId, at).catch(() => false);
  }

  const isReply = (value: unknown): value is DoorReply => typeof value === 'object' && value !== null && 'status' in value && 'body' in value;

  /**
   * The human check, bound to the chat, spent once, at the work the hour
   * asks now (`caps.difficulty`), less one step: a challenge asked just
   * before the step rose is still taken.
   */
  async function spendProof(chat: LiveChat, header: unknown, at: number): Promise<boolean> {
    const difficulty = Math.max(PROOF_DIFFICULTY, (await caps.difficulty(chat.addOn, at)) - 2);
    const proved = checkProof(proofSecret, header, { keyId: chatProofKeyId(chat.addOn), purpose: 'chat', now: at, difficulty });
    return proved.ok && (await proofs.spend({ id: proved.spendId, keyId: spentKeyOf(chat.addOn), purpose: 'chat', expiresAt: proved.expiresAt }, at));
  }

  /**
   * Asks the answerer about the visitor's last message, and writes what it
   * chose: an automatic answer, or the conversation handed to a person. Runs
   * after the visitor's message is answered; its result reaches the window
   * by the next poll. Anything that goes wrong hands over.
   */
  function answer(chat: LiveChat, conversation: ChatConversation, message: ChatMessage, ip: string): void {
    const work = (async () => {
      const at = now();
      const defaultLanguage = await defaultLanguageOf();
      let choice: Awaited<ReturnType<ChatAnswerer['pick']>>;
      let answers: ChatAnswer[] = [];
      try {
        answers = await readAnswers(chat);
        const recent = (await store.since(chat, conversation.id, '0', POLL_LIMIT)).filter((one) => one.kind === 'visitor').slice(-ANSWERER_MESSAGES);
        choice = await answerer().pick({
          installId: chat.installId,
          addOn: chat.addOn,
          conversationId: Number(conversation.id),
          messageId: Number(message.id),
          language: conversation.language,
          defaultLanguage,
          answers: answererAnswers(answers, defaultLanguage),
          visitorMessages: recent.map((one) => one.body),
          automaticCount: conversation.automaticCount,
          addressHash: addressHash(ip),
          dailyTokens: chat.settings.dailyTokens,
        });
      } catch {
        choice = { kind: 'hand-over', outcome: 'error' };
      }
      // A person may have taken it, or the visitor asked for one, while the answerer worked: only a conversation still with it moves.
      const still = await store.conversation(chat, conversation.id);
      if (still === null || still.state !== 'bot') return;
      if (choice.kind === 'answer') {
        const picked = answers.find((one) => one.ref === choice.ref);
        const text = picked === undefined ? null : answerText(picked, conversation.language, defaultLanguage);
        if (text !== null) {
          // Counted in one conditional statement: messages answered at the same moment never pass the conversation's six together.
          const added = await store.addAutomatic(chat, conversation.id, { body: text.text, answerRef: choice.ref }, CHAT_PER_CONVERSATION, { at: now() });
          if (added !== 'cap') return;
          // It had its six already: handed to a person, as the answerer's own cap does.
          await store
            .logChoice(chat, { conversationId: conversation.id, messageId: message.id, answerRef: null, outcome: 'cap', model: null, tokensIn: 0, tokensOut: 0, at: now() })
            .catch(() => undefined);
          // Another answer at the same moment may have handed it over already: once is enough.
          if ((await store.conversation(chat, conversation.id))?.state !== 'bot') return;
        }
      }
      await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['handed-over']!, event: 'handed-over' }, { state: 'waiting' }, { at: Math.max(now(), at) });
    })().catch(() => undefined);
    running.add(work);
    void work.finally(() => running.delete(work));
  }

  return {
    /** The answerer's work still running: a test waits for it before it reads. */
    settled: async (): Promise<void> => {
      while (running.size > 0) await Promise.all([...running]);
    },

    /** The work a chat's human check asks now: more as the hour's starts pass half its limit. */
    difficulty: (chat: LiveChat): Promise<number> => caps.difficulty(chat.addOn, now()),

    /** What the window draws (`preview`: a signed-in person's preview, which writes nothing). */
    async config(chat: LiveChat, asked: { language?: unknown; frame?: boolean; websites?: () => Promise<readonly string[]>; preview?: boolean }): Promise<DoorReply> {
      const at = now();
      // The breaker: a new visitor finds the chat not available while it is paused; a visitor already chatting goes on.
      if (asked.preview !== true && (await caps.pausedUntil(chat.addOn, at)) !== null) return notAvailable();
      const shared = await strangerBusiness(meta);
      const hours = await hoursOf(chat, at);
      const { automatic, ai } = await automaticNow(chat, hours, at);
      const defaultLanguage = await defaultLanguageOf();
      const languages = chatLanguages(chat.settings, defaultLanguage);
      const language = visitorLanguage(asked.language, languages, defaultLanguage);
      return {
        status: 200,
        body: {
          state: 'live',
          ...shared,
          language,
          languages,
          defaultLanguage,
          theme: chat.settings.theme,
          ...wireHours(hours),
          timeZone: await zoneOf(chat),
          welcome: wordsIn(chat.settings.welcome, language, defaultLanguage),
          outsideWords: wordsIn(chat.settings.outsideWords, language, defaultLanguage),
          automatic,
          miloDrafts: chat.settings.miloDrafts,
          // The service a visitor's words would go to, named only while something sends them there.
          aiService: (automatic || chat.settings.miloDrafts) && ai.usable ? ai.service : null,
          mail: (await formsMailBlocked(meta, deps.secret)) === null,
          // Only a frame asks which websites it may answer: the loader's first message must come from one.
          ...(asked.frame === true && asked.websites !== undefined ? { frameOrigins: [...(await asked.websites())] } : {}),
          ...(asked.preview === true ? { preview: true } : {}),
        },
      };
    },

    /** "Not available", with who the business is, as every door says it. */
    unavailable: notAvailable,

    /** A new conversation, with the visitor's first message (see the header). */
    async start(request: FastifyRequest, chat: LiveChat, sent: { language?: unknown; cameFrom?: unknown; body?: unknown; website?: unknown } | null): Promise<DoorReply> {
      const at = now();
      if (!(await spendProof(chat, request.headers['x-adminium-proof'], at))) return { status: 403, body: { state: 'proof' } };
      if (sent === null) return { status: 400, body: { state: 'refused', errors: { '*': 'shape' } } };
      const defaultLanguage = await defaultLanguageOf();
      const language = visitorLanguage(sent.language, chatLanguages(chat.settings, defaultLanguage), defaultLanguage);
      const hours = await hoursOf(chat, at);
      // The trap: answered as a start is, and nothing written or counted; its token opens nothing.
      if (typeof sent.website === 'string' && sent.website.trim() !== '') {
        return { status: 200, body: { state: 'started', token: await tokenFor(chat, NO_CONVERSATION, at), conversation: { state: 'waiting', language }, messages: [], cursor: '0', ...wireHours(hours) } };
      }
      const body = cleanBody(sent.body);
      if (body === null) return { status: 400, body: { state: 'refused', errors: { body: 'length' } } };
      const charged = await caps.chargeStart(chat.addOn, request.ip, at);
      if (!charged.ok) return charged.cap === 'paused' ? notAvailable() : tooMany(charged);
      const { automatic } = await automaticNow(chat, hours, at);
      const state: ChatState = automatic ? 'bot' : 'waiting';
      let started: Awaited<ReturnType<ChatStore['start']>>;
      try {
        started = await store.start(chat, { state, language, cameFrom: await cameFrom(sent.cameFrom), outsideHours: !hours.open, first: { kind: 'visitor', body } }, { at });
      } catch (error) {
        await charged.release().catch(() => undefined);
        throw error;
      }
      const first = started.messages[0]!;
      if (state === 'bot') answer(chat, started.conversation, first, request.ip);
      return {
        status: 200,
        body: {
          state: 'started',
          token: await tokenFor(chat, started.conversation, at),
          conversation: { state: started.conversation.state, language },
          messages: await wire(chat, started.conversation, started.messages, at),
          cursor: first.id,
          ...wireHours(hours),
        },
      };
    },

    /** A visitor's message, or "Talk to a person" (`talk`). */
    async post(request: FastifyRequest, chat: LiveChat, sent: { token?: unknown; body?: unknown; talk?: unknown } | null): Promise<DoorReply> {
      const at = now();
      const held = await heldToken(chat, sent?.token ?? request.headers['x-adminium-chat'], true, at);
      if (isReply(held)) return held;
      const { conversation } = held;
      if (sent?.talk === true) {
        // Asked for a person: only a conversation still with the answerer moves; else it is a person's already.
        if (conversation.state !== 'bot') return { status: 200, body: { state: 'sent', conversation: { state: conversation.state }, token: await tokenFor(chat, conversation, at) } };
        const added = await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['asked']!, event: 'asked' }, { state: 'waiting', lastVisitorAt: at }, { at });
        if (added === null) return LOST;
        return { status: 200, body: { state: 'sent', message: (await wire(chat, added.conversation, [added.message], at))[0], conversation: { state: added.conversation.state }, token: await tokenFor(chat, conversation, at) } };
      }
      const body = cleanBody(sent?.body);
      if (body === null) return { status: 400, body: { state: 'refused', errors: { body: 'length' } } };
      const sentBefore = await store.visitorCount(chat, conversation.id);
      const charged = await caps.chargeMessage(chat.addOn, conversation.id, sentBefore, at);
      if (!charged.ok) return charged.cap === 'paused' ? notAvailable() : tooMany(charged);
      const added = await store.add(chat, conversation.id, { kind: 'visitor', body }, { lastVisitorAt: at }, { at });
      if (added === null) {
        await charged.release().catch(() => undefined);
        return LOST;
      }
      // A second message: a real conversation, as the breaker counts them (a bare start never is).
      if (sentBefore >= 1) await counted(chat, conversation.id, at);
      if (added.conversation.state === 'bot') answer(chat, added.conversation, added.message, request.ip);
      return { status: 200, body: { state: 'sent', message: (await wire(chat, added.conversation, [added.message], at))[0], conversation: { state: added.conversation.state }, token: await tokenFor(chat, conversation, at) } };
    },

    /**
     * The messages after `after`, the state, whether a person is answering,
     * and the hours. A poll with nothing new answers from memory; every poll
     * of an open conversation is the visitor's heartbeat (written once a
     * minute at most).
     */
    async poll(chat: LiveChat, token: unknown, after: unknown): Promise<DoorReply> {
      const at = now();
      const cursor = typeof after === 'string' && /^\d{1,20}$/.test(after) ? after : '0';
      const claim = readChatToken(tokenSecret, await thisInstall(), token, chat);
      if (claim === null) return LOST;
      const latest = await store.latest(chat, claim.conversation);
      // A closed conversation is still read (the window shows who closed it), until it lapses.
      if (latest === null || chatTokenRefusal(claim, latest, { now: at, write: false }) !== null) return LOST;
      if (latest.state !== 'closed') await store.heartbeat(chat, claim.conversation, at, HEARTBEAT_EVERY_MS).catch(() => undefined);
      const hours = wireHours(await hoursOf(chat, at));
      const staff = latest.state === 'open' && latest.takenBy !== null;
      if (compareKeys(latest.lastId, cursor) <= 0) return { status: 200, body: { state: latest.state, staff, messages: [], cursor, ...hours } };
      const messages = await store.since(chat, claim.conversation, cursor, POLL_LIMIT);
      const conversation = await store.conversation(chat, claim.conversation);
      if (conversation === null) return LOST;
      const last = messages[messages.length - 1]?.id ?? cursor;
      return {
        status: 200,
        body: { state: conversation.state, staff: conversation.state === 'open' && conversation.takenBy !== null, messages: await wire(chat, conversation, messages, at), cursor: last, ...hours },
      };
    },

    /** The name, the e-mail and the language the visitor gives (each optional; one given empty is cleared). */
    async details(chat: LiveChat, sent: { token?: unknown; name?: unknown; email?: unknown; language?: unknown } | null, header: unknown): Promise<DoorReply> {
      const at = now();
      const held = await heldToken(chat, sent?.token ?? header, true, at);
      if (isReply(held)) return held;
      const errors: Partial<Record<'name' | 'email' | 'language', string>> = {};
      const name = sent?.name === undefined ? undefined : nameOf(sent.name);
      const email = sent?.email === undefined ? undefined : emailOf(sent.email);
      if (sent?.name !== undefined && name === undefined) errors.name = 'text';
      if (sent?.email !== undefined && email === undefined) errors.email = 'email';
      let language: string | undefined;
      if (sent?.language !== undefined) {
        const defaultLanguage = await defaultLanguageOf();
        const languages = chatLanguages(chat.settings, defaultLanguage);
        language = typeof sent.language === 'string' ? languages.find((one) => one.toLowerCase() === sent.language!.toString().toLowerCase()) : undefined;
        if (language === undefined) errors.language = 'language';
      }
      if (Object.keys(errors).length > 0) return { status: 400, body: { state: 'refused', errors } };
      const was = held.conversation;
      const patch = {
        ...(name === undefined || name === was.name ? {} : { name }),
        ...(email === undefined || email === was.email ? {} : { email }),
        ...(language === undefined || language === was.language ? {} : { language }),
      };
      // Nothing new: nothing written, nothing published, nothing counted.
      if (Object.keys(patch).length === 0) return { status: 200, body: { state: 'saved', conversation: { state: was.state, language: was.language }, token: await tokenFor(chat, was, at) } };
      const charged = await caps.chargeDetails(chat.addOn, was.id, at);
      if (!charged.ok) return charged.cap === 'paused' ? notAvailable() : tooMany(charged);
      const changed = await store.update(chat, was.id, { ...patch, lastVisitorAt: at });
      if (changed === null) {
        await charged.release().catch(() => undefined);
        return LOST;
      }
      // Details given: a real conversation, as the breaker counts them.
      await counted(chat, changed.id, at);
      return { status: 200, body: { state: 'saved', conversation: { state: changed.state, language: changed.language }, token: await tokenFor(chat, changed, at) } };
    },

    /**
     * A question left outside hours: one proof, the trap, the caps, then a
     * waiting conversation marked outside hours and, when an app opens a
     * table to it, the row it becomes, together (`question.ts`). No mail is
     * ever sent to the address typed.
     */
    async question(request: FastifyRequest, chat: LiveChat, sent: { question?: unknown; name?: unknown; email?: unknown; language?: unknown; cameFrom?: unknown; website?: unknown } | null): Promise<DoorReply> {
      const at = now();
      if (!(await spendProof(chat, request.headers['x-adminium-proof'], at))) return { status: 403, body: { state: 'proof' } };
      if (sent === null) return { status: 400, body: { state: 'refused', errors: { '*': 'shape' } } };
      const hours = await hoursOf(chat, at);
      if (hours.open) return { status: 409, body: { state: 'in-hours', ...wireHours(hours) } };
      const defaultLanguage = await defaultLanguageOf();
      const language = visitorLanguage(sent.language, chatLanguages(chat.settings, defaultLanguage), defaultLanguage);
      // The trap: answered as a question is, and nothing written or counted.
      if (typeof sent.website === 'string' && sent.website.trim() !== '') return { status: 200, body: { state: 'sent', token: await tokenFor(chat, NO_CONVERSATION, at) } };
      const errors: Partial<Record<QuestionField, string>> = {};
      const question = cleanBody(sent.question);
      const name = nameOf(sent.name);
      const email = emailOf(sent.email);
      if (question === null) errors.question = 'length';
      if (name === undefined) errors.name = 'text';
      if (email === undefined || email === null) errors.email = 'email';
      if (Object.keys(errors).length > 0) return { status: 400, body: { state: 'refused', errors } };
      const charged = await caps.chargeStart(chat.addOn, request.ip, at);
      if (!charged.ok) return charged.cap === 'paused' ? notAvailable() : tooMany(charged);
      const conversation = { state: 'waiting' as const, language, cameFrom: await cameFrom(sent.cameFrom), outsideHours: true, name: name ?? null, email: email!, first: { kind: 'visitor' as const, body: question! } };
      let started: Awaited<ReturnType<ChatStore['start']>> | null = null;
      try {
        const became = await becomeRow(
          deps.questions,
          request,
          chat,
          { question: question!, name: name ?? null, email: email!, language },
          async (db, row) => {
            started = await store.start(chat, conversation, { at, on: db });
            await store.link(chat, started.conversation.id, row, { on: db });
          },
          at,
        );
        if (became.state === 'refused') {
          await charged.release().catch(() => undefined);
          return { status: 400, body: { state: 'refused', errors: became.errors } };
        }
        if (became.state === 'limit') {
          await charged.release().catch(() => undefined);
          return { status: 429, body: { state: 'too-many', cap: 'new-conversations', retryAfter: Math.ceil(HOUR_MS / 1000) } };
        }
        if (became.state === 'made' && started !== null) {
          const made = started as Awaited<ReturnType<ChatStore['start']>>;
          store.announceStart(chat, made.conversation, made.messages);
        } else {
          // No table opened to the chat (or it cannot take one now): the conversation alone.
          started = await store.start(chat, conversation, { at });
        }
      } catch (error) {
        await charged.release().catch(() => undefined);
        throw error;
      }
      const done = started as Awaited<ReturnType<ChatStore['start']>>;
      // A question carries an address: a real conversation, as the breaker counts them.
      await counted(chat, done.conversation.id, at);
      return { status: 200, body: { state: 'sent', token: await tokenFor(chat, done.conversation, at) } };
    },

    /** The visitor ends the chat. */
    async close(chat: LiveChat, sent: { token?: unknown } | null, header: unknown): Promise<DoorReply> {
      const at = now();
      const held = await heldToken(chat, sent?.token ?? header, true, at);
      if (isReply(held)) return held;
      const added = await store.add(chat, held.conversation.id, { kind: 'system', body: SYSTEM_LINES['closed']!, event: 'closed' }, { state: 'closed', closedAt: at, lastVisitorAt: at }, { at });
      if (added === null) return LOST;
      return { status: 200, body: { state: 'closed', conversation: { state: added.conversation.state } } };
    },
  };
}

export type ChatDoor = ReturnType<typeof createChatDoor>;
