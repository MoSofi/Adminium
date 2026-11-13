// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One value from the project's `.env`, where the profile reads that file at
 * all. Trial mode and the hosted profile never do (`projectDotEnv`): the
 * Super Admin is a stranger who can write the folder, and a key from it would
 * be one they chose. Their own keys live in Settings or the environment.
 */
import { readDotEnv } from '../project/dotenv.js';
import type { TrialPolicy } from './policy.js';

export function projectDotEnvValue(policy: Pick<TrialPolicy, 'allows'>, root: string, name: string): string | undefined {
  if (!policy.allows('projectDotEnv').allowed) return undefined;
  return readDotEnv(root)?.[name];
}
