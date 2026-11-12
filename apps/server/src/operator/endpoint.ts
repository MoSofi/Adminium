// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator endpoint: what the server's operator (whoever runs this
 * instance for its owner) asks of it and tells it, on a listener of its own.
 *
 *   GET  /api/v1/operator/status          totals: disk, mail, AI, sign-ins (`operator/status.ts`)
 *   POST /api/v1/operator/public-pages    hide or show every public page, with a reason
 *   GET  /api/v1/operator/public-content  what the instance serves to anybody (`operator/public-content.ts`)
 *
 * ── A LISTENER OF ITS OWN ──────────────────────────────────────────────────
 * `ADMINIUM_OPERATOR_LISTEN=<address>:<port>`, an address on the operator's
 * network, never every address. The routes are a second Fastify instance's,
 * sharing the server's services (the meta store, the holds, the surfaces) but
 * none of its routes, hooks or cookies:
 *
 *  - the public listener cannot answer `/api/v1/operator/*`: it has no such
 *    route, not a hook that refuses it, so no later hook or plugin can let one
 *    through. A proxy in front of the public listener refuses the path too;
 *  - this listener answers nothing else: no dashboard, no session, no host
 *    gate. The control service calls it by address, so the 421 the public
 *    listener answers to an unknown `Host` does not apply here, and nothing
 *    about the public listener's gate was loosened to make that so.
 *
 * Both share one process and one lifetime: this listener starts after the
 * public one is listening and closes with it.
 *
 * ── THE TOKEN ──────────────────────────────────────────────────────────────
 * Bearer `ADMINIUM_OPERATOR_TOKEN` (32 random bytes or more), held out of
 * `process.env` by `config/operator-secrets.ts`. Without it the endpoint is
 * not built at all. Compared in constant time (both sides hashed first, so
 * the length says nothing either); an address that sends a wrong one
 * {@link FAILURES_ALLOWED} times is answered 429 until its window passes,
 * before its token is even looked at.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

import { fastify, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditRepo, OPERATOR_HOLD_REASON_WIDTH, type MetaDb, type StoredFile } from '@adminium/meta';

import { resolveLogoFile } from '../branding/service.js';
import { AppError, errorEnvelope } from '../errors.js';
import type { HiddenPageLogo, OperatorHolds } from './holds.js';
import type { OperatorStatus } from './status.js';
import type { PublicContent } from './public-content.js';

export const OPERATOR_PREFIX = '/api/v1/operator';

/** Wrong tokens from one address within {@link FAILURE_WINDOW_MS} before it is refused unheard. */
export const FAILURES_ALLOWED = 10;
export const FAILURE_WINDOW_MS = 10 * 60_000;
/** Requests from one address in a minute, right token or not. */
export const REQUESTS_PER_MINUTE = 120;

/** Who the audit log says changed a hold. */
export const OPERATOR_ACTOR_LABEL = 'Server operator';

export interface OperatorEndpointDeps {
  meta: MetaDb;
  /** The bearer token; the endpoint is not built without one. */
  token: string;
  holds: OperatorHolds;
  status: () => Promise<OperatorStatus>;
  publicContent: () => Promise<PublicContent>;
  logger: FastifyBaseLogger;
  now?: () => number;
}

const holdView = z.object({ hidden: z.boolean(), reason: z.string().nullable(), changedAt: z.number().nullable() });

const statusReply = z.object({
  data: z.object({
    at: z.number(),
    storage: z.object({ dataDir: z.number().nullable(), files: z.number(), projectFolder: z.number().nullable() }),
    emails: z.object({ today: z.number().nullable(), thisHour: z.number().nullable() }),
    superAdminSignIns: z.array(z.object({ at: z.number(), ip: z.string().nullable() })),
    lastSignInAt: z.number().nullable(),
    operatorAiTokens: z.number().nullable(),
    publicPages: holdView,
  }),
});

const publicPagesBody = z
  .object({
    hidden: z.boolean(),
    /** Shown to the instance's owner in Studio while the pages are hidden. */
    reason: z.string().trim().min(1).max(OPERATOR_HOLD_REASON_WIDTH).optional(),
  })
  .strict()
  .refine((body) => !body.hidden || body.reason !== undefined, { message: 'A reason is required to hide the public pages.', path: ['reason'] });

const publicFile = z.object({ path: z.string(), bytes: z.number(), sha256: z.string(), text: z.string().optional(), truncated: z.boolean().optional() });
const publicContentReply = z.object({
  data: z.object({
    at: z.number(),
    sides: z.array(z.object({ appKey: z.string(), path: z.string(), files: z.array(publicFile), truncated: z.boolean() })),
    forms: z.array(z.object({ slug: z.string(), addOn: z.string(), form: z.unknown() })),
  }),
});

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Whether `given` is the token, in time that does not depend on how much of it was right. */
export function tokenMatches(given: string, token: string): boolean {
  return timingSafeEqual(digest(given), digest(token));
}

interface Window {
  start: number;
  count: number;
}

/** Counts per address in fixed windows; forgets an address once its window has passed. */
function counter(windowMs: number, now: () => number) {
  const windows = new Map<string, Window>();
  const current = (key: string): Window => {
    const at = now();
    let window = windows.get(key);
    if (window === undefined || at - window.start >= windowMs) {
      // Old windows go as new ones open, so the map holds only the addresses heard from lately.
      for (const [other, seen] of windows) if (at - seen.start >= windowMs) windows.delete(other);
      window = { start: at, count: 0 };
      windows.set(key, window);
    }
    return window;
  };
  return {
    count: (key: string): number => current(key).count,
    add: (key: string): number => (current(key).count += 1),
    retryAfter: (key: string): number => Math.max(1, Math.ceil((current(key).start + windowMs - now()) / 1000)),
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The operator endpoint's listener, or null where it is not set up (`operator/endpoint.ts`). */
    operatorEndpoint: OperatorListener | null;
  }
}

export interface OperatorListener {
  /** The endpoint's own server, for a test to `inject` into. */
  server: FastifyInstance;
  host: string;
  port: number;
  /** Start listening; the public listener calls it once it listens itself. */
  listen(): Promise<void>;
}

export function operatorListener(server: FastifyInstance, address: { host: string; port: number }): OperatorListener {
  return {
    server,
    host: address.host,
    port: address.port,
    listen: async () => {
      await server.listen({ host: address.host, port: address.port });
      server.log.info({ host: address.host, port: address.port }, 'operator endpoint listening');
    },
  };
}

/** The largest logo the hidden page carries inline; a bigger one is left out, the name stays. */
export const HIDDEN_PAGE_LOGO_MAX_BYTES = 256 * 1024;

/** The instance's logo, read once per stored file, for the page a hidden public page answers with. */
export function hiddenPageLogoReader(meta: MetaDb, storage: { read(file: StoredFile): Promise<Readable> }): () => Promise<HiddenPageLogo | null> {
  let kept: { id: string; logo: HiddenPageLogo | null } | null = null;
  return async () => {
    const file = await resolveLogoFile(meta);
    if (file === null) return null;
    if (kept?.id === file.id) return kept.logo;
    let logo: HiddenPageLogo | null = null;
    if (file.sizeBytes <= HIDDEN_PAGE_LOGO_MAX_BYTES && /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/.test(file.mime)) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of await storage.read(file)) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        size += bytes.length;
        if (size > HIDDEN_PAGE_LOGO_MAX_BYTES) return null;
        chunks.push(bytes);
      }
      logo = { mime: file.mime, bytes: Buffer.concat(chunks) };
    }
    kept = { id: file.id, logo };
    return logo;
  };
}

/** The operator endpoint's own server: not listening yet. */
export async function buildOperatorEndpoint(deps: OperatorEndpointDeps): Promise<FastifyInstance> {
  const now = deps.now ?? Date.now;
  const failures = counter(FAILURE_WINDOW_MS, now);
  const requests = counter(60_000, now);

  const app = fastify({
    loggerInstance: deps.logger,
    // Requests come from the operator's network, by address: no proxy, no forwarded header believed.
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => `req_${randomBytes(4).toString('hex')}`,
    forceCloseConnections: true,
    bodyLimit: 16 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode === 429) void reply.header('retry-after', String((error.details as { retryAfter: number }).retryAfter));
      return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, request.id, error.statusCode === 429 ? undefined : error.details));
    }
    if (Array.isArray(error.validation) && error.validation.length > 0) {
      return reply.status(422).send(errorEnvelope('VALIDATION_FAILED', `Request ${error.validationContext ?? 'input'} failed validation.`, request.id, { issues: error.validation.map((issue) => ({ path: issue.instancePath, message: issue.message })) }));
    }
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, 'operator endpoint: unhandled error');
    const code = status === 500 ? 'INTERNAL' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
    return reply.status(status).send(errorEnvelope(code, status === 500 ? 'Something went wrong.' : error.message, request.id));
  });
  app.setNotFoundHandler((request, reply) => reply.status(404).send(errorEnvelope('NOT_FOUND', 'Nothing is served at this address.', request.id)));

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id).header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow');
  });

  // The token, before anything else: a wrong one counts against its address, which is refused unheard once it is spent.
  app.addHook('onRequest', async (request, reply) => {
    const from = request.ip;
    if (requests.add(from) > REQUESTS_PER_MINUTE) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', { retryAfter: requests.retryAfter(from) });
    if (failures.count(from) >= FAILURES_ALLOWED) throw new AppError(429, 'RATE_LIMITED', 'Too many wrong tokens from this address. Try again later.', { retryAfter: failures.retryAfter(from) });
    const header = request.headers.authorization;
    const given = typeof header === 'string' && /^bearer /i.test(header) ? header.slice('bearer '.length).trim() : '';
    if (given !== '' && tokenMatches(given, deps.token)) return;
    failures.add(from);
    request.log.warn({ ip: from, path: request.url.split('?')[0] }, 'operator endpoint: wrong or missing token');
    void reply.header('www-authenticate', 'Bearer');
    throw new AppError(401, 'UNAUTHENTICATED', 'The operator token is missing or wrong.');
  });

  await app.register(
    async (scope) => {
      const operator = scope.withTypeProvider<ZodTypeProvider>();
      operator.get('/status', { schema: { response: { 200: statusReply } } }, async () => ({ data: await deps.status() }));

      operator.post('/public-pages', { schema: { body: publicPagesBody, response: { 200: z.object({ data: holdView }) } } }, async (request) => {
        const before = deps.holds.publicPages();
        const after = await deps.holds.setPublicPages({ hidden: request.body.hidden, reason: request.body.reason ?? null }, now());
        await auditRepo(deps.meta).append({
          actorKind: 'system',
          actorLabel: OPERATOR_ACTOR_LABEL,
          category: 'system',
          action: after.hidden ? 'operator.public_pages.hidden' : 'operator.public_pages.shown',
          changes: { before: { hidden: before.hidden, reason: before.reason }, after: { hidden: after.hidden, reason: after.reason } },
          ip: request.ip,
          requestId: request.id,
        });
        return { data: after };
      });

      operator.get('/public-content', { schema: { response: { 200: publicContentReply } } }, async () => ({ data: await deps.publicContent() }));
    },
    { prefix: OPERATOR_PREFIX },
  );

  return app;
}
