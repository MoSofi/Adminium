// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT DOOR — a live chat's window on the owner's website, served like
 * the forms door: always registered, on every host a customer one included,
 * and gated per request by whether the outside can reach this server.
 *
 *   GET  /x/chat/:addOn                       the window's page (the `x` bundle); `?frame=1` for a website's frame;
 *                                             `?preview=1` for staff who may read the chat's conversations
 *   GET  /x/chat/api/:addOn/config            what the window draws (`?lang=`, `?frame=1`, `?preview=1`)
 *   POST /x/chat/api/:addOn/challenge         the human check, bound to the chat
 *   POST /x/chat/api/:addOn/start             a new conversation: the solved check in `x-adminium-proof`
 *   POST /x/chat/api/:addOn/messages          a message, or "Talk to a person" (`talk: true`)
 *   GET  /x/chat/api/:addOn/messages?after=   the messages after a key; the token in `x-adminium-chat`
 *   POST /x/chat/api/:addOn/details           the visitor's name, e-mail and language
 *   POST /x/chat/api/:addOn/question          a question left outside hours: the solved check in `x-adminium-proof`
 *   POST /x/chat/api/:addOn/close             the visitor ends the chat
 *
 * A POST carries the conversation's token as `token` in its body (or in
 * `x-adminium-chat`). What each does is `chat/door.ts`'s.
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Every request asks first whether the outside can reach this server, with
 *   the forms door's rule (`forms/reach.ts`, `proxy-hidden` included): while
 *   it fails, every page is "not available", every API call the same 404,
 *   and nothing is written.
 * - A chat that is not there, not switched on, not vouched for or without a
 *   privacy notice answers exactly as an add-on that does not exist
 *   (`chat/catalog.ts`). While the chat's breaker holds, a new visitor finds it
 *   "not available"; a visitor already chatting goes on (`chat/caps.ts`).
 * - Every route is public (`security/route-audience.ts`), hidden with every
 *   other public door while the operator holds them back.
 * - Every answer carries the `/x/` doors' headers (`../x-door/headers.ts`):
 *   the window's page drawn for a frame may be framed by the websites the
 *   owner listed, a preview by this host alone, everything else by nobody.
 * - Polls and writes have buckets of their own (`chat-poll`, `chat-write`),
 *   never the forms door's.
 *
 * ─── THE PREVIEW ───────────────────────────────────────────────────────────
 * `?preview=1` on the page and on its config draws the chat as it is set now,
 * for "Try the chat": only for a signed-in person (the dashboard's own
 * session, on this host) who may read the chat's conversations. It is not
 * held to whether the outside can reach the server, it may be framed by this
 * host alone, and nothing is written from it: every other route refuses a
 * request that says it is a preview, before anything is read.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import type { ChatCatalog, LiveChat } from '../../chat/catalog.js';
import { chatProofKeyId, type ChatDoor, type DoorReply } from '../../chat/door.js';
import { formsReach } from '../../forms/reach.js';
import type { ListedWebsites } from '../../forms/websites.js';
import { issueChallenge, proofKey } from '../../public-api/proof.js';
import { tagRoutes } from '../../security/route-audience.js';
import { framedPageOf, xDoorHeaders } from '../x-door/headers.js';
import { xPages, type XPageWords } from '../x-door/page.js';

export interface ChatDoorDeps {
  meta: MetaDb;
  catalog: ChatCatalog;
  door: ChatDoor;
  /** `ADMINIUM_SECRET`: what a chat's human check is signed under. */
  secret: string;
  /** The websites that may frame a chat ("Your websites"). */
  websites: ListedWebsites;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: () => number;
}

/** The pages of this door a listed website may frame, with `?frame=1`: a chat's window. */
export const CHAT_FRAMED_PAGES: readonly RegExp[] = [/^\/x\/chat\/[^/]+$/];

/** What a browser with no script reads on a chat's page, by its state. */
const CHAT_PAGE_WORDS: XPageWords = {
  live: { key: 'x:chat.noScript', fallback: 'This chat needs JavaScript.' },
  closed: { key: 'x:ending.unavailable', fallback: 'This page isn’t available.' },
  unavailable: { key: 'x:ending.unavailable', fallback: 'This page isn’t available.' },
};

/** The largest body a window sends: a 2,000-character message, its token, and room. */
const BODY_LIMIT = 32 * 1024;

const addOnParams = z.object({ addOn: z.string().min(1).max(80) });
const pageQuery = z.object({ frame: z.string().max(8).optional(), lang: z.string().max(20).optional(), preview: z.string().max(8).optional() }).passthrough();
const pollQuery = z.object({ after: z.string().max(24).optional(), preview: z.string().max(8).optional() }).passthrough();
const anyQuery = z.object({ preview: z.string().max(8).optional() }).passthrough();

/** A posted body read loosely: the door judges each field itself. */
const postedBody = z.record(z.string().max(64), z.unknown()).nullable().optional();

/** Whether a request says it is a preview. */
function asksPreview(request: FastifyRequest): boolean {
  return (request.query as { preview?: unknown } | undefined)?.preview !== undefined;
}

export function chatDoorRoutes(deps: ChatDoorDeps): FastifyPluginAsyncZod {
  const { meta, catalog, door } = deps;
  const now = deps.now ?? Date.now;
  const key = proofKey(deps.secret);

  async function reachable(request: FastifyRequest): Promise<boolean> {
    return (await formsReach(meta, deps, request)).state === 'reachable';
  }

  /** The chat a request names, as visitors may be served it now; never while the outside cannot reach the server. */
  async function chatFor(request: FastifyRequest, addOn: string): Promise<LiveChat | null> {
    if (!(await reachable(request))) return null;
    const found = await catalog.find(addOn);
    return found.state === 'live' ? found.chat : null;
  }

  /** The requests answered with a preview: framed by this host alone. */
  const previewing = new WeakSet<FastifyRequest>();

  /** A chat for its preview: only for a signed-in person who may read its conversations; null for everyone else. */
  async function previewOf(request: FastifyRequest, addOn: string): Promise<LiveChat | null> {
    if (request.user === null || request.user === undefined || request.session === null || request.session === undefined) return null;
    const chat = await catalog.forStaff(addOn);
    if (chat === null || !(await request.can(`table:${chat.connectionId}:${chat.conversations.table.id}:read`))) return null;
    previewing.add(request);
    return chat;
  }

  /** A door answer, sent: a tripped cap also says its wait in `Retry-After`. */
  function send(reply: FastifyReply, answer: DoorReply): FastifyReply {
    const wait = answer.body['retryAfter'];
    if (answer.status === 429 && typeof wait === 'number') void reply.header('retry-after', String(wait));
    return reply.status(answer.status).send(answer.body);
  }

  return async (app) => {
    // Doors anybody may open: hidden with the other public pages (`security/route-audience.ts`).
    tagRoutes(app, 'public');
    // Last word on the headers of everything this plugin answers (`../x-door/headers.ts`).
    xDoorHeaders(app, { framed: framedPageOf(CHAT_FRAMED_PAGES), websites: deps.websites, previewing: (request) => previewing.has(request) });
    const { page } = xPages(app, meta, CHAT_PAGE_WORDS);

    const unavailable = async (reply: FastifyReply) => send(reply, await door.unavailable());

    const polled = { rateLimitBucket: 'chat-poll' as const };
    const posted = {
      rateLimitBucket: 'chat-write' as const,
      csrf: 'origin' as const,
      audit: auditExempt('a visitor chatting: the conversation and its messages are the record; a visitor is not an actor the audit log names'),
    };

    app.get('/x/chat/:addOn', { config: polled, schema: { hide: true, params: addOnParams, querystring: pageQuery } }, async (request, reply) => {
      if (request.query.preview !== undefined) return page(request, reply, request.query.preview === '1' && (await previewOf(request, request.params.addOn)) !== null ? 'live' : 'unavailable');
      return page(request, reply, (await chatFor(request, request.params.addOn)) === null ? 'unavailable' : 'live');
    });

    app.get('/x/chat/api/:addOn/config', { config: polled, schema: { hide: true, params: addOnParams, querystring: pageQuery } }, async (request, reply) => {
      if (request.query.preview !== undefined) {
        const chat = request.query.preview === '1' ? await previewOf(request, request.params.addOn) : null;
        if (chat === null) return unavailable(reply);
        return send(reply, await door.config(chat, { language: request.query.lang, preview: true }));
      }
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.config(chat, { language: request.query.lang, frame: request.query.frame === '1', websites: deps.websites }));
    });

    app.post('/x/chat/api/:addOn/challenge', { bodyLimit: 1024, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery } }, async (request, reply) => {
      // A preview solves no check: nothing is sent from it.
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      // More work as the hour's starts pass half the chat's limit (`caps.difficulty`).
      return issueChallenge(key, chatProofKeyId(chat.addOn), 'chat', now(), await door.difficulty(chat));
    });

    app.post('/x/chat/api/:addOn/start', { bodyLimit: BODY_LIMIT, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery, body: postedBody } }, async (request, reply) => {
      // A preview's message is never taken: refused before the chat is even looked up, and nothing is written.
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.start(request, chat, request.body ?? null));
    });

    app.post('/x/chat/api/:addOn/messages', { bodyLimit: BODY_LIMIT, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery, body: postedBody } }, async (request, reply) => {
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.post(request, chat, request.body ?? null));
    });

    app.get('/x/chat/api/:addOn/messages', { config: polled, schema: { hide: true, params: addOnParams, querystring: pollQuery } }, async (request, reply) => {
      if (request.query.preview !== undefined) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.poll(chat, request.headers['x-adminium-chat'], request.query.after));
    });

    app.post('/x/chat/api/:addOn/details', { bodyLimit: BODY_LIMIT, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery, body: postedBody } }, async (request, reply) => {
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.details(chat, request.body ?? null, request.headers['x-adminium-chat']));
    });

    app.post('/x/chat/api/:addOn/question', { bodyLimit: BODY_LIMIT, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery, body: postedBody } }, async (request, reply) => {
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.question(request, chat, request.body ?? null));
    });

    app.post('/x/chat/api/:addOn/close', { bodyLimit: BODY_LIMIT, config: posted, schema: { hide: true, params: addOnParams, querystring: anyQuery, body: postedBody } }, async (request, reply) => {
      if (asksPreview(request)) return unavailable(reply);
      const chat = await chatFor(request, request.params.addOn);
      if (chat === null) return unavailable(reply);
      return send(reply, await door.close(chat, request.body ?? null, request.headers['x-adminium-chat']));
    });
  };
}
