// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONVERSATION TOKEN — what a visitor's window holds once its one human
 * check started a conversation, and sends with every message and poll after.
 *
 * Signed and self-contained, in the shape of the sign-up confirm token
 * (`forms/confirm-token.ts`): `base64url(JSON payload) ~ HMAC`, nothing
 * stored per token. The payload names:
 *   - `i`: this install (`system.instanceId`): another install's token reads as nothing;
 *   - `a`: the chat add-on, `c`: the conversation's key (as text);
 *   - `t`: when it was made (epoch ms).
 *
 * Signed with a key of its own, derived from `ADMINIUM_SECRET` under its own
 * salt: a token changed by one byte, made by another install or under
 * another secret reads as nothing.
 *
 * What the token alone cannot say is read from the conversation it names
 * ({@link chatTokenRefusal}): it lapses 24 hours after the conversation's last
 * message, and once the conversation is closed it may still READ (the window
 * shows "closed", until the lapse) but never WRITE. Staff reopening it lets
 * the same token write again. Every answer of the door may hand back a fresh
 * one; an older one keeps working until the lapse.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

/** How long a conversation's token works after its last message. */
export const CHAT_TOKEN_LAPSE_MS = 24 * 60 * 60_000;
/** A token made further in the future than this is not one this server made. */
const SKEW_MS = 5 * 60_000;

const SIGN_SALT = 'adminium:chat-conversation:sign:v1';
/** The longest token read. */
const TOKEN_MAX = 1024;
const TOKEN = /^([A-Za-z0-9_-]{16,900})~([A-Za-z0-9_-]{43})$/;

/** What a conversation token says. */
export interface ChatClaim {
  addOn: string;
  /** The conversation's key, as text. */
  conversation: string;
  /** When it was made, epoch ms. */
  issuedAt: number;
}

interface Payload {
  v: 1;
  i: string;
  a: string;
  c: string;
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
  const payload: Payload = { v: 1, i: install, a: claim.addOn, c: claim.conversation, t: claim.issuedAt };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(key, text)}`;
}

/**
 * What a token says, or null when this install did not make it with `key`
 * (another install, another secret, a byte changed, not a token at all).
 */
export function readChatToken(key: Buffer, install: string, token: unknown): ChatClaim | null {
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
  if (payload.v !== 1 || payload.i !== install) return null;
  if (typeof payload.a !== 'string' || payload.a === '' || typeof payload.c !== 'string' || !/^\d{1,20}$/.test(payload.c)) return null;
  if (typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
  return { addOn: payload.a, conversation: payload.c, issuedAt: payload.t };
}

/** Why a token that reads may not be used now; null when it may. */
export type ChatTokenRefusal = 'gone' | 'lapsed' | 'closed';

/** What a token's conversation says about it: when its last message was, and whether it is closed. */
export interface TokenConversation {
  lastMessageAt: number;
  state: string;
}

/**
 * Whether a token that reads may be used on its conversation now: not when
 * the conversation is gone (erased), not 24 hours after its last message,
 * and, to write, not while it is closed.
 */
export function chatTokenRefusal(claim: ChatClaim, conversation: TokenConversation | null, opts: { now: number; write: boolean }): ChatTokenRefusal | null {
  if (conversation === null) return 'gone';
  if (claim.issuedAt > opts.now + SKEW_MS) return 'gone';
  if (opts.now - conversation.lastMessageAt > CHAT_TOKEN_LAPSE_MS) return 'lapsed';
  if (opts.write && conversation.state === 'closed') return 'closed';
  return null;
}
