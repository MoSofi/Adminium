// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How much a test server widens every request limit (`ADMINIUM_RATE_LIMIT_SCALE`).
 *
 * Ignored when `NODE_ENV` is `production` (the Docker image sets it), as
 * `ADMINIUM_ADD_ON_DEV_TRUST` is: the limits are what stop password guessing
 * and floods, so a production server keeps them whatever its environment says.
 */
import type { Env } from './env.js';

export interface RateLimitScale {
  /** The multiplier in force: 1 keeps a real server's limits. */
  scale: number;
  /** Set above 1 but not applied, because the server runs in production. */
  ignored: boolean;
}

export function rateLimitScale(env: Pick<Env, 'ADMINIUM_RATE_LIMIT_SCALE'>, nodeEnv: string | undefined = process.env['NODE_ENV']): RateLimitScale {
  const asked = env.ADMINIUM_RATE_LIMIT_SCALE ?? 1;
  if (asked > 1 && nodeEnv === 'production') return { scale: 1, ignored: true };
  return { scale: asked, ignored: false };
}
