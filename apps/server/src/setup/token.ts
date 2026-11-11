// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-time setup token: who asks for one, what it is, and the boot step
 * that puts its proof in the meta store.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * A fresh instance makes its first visitor the super admin. On a one-click
 * host (Railway, Render, Fly, a Droplet on a public IP) there is a window
 * between the deploy finishing and the owner opening the URL, and anyone who
 * finds the address in it owns the instance. So a server boot mints a token,
 * prints it in its log, and the wizard asks for it first — the idea behind
 * Jenkins' and Grafana's initial admin password.
 *
 * ── WHO IS ASKED ────────────────────────────────────────────────────────────
 * Every server, except where only this computer can reach the wizard:
 *   - the desktop app (`ADMINIUM_RUNTIME=desktop`) — its window is the wizard;
 *   - `adminium dev`, `design` and `try` bound to a loopback address.
 * `adminium start` asks even on 127.0.0.1: that is how a server behind Caddy or
 * nginx listens, and the proxy makes it public.
 *
 * ── WHAT IS KEPT ────────────────────────────────────────────────────────────
 * Never the token. `system.setupToken` holds a random salt and a hash
 * (`@adminium/meta` setup-token.ts). The printed token is DERIVED from
 * `ADMINIUM_SECRET` and that salt, so every boot while setup is open prints the
 * same one: a log that scrolled away, or a host that restarted the container,
 * costs nothing. `ADMINIUM_SETUP_TOKEN`, when set, is used instead, so a
 * template can generate one and show it beside the other variables.
 *
 * Once the first account exists the row is gone (deleted in the same
 * transaction that created it) and nothing is printed again.
 */
import { createHmac } from 'node:crypto';

import {
  clearSetupToken,
  hashSetupToken,
  isBootstrapRequired,
  newSetupTokenSalt,
  readSetupToken,
  setupTokenMatches,
  writeSetupToken,
  type MetaDb,
} from '@adminium/meta';

import type { Env } from '../config/env.js';

/** How this process was started, as far as the gate cares. */
export type SetupTokenMode = 'server' | 'dev' | 'design' | 'try';

/** Crockford base32: no I, L, O or U, so nothing reads as something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A bind address only this machine can reach. `0.0.0.0` and `::` are every address, not this one. */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Does this boot ask for a setup token? */
export function setupTokenRequired(opts: { runtime: Env['ADMINIUM_RUNTIME']; host: string; mode: SetupTokenMode }): boolean {
  if (opts.runtime === 'desktop') return false;
  if (opts.mode === 'server') return true;
  return !isLoopbackBindHost(opts.host);
}

/** `XXXX-XXXX-XXXX-XXXX`: 80 bits of an HMAC over the salt, keyed by the instance secret. */
export function deriveSetupToken(secret: string, salt: string): string {
  const digest = createHmac('sha256', secret).update(`adminium-setup-token:v1:${salt}`).digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 16) break;
  }
  return out.match(/.{4}/g)?.join('-') ?? out;
}

export interface PreparedSetupToken {
  /** What the wizard asks for. */
  token: string;
  /** It is `ADMINIUM_SETUP_TOKEN`: say so rather than print the operator's own secret back. */
  fromEnv: boolean;
}

/**
 * The boot step. Returns the token to print, or `null` when nobody will be
 * asked (gate off, or setup already done). A gate-off boot leaves the row
 * alone: another process may serve the same store with the gate on, and its
 * row is its door. Whether THIS server asks is the boot's decision, handed to
 * the setup service (`tokenRequired`), never read from the row, so a folder
 * last served by `start` and now by `dev` on this computer asks nothing, and a
 * row deleted behind a `start` server's back opens nothing.
 *
 * Throws when the gate is on and the row cannot be written: a server that
 * meant to ask and silently could not must not boot open.
 */
export async function prepareSetupToken(opts: {
  meta: MetaDb;
  env: Pick<Env, 'ADMINIUM_SECRET' | 'ADMINIUM_SETUP_TOKEN' | 'ADMINIUM_RUNTIME' | 'HOST'>;
  mode: SetupTokenMode;
  now?: number | undefined;
}): Promise<PreparedSetupToken | null> {
  const { meta, env } = opts;
  const at = opts.now ?? Date.now();
  const required = setupTokenRequired({ runtime: env.ADMINIUM_RUNTIME, host: env.HOST, mode: opts.mode });

  if (!required) return null;
  if (!(await isBootstrapRequired(meta))) {
    await clearSetupToken(meta);
    return null;
  }

  const stored = await readSetupToken(meta);
  const chosen = env.ADMINIUM_SETUP_TOKEN;
  if (chosen !== undefined) {
    if (stored === null || !setupTokenMatches(stored, chosen)) {
      const salt = newSetupTokenSalt();
      await writeSetupToken(meta, { salt, hash: hashSetupToken(salt, chosen) }, at);
    }
    return { token: chosen, fromEnv: true };
  }

  // The same salt ⇒ the same token. A row whose hash this secret cannot
  // reproduce (the secret changed, or the last boot used ADMINIUM_SETUP_TOKEN)
  // is replaced; the token printed now is the only one that works.
  if (stored !== null) {
    const token = deriveSetupToken(env.ADMINIUM_SECRET, stored.salt);
    if (setupTokenMatches(stored, token)) return { token, fromEnv: false };
  }
  const salt = newSetupTokenSalt();
  const token = deriveSetupToken(env.ADMINIUM_SECRET, salt);
  await writeSetupToken(meta, { salt, hash: hashSetupToken(salt, token) }, at);
  return { token, fromEnv: false };
}

/** The lines a boot prints. One place, so `start` and `try` say it the same way. */
export function setupTokenLines(prepared: PreparedSetupToken): string[] {
  return [
    prepared.fromEnv
      ? 'Setup token: the value of ADMINIUM_SETUP_TOKEN.'
      : `Setup token: ${prepared.token}`,
    'The first-run wizard asks for it before it creates the first account.',
  ];
}
