// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/designer/*` — Adminium Designer's sessions, turns and models.
 *
 * Registered only when the server runs the Designer (`adminium design`).
 * Every route needs `system:designer:use`, which only Super Admin holds
 * unless it is granted on purpose: the Designer's model writes code this
 * server runs. Every route declares the `designer` rate bucket itself, so no
 * address pattern can take its limit away.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Designer } from '../../designer/service.js';
import type { Actor } from '../../designer/runner.js';
import { NotFoundError } from '../../errors.js';
import type { Versions } from '../../designer/versions.js';
import type { AiConnections } from '../../llm/connections.js';
import { APPS_DIR, listAppKeys, MANIFEST_PARTS_DIR } from '../../project/apps/read-app.js';
import { nameFromKey } from '../../project/apps/scaffold-app.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { auditExempt } from '../../audit/coverage.js';
import {
  designerAnswerBody,
  designerAnswerReply,
  designerAppsReply,
  designerConnectionDraft,
  designerConnectionReply,
  designerConnectionSaveBody,
  designerConnectionTestReply,
  designerEventsQuery,
  designerEventsReply,
  designerSessionCreateBody,
  designerSessionCreateReply,
  designerSessionParams,
  designerSessionPatchBody,
  designerSessionReply,
  designerStateReply,
  designerRestoreBody,
  designerRestoreReply,
  designerStopReply,
  designerVersionParams,
  designerVersionsReply,
  designerTurnBody,
  designerTurnReply,
} from './schema.js';

export interface DesignerRoutesDeps {
  designer: Designer;
  versions: Versions | null;
  connections: AiConnections;
  mode: 'local' | 'live';
  root: string;
  limits: () => Promise<{ maxSteps: number; turnTokens: number; sessionTokens: number }>;
}

/** How many events one catch-up read gives. */
export const EVENTS_PAGE = 2000;

const RATE = { rateLimitBucket: 'designer' } as const;

/** The person asking. */
function actorOf(request: FastifyRequest): Actor {
  return { id: request.user?.id ?? null, label: request.user?.email ?? 'unknown' };
}

/** An app's name as its `app.json` says it, or one made from its key. */
function appName(root: string, key: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, APPS_DIR, key, MANIFEST_PARTS_DIR, 'app.json'), 'utf8')) as { name?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim() !== '') return parsed.name;
    if (parsed.name !== null && typeof parsed.name === 'object') {
      const text = (parsed.name as Record<string, unknown>)['en-US'] ?? (parsed.name as { fallback?: unknown }).fallback;
      if (typeof text === 'string' && text.trim() !== '') return text;
    }
  } catch {
    // A single manifest.json, or one that does not read: the key says enough.
  }
  return nameFromKey(key);
}

export function designerRoutes(deps: DesignerRoutesDeps): FastifyPluginAsyncZod {
  const { designer, connections } = deps;
  const { store, runner } = designer;

  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.designerUse);

    app.get('/designer/state', { preHandler: guard, config: RATE, schema: { response: { 200: designerStateReply } } }, async () => ({
      mode: deps.mode,
      project: basename(deps.root),
      limits: await deps.limits(),
      active: runner.active(),
    }));

    // "Your apps": every app of the folder, with the newest session that built it.
    app.get('/designer/sessions', { preHandler: guard, config: RATE, schema: { response: { 200: designerAppsReply } } }, async () => {
      const sessions = store.list();
      return {
        apps: listAppKeys(deps.root).map((key) => {
          const newest = sessions.find((session) => session.appKey === key) ?? null;
          return {
            key,
            name: appName(deps.root, key),
            version: newest?.version ?? null,
            editedAt: newest?.updatedAt ?? null,
            sessionId: newest?.id ?? null,
          };
        }),
      };
    });

    app.post(
      '/designer/sessions',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the session and its first turn are audited by the Designer itself') },
        schema: { body: designerSessionCreateBody, response: { 201: designerSessionCreateReply } },
      },
      async (request, reply) => {
        const by = actorOf(request);
        const { text, ...input } = request.body;
        const session = await designer.createSession(input, by);
        const { turn } = await runner.start(session.id, { text, by });
        return reply.code(201).send({ session: store.read(session.id), turn });
      },
    );

    app.get(
      '/designer/sessions/:id',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerSessionReply } } },
      async (request) => {
        const session = store.read(request.params.id);
        return { session, waiting: runner.waiting(session.id), active: runner.active()?.sessionId === session.id };
      },
    );

    app.patch(
      '/designer/sessions/:id',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a session’s title and model are the person’s working state, not configuration') },
        schema: { params: designerSessionParams, body: designerSessionPatchBody, response: { 200: designerSessionReply } },
      },
      async (request) => {
        const current = store.read(request.params.id);
        if (request.body.connectionId !== undefined && (await connections.find(request.body.connectionId)) === null) {
          throw new NotFoundError('There is no such model connection.', { connectionId: request.body.connectionId });
        }
        const session = store.update(current.id, {
          ...(request.body.title === undefined ? {} : { title: request.body.title }),
          ...(request.body.connectionId === undefined ? {} : { connectionId: request.body.connectionId }),
          ...(request.body.model === undefined ? {} : { model: request.body.model }),
        });
        return { session, waiting: runner.waiting(session.id), active: runner.active()?.sessionId === session.id };
      },
    );

    app.post(
      '/designer/sessions/:id/turns',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('every turn is audited by the Designer itself, start and end') },
        schema: { params: designerSessionParams, body: designerTurnBody, response: { 202: designerTurnReply } },
      },
      async (request, reply) => {
        const started = await runner.start(request.params.id, { text: request.body.text, by: actorOf(request) });
        return reply.code(202).send(started);
      },
    );

    app.post(
      '/designer/sessions/:id/stop',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the turn’s end is audited, with how it ended') },
        schema: { params: designerSessionParams, response: { 200: designerStopReply } },
      },
      async (request) => {
        store.read(request.params.id);
        return { stopped: runner.stop(request.params.id) };
      },
    );

    app.post(
      '/designer/sessions/:id/answers',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('an answer is an event of the session; a removal it accepts is audited by the install service') },
        schema: { params: designerSessionParams, body: designerAnswerBody, response: { 200: designerAnswerReply } },
      },
      async (request) => {
        store.read(request.params.id);
        runner.answer(request.params.id, request.body.cardId, request.body.value, actorOf(request));
        return { answered: true as const };
      },
    );

    // The catch-up read: everything after the last event a page saw. Named `-since` so it keeps its rate limit.
    app.get(
      '/designer/sessions/:id/events-since',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, querystring: designerEventsQuery, response: { 200: designerEventsReply } } },
      async (request) => {
        store.read(request.params.id);
        runner.events(request.params.id).flush();
        const { events, more } = store.eventsSince(request.params.id, request.query.after, EVENTS_PAGE);
        return { events, more, last: store.lastSeq(request.params.id) };
      },
    );

    app.get(
      '/designer/sessions/:id/versions',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerVersionsReply } } },
      async (request) => {
        store.read(request.params.id);
        const available = deps.versions !== null && (await deps.versions.available());
        return { available, versions: available && deps.versions !== null ? await deps.versions.list(request.params.id) : [] };
      },
    );

    // Going back to a version (O1: as a new version on top), or putting the files back after a stop (O3).
    app.post(
      '/designer/sessions/:id/versions/:n/restore',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the Designer audits a restore itself, with the version it went back to') },
        schema: { params: designerVersionParams, body: designerRestoreBody, response: { 200: designerRestoreReply } },
      },
      async (request) => designer.restore(request.params.id, request.params.n, { record: request.body.record, by: actorOf(request) }),
    );

    // Models: try one without saving it, and keep one in the project's .env.
    app.post(
      '/designer/connections/test',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a test saves nothing') },
        schema: { body: designerConnectionDraft, response: { 200: designerConnectionTestReply } },
      },
      async (request) => connections.test(request.body),
    );

    app.put(
      '/designer/connections',
      { preHandler: guard, config: RATE, schema: { body: designerConnectionSaveBody, response: { 200: designerConnectionReply } } },
      async (request) => {
        const saved = await connections.save(request.body);
        // Provider and model only: the key is never in an audit entry.
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'designer.model.saved',
          changes: { after: { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl } },
        });
        return saved;
      },
    );
  };
}
