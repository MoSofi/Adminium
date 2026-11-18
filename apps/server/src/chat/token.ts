// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONVERSATION TOKEN — what a visitor's window holds once its one human
 * check started a conversation, and sends with every message and poll after.
 *
 * Signed and self-contained, in the shape of the sign-up confirm token
 * (`forms/confirm-token.ts`): `base64url(JSON payload) ~ HMAC`, nothing
 * stored per token. The payload names ONE conversation of ONE chat install:
 *   - `i`: this server (`system.instanceId`): another server's token reads as nothing;
 *   - `n`: the chat add-on's install (`adminium_manifests.id`): a token is
 *     never served by another install of the same add-on;
 *   - `a`: the chat add-on, `c`: the conversation's key (as text);
 *   - `s`: when the conversation started (epoch ms, as its row holds it): a
 *     key number handed out again after the conversation was removed (a
 *     SQLite rowid, a MySQL counter after a restart) names another
 *     conversation, which the token does not open;
 *   - `t`: when it was made (epoch ms).
 *
 * Signed with a key of its own, derived from `ADMINIUM_SECRET` under its own
 * salt: a token changed by one byte, made by another install or under
 * another secret reads as nothing.
 *
 * What the token alone cannot say is read from the conversation it names
 * ({@link chatTokenRefusal}): it lapses 24 hours after the VISITOR's own
 * last write or poll (`last_visitor_at`, or the token's own making), never
 * counted from a staff or system line, so a staff reopen months later does
 * not bring it back. Once the conversation is closed it may still READ (the
 * window shows "closed", until the lapse) but never WRITE; a reopen within
 * the lapse lets the same token write again. Every answer of the door may
 * hand back a fresh one; an older one keeps working until the lapse.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

/** How long a conversation's token works after the visitor's own last write or poll. */
export const CHAT_TOKEN_LAPSE_MS = 24 * 60 * 60_000;
/** A token made further in the future than this is not one this server made. */
const SKEW_MS = 5 * 60_000;

const SIGN_SALT = 'adminium:chat-conversation:sign:v1';
/** The longest token read. */
const TOKEN_MAX = 1024;
const TOKEN = /^([A-Za-z0-9_-]{16,900})~([A-Za-z0-9_-]{43})$/;

/** What a conversation token says. */
export interface ChatClaim {
  /** The chat add-on's install (`adminium_manifests.id`). */
  installId: string;
  addOn: string;
  /** The conversation's key, as text. */
  conversation: string;
  /** When the conversation started, epoch ms. */
  startedAt: number;
  /** When it was made, epoch ms. */
  issuedAt: number;
}

interface Payload {
  v: 2;
  i: string;
  n: string;
  a: string;
  c: string;
  s: number;
  t: number;
}

/** The key conversation tokens are signed under. */
export function chatTokenKey(secret: string): Buffer {
  return deriveKey(secret, SIGN_SALT, 'sign');
}

function sign(key: Buffer, text: string): string {
  return createHmac('sha256', key).update(text).digest('base64url');
}

/** A token for one conversation. */
export function makeChatToken(key: Buffer, install: string, claim: ChatClaim): string {
  const payload: Payload = { v: 2, i: install, n: claim.installId, a: claim.addOn, c: claim.conversation, s: claim.startedAt, t: claim.issuedAt };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(key, text)}`;
}

/**
 * What a token says, or null when this install did not make it with `key`
 * (another install, another secret, a byte changed, not a token at all), or,
 * given `chat`, when it was made for another chat add-on or another install
 * of it.
 */
export function readChatToken(key: Buffer, install: string, token: unknown, chat?: { addOn: string; installId: string }): ChatClaim | null {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
  const match = TOKEN.exec(token);
  if (match === null) return null;
  const [, text = '', signature = ''] = match;
  // Compared as written, not as decoded: base64url's last character carries spare bits, and a token changed there must not read.
  const want = Buffer.from(sign(key, text), 'utf8');
  const got = Buffer.from(signature, 'utf8');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return null;
  }
  if (payload.v !== 2 || payload.i !== install) return null;
  if (typeof payload.a !== 'string' || payload.a === '' || typeof payload.n !== 'string' || payload.n === '' || typeof payload.c !== 'string' || !/^\d{1,20}$/.test(payload.c)) return null;
  if (typeof payload.t !== 'number' || !Number.isFinite(payload.t) || typeof payload.s !== 'number' || !Number.isFinite(payload.s)) return null;
  // Never served by another chat, nor by another install of the same add-on (one installed again elsewhere, one read when this one cannot be).
  if (chat !== undefined && (payload.a !== chat.addOn || payload.n !== chat.installId)) return null;
  return { installId: payload.n, addOn: payload.a, conversation: payload.c, startedAt: payload.s, issuedAt: payload.t };
}

/** Why a token that reads may not be used now; null when it may. */
export type ChatTokenRefusal = 'gone' | 'lapsed' | 'closed';

/** What a token's conversation says about it: when it started, when the visitor last wrote or polled, and whether it is closed. */
export interface TokenConversation {
  startedAt: number;
  lastVisitorAt: number | null;
  state: string;
}

/**
 * Whether a token that reads may be used on its conversation now: not when
 * the conversation is gone (erased) or is another one under the same key
 * (its start differs), not 24 hours after the visitor's own last write or
 * poll (or the token's making, whichever is later), and, to write, not
 * while it is closed.
 */
export function chatTokenRefusal(claim: ChatClaim, conversation: TokenConversation | null, opts: { now: number; write: boolean }): ChatTokenRefusal | null {
  if (conversation === null) return 'gone';
  if (claim.issuedAt > opts.now + SKEW_MS) return 'gone';
  if (conversation.startedAt !== claim.startedAt) return 'gone';
  if (opts.now - Math.max(conversation.lastVisitorAt ?? 0, claim.issuedAt) > CHAT_TOKEN_LAPSE_MS) return 'lapsed';
  if (opts.write && conversation.state === 'closed') return 'closed';
  return null;
}
