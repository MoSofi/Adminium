// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_ADD_ON_DEV_TRUST`: a developer's list of add-on keys whose server
 * code this server runs whatever its bytes, and where it may be read. Like the
 * lead demo seam (`lead-sources/demo-seam.ts`) it is for test and development
 * servers only, and `NODE_ENV` must say so:
 *
 *  - `test` or `development`: honoured;
 *  - `production` (the Docker image sets it): ignored, and the boot says so in
 *    its log, so a copy left in an env file never stops a live server;
 *  - unset, or any other value: the boot refuses. An npm install run as a
 *    service sets no `NODE_ENV`, and a copy left in an env file must not run
 *    unvouched add-on code there;
 *  - a trial or a hosted server: refused whatever `NODE_ENV` says
 *    (`config/env.ts`, `profileIssues`).
 *
 * `adminium app try` does not go through the environment: it trusts the
 * packages it tries for its own run, in this process ({@link trustForThisRun}).
 */

export const DEV_TRUST_ENV = 'ADMINIUM_ADD_ON_DEV_TRUST';

/** The `NODE_ENV` values that say a server is for tests or development. */
const DEV_ENVS: ReadonlySet<string> = new Set(['test', 'development']);

type RawEnv = Readonly<Record<string, string | undefined>>;

const nodeEnvOf = (nodeEnv: string | undefined): string => (nodeEnv ?? '').trim().toLowerCase();

/** The keys a list names, trimmed, empty entries dropped. */
export function devTrustListKeys(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
}

/** Whether a server with this `NODE_ENV` reads the developer's list: a test or development one only. */
export function devTrustHonoured(nodeEnv: string | undefined): boolean {
  return DEV_ENVS.has(nodeEnvOf(nodeEnv));
}

/** The boot's refusal: the list set on a server that does not say it is for tests or development; null otherwise. */
export function devTrustProblem(env: RawEnv): string | null {
  if (devTrustListKeys(env[DEV_TRUST_ENV]).length === 0) return null;
  const nodeEnv = nodeEnvOf(env['NODE_ENV']);
  if (nodeEnv === 'production' || DEV_ENVS.has(nodeEnv)) return null;
  const why = nodeEnv === '' ? 'NODE_ENV is not set' : `NODE_ENV is ${nodeEnv}`;
  return `cannot be set: ${why}. It runs add-on code no catalogue vouched for, on a test or development server only. On your own development server set NODE_ENV=development as well; anywhere else, remove it.`;
}

/** The keys a production server leaves unread (said in its log at boot); empty anywhere else. */
export function devTrustIgnoredKeys(env: RawEnv = process.env): string[] {
  return nodeEnvOf(env['NODE_ENV']) === 'production' ? devTrustListKeys(env[DEV_TRUST_ENV]) : [];
}

// ── one run's own trust ───────────────────────────────────────────────────────

/** Keys trusted for a run in this process, counted, so two runs that overlap each put back only their own. */
const runKeys = new Map<string, number>();

/**
 * Trusts these add-on keys for one run in this process (`adminium app try`,
 * which composes a throwaway server and runs the packages it was handed).
 * Returns the function that puts it back. Never read in production.
 */
export function trustForThisRun(keys: readonly string[]): () => void {
  const added = [...new Set(keys.map((key) => key.trim()).filter((key) => key !== ''))];
  for (const key of added) runKeys.set(key, (runKeys.get(key) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const key of added) {
      const left = (runKeys.get(key) ?? 1) - 1;
      if (left > 0) runKeys.set(key, left);
      else runKeys.delete(key);
    }
  };
}

/** The keys trusted for a run in this process now. */
export function runTrustedKeys(): string[] {
  return [...runKeys.keys()];
}
