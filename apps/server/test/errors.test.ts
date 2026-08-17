// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildServer, type AdminiumServer, type BuildServerOptions } from '../src/app.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationFailedError,
  errorEnvelope,
} from '../src/errors.js';
import { makeEnv, REQUEST_ID_PATTERN } from './helpers.js';

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

let app: AdminiumServer | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(opts: Partial<BuildServerOptions> = {}): Promise<AdminiumServer> {
  app = await buildServer({ env: makeEnv(), logger: false, ...opts });
  return app;
}

describe('AppError hierarchy', () => {
  it('carries status, code, and details', () => {
    const error = new AppError(418, 'TEAPOT', 'short and stout', { spout: true });
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(418);
    expect(error.code).toBe('TEAPOT');
    expect(error.details).toEqual({ spout: true });
  });

  it.each([
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ValidationFailedError(), 422, 'VALIDATION_FAILED'],
    [new UnauthorizedError(), 401, 'UNAUTHENTICATED'],
    [new UnauthorizedError('SESSION_EXPIRED'), 401, 'SESSION_EXPIRED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new ForbiddenError('no table for you', 'TABLE_FORBIDDEN'), 403, 'TABLE_FORBIDDEN'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new ConflictError('dupe', 'UNIQUE_VIOLATION'), 409, 'UNIQUE_VIOLATION'],
    [new RateLimitedError(), 429, 'RATE_LIMITED'],
  ] as const)('%s maps to %i %s', (error, statusCode, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(statusCode);
    expect(error.code).toBe(code);
  });

  it('errorEnvelope omits details when undefined', () => {
    expect(errorEnvelope('NOT_FOUND', 'gone', 'req_00000000')).toEqual({
      error: { code: 'NOT_FOUND', message: 'gone', requestId: 'req_00000000' },
    });
    expect(JSON.stringify(errorEnvelope('X', 'y', 'req_1'))).not.toContain('details');
  });
});

describe('global error handler — AppError mapping', () => {
  it('serializes a thrown AppError subclass into the envelope with requestId', async () => {
    const server = await build();
    server.get('/boom/user', async () => {
      throw new NotFoundError('User usr_1 not found.', { id: 'usr_1' });
    });
    const res = await server.inject({ method: 'GET', url: '/boom/user' });
    expect(res.statusCode).toBe(404);
    const body = res.json<Envelope>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('User usr_1 not found.');
    expect(body.error.details).toEqual({ id: 'usr_1' });
    expect(body.error.requestId).toMatch(REQUEST_ID_PATTERN);
    expect(res.headers['x-request-id']).toBe(body.error.requestId);
  });

  it.each([
    ['session-expired', new UnauthorizedError('SESSION_EXPIRED'), 401, 'SESSION_EXPIRED'],
    ['forbidden', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['conflict', new ConflictError(), 409, 'CONFLICT'],
    ['rate-limited', new RateLimitedError(), 429, 'RATE_LIMITED'],
  ] as const)('maps %s to its status/code', async (name, error, statusCode, code) => {
    const server = await build();
    server.get(`/boom/${name}`, async () => {
      throw error;
    });
    const res = await server.inject({ method: 'GET', url: `/boom/${name}` });
    expect(res.statusCode).toBe(statusCode);
    expect(res.json<Envelope>().error.code).toBe(code);
  });
});

describe('global error handler — unexpected errors', () => {
  it('hides the message behind INTERNAL when internals are not exposed (production)', async () => {
    const server = await build({ exposeInternalErrors: false });
    server.get('/boom/internal', async () => {
      throw new Error('secret stack detail: dsn=postgres://u:p@h/db');
    });
    const res = await server.inject({ method: 'GET', url: '/boom/internal' });
    expect(res.statusCode).toBe(500);
    const body = res.json<Envelope>();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('secret stack detail');
    expect(body.error.requestId).toMatch(REQUEST_ID_PATTERN);
    expect(res.payload).not.toContain('stack');
  });

  it('exposes the message in development', async () => {
    const server = await build({ exposeInternalErrors: true });
    server.get('/boom/dev', async () => {
      throw new Error('kaboom');
    });
    const res = await server.inject({ method: 'GET', url: '/boom/dev' });
    expect(res.statusCode).toBe(500);
    expect(res.json<Envelope>().error.message).toBe('kaboom');
  });
});

describe('global error handler — Zod validation (fastify-type-provider-zod)', () => {
  async function buildWithEcho(): Promise<AdminiumServer> {
    const server = await build();
    server.post(
      '/api/v1/echo',
      {
        schema: {
          body: z.object({ name: z.string(), count: z.number().int().min(1) }),
          response: { 200: z.object({ name: z.string(), count: z.number() }) },
        },
      },
      async (request) => request.body,
    );
    return server;
  }

  it('maps a body validation failure to 422 VALIDATION_FAILED with field details', async () => {
    const server = await buildWithEcho();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/echo',
      payload: { name: 42 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<Envelope>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toMatch(REQUEST_ID_PATTERN);
    const details = body.error.details as { in: string; issues: { path: string }[] };
    expect(details.in).toBe('body');
    expect(details.issues.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(details.issues)).toContain('name');
  });

  it('passes a valid body through untouched', async () => {
    const server = await buildWithEcho();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/echo',
      payload: { name: 'ok', count: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'ok', count: 3 });
  });
});
