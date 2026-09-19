// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's HTTP surface.
 *
 * ```
 * GET  /assistant/availability            can it work here, and under whose terms
 * POST /assistant/sessions                open one modal; compute the page's facts
 * POST /assistant/sessions/:id/turns      ask something; the work runs as a job
 * GET  /assistant/sessions/:id/turns/:turnId    what that turn ended as
 * POST /assistant/sessions/:id/turns/:turnId/cancel
 * POST /assistant/sessions/:id/turns/:turnId/actions   a button on the result card
 * POST /assistant/sessions/:id/close
 * ```
 *
 * Every route needs a session AND `system:assistant:use`. The two that WRITE —
 * saving a draft and sending a test message — additionally need
 * `system:settings:manage`, which is what each host page's own save needs; that
 * check lives in `assistant/actions.ts` so it cannot be forgotten by a second
 * caller.
 *
 * A session belongs to the person who opened it. Reading somebody else's
 * transcript is not a feature of this surface, so every route resolves the
 * session for the acting user and answers 404 otherwise — the same answer as a
 * session that never existed, because which of the two it is is not the
 * asker's business.
 *
 * NOTHING HERE IS A PROJECT WRITE. These routes create database rows —
 * templates, invoices, reports — and never a file in a project folder, so this
 * prefix is deliberately not one the project sync watches.
 */

import { estimateTokens } from '@adminium/llm';
import {
  assistantSessionsRepo,
  jobsRepo,
  settingsRepo,
  type AssistantSession,
  type AssistantTurn,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { runAssistantAction, type AssistantActionKind } from '../../assistant/actions.js';
import { setUpTurn, toolDepsFor } from '../../assistant/turn-setup.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { ASSISTANT_TURN_KIND } from '../../jobs/assistant-turn.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  assistantActionBody,
  assistantActionReply,
  assistantAvailabilityQuery,
  assistantAvailabilityReply,
  assistantSessionCreateBody,
  assistantSessionCreateReply,
  assistantSessionParams,
  assistantTurnCreateBody,
  assistantTurnCreateReply,
  assistantTurnParams,
  assistantTurnView,
  type AssistantTurnView,
} from './schema.js';

export interface AssistantRoutesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** Whether this instance may make outbound calls at all (desktop air-gap, env veto). */
  networkFeatures: boolean;
  /** The master secret, for the mail transport a test send uses. */
  secret?: string | null | undefined;
  /**
   * Stop a running turn. Cooperative, like every cancel here: the worker
   * aborts the run's signal and the handler notices between rounds. Absent in
   * tests that register no worker, where the row-level cancel below is the
   * whole of it.
   */
  cancelJob?: ((jobId: string) => void) | undefined;
}

const USE_PERMISSION = 'system:assistant:use';

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

/** A record, or `null` — what a stored JSON column is allowed to come back as. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A stored turn, as the reply shape.
 *
 * Every JSON column is READ DEFENSIVELY. A `result` written by a newer server,
 * or by a shape this build has since changed, must not 500 the one route whose
 * job is to explain what happened — so a field that no longer fits comes back
 * as null and the rest of the turn still renders.
 */
function turnView(turn: AssistantTurn): AssistantTurnView {
  const steps = assistantTurnView.shape.steps.safeParse(turn.steps);
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    seq: turn.seq,
    status: turn.status,
    jobId: turn.jobId,
    askText: turn.askText,
    say: turn.say,
    steps: steps.success ? steps.data : [],
    ask: asRecord(turn.ask),
    result: asRecord(turn.result),
    error: asRecord(turn.error),
    tokensIn: turn.tokensIn,
    tokensOut: turn.tokensOut,
    createdAt: turn.createdAt,
    finishedAt: turn.finishedAt,
  };
}

function sessionView(session: AssistantSession) {
  return {
    id: session.id,
    context: session.context,
    status: session.status,
    provider: session.provider,
    model: session.model,
    tokensIn: session.tokensIn,
    tokensOut: session.tokensOut,
    createdAt: session.createdAt,
  };
}

export function assistantRoutes(deps: AssistantRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manager } = deps;
  const sessions = assistantSessionsRepo(meta);
  const settings = settingsRepo(meta);

  return async (app) => {
    const guard = app.rbac.require(USE_PERMISSION);

    /** The session this person opened, or a 404 — never somebody else's. */
    async function mine(request: FastifyRequest, sessionId: string): Promise<AssistantSession> {
      const userId = requireUserId(request);
      const session = await sessions.findSession(sessionId);
      if (session === null || session.createdBy !== userId) {
        throw new NotFoundError('That assistant session does not exist.', { sessionId });
      }
      return session;
    }

    async function providerState(): Promise<{
      provider: string | null;
      model: string | null;
      enabled: boolean;
      reason: 'no-provider' | 'network-disabled' | null;
    }> {
      const provider = await settings.get('llm.provider');
      const model = await settings.get('llm.model');
      if (provider === null) return { provider, model, enabled: false, reason: 'no-provider' };
      // Ollama is the local one: an instance with no outbound network can
      // still use it, and saying otherwise would hide the only provider that
      // works there.
      if (!deps.networkFeatures && provider !== 'ollama') {
        return { provider, model, enabled: false, reason: 'network-disabled' };
      }
      return { provider, model, enabled: true, reason: null };
    }

    app.get(
      '/assistant/availability',
      {
        preHandler: guard,
        schema: { querystring: assistantAvailabilityQuery, response: { 200: assistantAvailabilityReply } },
      },
      async (request) => {
        requireUserId(request);
        const state = await providerState();
        return {
          enabled: state.enabled,
          reason: state.reason,
          name: await settings.get('assistant.name'),
          rowData: await settings.get('assistant.rowData'),
          // What the card's write buttons are allowed to do, decided here
          // rather than guessed in the browser.
          canWrite: await request.can(PERMISSIONS.settingsManage),
          // Whether the unavailable bar may offer a link to Settings → AI.
          canConfigure: await request.can(PERMISSIONS.llmRun),
          provider: state.provider,
          model: state.model,
        };
      },
    );

    app.post(
      '/assistant/sessions',
      {
        preHandler: guard,
        config: { audit: auditExempt('opening a modal changes nothing; the session row IS the record') },
        schema: { body: assistantSessionCreateBody, response: { 201: assistantSessionCreateReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const state = await providerState();
        if (!state.enabled) {
          throw new ConflictError('The assistant has no provider to work with.', 'CONFLICT', {
            reason: state.reason,
          });
        }
        const { context, host, draft } = request.body;

        const setup = await setUpTurn({
          meta,
          manager,
          context,
          host,
          userId,
          can: (permission) => request.can(permission),
        });
        const facts = await setup.adapter.pageFacts(setup.deps);

        const session = await sessions.create(
          {
            context,
            host,
            ...(draft === undefined ? {} : { draft }),
            provider: state.provider,
            model: state.model,
            createdBy: userId,
          },
          app.rbac.now(),
        );
        return await reply.status(201).send({
          session: sessionView(session),
          facts: { values: facts.values, scope: facts.scope },
          nextTurnTokens: estimateTokens(setup.system),
        });
      },
    );

    app.post(
      '/assistant/sessions/:id/turns',
      {
        preHandler: guard,
        config: {
          audit: auditExempt('a transcript row is the record; a turn reads and changes no state'),
        },
        schema: {
          params: assistantSessionParams,
          body: assistantTurnCreateBody,
          response: { 202: assistantTurnCreateReply },
        },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const session = await mine(request, request.params.id);
        if (session.status !== 'open') {
          throw new ConflictError('That assistant session is closed.', 'CONFLICT', { sessionId: session.id });
        }
        // One turn at a time: a second question over a running one would
        // replay a transcript that is still being written.
        if (await sessions.hasLiveTurn(session.id)) {
          throw new ConflictError('The assistant is still working on the last question.', 'CONFLICT', {
            sessionId: session.id,
          });
        }

        const at = app.rbac.now();
        const turn = await sessions.createTurn(
          {
            sessionId: session.id,
            askText: request.body.text ?? null,
            picks: request.body.picks ?? null,
          },
          at,
        );
        const job = await jobsRepo(meta).enqueue(
          {
            kind: ASSISTANT_TURN_KIND,
            // The owner convention: the acting user may follow `jobs:<id>`
            // without holding the read-everyone's-jobs key.
            payload: { turnId: turn.id, userId },
          },
          at,
        );
        await sessions.setTurnStatus(turn.id, 'queued', { jobId: job.id });

        const stored = (await sessions.findTurn(turn.id)) ?? turn;
        return await reply.status(202).send({
          turn: turnView(stored),
          jobId: job.id,
          nextTurnTokens: estimateTokens(request.body.text ?? ''),
        });
      },
    );

    app.get(
      '/assistant/sessions/:id/turns/:turnId',
      { preHandler: guard, schema: { params: assistantTurnParams, response: { 200: assistantTurnView } } },
      async (request) => {
        const session = await mine(request, request.params.id);
        const turn = await sessions.findTurn(request.params.turnId);
        if (turn === null || turn.sessionId !== session.id) {
          throw new NotFoundError('That turn does not exist.', { turnId: request.params.turnId });
        }
        return turnView(turn);
      },
    );

    app.post(
      '/assistant/sessions/:id/turns/:turnId/cancel',
      {
        preHandler: guard,
        config: { audit: auditExempt('stopping work that has written nothing; the turn row records it') },
        schema: { params: assistantTurnParams, response: { 204: z.null() } },
      },
      async (request, reply) => {
        const session = await mine(request, request.params.id);
        const turn = await sessions.findTurn(request.params.turnId);
        if (turn === null || turn.sessionId !== session.id) {
          throw new NotFoundError('That turn does not exist.', { turnId: request.params.turnId });
        }
        if (turn.jobId !== null) deps.cancelJob?.(turn.jobId);
        await sessions.finishTurn(turn.id, { status: 'cancelled', finishedAt: app.rbac.now() });
        return await reply.status(204).send(null);
      },
    );

    app.post(
      '/assistant/sessions/:id/turns/:turnId/actions',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: {
          params: assistantTurnParams,
          body: assistantActionBody,
          response: { 200: assistantActionReply },
        },
      },
      async (request) => {
        const userId = requireUserId(request);
        const session = await mine(request, request.params.id);
        const turn = await sessions.findTurn(request.params.turnId);
        if (turn === null || turn.sessionId !== session.id) {
          throw new NotFoundError('That turn does not exist.', { turnId: request.params.turnId });
        }
        const result = asRecord(turn.result);
        const artefact = result === null ? null : asRecord(result.artefact);
        if (artefact === null) {
          throw new ValidationFailedError('That turn produced no draft to act on.', { turnId: turn.id });
        }

        const principal = (request as unknown as { user?: { id?: string; name?: string; email?: string } }).user;
        // A RE-RUN reads the database, so it needs the same dependency bundle
        // a turn's tools read through — the acting person's grants, resolved
        // the same way. Built only for the action that can use it: every
        // other action here writes or sends and reads no source table.
        const toolDeps =
          request.body.action === 'sample'
            ? await toolDepsFor({
                meta,
                manager: deps.manager,
                context: session.context,
                host: session.host,
                userId,
                can: (permission) => request.can(permission),
              })
            : undefined;
        const outcome = await runAssistantAction({
          meta,
          action: request.body.action as AssistantActionKind,
          context: session.context,
          artefact,
          sessionId: session.id,
          turnId: turn.id,
          actor: { kind: 'user', id: userId, label: principal?.name ?? principal?.email ?? userId },
          can: (permission) => request.can(permission),
          ...(toolDeps === undefined ? {} : { toolDeps }),
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
          ...(request.body.open === undefined ? {} : { open: request.body.open }),
          ...(request.body.locale === undefined ? {} : { locale: request.body.locale }),
          // A test message goes to the person who asked for it and nowhere
          // else: there is no recipient field on this surface to abuse.
          ...(principal?.email === undefined ? {} : { to: principal.email }),
          ...(deps.secret === undefined ? {} : { secret: deps.secret }),
          logger: request.log,
          now: () => app.rbac.now(),
        });
        return {
          echo: outcome.echo as unknown as Record<string, unknown>,
          created: outcome.created ?? null,
          sample: outcome.sample ?? null,
        };
      },
    );

    app.post(
      '/assistant/sessions/:id/close',
      {
        preHandler: guard,
        config: { audit: auditExempt('closing a modal; the session row already records that it existed') },
        schema: { params: assistantSessionParams, response: { 204: z.null() } },
      },
      async (request, reply) => {
        const session = await mine(request, request.params.id);
        for (const turn of await sessions.listTurns(session.id)) {
          if (turn.status !== 'queued' && turn.status !== 'running') continue;
          if (turn.jobId !== null) deps.cancelJob?.(turn.jobId);
          await sessions.finishTurn(turn.id, { status: 'cancelled', finishedAt: app.rbac.now() });
        }
        await sessions.close(session.id, app.rbac.now());
        return await reply.status(204).send(null);
      },
    );
  };
}
