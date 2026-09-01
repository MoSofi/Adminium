// SPDX-License-Identifier: AGPL-3.0-only
/** Shared test helpers (not collected by vitest — no .test suffix). */
import type { InjectOptions } from 'fastify';

import { envSchema, type Env } from '../src/config/env.js';

export const TEST_SECRET = 'a-sufficiently-long-dev-secret';

/** Parses a minimal valid environment, without touching process.env. */
export function makeEnv(overrides: Record<string, string> = {}): Env {
  return envSchema.parse({ ADMINIUM_SECRET: TEST_SECRET, ...overrides });
}

export const REQUEST_ID_PATTERN = /^req_[0-9a-f]{8}$/;

/**
 * The body accepted by `app.inject({ payload })`, re-derived from Fastify's own
 * option type (`light-my-request` is not a declared dependency here, so its
 * `InjectPayload` cannot be imported directly).
 *
 * Helpers that post deliberately-malformed bodies want this rather than
 * `unknown`: `unknown` fails to satisfy `payload`, and a failed argument check
 * makes TypeScript abandon overload resolution on `inject` and fall back to the
 * intersection of all three return types, so every `.statusCode`/`.json()` on
 * the result errors too. Bad input that is not an object goes through as a
 * string (`'null'`, `'[]'`) — the route parses it the same way.
 */
export type InjectPayload = NonNullable<InjectOptions['payload']>;
