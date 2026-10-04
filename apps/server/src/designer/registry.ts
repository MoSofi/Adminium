// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The newest version of an npm package, asked of the registry.
 *
 * A model guesses versions (one session saw two for one font package, both
 * wrong). So the Designer never takes one from it: the server asks the
 * registry the project installs from, through the fetch that checks and pins
 * the address it calls.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeFetch, SafeFetchError, type SafeFetchOptions } from '../net/safe-fetch.js';
import { EXACT_VERSION, PACKAGE_NAME, TAILWIND_PACKAGE } from './needs.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The registry a project installs from: its `.npmrc`, the environment, else npm's own. */
export function registryOf(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['npm_config_registry'] ?? env['NPM_CONFIG_REGISTRY'];
  let found = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : '';
  const file = join(root, '.npmrc');
  if (found === '' && existsSync(file)) {
    const line = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(readFileSync(file, 'utf8'));
    if (line !== null) found = line[1] as string;
  }
  return (found === '' ? DEFAULT_REGISTRY : found).replace(/\/+$/, '');
}

export interface RegistryOptions {
  root: string;
  /** False where this server is set to call nothing outside: every lookup throws. */
  allowed?: () => boolean;
  fetch?: (url: string, opts: SafeFetchOptions) => Promise<{ body: Buffer }>;
  env?: NodeJS.ProcessEnv;
}

/**
 * A lookup of a package's newest version: null when the registry has no such
 * package, a throw when it could not be asked. Answers are kept while the
 * server runs.
 */
export function createRegistry(opts: RegistryOptions): (name: string, signal?: AbortSignal) => Promise<string | null> {
  const kept = new Map<string, string | null>();
  const fetcher = opts.fetch ?? safeFetch;
  return async (name, signal) => {
    if (!PACKAGE_NAME.test(name)) return null;
    if (opts.allowed?.() === false) throw new Error('This server is set to call nothing outside itself.');
    const before = kept.get(name);
    if (before !== undefined) return before;
    // A scoped name is one path piece: its slash is written as %2F.
    const url = `${registryOf(opts.root, opts.env)}/-/package/${name.replace('/', '%2F')}/dist-tags`;
    let version: string | null;
    try {
      const reply = await fetcher(url, { maxBytes: 64 * 1024, timeoutMs: 5000, headers: { accept: 'application/json' }, ...(signal === undefined ? {} : { signal }) });
      const latest = (JSON.parse(reply.body.toString('utf8')) as { latest?: unknown }).latest;
      version = typeof latest === 'string' && EXACT_VERSION.test(latest) ? latest : null;
    } catch (error) {
      if (!(error instanceof SafeFetchError) || error.reason !== 'status' || error.status !== 404) throw error;
      version = null;
    }
    // The screen build knows Tailwind 4: another major is not offered.
    if (name === TAILWIND_PACKAGE && version !== null && !version.startsWith('4.')) version = null;
    kept.set(name, version);
    return version;
  };
}
