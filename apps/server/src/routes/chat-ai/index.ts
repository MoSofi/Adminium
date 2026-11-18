// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a website chat's settings page asks the engine about its automatic
 * answers, for staff.
 *
 *   GET  /chat/:addOn/ai       whether the answerer can call an AI service
 *                              here and why not, the service's name (decided
 *                              here from the connection the answerer would
 *                              use, never guessed by the page), the sentence
 *                              the page shows beside the switch in the
 *                              reader's language, and today's spent and
 *                              reserved tokens against the chat's limit
 *   POST /chat/:addOn/ai/try   "Try a question": the real answerer on one
 *                              typed question, counted against the day's
 *                              tokens like a visitor's, so what the page shows
 *                              is what a visitor would get
 *
 * Both are for a signed-in person (never an API key): the read for one who
 * may read the chat's settings table, the try for one who may change its
 * answers or its settings, since it spends the chat's tokens. Everyone else
 * is refused (403); a chat that is not installed is 404. `?install=` names
 * the install when the add-on is on more than one database.
 *
 * A try writes no `choices` row: that table's conversation is a required
 * link, and a try has none. It is in the audit log instead (who, the outcome
 * and the tokens; never the question).
 */
import { userPrefsRepo, chatAiDayOf, chatAiTallyRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { chatAiService, createChatAnswerer, type ChatAnswererDeps, type ChatAnswererInput, type ChatChoiceRow } from '../../chat/answerer.js';
import { chatServiceName, chatAiNotice } from '../../chat/ai-notice.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { translatorFor } from '../../i18n/server-i18n.js';

/** One chat install, as its settings page needs it: the chat store's reader fills it. */
export interface ChatAiInstall {
  installId: string;
  /** The database the add-on is installed on. */
  connectionId: string;
  /** The add-on's settings table and answers table, by their ids in that database's snapshot. */
  settingsTable: string;
  answersTable: string;
  /** The settings row's `daily_tokens` (0: no automatic answers). */
  dailyTokens: number;
  /** The chat's default language. */
  defaultLanguage: string;
  /** The default-language versions of the active answers. */
  answers: ChatAnswererInput['answers'];
}

export interface ChatAiRoutesDeps {
  meta: MetaDb;
  /** The chat install of `addOn` (on the database `installId` names, when given), or null when there is none. */
  install: (addOn: string, installId: string | undefined) => Promise<ChatAiInstall | null>;
  /** What the answerer is built with, but its choice log: a try logs to the audit instead. */
  answerer: Omit<ChatAnswererDeps, 'logChoice'>;
}

const REFUSALS = ['no-provider', 'network-disabled', 'off-here'] as const;

const params = z.object({ addOn: z.string().min(1).max(80) });
const query = z.object({ install: z.string().min(1).max(64).optional() });

export const chatAiReply = z.object({
  data: z.object({
    /** Whether the answerer can call an AI service on this server now (the chat's own switch and tokens aside). */
    usable: z.boolean(),
    /** Why not: no AI service set, outside calls off on this server, or the answerer off here (a trial); null when usable. */
    refusal: z.enum(REFUSALS).nullable(),
    /** The service the visitors' words go to, as this server names it; null with none set. */
    service: z.object({ provider: z.string(), name: z.string() }).nullable(),
    /** "Visitors' messages are sent to {service} …", in the reader's language; null with no service. */
    notice: z.string().nullable(),
    /** Today's tokens (a UTC day): spent, held by calls running now, and the chat's limit. */
    today: z.object({ day: z.string(), spent: z.number().int(), reserved: z.number().int(), limit: z.number().int() }),
  }),
});

export const chatAiTryBody = z.object({
  question: z.string().trim().min(1).max(2000),
});

export const chatAiTryReply = z.object({
  data: z.object({
    /** The answer the visitor would get, by its ref; null when the chat would be handed to a person. */
    answerRef: z.string().nullable(),
    outcome: z.enum(['answered', 'hand-over', 'error', 'budget', 'cap', 'off']),
    tokensIn: z.number().int(),
    tokensOut: z.number().int(),
  }),
});

/** The conversation a try is counted under: none is real, so one number every try shares. */
export const CHAT_TRY_CONVERSATION = 0;

export function chatAiRoutes(deps: ChatAiRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;

  async function found(addOn: string, installId: string | undefined) {
    const install = await deps.install(addOn, installId);
    if (install === null) throw new NotFoundError('No website chat of that add-on is installed.');
    return install;
  }

  return async (app) => {
    app.get(
      '/chat/:addOn/ai',
      {
        preHandler: [app.requireAuth],
        schema: {
          tags: ['chat'],
          summary: 'What a website chat\'s automatic answers can do here',
          description:
            'Whether the automatic answerer can call an AI service on this server, the service\'s name and the sentence shown beside the switch, and today\'s spent and reserved tokens. For a signed-in person who may read the chat\'s settings.',
          params,
          querystring: query,
          response: { 200: chatAiReply },
        },
      },
      async (request) => {
        const install = await found(request.params.addOn, request.query.install);
        if (!(await request.can(`table:${install.connectionId}:${install.settingsTable}:read`))) {
          throw new ForbiddenError('Only someone who may read the chat\'s settings reads its automatic answers.', 'FORBIDDEN', { reason: 'chat-settings-read' });
        }
        const service = await chatAiService(deps.answerer);
        const named = service.connection === null ? null : { provider: service.connection.provider, name: chatServiceName(service.connection, service.model) };
        const i18n = await translatorFor(meta, request.user?.id ?? null);
        const day = chatAiDayOf((deps.answerer.now ?? Date.now)());
        const today = await chatAiTallyRepo(meta).day({ installId: install.installId, addOn: request.params.addOn, day });
        return {
          data: {
            usable: service.refusal === null,
            refusal: service.refusal,
            service: named,
            notice: named === null ? null : chatAiNotice(i18n, named.name),
            today: { day, spent: today?.spent ?? 0, reserved: today?.reserved ?? 0, limit: install.dailyTokens },
          },
        };
      },
    );

    app.post(
      '/chat/:addOn/ai/try',
      {
        preHandler: [app.requireAuth],
        config: { audit: audited('rbac') },
        schema: {
          tags: ['chat'],
          summary: 'Try a question on a website chat\'s automatic answers',
          description:
            'Runs the real automatic answerer on one typed question, counted against the chat\'s tokens for today, and says which answer a visitor would get, or that the chat would go to a person. For a signed-in person who may change the chat\'s answers or settings.',
          params,
          querystring: query,
          body: chatAiTryBody,
          response: { 200: chatAiTryReply },
        },
      },
      async (request) => {
        const addOn = request.params.addOn;
        const install = await found(addOn, request.query.install);
        const may =
          (await request.can(`table:${install.connectionId}:${install.answersTable}:update`)) || (await request.can(`table:${install.connectionId}:${install.settingsTable}:update`));
        if (!may) throw new ForbiddenError('Only someone who may change the chat\'s answers tries a question on them.', 'FORBIDDEN', { reason: 'chat-answers-update' });
        let row: ChatChoiceRow | null = null;
        const answerer = createChatAnswerer({
          ...deps.answerer,
          logChoice: async (choice) => {
            row = choice;
          },
        });
        const userId = request.user?.id ?? '';
        await answerer.pick({
          installId: install.installId,
          addOn,
          conversationId: CHAT_TRY_CONVERSATION,
          messageId: 0,
          language: install.defaultLanguage,
          defaultLanguage: install.defaultLanguage,
          answers: install.answers,
          visitorMessages: [request.body.question],
          automaticCount: 0,
          // A person's tries are one "address": they share one conversation, so they never meet the address cap.
          addressHash: `chat-try:${createHash('sha256').update(userId).digest('hex')}`,
          dailyTokens: install.dailyTokens,
        });
        const made = row as ChatChoiceRow | null;
        const choice = made ?? { answerRef: null, outcome: 'error' as const, tokensIn: 0, tokensOut: 0, model: null };
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'chat.ai.try',
          changes: { after: { addOn, installId: install.installId, outcome: choice.outcome, answerRef: choice.answerRef, model: choice.model, tokensIn: choice.tokensIn, tokensOut: choice.tokensOut } },
        });
        return { data: { answerRef: choice.answerRef, outcome: choice.outcome, tokensIn: choice.tokensIn, tokensOut: choice.tokensOut } };
      },
    );
  };
}
