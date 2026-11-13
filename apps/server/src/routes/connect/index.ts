// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect Supabase": the instance's side of the operator hand-off
 * (`connect/handoff.ts` has the flow and why it is safe).
 *
 *  - `POST /connect/start`: a state bound to this session and user, and the
 *    operator's address to send the browser to. Audited.
 *  - `POST /connect/return`: the browser is back from the operator
 *    (`<origin>/connect/supabase/return?state=…&code=…`, read by the
 *    dashboard). The state is spent, the code redeemed server to server, the
 *    answer checked, and the connection made, tested and introspected as the
 *    connect wizard makes one. An existing project comes back without its
 *    password: the reply asks for it.
 *  - `POST /connect/complete`: that password, typed into THIS instance. A
 *    wrong one can be typed again while the answer is held.
 *
 * All three need a signed-in person (a session, never an API key) holding
 * `connections.manage`. Success and every refusal are audited by provider,
 * host and reason; never the connection string, never the password.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { MetaDb } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import type { Env } from '../../config/env.js';
import { createHandoffStore, type HandoffOwner, type HandoffStore } from '../../connect/handoff.js';
import { connectProviders, redeemUrl, startUrl, type ConnectProvider, type ConnectProviderId } from '../../connect/providers.js';
import { connectionDsn, ConnectExpiredError, ConnectRefusedError, redeem, type RedeemedConnection } from '../../connect/redeem.js';
import { runIntrospection } from '../../connections/introspect.js';
import { testOutcome, type ConnectionManager } from '../../connections/manager.js';
import { AppError, UnauthorizedError } from '../../errors.js';
import { linkOrigin } from '../../security/public-origin.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import {
  connectCompleteBody,
  connectResultReply,
  connectReturnBody,
  connectStartBody,
  connectStartReply,
  type ConnectResultReply,
} from './schema.js';

/** Where the operator sends the browser back to, under this instance's origin. */
export const CONNECT_RETURN_PATH = (provider: ConnectProviderId): string => `/connect/${provider}/return`;

const PROVIDER_LABEL: Readonly<Record<ConnectProviderId, string>> = { supabase: 'Supabase' };

export interface ConnectRoutesDeps {
  env: Pick<Env, 'ADMINIUM_SUPABASE_CONNECT_URL' | 'ADMINIUM_SECRET'>;
  manager: ConnectionManager;
  meta: MetaDb;
  /** Test seams. */
  store?: HandoffStore | undefined;
  redeemCa?: string | undefined;
  redeemTimeoutMs?: number | undefined;
  now?: (() => number) | undefined;
}

/** The session and user behind a request; an API key or no sign-in is refused. */
function ownerOf(request: FastifyRequest): HandoffOwner {
  if (request.session === null || request.user === null) throw new UnauthorizedError('UNAUTHENTICATED');
  return { sessionId: request.session.id, userId: request.user.id };
}

export function connectRoutes(deps: ConnectRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const providers = new Map(connectProviders(deps.env).map((provider) => [provider.id, provider] as const));
  const store = deps.store ?? createHandoffStore({ secret: deps.env.ADMINIUM_SECRET, ...(deps.now === undefined ? {} : { now: deps.now }) });

  return async (app) => {
    function providerOf(id: ConnectProviderId): ConnectProvider {
      const provider = providers.get(id);
      if (provider === undefined) throw new AppError(404, 'NOT_FOUND', `${PROVIDER_LABEL[id]} connections are not offered on this instance.`);
      return provider;
    }

    async function refused(request: FastifyRequest, provider: ConnectProviderId, error: unknown, host: string | null): Promise<void> {
      const reason =
        error instanceof ConnectExpiredError
          ? 'expired'
          : error instanceof ConnectRefusedError
            ? String((error.details as { reason?: unknown }).reason ?? 'refused')
            : error instanceof AppError
              ? error.code.toLowerCase()
              : 'error';
      await app.rbac.audit(request, {
        category: 'connection',
        action: 'connection.handoff.refused',
        changes: { after: { provider, reason, ...(host === null ? {} : { host }) } },
      });
    }

    /**
     * Test, create, introspect: what the connect wizard does with a string
     * somebody typed, with one built from the operator's checked fields.
     */
    async function land(request: FastifyRequest, provider: ConnectProviderId, answer: RedeemedConnection, password: string | undefined): Promise<ConnectResultReply> {
      const dsn = connectionDsn(answer, password);
      const name = answer.project ?? PROVIDER_LABEL[provider];
      // A trial connects a few databases at most: counted and created one request at a time.
      const { connection, summary } = await manager.withRoomForSource(async () => {
        // The guard runs here: ADMINIUM_DATABASE_HOSTS, the network policy, the host's lookup.
        const tested = await manager.testDsn('postgres', dsn);
        if (!tested.ok) {
          throw new AppError(502, 'SOURCE_DB_UNREACHABLE', tested.error?.message ?? 'The database did not answer.', {
            adapterCode: tested.error?.code ?? 'UNKNOWN',
            hint: tested.error?.hint ?? null,
          });
        }
        manager.enforceMetaPlacement(dsn, tested);
        const created = await manager.connections.create({
          name,
          engine: 'postgres',
          sourceKind: 'dsn',
          introspectDsn: dsn,
          dataDsn: null,
          readOnly: tested.readOnly,
          settings: {},
          status: 'connected',
          createdBy: request.user?.id ?? null,
        });
        return { connection: created, summary: tested };
      });
      await manager.connections.recordTestResult(connection.id, testOutcome(summary));
      await app.rbac.audit(request, {
        category: 'connection',
        action: 'connection.create',
        connectionId: connection.id,
        changes: { after: { name, engine: 'postgres', host: answer.host, via: provider, ok: true, readOnly: summary.readOnly } },
      });
      await app.rbac.audit(request, {
        category: 'connection',
        action: 'connection.handoff.success',
        connectionId: connection.id,
        changes: { after: { provider, host: answer.host, project: answer.project ?? null, password: password === undefined ? 'none' : 'given' } },
      });
      // The wizard reads the schema next; reading it here means a person who closes the tab still has a usable connection.
      let introspected = false;
      try {
        await runIntrospection({ manager, meta, connectionId: connection.id, createdBy: request.user?.id ?? null });
        introspected = true;
      } catch {
        // The wizard's own analyze step reads it again and says what went wrong.
      }
      return { status: 'connected', connection: { id: connection.id, name, engine: 'postgres', readOnly: summary.readOnly, introspected } };
    }

    app.post(
      '/connect/start',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        config: { audit: audited('rbac'), rateLimitBucket: 'connect-handoff' },
        schema: { body: connectStartBody, response: { 200: connectStartReply } },
      },
      async (request) => {
        const owner = ownerOf(request);
        const provider = providerOf(request.body.provider);
        // The origin the operator sends the browser back to: the stored public origin, else this request's own
        // scheme and host (never its Origin header). The operator must send it to the origin IT registered (S14).
        const instance = await linkOrigin(meta, request);
        const { state, challenge } = store.start(provider.id, owner);
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.handoff.start',
          changes: { after: { provider: provider.id } },
        });
        return { redirectUrl: startUrl(provider, { instance, state, challenge }) };
      },
    );

    app.post(
      '/connect/return',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        config: { audit: audited('rbac'), rateLimitBucket: 'connect-handoff' },
        schema: { body: connectReturnBody, response: { 200: connectResultReply } },
      },
      async (request) => {
        const owner = ownerOf(request);
        const providerId = request.body.provider;
        let host: string | null = null;
        try {
          const provider = providerOf(providerId);
          const taken = store.take(provider.id, request.body.state, owner);
          if (!taken.ok) throw new ConnectExpiredError();
          const answer = await redeem({
            url: redeemUrl(provider),
            code: request.body.code,
            verifier: taken.value.verifier,
            // The operator's own address, set in the environment like ADMINIUM_DATABASE_HOSTS: checked and pinned,
            // cloud metadata always refused, a name that does not resolve refused. Loopback and the server's own
            // network are not: those rules are for addresses people type, and an operator's service may run beside it.
            policy: { blockLoopback: false, blockPrivate: false, lookup: manager.outboundPolicy.lookup },
            ca: deps.redeemCa,
            ...(deps.redeemTimeoutMs === undefined ? {} : { timeoutMs: deps.redeemTimeoutMs }),
          });
          host = answer.host;
          if (answer.password === undefined) {
            // The host is held to the database guard now, not after the person has typed a password for it.
            await manager.checkDsnAllowed(connectionDsn(answer, undefined), 'postgres');
            const pendingId = store.hold(provider.id, owner, answer);
            return { status: 'needs-password' as const, pendingId, project: answer.project ?? null };
          }
          return await land(request, provider.id, answer, answer.password);
        } catch (error) {
          await refused(request, providerId, error, host);
          throw error;
        }
      },
    );

    app.post(
      '/connect/complete',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        config: { audit: audited('rbac'), rateLimitBucket: 'connect-handoff' },
        schema: { body: connectCompleteBody, response: { 200: connectResultReply } },
      },
      async (request) => {
        const owner = ownerOf(request);
        const held = store.pending(request.body.pendingId, owner);
        if (!held.ok) {
          const error = new ConnectExpiredError();
          await refused(request, 'supabase', error, null);
          throw error;
        }
        const { provider, answer } = held.value;
        try {
          const result = await land(request, provider, answer, request.body.password);
          store.drop(request.body.pendingId);
          return result;
        } catch (error) {
          // Held still: a mistyped password is typed again, not fetched again.
          await refused(request, provider, error, answer.host);
          throw error;
        }
      },
    );
  };
}
