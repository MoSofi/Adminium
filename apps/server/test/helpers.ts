/** Shared test helpers (not collected by vitest — no .test suffix). */
import { envSchema, type Env } from '../src/config/env.js';

export const TEST_SECRET = 'a-sufficiently-long-dev-secret';

/** Parses a minimal valid environment, without touching process.env. */
export function makeEnv(overrides: Record<string, string> = {}): Env {
  return envSchema.parse({ ADMINIUM_SECRET: TEST_SECRET, ...overrides });
}

export const REQUEST_ID_PATTERN = /^req_[0-9a-f]{8}$/;
