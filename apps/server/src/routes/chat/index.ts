// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE CHAT, FOR STAFF: what a person answering chats does, under their
 * own grants on the chat add-on's tables.
 *
 *   GET  /chat/:addOn/conversations/:id/presence  on the page or left, and whether a reply would be mailed
 *   POST /chat/:addOn/conversations/:id/take      it is theirs now; `force` takes it from a colleague
 *   POST /chat/:addOn/conversations/:id/reply     a reply (1 to 2,000 characters), mailed when the visitor left
 *   POST /chat/:addOn/conversations/:id/close     closed, with their line
 *   POST /chat/:addOn/conversations/:id/reopen    open again, theirs, and the visitor may write again
 *   POST /chat/:addOn/conversations/:id/enquiry   "Make an enquiry": a row in the table an app opens to the chat
 *   POST /chat/:addOn/conversations/:id/draft     "Draft with Milo": a reply to read, never sent
 *   GET  /chat/:addOn/status                      what the settings page shows: reach, notice, address,
 *                                                 websites, mail, roles, languages, business name, time zone
 *   GET  /chat/:addOn/pause                       until when new chats are paused by the breaker
 *   POST /chat/:addOn/resume                      new chats open again before the pause is over
 *
 * Who may:
 *  - a presence read: who may read the chat's conversations
 *    (`table:<conn>:<conversations>:read`);
 *  - every act on a conversation: who may change them (`:update`). The
 *    engine alone writes the rows, through the chat store; the grant says
 *    who may ask it to. A role held to some rows of the conversations reaches
 *    only those (refused as not found);
 *  - an enquiry: also the person's own create on the table it goes into, and
 *    the row is made by the dashboard's own create route as them;
 *  - a draft: also `system:assistant:use`, while the chat's Milo drafting is on;
 *  - the status, the pause and resume: who may read, and who may change, the
 *    chat's settings. The status asks for nothing more: a settings manager
 *    with no Forms or privacy rights still sees the snippet and the cards.
 *
 * Only a signed-in person acts in a chat: a line says who wrote it. A chat
 * that is not installed is 404; `?install=` names the install when the
 * add-on is on more than one database.
 */
import { CHAT_MESSAGE_MAX } from '@adminium/manifest';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AddOnInstalls } from '../../apps/table-ref.js';
import { audited } from '../../audit/coverage.js';
import type { ChatAnswererDeps } from '../../chat/answerer.js';
import { readAnswers } from '../../chat/answering.js';
import type { ChatCaps } from '../../chat/caps.js';
import type { ChatCatalog, LiveChat } from '../../chat/catalog.js';
import { chatZoneOf, cleanBody } from '../../chat/door.js';
import { draftChatReply } from '../../chat/draft.js';
import { planEnquiry } from '../../chat/enquiry.js';
import { chatLanguageOf, chatLanguages } from '../../chat/settings.js';
import type { ChatActor, ChatStaff, ChatStaffRefusal } from '../../chat/staff.js';
import { boundKey, SYSTEM_LINES, type ChatConversation, type ChatStore } from '../../chat/store.js';
import { fetchVisible, rowLimitFor } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import type { FormsReachFacts } from '../../forms/reach.js';
import type { FormsScopes } from '../../forms/scope.js';
import { strangerBusiness } from '../../forms/view.js';
import { businessName } from '../../privacy/business.js';
import { getPrincipal } from '../../rbac/principal.js';
import { doorStatusData, readDoorStatus } from '../forms/index.js';

export interface ChatStaffRoutesDeps {
  meta: MetaDb;
  catalog: Pick<ChatCatalog, 'forStaff'>;
  store: ChatStore;
  staff: ChatStaff;
  caps: Pick<ChatCaps, 'pausedUntil' | 'resume'>;
  /** The tables apps open to a chat (the chat door's scopes): where an enquiry goes. */
  scopes: FormsScopes;
  installs: () => Promise<AddOnInstalls>;
  /** The AI service a draft is written on: the one the window's first line names. */
  ai: Pick<ChatAnswererDeps, 'connections' | 'offHere'>;
  /** The server's secret, which opens the stored mail settings: whether mail goes. */
  secret: string;
  /** The facts the reach answer reads (the doors' own); absent, the status read is not served. */
  reach?: FormsReachFacts | undefined;
  now?: () => number;
}

const params = z.object({ addOn: z.string().min(1).max(80) });
const conversationParams = z.object({ addOn: z.string().min(1).max(80), id: z.string().regex(/^\d{1,20}$/) });
const query = z.object({ install: z.string().min(1).max(64).optional() });

const person = z.object({ id: z.string(), name: z.string(), firstName: z.string(), initials: z.string() });
const MAIL_REASONS = ['no-public-origin', 'no-mail-server', 'cap', 'no-email', 'sample'] as const;

/** A conversation as an act answers it: its state and stamps, never what the visitor typed (the page reads the row). */
export const chatConversationView = z.object({
  id: z.string(),
  state: z.enum(['bot', 'waiting', 'open', 'closed']),
  outsideHours: z.boolean(),
  takenBy: person.nullable(),
  takenAt: z.string().nullable(),
  lastVisitorAt: z.string().nullable(),
  lastStaffAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  became: z.object({ table: z.string(), key: z.string() }).nullable(),
});

export const chatMessageView = z.object({
  id: z.string(),
  kind: z.enum(['visitor', 'staff', 'automatic', 'system']),
  body: z.string(),
  event: z.string().nullable(),
  authorId: z.string().nullable(),
  drafted: z.boolean(),
  sentAt: z.string(),
  mailedAt: z.string().nullable(),
});

export const chatConversationReply = z.object({ data: chatConversationView });

export const chatPresenceReply = z.object({
  data: z.object({
    presence: z.enum(['on-page', 'left']),
    lastVisitorAt: z.string().nullable(),
    outsideHours: z.boolean(),
    /** Whether a reply would also be mailed once the visitor is gone, and why not. */
    mail: z.object({ ready: z.boolean(), reason: z.enum(MAIL_REASONS).nullable(), used: z.number().int(), max: z.number().int() }),
    conversation: chatConversationView,
  }),
});

export const chatTakeBody = z.object({ force: z.boolean().optional() }).nullable().optional();

export const chatReplyBody = z.object({
  body: z.string().min(1).max(4 * CHAT_MESSAGE_MAX),
  /** The person sent a Milo draft (changed or not). */
  drafted: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const chatReplyReply = z.object({
  data: z.object({
    message: chatMessageView,
    conversation: chatConversationView,
    presence: z.enum(['on-page', 'left']),
    /** Mailed to the address the visitor left; else why not (null: the visitor is on the page, nothing to mail). */
    mailed: z.boolean(),
    reason: z.enum(MAIL_REASONS).nullable(),
  }),
});

export const chatEnquiryReply = z.object({
  data: z.object({
    /** The new row: its database, table id, stored name and key. */
    became: z.object({ connectionId: z.string(), tableId: z.string(), table: z.string(), key: z.string() }),
    conversation: chatConversationView,
  }),
});

export const chatDraftReply = z.object({ data: z.object({ draft: z.string(), tokens: z.number().int() }) });

export const chatStatusReply = z.object({
  data: doorStatusData.extend({
    /** The languages the window speaks: the server's default and each the owner wrote words in. */
    languages: z.array(z.string()),
    /** The server's default language (`locale.default`), as a chat names languages. */
    defaultLanguage: z.string(),
    /** The business's name, as the window shows it. */
    businessName: z.string(),
    /** The zone the chat's hours are in: its own, else its database's, else UTC. */
    timeZone: z.string(),
  }),
});

export const chatPauseReply = z.object({ data: z.object({ pausedUntil: z.string().nullable() }) });
export const chatResumeReply = z.object({ data: z.object({ resumed: z.boolean() }) });

const emptyBody = z.object({}).passthrough().nullable().optional();

/** A refusal as the answer says it: 409 with what is in the way. */
function conflict(why: ChatStaffRefusal): never {
  switch (why.refused) {
    case 'taken':
      throw new ConflictError(
        why.by === null || why.by.firstName === '' ? 'Someone else is answering this chat.' : `${why.by.firstName} is answering this chat.`,
        'CONFLICT',
        { reason: 'taken', by: why.by },
      );
    case 'closed':
      throw new ConflictError('This chat is closed. Reopen it first.', 'CONFLICT', { reason: 'closed' });
    case 'not-closed':
      throw new ConflictError('This chat is not closed.', 'CONFLICT', { reason: 'not-closed' });
    case 'automatic':
      throw new ConflictError('Automatic answers have this chat. Take it over first.', 'CONFLICT', { reason: 'automatic' });
  }
}

/** Headers an act passes on when it asks another route of this server as the same person. */
const FORWARDED = ['cookie', 'authorization', 'user-agent', 'accept-language'] as const;

export function chatStaffRoutes(deps: ChatStaffRoutesDeps): FastifyPluginAsyncZod {
  const { meta, store, staff } = deps;
  const now = deps.now ?? Date.now;
  /** "Make an enquiry" while its row is being made, by install and conversation: a second click waits for the first. */
  const enquiring = new Map<string, Promise<unknown>>();

  return async (app) => {
    /** The chat an add-on key names; 404 when none is installed. */
    async function chatOf(addOn: string, installId: string | undefined): Promise<LiveChat> {
      const chat = await deps.catalog.forStaff(addOn, installId);
      if (chat === null) throw new NotFoundError('No website chat of that add-on is installed.');
      return chat;
    }

    /** The signed-in person who acts; an API key never writes a line in a chat. */
    function actorOf(request: FastifyRequest): ChatActor {
      const principal = getPrincipal(request);
      if (principal === null || principal.kind !== 'user') throw new ForbiddenError('Only a signed-in person answers a chat.', 'FORBIDDEN', { reason: 'chat-person' });
      return { id: principal.id, name: principal.label };
    }

    /**
     * The conversation, for someone who may `action` the chat's
     * conversations, within the rows their role reaches. Not found otherwise
     * (a row they cannot reach is not said to be there).
     */
    async function conversationFor(request: FastifyRequest, chat: LiveChat, id: string, action: 'read' | 'update'): Promise<ChatConversation> {
      const table = chat.conversations.table;
      if (!(await request.can(`table:${chat.connectionId}:${table.id}:${action}`))) {
        throw new ForbiddenError(action === 'read' ? 'Only someone who may read the chat’s conversations reads this.' : 'Only someone who may answer the chat’s conversations does this.', 'TABLE_FORBIDDEN', {
          reason: action === 'read' ? 'chat-read' : 'chat-update',
        });
      }
      const rows = await rowLimitContextOf(meta, await app.rbac.resolve(request), chat.connectionId, chat.view.model);
      if (rows !== null && rowLimitFor(rows, table.id, action) !== null && (await fetchVisible(rows, chat.db as never, table, { [chat.conversations.pk]: boundKey(id) }, action)) === undefined) {
        throw new NotFoundError('No such conversation.');
      }
      const conversation = await store.conversation(chat, id);
      if (conversation === null) throw new NotFoundError('No such conversation.');
      return conversation;
    }

    async function audit(request: FastifyRequest, chat: LiveChat, action: string, conversationId: string | null, after: Record<string, unknown> = {}): Promise<void> {
      await app.rbac.audit(request, {
        category: 'data',
        action,
        connectionId: chat.connectionId,
        changes: { after: { addOn: chat.addOn, installId: chat.installId, ...(conversationId === null ? {} : { conversation: conversationId }), ...after } },
      });
    }

    const tags = ['chat'];
    const write = { audit: audited('rbac') };

    app.get(
      '/chat/:addOn/conversations/:id/presence',
      {
        preHandler: [app.requireAuth],
        schema: {
          tags,
          summary: 'Whether a website chat\'s visitor is on the page',
          description:
            'On the page (a heartbeat in the last 3 minutes) or left, the last heartbeat, and whether a reply would also be mailed once the visitor is gone, with the reason when not. A staff read: the conversation counts as opened, and a visitor gone 3 minutes gets their "left" line, dated at their last heartbeat.',
          params: conversationParams,
          querystring: query,
          response: { 200: chatPresenceReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const conversation = await conversationFor(request, chat, request.params.id, 'read');
        return { data: await staff.presence(chat, conversation) };
      },
    );

    app.post(
      '/chat/:addOn/conversations/:id/take',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Take a website chat',
          description: 'The chat is the signed-in person\'s to answer, with a line the visitor sees. Someone else answering it is a 409 naming them, unless `force`.',
          params: conversationParams,
          querystring: query,
          body: chatTakeBody,
          response: { 200: chatConversationReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        const conversation = await conversationFor(request, chat, request.params.id, 'update');
        const taken = await staff.take(chat, conversation, actor, request.body?.force === true);
        if (!taken.ok) conflict(taken);
        await audit(request, chat, 'chat.take', conversation.id, { forced: request.body?.force === true && conversation.takenBy !== null && conversation.takenBy !== actor.id });
        return { data: taken.value };
      },
    );

    app.post(
      '/chat/:addOn/conversations/:id/reply',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Reply in a website chat',
          description:
            'A staff reply (1 to 2,000 characters). A waiting chat is taken first. When the visitor left the page or the chat came outside hours, and they gave an e-mail address, the reply is also mailed: the business\'s name and the reply only. The answer says whether, and why not.',
          params: conversationParams,
          querystring: query,
          body: chatReplyBody,
          response: { 200: chatReplyReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        const body = cleanBody(request.body.body);
        if (body === null) throw new ValidationFailedError('A reply is 1 to 2,000 characters.', { fields: { body: 'length' } });
        const conversation = await conversationFor(request, chat, request.params.id, 'update');
        const replied = await staff.reply(chat, conversation, actor, { body, drafted: request.body.drafted === true, force: request.body.force === true });
        if (!replied.ok) conflict(replied);
        // Who replied, and whether it was mailed: never the words.
        await audit(request, chat, 'chat.reply', conversation.id, { message: replied.value.message.id, drafted: replied.value.message.drafted, mailed: replied.value.mailed, reason: replied.value.reason });
        return { data: replied.value };
      },
    );

    app.post(
      '/chat/:addOn/conversations/:id/close',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: { tags, summary: 'Close a website chat', description: 'Closed, with a line naming who closed it. The visitor reads it, and writes no more.', params: conversationParams, querystring: query, body: emptyBody, response: { 200: chatConversationReply } },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        const conversation = await conversationFor(request, chat, request.params.id, 'update');
        const closed = await staff.close(chat, conversation, actor);
        if (!closed.ok) conflict(closed);
        await audit(request, chat, 'chat.close', conversation.id);
        return { data: closed.value };
      },
    );

    app.post(
      '/chat/:addOn/conversations/:id/reopen',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Reopen a website chat',
          description: 'A closed chat open again, the reopener\'s to answer, with a line naming them. The visitor\'s window may write again.',
          params: conversationParams,
          querystring: query,
          body: emptyBody,
          response: { 200: chatConversationReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        const conversation = await conversationFor(request, chat, request.params.id, 'update');
        const opened = await staff.reopen(chat, conversation, actor);
        if (!opened.ok) conflict(opened);
        await audit(request, chat, 'chat.reopen', conversation.id);
        return { data: opened.value };
      },
    );

    app.post(
      '/chat/:addOn/conversations/:id/enquiry',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Make an enquiry from a website chat',
          description:
            'A new row in the table an app opens to the chat, made by the dashboard\'s own create as the signed-in person (their own create right and every rule of the table), filled with the chat\'s name, e-mail and first message and the entry\'s own defaults, never a consent. The chat is linked to it. 409 when no app opens a table to the chat, or the chat became a row already.',
          params: conversationParams,
          querystring: query,
          body: emptyBody,
          response: { 200: chatEnquiryReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        let conversation = await conversationFor(request, chat, request.params.id, 'update');
        // A second click while the first is still making its row waits for it, and is told of the first's row: one enquiry, never two.
        const making = `${chat.installId}\u0000${conversation.id}`;
        const earlier = enquiring.get(making);
        if (earlier !== undefined) {
          await earlier.catch(() => undefined);
          conversation = (await store.conversation(chat, conversation.id)) ?? conversation;
        }
        const already = (became: Pick<ChatConversation, 'becameTable' | 'becameKey'>): ConflictError =>
          new ConflictError('This chat became a row already.', 'CONFLICT', { reason: 'already', became: { table: became.becameTable, key: became.becameKey } });
        if (conversation.becameTable !== null && conversation.becameKey !== null) throw already(conversation);
        const work = makeEnquiry(request, chat, actor, conversation, already);
        enquiring.set(making, work);
        try {
          return await work;
        } finally {
          if (enquiring.get(making) === work) enquiring.delete(making);
        }
      },
    );

    /** "Make an enquiry"'s work, once the conversation is judged (see the route). */
    async function makeEnquiry(
      request: FastifyRequest,
      chat: LiveChat,
      actor: ChatActor,
      conversation: ChatConversation,
      already: (became: Pick<ChatConversation, 'becameTable' | 'becameKey'>) => ConflictError,
    ): Promise<{ data: z.infer<typeof chatEnquiryReply>['data'] }> {
      const first = (await store.since(chat, conversation.id, '0', 200)).find((message) => message.kind === 'visitor')?.body ?? null;
      const plan = await planEnquiry(deps.scopes, chat, conversation, first);
      if (!plan.ok) {
        throw new ConflictError(
          plan.missing === 'no-table' ? 'No app this chat is attached to takes an enquiry from a chat.' : 'The table an app opens to this chat has no column for the question.',
          'CONFLICT',
          { reason: plan.missing },
        );
      }
      const { opened } = plan;
      if (!(await request.can(`table:${opened.connectionId}:${opened.tableId}:create`))) {
        throw new ForbiddenError('Only someone who may add rows to that table makes an enquiry.', 'TABLE_FORBIDDEN', { reason: 'enquiry-create', table: opened.tableId });
      }
      const made = await createAsPerson(app, request, opened.connectionId, opened.tableId, plan.values);
      const view = chat.view.table(opened.tableId);
      const key = view.primaryKey.length === 1 ? String(made[view.primaryKey[0]!]) : JSON.stringify(view.primaryKey.map((column) => made[column] ?? null));
      const table = (await deps.installs()).refOf(opened.connectionId, opened.tableId);
      // The link decides: of two enquiries at once (another server process, say), the first linked wins; the other's row stays, unlinked, and it is told of the first.
      const link = await store.link(chat, conversation.id, { table, key });
      if (!link.linked) throw already(link.conversation ?? conversation);
      const added = await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['enquiry']!, event: 'enquiry', authorId: actor.id }, {}, { at: now() });
      await audit(request, chat, 'chat.enquiry', conversation.id, { table, key });
      return { data: { became: { connectionId: opened.connectionId, tableId: opened.tableId, table, key }, conversation: await staff.view(added?.conversation ?? conversation) } };
    }

    app.post(
      '/chat/:addOn/conversations/:id/draft',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Draft a reply in a website chat with Milo',
          description:
            'One call to the AI service the chat\'s first line names, on the person\'s own daily Milo allowance, with the conversation and the active answers only: no tools, no rows. It answers a draft to read and change; it never sends. While the chat\'s Milo drafting is on, for someone who may use Milo.',
          params: conversationParams,
          querystring: query,
          body: emptyBody,
          response: { 200: chatDraftReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        const actor = actorOf(request);
        if (!(await request.can('system:assistant:use'))) throw new ForbiddenError('Only someone who may use Milo drafts with it.', 'FORBIDDEN', { reason: 'assistant-use' });
        const conversation = await conversationFor(request, chat, request.params.id, 'update');
        const at = now();
        const defaultLanguage = chatLanguageOf(await settingsRepo(meta).get('locale.default'));
        const drafted = await draftChatReply({
          meta,
          ai: deps.ai,
          miloDrafts: chat.settings.miloDrafts,
          userId: actor.id,
          business: (await strangerBusiness(meta)).business.name,
          language: conversation.language,
          defaultLanguage,
          answers: await readAnswers(chat),
          messages: await store.since(chat, conversation.id, '0', 1000),
          at,
        });
        if (!drafted.ok) {
          if (drafted.refused === 'allowance') throw new AppError(429, 'RATE_LIMITED', 'Your Milo allowance for today is used.', { reason: 'allowance', resetsAt: new Date(drafted.resetsAt).toISOString() });
          if (drafted.refused === 'failed') throw new AppError(502, 'CHAT_DRAFT_FAILED', 'Milo could not write a draft. Try again.', { reason: 'failed' });
          throw new ConflictError(drafted.refused === 'off' ? 'Milo drafting is off for this chat.' : 'No AI service can be used here.', 'CONFLICT', { reason: drafted.refused });
        }
        await app.rbac.audit(request, { category: 'llm', action: 'chat.ai.draft', connectionId: chat.connectionId, changes: { after: { addOn: chat.addOn, installId: chat.installId, conversation: conversation.id, tokens: drafted.tokens } } });
        return { data: { draft: drafted.draft, tokens: drafted.tokens } };
      },
    );

    const reach = deps.reach;
    if (reach !== undefined) {
      app.get(
        '/chat/:addOn/status',
        {
          preHandler: [app.requireAuth],
          schema: {
            tags,
            summary: 'What a website chat\'s settings page shows',
            description:
              'Whether strangers can reach the chat, whether the privacy notice is set, the public address, the listed websites, whether mail goes (and why not), the roles a chat may tell, the chat\'s languages and the default one, the business\'s name and the time zone of the hours. For someone who may read the chat\'s settings.',
            params,
            querystring: query,
            response: { 200: chatStatusReply },
          },
        },
        async (request) => {
          const chat = await chatOf(request.params.addOn, request.query.install);
          if (!(await request.can(`table:${chat.connectionId}:${chat.settingsTable.table.id}:read`))) {
            throw new ForbiddenError('Only someone who may read the chat’s settings reads this.', 'TABLE_FORBIDDEN', { reason: 'chat-settings-read' });
          }
          const [status, defaultLanguage, timeZone] = await Promise.all([readDoorStatus(meta, deps.secret, reach, request), settingsRepo(meta).get('locale.default'), chatZoneOf(meta, chat)]);
          const language = chatLanguageOf(defaultLanguage);
          return {
            data: {
              ...status,
              languages: chatLanguages(chat.settings, language),
              defaultLanguage: language,
              businessName: await businessName(meta, { origin: status.publicOrigin }),
              timeZone,
            },
          };
        },
      );
    }

    app.get(
      '/chat/:addOn/pause',
      {
        preHandler: [app.requireAuth],
        schema: { tags, summary: 'Whether new website chats are paused', description: 'Until when the breaker holds new chats back (null: they are open). For someone who may read the chat\'s settings.', params, querystring: query, response: { 200: chatPauseReply } },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        if (!(await request.can(`table:${chat.connectionId}:${chat.settingsTable.table.id}:read`))) {
          throw new ForbiddenError('Only someone who may read the chat’s settings reads this.', 'TABLE_FORBIDDEN', { reason: 'chat-settings-read' });
        }
        const until = await deps.caps.pausedUntil(chat.addOn, now());
        return { data: { pausedUntil: until === null ? null : new Date(until).toISOString() } };
      },
    );

    app.post(
      '/chat/:addOn/resume',
      {
        preHandler: [app.requireAuth],
        config: write,
        schema: {
          tags,
          summary: 'Resume new website chats',
          description: 'New visitors may start chats again before the breaker\'s pause is over. For someone who may change the chat\'s settings. `resumed` is false when nothing was paused.',
          params,
          querystring: query,
          body: emptyBody,
          response: { 200: chatResumeReply },
        },
      },
      async (request) => {
        const chat = await chatOf(request.params.addOn, request.query.install);
        if (!(await request.can(`table:${chat.connectionId}:${chat.settingsTable.table.id}:update`))) {
          throw new ForbiddenError('Only someone who may change the chat’s settings resumes it.', 'TABLE_FORBIDDEN', { reason: 'chat-settings-update' });
        }
        const resumed = await deps.caps.resume(chat.addOn, now());
        await audit(request, chat, 'chat.resume', null, { resumed });
        return { data: { resumed } };
      },
    );
  };
}

/**
 * A row made by the dashboard's own create route, as the person behind
 * `request`: the same session (or key), so every grant, column limit, rule,
 * audit and live update of an ordinary create applies, and its refusal is
 * passed on in its own words. Browser-only headers are not passed: the outer
 * request already passed the cross-site check.
 */
async function createAsPerson(app: FastifyInstance, request: FastifyRequest, connectionId: string, tableId: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = request.headers[name];
    if (typeof value === 'string' && value !== '') headers[name] = value;
  }
  if (typeof request.host === 'string' && request.host !== '') headers['host'] = request.host;
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(tableId)}`,
    headers,
    remoteAddress: request.ip,
    payload: { values },
  });
  let body: { data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = JSON.parse(res.body) as typeof body;
  } catch {
    body = {};
  }
  if (res.statusCode === 201 || res.statusCode === 200) return body.data ?? {};
  throw new AppError(res.statusCode, body.error?.code ?? 'ENQUIRY_REFUSED', body.error?.message ?? 'The enquiry was refused.', body.error?.details);
}
