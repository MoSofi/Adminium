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

import type { AiConnections } from '../../llm/connections.js';
import { estimateTokens } from '@adminium/llm';
import {
  assistantSessionsRepo,
  assistantUseDay,
  assistantUseRepo,
  assistantUseResetsAt,
  jobsRepo,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type AssistantSession,
  type AssistantTurn,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { runAssistantAction, type AssistantActionKind } from '../../assistant/actions.js';
import { readAllowance } from '../../assistant/allowance.js';
import { listedAddOns } from '../../assistant/tools/add-ons.js';
import type { AssistantAddOn } from '../../assistant/types.js';
import { setUpTurn, toolDepsFor } from '../../assistant/turn-setup.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { ASSISTANT_TURN_KIND } from '../../jobs/assistant-turn.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  assistantActionBody,
  assistantActionReply,
  assistantAvailabilityQuery,
  assistantAvailabilityReply,
  assistantCurrentReply,
  assistantFactsBody,
  assistantFactsReply,
  assistantSessionCreateBody,
  assistantSessionCreateReply,
  assistantSessionParams,
  assistantSettingsPutBody,
  assistantSettingsReply,
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
  /** The instance's model connections; absent in a harness, which reads the saved setting. */
  connections?: AiConnections | undefined;
  /** The master secret, for the mail transport a test send uses. */
  secret?: string | null | undefined;
  /**
   * Stop a running turn. Cooperative, like every cancel here: the worker
   * aborts the run's signal and the handler notices between rounds. Absent in
   * tests that register no worker, where the row-level cancel below is the
   * whole of it.
   */
  cancelJob?: ((jobId: string) => void) | undefined;
  /** The add-ons this server has and could have: the tool's list, and where a suggestion's card is drawn from. */
  addOns?: (() => Promise<AssistantAddOn[]>) | undefined;
}

const USE_PERMISSION = 'system:assistant:use';

/**
 * The signed-in person. An API key is refused by name: a turn runs as a
 * person, and a key's id looked up as one holds no role, so its tools would
 * read no table and the conversation would answer about nothing.
 */
function requireUserId(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('The assistant works for a signed-in person, not for an API key.', 'FORBIDDEN', {
      reason: 'api-key',
    });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

/** A record, or `null` — what a stored JSON column is allowed to come back as. */
/** Turns `GET /assistant/sessions/current` answers, newest last. */
const CURRENT_TURNS = 30;
/** How many of them carry their drafts' documents. */
const CURRENT_WHOLE_TURNS = 5;

/** A result card's words without its document: enough to draw the card, parked or not. */
function lightResult(result: Record<string, unknown>): Record<string, unknown> {
  const { artefact: _artefact, diff: _diff, ...rest } = result;
  return { ...rest, light: true };
}

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
function turnView(turn: AssistantTurn, session: AssistantSession): AssistantTurnView {
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
    context: turn.context ?? session.context,
    answer: asRecord(turn.answer),
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
    kind: session.kind,
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

    /**
     * A turn as it is answered, with its suggestions drawn from THIS SERVER'S list as it is now:
     * each add-on's name and one line come from the list, never from the model, and one that has
     * been installed since, or is no longer listed, is not suggested any more.
     */
    async function served(turn: AssistantTurn, session: AssistantSession): Promise<AssistantTurnView> {
      const view = turnView(turn, session);
      const suggest = view.answer === null ? undefined : view.answer.suggest;
      if (!Array.isArray(suggest) || suggest.length === 0) return view;
      const known = (await listedAddOns(deps.addOns)) ?? [];
      const cards: { key: string; name: string; line: string }[] = [];
      for (const entry of suggest) {
        const key = (entry as { key?: unknown } | null)?.key;
        const found = typeof key === 'string' ? known.find((item) => item.key === key && item.state !== 'installed') : undefined;
        if (found !== undefined) cards.push({ key: found.key, name: found.name, line: found.line });
      }
      const { suggest: _stored, ...rest } = view.answer as Record<string, unknown>;
      return { ...view, answer: cards.length === 0 ? rest : { ...rest, suggest: cards } };
    }

    async function providerState(): Promise<{
      provider: string | null;
      model: string | null;
      enabled: boolean;
      reason: 'no-provider' | 'network-disabled' | null;
    }> {
      if (deps.connections !== undefined) {
        // The saved connection, else the one the environment selects.
        const chosen = await deps.connections.default();
        const reason = deps.connections.refusal(chosen?.connection ?? null);
        return { provider: chosen?.connection.provider ?? null, model: chosen?.model ?? null, enabled: reason === null, reason };
      }
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
          budget: await readAllowance(meta, requireUserId(request), app.rbac.now()),
        };
      },
    );

    app.post(
      '/assistant/sessions',
      {
        preHandler: guard,
        config: { audit: auditExempt('opening a modal changes nothing; the session row IS the record'), rateLimitBucket: 'assistant' },
        schema: { body: assistantSessionCreateBody, response: { 200: assistantSessionCreateReply, 201: assistantSessionCreateReply } },
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

        // The panel's conversation: a person has ONE, open across pages. Asked for again (a
        // reload, a second window), the one they have is answered.
        if (request.body.kind === 'panel') {
          const open = await sessions.openPanelOf(userId);
          if (open !== null) {
            return await reply.status(200).send({
              session: sessionView(open),
              facts: { values: facts.values as never, scope: facts.scope },
              nextTurnTokens: estimateTokens(setup.system),
            });
          }
        }

        const made = await sessions.create(
          {
            context,
            host,
            ...(draft === undefined ? {} : { draft }),
            provider: state.provider,
            model: state.model,
            createdBy: userId,
            ...(request.body.kind === undefined ? {} : { kind: request.body.kind }),
          },
          app.rbac.now(),
        );
        // Two windows that asked in the same instant each made one. The oldest is THE one, for
        // both: the other is closed, and whoever made it is answered the one that stays.
        let session = made;
        if (made.kind === 'panel') {
          const first = (await sessions.openPanelOf(userId)) ?? made;
          await sessions.closeOtherPanels(userId, first.id, app.rbac.now());
          session = first;
        }
        return await reply.status(session.id === made.id ? 201 : 200).send({
          session: sessionView(session),
          facts: { values: facts.values, scope: facts.scope },
          nextTurnTokens: estimateTokens(setup.system),
        });
      },
    );

    app.get(
      '/assistant/sessions/current',
      { preHandler: guard, schema: { response: { 200: assistantCurrentReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const session = await sessions.openPanelOf(userId);
        if (session === null) return { session: null, turns: [], earlier: 0 };
        const all = await sessions.listTurns(session.id);
        const shown = all.slice(-CURRENT_TURNS);
        const turns: AssistantTurnView[] = [];
        for (const [index, turn] of shown.entries()) {
          const view = await served(turn, session);
          // The newest come whole. An older draft comes as its card's words; its document is the
          // heavy part and is read with the turn when the person opens it.
          const light = index < shown.length - CURRENT_WHOLE_TURNS && view.result !== null;
          turns.push(light ? { ...view, result: lightResult(view.result as Record<string, unknown>) } : view);
        }
        return { session: sessionView(session), turns, earlier: all.length - shown.length };
      },
    );

    app.post(
      '/assistant/facts',
      {
        preHandler: guard,
        config: { audit: auditExempt('reads what a page holds, for the header of a conversation that walked to it; writes nothing') },
        schema: { body: assistantFactsBody, response: { 200: assistantFactsReply } },
      },
      async (request) => {
        const setup = await setUpTurn({
          meta,
          manager,
          context: request.body.context,
          host: request.body.host,
          userId: requireUserId(request),
          can: (permission) => request.can(permission),
          ...(deps.addOns === undefined ? {} : { addOns: deps.addOns }),
        });
        return { facts: { values: setup.facts as never, scope: (await setup.adapter.pageFacts(setup.deps)).scope }, nextTurnTokens: estimateTokens(setup.system) };
      },
    );

    app.post(
      '/assistant/sessions/:id/turns',
      {
        preHandler: guard,
        config: {
          audit: auditExempt('a transcript row is the record; a turn reads and changes no state'),
          rateLimitBucket: 'assistant',
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
            reason: 'busy',
          });
        }
        // …and one at a time a PERSON, whichever conversation it is in: what the day's
        // allowance is held against is counted as it is spent, and turns opened at once
        // in several windows would each pass the same check.
        const live = await sessions.liveTurnOf(userId);
        if (live !== null) {
          throw new ConflictError('The assistant is still working on your last question.', 'CONFLICT', {
            sessionId: live.sessionId,
            turnId: live.id,
            reason: 'busy',
          });
        }
        const allowance = await readAllowance(meta, userId, app.rbac.now());
        if (!allowance.left) {
          throw new ConflictError('Today\'s allowance for the assistant is used up.', 'CONFLICT', {
            reason: 'budget',
            limit: allowance.limit,
            used: allowance.used,
            resetsAt: allowance.resetsAt,
          });
        }

        const at = app.rbac.now();
        const turn = await sessions.createTurn(
          {
            sessionId: session.id,
            askText: request.body.text ?? null,
            picks: request.body.picks ?? null,
            // The page the question is asked on. Without one it is the session's, and the turn says nothing.
            ...(request.body.context === undefined
              ? {}
              : {
                  context: request.body.context,
                  host: request.body.host ?? { connectionIds: [] },
                  ...(request.body.draft === undefined ? {} : { draft: request.body.draft }),
                }),
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
          turn: await served(stored, session),
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
        return await served(turn, session);
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
        // Only a turn that is still being worked on: one that has ended keeps what it ended as.
        if (turn.status === 'queued' || turn.status === 'running') {
          if (turn.jobId !== null) deps.cancelJob?.(turn.jobId);
          await sessions.finishTurn(turn.id, { status: 'cancelled', finishedAt: app.rbac.now(), expected: turn.status });
        }
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
        // A draft belongs to the page and the document it was made for. Pressed on another page,
        // or on another document of the same page (a new-template draft on some other template's
        // editor), it is refused: the page it belongs to is where it is used.
        const on = request.body.on;
        if (on !== undefined) {
          const madeOn = turn.context ?? session.context;
          const madeFor = (turn.context === null ? session.host : (turn.host ?? session.host)).documentId ?? null;
          if (on.context !== madeOn || (on.documentId ?? null) !== madeFor) {
            throw new ConflictError('That draft was made on another page.', 'CONFLICT', { reason: 'draft-elsewhere', context: madeOn, documentId: madeFor });
          }
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
                context: turn.context ?? session.context,
                host: turn.host ?? session.host,
                userId,
                can: (permission) => request.can(permission),
              })
            : undefined;
        const outcome = await runAssistantAction({
          meta,
          action: request.body.action as AssistantActionKind,
          // The page the DRAFT was made on. A conversation opened on one page and asked on
          // another would otherwise be saved by the first page's code.
          context: turn.context ?? session.context,
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

    // ── what an owner sets ───────────────────────────────────────────────────

    const manage = app.rbac.require(PERMISSIONS.settingsManage);

    async function settingsReply() {
      const at = app.rbac.now();
      const day = assistantUseDay(at);
      const people = [];
      for (const row of await assistantUseRepo(meta).listDay(day)) {
        const user = await usersRepo(meta).findById(row.userId);
        people.push({ userId: row.userId, name: user?.name ?? user?.email ?? row.userId, tokens: row.tokens, turns: row.turns });
      }
      const roles = [];
      for (const grant of await permissionsRepo(meta).listForResource('system', 'assistant.use')) {
        if ((grant.actions as { allowed?: boolean }).allowed !== true) continue;
        const role = await rolesRepo(meta).findById(grant.roleId);
        if (role !== null) roles.push({ id: role.id, name: role.name });
      }
      return {
        dailyTokens: await settings.get('assistant.dailyTokens'),
        today: { day, resetsAt: assistantUseResetsAt(at), people },
        roles,
      };
    }

    app.get(
      '/assistant/settings',
      { preHandler: manage, schema: { response: { 200: assistantSettingsReply } } },
      async () => settingsReply(),
    );

    app.put(
      '/assistant/settings',
      {
        preHandler: manage,
        config: { audit: audited('rbac') },
        schema: { body: assistantSettingsPutBody, response: { 200: assistantSettingsReply } },
      },
      async (request) => {
        const before = await settings.get('assistant.dailyTokens');
        const next = request.body.dailyTokens;
        if (before !== next) {
          await settings.set('assistant.dailyTokens', next, { updatedBy: requireUserId(request), at: app.rbac.now() });
          await app.rbac.audit(request, {
            category: 'settings',
            action: 'assistant.settings.update',
            changes: { before: { dailyTokens: before }, after: { dailyTokens: next } },
          });
        }
        return settingsReply();
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
