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

import type { AddOnInstalls } from '../../apps/table-ref.js';
import type { AiConnections } from '../../llm/connections.js';
import { estimateTokens } from '@adminium/llm';
import {
  assistantSessionsRepo,
  assistantUseDay,
  assistantUseRepo,
  assistantUseResetsAt,
  jobsRepo,
  pagesRepo,
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

import { assistantDocumentExists, runAssistantAction } from '../../assistant/actions.js';
import { dataPageOf } from '../../assistant/data-page.js';
import { applyProposal, checkProposal, proposalView, storedProposalOf } from '../../assistant/proposals.js';
import { viewOrError } from '../../assistant/tools/schema.js';
import { readAllowance } from '../../assistant/allowance.js';
import { listedAddOns } from '../../assistant/tools/add-ons.js';
import type { AssistantAddOn, AssistantToolDeps } from '../../assistant/types.js';
import { setUpTurn, toolDepsFor } from '../../assistant/turn-setup.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { ASSISTANT_TURN_KIND } from '../../jobs/assistant-turn.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { isUniqueViolation } from '../../crud/decided-columns.js';
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
  ASSISTANT_MAX_ROWS_CEILING,
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
  /** What is installed where: a draft rule is checked against the steps add-ons give. */
  installs?: (() => Promise<AddOnInstalls>) | undefined;
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
/** How long after a conversation was closed for its age the panel still says so. */
const AGED_NOTE_MS = 7 * 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

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
    answer: answerView(turn.answer),
    on: whereAsked(turn, session),
  };
}

/**
 * A turn's answer as a reader is given it. A proposal that has not been
 * checked is the model's own text: only the fact of it is told.
 */
function answerView(answer: unknown): Record<string, unknown> | null {
  const record = asRecord(answer);
  if (record === null || record.proposal === undefined) return record;
  const stored = storedProposalOf(record);
  const { proposal: _stored, ...rest } = record;
  return stored === null ? rest : { ...rest, proposal: proposalView(stored) };
}

/** The one key column of the table a turn's page shows, to name a row a confirm made; absent when there is not exactly one. */
async function keyColumnOf(deps: AssistantToolDeps): Promise<string | undefined> {
  const page = await dataPageOf(deps);
  if (page === null || page.connectionId === null || page.table === null) return undefined;
  const found = await viewOrError(deps, page.connectionId);
  if ('error' in found) return undefined;
  try {
    const key = found.view.table(page.table).primaryKey;
    return key.length === 1 ? key[0] : undefined;
  } catch {
    return undefined;
  }
}

/** The page or document a turn was asked on. The title is filled as the turn is served. */
function whereAsked(turn: AssistantTurn, session: AssistantSession): AssistantTurnView['on'] {
  const host = turn.host ?? session.host;
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
  const view = host.view;
  const ticked = view?.selectedIds?.length ?? 0;
  const scope: AssistantTurnView['on']['scope'] =
    view === undefined
      ? null
      : ticked > 0
        ? { kind: 'selection', count: ticked }
        : text(view.recordId) !== null
          ? { kind: 'record', count: 1 }
          : text(view.q) !== null || text(view.where) !== null
            ? { kind: 'page', count: null }
            : null;
  return { pageId: text(host.pageId), documentId: text(host.documentId), title: null, scope, gone: false };
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
    /**
     * The title of the data page a turn was asked on, as the page is called NOW. A page that is
     * gone leaves no title, and the thread then names the turn by its context alone. Not checked
     * against the reader's grants: the turn is their own, asked while they were on that page.
     */
    async function titled(view: AssistantTurnView, request: { can: (permission: string) => Promise<boolean> }): Promise<AssistantTurnView> {
      // A draft made for a document (an editor's) whose document has since been deleted.
      if (view.result !== null && view.on.documentId !== null && !(await assistantDocumentExists(deps.meta, view.context, view.on.documentId))) {
        view = { ...view, on: { ...view.on, gone: true } };
      }
      if (view.on.pageId === null) return view;
      // The page id is what the browser said: its name is told only to a reader who may open
      // that page, by the page's own view check. Anyone else is told the turn's context alone.
      const pageId = view.on.pageId;
      if (!(await request.can(`page:${pageId}:view`)) && !(await request.can('system:pages:manage'))) return view;
      const page = await pagesRepo(deps.meta).findById(pageId);
      return page === null ? view : { ...view, on: { ...view.on, title: page.title } };
    }

    async function served(turn: AssistantTurn, session: AssistantSession, request: { can: (permission: string) => Promise<boolean> }): Promise<AssistantTurnView> {
      const view = await titled(turnView(turn, session), request);
      const suggest = view.answer === null ? undefined : view.answer.suggest;
      if (!Array.isArray(suggest) || suggest.length === 0) return view;
      const known = (await listedAddOns(deps.addOns)) ?? [];
      // Whether THIS person may install one: the card offers the way in only to them.
      const mayInstall = await request.can(PERMISSIONS.manifestsManage);
      const cards: { key: string; name: string; line: string; mayInstall: boolean }[] = [];
      for (const entry of suggest) {
        const key = (entry as { key?: unknown } | null)?.key;
        const found = typeof key === 'string' ? known.find((item) => item.key === key && item.state !== 'installed') : undefined;
        if (found !== undefined) cards.push({ key: found.key, name: found.name, line: found.line, mayInstall });
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
          abilities: await settings.get('assistant.abilities'),
          maxRows: await settings.get('assistant.maxRows'),
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
        if (session === null) {
          // Closed by the sweep for its age, lately: the one way a conversation ends without the person ending it.
          const last = await sessions.lastClosedPanelOf(userId);
          const days = await settingsRepo(deps.meta).get('retention.assistantSessionsDays');
          const now = Date.now();
          const aged =
            last !== null &&
            last.closedAt !== null &&
            now - last.closedAt < AGED_NOTE_MS &&
            last.closedAt - last.createdAt >= days * DAY_MS;
          return { session: null, turns: [], earlier: 0, aged };
        }
        const tail = await sessions.listTurnsTail(session.id, CURRENT_TURNS);
        const shown = tail.turns;
        const turns: AssistantTurnView[] = [];
        for (const [index, turn] of shown.entries()) {
          const view = await served(turn, session, request);
          // The newest come whole. An older draft comes as its card's words; its document is the
          // heavy part and is read with the turn when the person opens it.
          const light = index < shown.length - CURRENT_WHOLE_TURNS && view.result !== null;
          turns.push(light ? { ...view, result: lightResult(view.result as Record<string, unknown>) } : view);
        }
        return { session: sessionView(session), turns, earlier: tail.earlier, aged: false };
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
          ...(deps.installs === undefined ? {} : { installs: deps.installs }),
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
          throw new ConflictError('That assistant session is closed.', 'CONFLICT', { sessionId: session.id, reason: 'closed' });
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
        // The checks above are made before the row: two questions posted in the same instant
        // both pass them. In one conversation the second then clashes on the turn's number, and
        // that is the same answer as arriving a moment later: busy.
        const turn = await sessions
          .createTurn(
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
          )
          .catch((error: unknown) => {
            if (!isUniqueViolation(error)) throw error;
            throw new ConflictError('The assistant is still working on the last question.', 'CONFLICT', { sessionId: session.id, reason: 'busy' });
          });
        const job = await jobsRepo(meta)
          .enqueue(
            {
              kind: ASSISTANT_TURN_KIND,
              // The owner convention: the acting user may follow `jobs:<id>`
              // without holding the read-everyone's-jobs key.
              payload: { turnId: turn.id, userId },
            },
            at,
          )
          .catch(async (error: unknown) => {
            // A turn with no job behind it would wait for ever, and "one question at a time"
            // would then refuse this person everything: it ends here, as a failure.
            await sessions
              .finishTurn(turn.id, { status: 'failed', error: { kind: 'setup', message: 'The question could not be queued.' }, finishedAt: at, expected: 'queued' })
              .catch(() => undefined);
            throw error;
          });
        // Only while it is still waiting: a worker that has already taken it is not put back.
        await sessions.setTurnStatus(turn.id, 'queued', { jobId: job.id, expected: 'queued' });

        const stored = (await sessions.findTurn(turn.id)) ?? turn;
        return await reply.status(202).send({
          turn: await served(stored, session, request),
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
        return await served(turn, session, request);
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
        if (request.body.action === 'check' || request.body.action === 'apply') {
          const stored = storedProposalOf(turn.answer);
          if (turn.status !== 'done' || stored === null) {
            throw new ValidationFailedError('That turn proposed nothing.', { turnId: turn.id });
          }
          const tail = await sessions.listTurnsTail(session.id, 1);
          // The page the proposal was made on, and the person asking now.
          const toolDeps = await toolDepsFor({
            meta,
            manager: deps.manager,
            context: turn.context ?? session.context,
            host: turn.host ?? session.host,
            userId,
            can: (permission) => request.can(permission),
          });
          const checking = {
            request,
            door: app.assistantDoor,
            meta,
            deps: toolDeps,
            sessionId: session.id,
            turnId: turn.id,
            proposal: stored,
            newest: tail.turns.at(-1)?.id === turn.id,
            now: app.rbac.now(),
            artefact: asRecord(asRecord(turn.result)?.artefact),
          };
          const answer = asRecord(turn.answer) ?? {};
          if (request.body.action === 'check') {
            const checked = await checkProposal(checking);
            // Not written when a confirm took it meanwhile: the stored copy is then the confirm's.
            if (checked.changed) await sessions.recordAnswer(turn.id, { ...answer, proposal: checked.proposal });
            return { proposal: proposalView(checked.proposal) };
          }
          if (request.body.hash === undefined) {
            throw new ValidationFailedError('A confirm names the proposal it confirms.', { fields: { hash: { code: 'required' } } });
          }
          const applied = await applyProposal({
            ...checking,
            store: sessions,
            answer,
            hash: request.body.hash,
            pick: request.body.pick,
            keyColumn: await keyColumnOf(toolDeps),
            // The same save the draft card's button runs, by the page the draft was made on.
            saveDraft: async () => {
              const artefact = asRecord(asRecord(turn.result)?.artefact);
              if (artefact === null) return null;
              const principal = (request as unknown as { user?: { name?: string; email?: string } }).user;
              const saved = await runAssistantAction({
                meta,
                action: 'save',
                context: turn.context ?? session.context,
                artefact,
                sessionId: session.id,
                turnId: turn.id,
                actor: { kind: 'user', id: userId, label: principal?.name ?? principal?.email ?? userId },
                can: (permission) => request.can(permission),
                ...(deps.secret === undefined ? {} : { secret: deps.secret }),
                logger: request.log,
                now: () => app.rbac.now(),
              });
              return saved.created === undefined ? null : { id: saved.created.id };
            },
          });
          return { proposal: proposalView(applied.proposal), undo: applied.handOver.undo, once: applied.handOver.once };
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

        // Saving a draft as a document, and adding a language of one, are the assistant creating
        // something: both stand under the workspace's Create switch. A test mail to oneself and a
        // re-run of the sample write nothing and stay outside it.
        if (request.body.action === 'save' || request.body.action === 'language.add') {
          const abilities = await settingsRepo(meta).get('assistant.abilities');
          if (!abilities.create) {
            throw new ForbiddenError('Saving is switched off for the assistant in this workspace.', 'FORBIDDEN', { reason: 'assistant-switched-off', ability: 'create' });
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
          action: request.body.action,
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
        abilities: await settings.get('assistant.abilities'),
        maxRows: await settings.get('assistant.maxRows'),
        maxRowsCeiling: ASSISTANT_MAX_ROWS_CEILING,
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
        const by = { updatedBy: requireUserId(request), at: app.rbac.now() };
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const body = request.body;
        if (body.dailyTokens !== undefined) {
          const held = await settings.get('assistant.dailyTokens');
          if (held !== body.dailyTokens) {
            await settings.set('assistant.dailyTokens', body.dailyTokens, by);
            before.dailyTokens = held;
            after.dailyTokens = body.dailyTokens;
          }
        }
        if (body.abilities !== undefined) {
          // A switch that is not named keeps its state: turning one on never moves another.
          const held = await settings.get('assistant.abilities');
          const next = { ...held, ...Object.fromEntries(Object.entries(body.abilities).filter(([, value]) => value !== undefined)) };
          if (JSON.stringify(held) !== JSON.stringify(next)) {
            await settings.set('assistant.abilities', next, by);
            before.abilities = held;
            after.abilities = next;
          }
        }
        if (body.maxRows !== undefined) {
          const held = await settings.get('assistant.maxRows');
          if (held !== body.maxRows) {
            await settings.set('assistant.maxRows', body.maxRows, by);
            before.maxRows = held;
            after.maxRows = body.maxRows;
          }
        }
        // One entry for what really changed, with what it was: who let the assistant write is on record.
        if (Object.keys(after).length > 0) {
          await app.rbac.audit(request, { category: 'settings', action: 'assistant.settings.update', changes: { before, after } });
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
