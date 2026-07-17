/**
 * `buildServer()` — the Fastify 5 application skeleton (08-server-api.md §1,
 * M2-T01). Assembles: pino logger with the §1.3 redaction set, `req_`-prefixed
 * request ids echoed as `x-request-id`, fastify-type-provider-zod compilers,
 * the global §1.4 error envelope, the core/static plugins, and the `/api/v1`
 * route tree. Wave 1 boots with no meta DB configured — auth/meta wiring is
 * wave 2 (01-architecture.md §8.1 gates arrive with it).
 */
import { randomBytes } from 'node:crypto';

import { fastify, type FastifyBaseLogger, type FastifyError, type FastifyRequest } from 'fastify';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { MetaDb } from '@adminium/meta';

import { hashPassword } from './auth/passwords.js';
import { loadEnv, type Env } from './config/env.js';
import { AppError, errorEnvelope } from './errors.js';
import { scrubUrlForLog } from './log-scrub.js';
import { authPlugin, type PasswordResetDelivery } from './plugins/auth.js';
import { corePlugin } from './plugins/core.js';
import { staticPlugin } from './plugins/static.js';
import { createSetupService } from './setup/service.js';
import { createUpdateCheckService } from './telemetry/update-check.js';
import { API_PREFIX, registerRoutes } from './routes/index.js';
import { aboutRoutes } from './routes/about/index.js';
import { authRoutes } from './routes/auth/index.js';
import { bootstrapRoutes } from './routes/bootstrap/index.js';
import { meRoutes } from './routes/me/index.js';
import { setupRoutes } from './routes/setup/index.js';
import { APP_VERSION } from './version.js';

/** Pino deny-by-path redaction set (08-server-api.md §1.3 + ADMINIUM_SECRET). */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'ADMINIUM_SECRET',
  '*.ADMINIUM_SECRET',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.dsn',
  '*.connectionString',
  '*.smtpUrl',
  // 11-electron.md §2.2 step 4: the desktop per-boot token. `*.token` above does
  // not match `bootToken` — pino paths are field names, not substrings — and the
  // field travels in this product (the §5 exchange body). The QUERY-STRING half
  // of the same secret is `log-scrub.ts`'s job; paths cannot reach into a string.
  '*.bootToken',
  'ADMINIUM_BOOT_TOKEN',
  '*.ADMINIUM_BOOT_TOKEN',
];

export interface BuildLoggerOptions {
  /** Force pino-pretty on/off; default: dev (`NODE_ENV !== 'production'`) on a TTY. */
  pretty?: boolean | undefined;
  /** Test seam: write to a capturing stream instead of stdout. */
  stream?: DestinationStream | undefined;
}

/**
 * The `req` serializer, which REPLACES Fastify's default one.
 *
 * Fastify merges the serializers off a supplied `loggerInstance` OVER its own
 * (`lib/logger-pino.js`: `Object.assign({}, opts.serializers, prevLogger[serializersSym])`),
 * so defining `req` here wins — and therefore has to reproduce the default's
 * shape, or every request line in the product silently loses fields. It is the
 * default, verbatim, with the one change this exists for: {@link scrubUrlForLog}
 * on the url. Deliberately still no `headers` — the fields below are the whole
 * contract, and `REDACT_PATHS` covers the header paths for anyone who logs `req`
 * by hand.
 */
function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: scrubUrlForLog(request.url),
    version: request.headers['accept-version'],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}

/** Structured pino logger: level from env, §1.3 redaction, pretty in dev. */
export function buildLogger(env: Env, opts: BuildLoggerOptions = {}): Logger {
  const pretty =
    opts.pretty ?? (process.env.NODE_ENV !== 'production' && Boolean(process.stdout.isTTY));
  const options: LoggerOptions = {
    level: env.ADMINIUM_LOG_LEVEL,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    serializers: { req: serializeRequest },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  };
  return opts.stream === undefined ? pino(options) : pino(options, opts.stream);
}

/** Maps residual (non-AppError) status codes to §1.4 canonical codes. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'VALIDATION_FAILED',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Normalizes Fastify's `error.validation` entries (ZodFastifySchemaValidation
 * errors from fastify-type-provider-zod) into `{ path, message, code }` field
 * details for the 422 envelope, without coupling to the provider's internals.
 */
function mapValidationIssues(validation: readonly unknown[]): ValidationIssue[] {
  return validation.map((entry) => {
    const raw = entry as {
      instancePath?: unknown;
      message?: unknown;
      keyword?: unknown;
      params?: { issue?: { path?: unknown; code?: unknown; message?: unknown } };
    };
    const zodIssue = raw.params?.issue;
    const zodPath = zodIssue?.path;
    let path = '';
    if (Array.isArray(zodPath) && zodPath.length > 0) {
      path = zodPath.map(String).join('.');
    } else if (typeof raw.instancePath === 'string') {
      path = raw.instancePath.replace(/^\//, '').replaceAll('/', '.');
    }
    const message =
      typeof raw.message === 'string'
        ? raw.message
        : typeof zodIssue?.message === 'string'
          ? zodIssue.message
          : 'Invalid value';
    const code =
      typeof zodIssue?.code === 'string'
        ? zodIssue.code
        : typeof raw.keyword === 'string'
          ? raw.keyword
          : 'invalid';
    return { path, message, code };
  });
}

export interface BuildServerOptions {
  /** Pre-validated environment; defaults to `loadEnv()` on `process.env`. */
  env?: Env | undefined;
  /** `false` silences logging (tests); a pino instance overrides `buildLogger`. */
  logger?: boolean | Logger | undefined;
  /**
   * Directory containing a dashboard build (`index.html`). Served with an SPA
   * fallback when present; cleanly skipped when absent (dashboard ships M4).
   */
  staticRoot?: string | undefined;
  /**
   * Include real messages in 500 envelopes. Default: `NODE_ENV !== 'production'`.
   * In production the message is generic; the stack goes to the log under the
   * same requestId (the §1.4 support handshake).
   */
  exposeInternalErrors?: boolean | undefined;
  /**
   * Connected meta store (07-meta-store.md). When absent the server still
   * boots (wave-1 behavior) and auth/me routes answer 503 META_NOT_CONFIGURED.
   */
  metaDb?: MetaDb | undefined;
  /** Delivery hook for password-reset tokens (email transport lands later). */
  onPasswordResetToken?: ((delivery: PasswordResetDelivery) => void) | undefined;
}

/**
 * Builds the configured Fastify instance. Does not listen — `start()` does.
 * Boots without any database configured (meta wiring lands in wave 2).
 */
export async function buildServer(opts: BuildServerOptions = {}) {
  const env = opts.env ?? loadEnv();
  const exposeInternalErrors = opts.exposeInternalErrors ?? process.env.NODE_ENV !== 'production';
  const loggerInstance: FastifyBaseLogger =
    opts.logger === false
      ? pino({ level: 'silent' })
      : typeof opts.logger === 'object'
        ? opts.logger
        : buildLogger(env);

  const app = fastify({
    loggerInstance,
    // §1.3: `req_` + 8 lowercase hex chars, e.g. req_8f2a91cd.
    genReqId: () => `req_${randomBytes(4).toString('hex')}`,
    // An inbound x-request-id is honored only behind a trusted proxy (§1.3).
    requestIdHeader: env.ADMINIUM_TRUST_PROXY ? 'x-request-id' : false,
    trustProxy: env.ADMINIUM_TRUST_PROXY,
    bodyLimit: 1_048_576, // 1 MiB JSON; multipart gets its own limits (§3.10)
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Every /api route must declare a schema — no untyped routes (§1.1, 08-T01).
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!route.url.startsWith('/api/')) return;
    if (methods.every((method) => method === 'HEAD' || method === 'OPTIONS')) return;
    if (route.schema === undefined) {
      throw new Error(
        `route ${methods.join(',')} ${route.url} registered without a schema (08-server-api.md §1.1)`,
      );
    }
  });

  // The request id is echoed on every response (§1.3).
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  // Global §1.4 error envelope.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      void reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, requestId, error.details));
      return;
    }

    if (Array.isArray(error.validation) && error.validation.length > 0) {
      const details = {
        in: error.validationContext ?? 'body',
        issues: mapValidationIssues(error.validation),
      };
      void reply
        .status(422)
        .send(
          errorEnvelope(
            'VALIDATION_FAILED',
            `Request ${error.validationContext ?? 'input'} failed validation.`,
            requestId,
            details,
          ),
        );
      return;
    }

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    const code = CODE_BY_STATUS[statusCode];

    if (statusCode < 500 && code !== undefined) {
      void reply.status(statusCode).send(errorEnvelope(code, error.message, requestId));
      return;
    }

    // Unexpected: full stack to the log under the same requestId; message
    // hidden from the client in production (§1.4).
    request.log.error({ err: error }, 'unhandled error');
    const message = exposeInternalErrors
      ? error.message
      : 'Something went wrong. Share the request id with support.';
    void reply.status(500).send(errorEnvelope('INTERNAL', message, requestId));
  });

  await app.register(corePlugin, { env });
  await app.register(authPlugin, {
    env,
    metaDb: opts.metaDb ?? null,
    deliverResetToken: opts.onPasswordResetToken,
  });
  await app.register(staticPlugin, { root: opts.staticRoot });

  // Unknown route → 404 envelope; non-API GET/HEAD falls back to the SPA
  // index when a dashboard build is being served (05/09 request lifecycle).
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api/');
    if (
      !isApi &&
      app.spaRoot !== null &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      void reply.sendFile('index.html');
      return;
    }
    void reply
      .status(404)
      .send(
        errorEnvelope('NOT_FOUND', `Route ${request.method}:${request.url} not found.`, request.id),
      );
  });

  await registerRoutes(app);

  // Auth + me + bootstrap resources (08-server-api.md §2.1–§2.2,
  // 09-generated-app.md §2.1) under the same prefix.
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(bootstrapRoutes);

      // First-run setup + About (M10-T04). Both need a meta store to say
      // anything at all, so — unlike auth, whose 503 is itself the answer —
      // they are wired only when one is configured. Composition roots that
      // want injected services (tests with a stubbed release feed, the CLI)
      // build the server without `metaDb` and register these factories
      // themselves, exactly as the LLM/settings resources are wired.
      const meta = opts.metaDb;
      if (meta !== undefined && meta !== null) {
        await api.register(setupRoutes({ service: createSetupService({ meta, hashPassword }) }));
        await api.register(
          aboutRoutes({ meta, updates: createUpdateCheckService({ meta, version: APP_VERSION }) }),
        );
      }
    },
    { prefix: API_PREFIX },
  );

  return app;
}

/** The fully-typed (Zod type provider) server instance. */
export type AdminiumServer = Awaited<ReturnType<typeof buildServer>>;
