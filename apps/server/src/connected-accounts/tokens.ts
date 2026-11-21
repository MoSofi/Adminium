// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The token service: the ONLY reader of a connected account's sealed tokens.
 *
 * ─── WHAT AN ADD-ON GETS ────────────────────────────────────────────────────
 * {@link TokenService.clientFor} hands a provider a client that adds the
 * bearer header itself, on hosts the manifest declares. The add-on never holds
 * a token, a refresh token or the client secret. This is a rule about what the
 * engine passes, not a sandbox: an add-on's server half runs in this process,
 * and vouching is what keeps a hostile module out (`add-ons/runtime.ts`).
 *
 * ─── ONE REFRESH AT A TIME ──────────────────────────────────────────────────
 * Within a process by a shared promise; across processes by a lease on the
 * row, taken in one statement. Tokens are written with a compare on the row's
 * version, so an older answer never overwrites a newer one.
 *
 * ─── WHOSE FAULT IS IT ──────────────────────────────────────────────────────
 * Only the token endpoint's `invalid_grant` moves an account to `reconnect`.
 * `invalid_client` is the install's: one notice, and nobody is told to
 * reconnect. Anything else (a 5xx, a timeout) changes no state and is retried.
 */
import type { ConnectedAccount, ConnectedAccountsRepo } from '@adminium/meta';

import { AddOnCredentialSecretMismatchError } from '../add-ons/credential-crypto.js';
import type { AddOnHttpClient } from '../add-ons/egress.js';
import { AddOnOAuthError, refreshAccessToken } from '../add-ons/oauth.js';
import { endpointsFor, missingScopes, type AccountSpec, type AppRegistration } from './spec.js';

/** Refresh when less than this is left. */
export const REFRESH_MARGIN_MS = 5 * 60_000;
/** How long one process may hold the right to refresh: well past the longest call it makes (the guarded client's 30 s). */
export const REFRESH_LEASE_MS = 90_000;
/**
 * How often a refused client is tried again. Rarely, because a real refusal
 * stays until the owner fixes it; and at all, because a refusal the provider
 * took back must not need someone to re-save the same secret.
 */
export const REFUSED_RETRY_MS = 15 * 60_000;
/** How long a caller waits on another process's refresh before calling it a passing failure. */
const LEASE_WAIT_MS = 3_000;
const LEASE_POLL_MS = 150;

/** Why an account's token cannot be had right now. */
export type AccountFailure =
  /** The person must connect again. */
  | 'reconnect'
  /** The provider refused the install's own client: the owner's to fix. */
  | 'setup'
  /** The stored tokens were sealed under another secret. */
  | 'keys'
  /** The account or its add-on is not there. */
  | 'unavailable'
  /** A passing failure: nothing changed, try again later. */
  | 'transient';

export class AccountTokenError extends Error {
  override readonly name = 'AccountTokenError';
  readonly failure: AccountFailure;
  constructor(failure: AccountFailure) {
    // Fixed words: this reaches a job's `lastError`, which staff can read.
    super(`The connected account is not usable right now (${failure}).`);
    this.failure = failure;
  }
}

/** The install an account belongs to, resolved at run time. */
export interface AccountInstall {
  spec: AccountSpec;
  registration: AppRegistration | null;
  http: AddOnHttpClient;
}

export interface TokenServiceDeps {
  repo: ConnectedAccountsRepo;
  /** The add-on's spec, its registration and its guarded client; null when its code is not there. */
  installOf(manifestId: string): Promise<AccountInstall | null>;
  /** Told once when the provider refuses the install's client. Never throws. */
  onClientRefused?(manifestId: string, code: string): Promise<void>;
  /** Told when an account moves to `reconnect`. Never throws. */
  onGrantGone?(account: ConnectedAccount): Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** What a provider is handed for one account. */
export interface AccountClient {
  http: AddOnHttpClient;
  account: { id: string; address: string | null };
}

export interface TokenService {
  /** A usable access token, refreshed if needed. Core-only: never pass it to add-on code. */
  accessToken(accountId: string): Promise<string>;
  /** A client that adds the bearer header, refreshes once on a 401, and never shows the token. */
  clientFor(accountId: string): Promise<AccountClient>;
}

export function createTokenService(deps: TokenServiceDeps): TokenService {
  const { repo } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const running = new Map<string, Promise<string>>();

  async function tokensOf(id: string) {
    try {
      return await repo.tokensOf(id);
    } catch (error) {
      if (error instanceof AddOnCredentialSecretMismatchError) throw new AccountTokenError('keys');
      throw error;
    }
  }

  async function gone(account: ConnectedAccount): Promise<AccountTokenError> {
    if (await repo.markGone(account.id, account.version, now())) await deps.onGrantGone?.(account);
    return new AccountTokenError('reconnect');
  }

  /** Waits for another process's refresh to land, and reads what it wrote. */
  async function afterOthers(id: string, version: number): Promise<string> {
    const until = now() + LEASE_WAIT_MS;
    for (;;) {
      const account = await repo.find(id);
      if (account === null) throw new AccountTokenError('unavailable');
      if (account.version !== version) {
        const tokens = await tokensOf(id);
        if (tokens === null) throw await gone(account);
        return tokens.accessToken;
      }
      if (account.leaseUntil === null || now() >= until) throw new AccountTokenError('transient');
      await sleep(LEASE_POLL_MS);
    }
  }

  async function refresh(account: ConnectedAccount): Promise<string> {
    const leaseUntil = now() + REFRESH_LEASE_MS;
    if (!(await repo.takeLease(account.id, now(), leaseUntil))) return afterOthers(account.id, account.version);
    let handedBack = false;
    try {
      // Read under the lease: another process may have finished just before it was taken.
      const fresh = await repo.find(account.id);
      if (fresh === null) throw new AccountTokenError('unavailable');
      const tokens = await tokensOf(fresh.id);
      if (tokens === null) throw await gone(fresh);
      if (fresh.version !== account.version) return tokens.accessToken;

      const install = await deps.installOf(fresh.manifestId);
      if (install === null) throw new AccountTokenError('unavailable');
      if (install.registration === null) throw new AccountTokenError('setup');

      let result;
      try {
        result = await refreshAccessToken({
          http: install.http,
          connect: endpointsFor(install.spec, install.registration),
          allow: install.spec.allow,
          addOnKey: install.spec.key,
          envelope: { clientId: install.registration.clientId, clientSecret: install.registration.clientSecret, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, redirectUri: '' },
          now: now(),
        });
      } catch (error) {
        const failure = await failureOf(error, fresh);
        // A person reconnected while this answer was on its way: what they saved stands.
        if (failure.failure === 'reconnect') {
          const current = await repo.find(fresh.id);
          if (current !== null && current.version !== fresh.version && current.state !== 'reconnect') {
            const saved = await tokensOf(fresh.id);
            if (saved !== null) return saved.accessToken;
          }
        }
        throw failure;
      }

      const next = { accessToken: result.envelope.accessToken, refreshToken: result.envelope.refreshToken ?? tokens.refreshToken };
      const written = await repo.writeTokens(
        fresh.id,
        fresh.version,
        { tokens: next, expiresAt: result.expiresAt, refreshExpiresAt: result.refreshExpiresAt ?? fresh.refreshExpiresAt, scopes: result.scopes },
        now(),
      );
      handedBack = written;
      if (!written) return (await tokensOf(fresh.id))?.accessToken ?? next.accessToken;

      // A good refresh proves the client is accepted again.
      await repo.clearRefused(fresh.manifestId);
      // The provider says what the grant holds now: a permission taken away reads "partial".
      const short = missingScopes(install.spec.requiredScopes, result.scopes).length > 0;
      if (short) await repo.setState(fresh.id, 'partial', now());
      else if (fresh.state === 'partial' || fresh.state === 'reconnect') await repo.setState(fresh.id, 'connected', now());
      return next.accessToken;
    } finally {
      if (!handedBack) await repo.releaseLease(account.id, leaseUntil).catch(() => undefined);
    }
  }

  async function failureOf(error: unknown, account: ConnectedAccount): Promise<AccountTokenError> {
    if (!(error instanceof AddOnOAuthError)) return new AccountTokenError('transient');
    if (error.reason === 'NO_REFRESH_TOKEN') return gone(account);
    if (error.providerCode === 'invalid_grant') return gone(account);
    if (error.providerCode === 'invalid_client' || error.providerCode === 'unauthorized_client') {
      if (await repo.markRefused(account.manifestId, error.providerCode, now())) await deps.onClientRefused?.(account.manifestId, error.providerCode);
      return new AccountTokenError('setup');
    }
    return new AccountTokenError('transient');
  }

  /** One refresh per account in this process, whoever asks. */
  function refreshOnce(account: ConnectedAccount): Promise<string> {
    const already = running.get(account.id);
    if (already !== undefined) return already;
    const started = refresh(account).finally(() => running.delete(account.id));
    running.set(account.id, started);
    return started;
  }

  async function usable(id: string): Promise<ConnectedAccount> {
    const account = await repo.find(id);
    if (account === null) throw new AccountTokenError('unavailable');
    if (account.state === 'disconnecting') throw new AccountTokenError('unavailable');
    if (!account.hasTokens || account.state === 'reconnect') throw new AccountTokenError('reconnect');
    return account;
  }

  /** Before a refresh: a client the provider refused is asked again only now and then. */
  async function mayAskProvider(manifestId: string): Promise<void> {
    const refused = await repo.refusedOf(manifestId);
    if (refused === null) return;
    const at = now();
    if (at - refused.at < REFUSED_RETRY_MS || !(await repo.retryRefused(manifestId, refused.at, at))) throw new AccountTokenError('setup');
  }

  async function accessToken(id: string): Promise<string> {
    const account = await usable(id);
    // No stated expiry: unknown, so it is used until a call answers 401.
    if (account.expiresAt === null || account.expiresAt - now() > REFRESH_MARGIN_MS) {
      const tokens = await tokensOf(id);
      if (tokens === null) throw await gone(account);
      return tokens.accessToken;
    }
    await mayAskProvider(account.manifestId);
    return refreshOnce(account);
  }

  /** After a 401: refresh, unless someone already replaced the token that was refused. */
  async function replaced(id: string, refused: string): Promise<string> {
    const account = await usable(id);
    const tokens = await tokensOf(id);
    if (tokens === null) throw await gone(account);
    if (tokens.accessToken !== refused) return tokens.accessToken;
    await mayAskProvider(account.manifestId);
    return refreshOnce(account);
  }

  return {
    accessToken,

    async clientFor(id) {
      const account = await usable(id);
      const install = await deps.installOf(account.manifestId);
      if (install === null) throw new AccountTokenError('unavailable');

      const send = (input: Parameters<AddOnHttpClient>[0], init: Parameters<AddOnHttpClient>[1], token: string) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${token}`);
        return install.http(input, { ...init, headers });
      };
      const http = (async (input, init) => {
        const token = await accessToken(id);
        const first = await send(input, init, token);
        if (first.status !== 401) return first;
        // A body already read cannot be sent twice: only a call that can be repeated is retried.
        if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') return first;
        await first.body?.cancel().catch(() => undefined);
        // Told as it came. A second 401 is not the token endpoint's word, so it moves no state: an API outage must not tell everyone to reconnect.
        return send(input, init, await replaced(id, token));
      }) as AddOnHttpClient;

      return { http, account: { id: account.id, address: account.address } };
    },
  };
}
