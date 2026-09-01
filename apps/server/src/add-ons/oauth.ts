// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host-run OAuth2 authorization-code flow with PKCE (26-T08, §5.1, D2).
 *
 * ─── "Host-run", and what that buys ────────────────────────────────────────
 *
 * Acceptance #2: all three connect kinds work "with the add-on never seeing the
 * client secret". So Adminium runs the flow. The add-on declares WHERE to
 * authorize (`authorizeUrl`, `tokenUrl` in its manifest) and gets handed an
 * access token when there is one; it never holds the client secret, never sees
 * the code verifier, and never performs the exchange.
 *
 * PKCE on top of a confidential-client flow is belt and braces on purpose: the
 * authorization code travels back through a browser, and a verifier the browser
 * never saw is what makes an intercepted code useless on its own.
 *
 * ─── The OAuth hosts are held to the SAME allow-list as everything else ────
 *
 * The manifest validator requires an `oauth2` connect to declare both URLs
 * (§5.6) and does NOT require their hosts to appear in `network.allow`. That
 * gap is closed here rather than left: an add-on declaring
 * `tokenUrl: https://evil.example/token` while its allow-list says
 * `api.canva.com` would otherwise have Adminium POST a client secret and an
 * authorization code to a host the operator never consented to. The exchange
 * goes through the same guarded client an add-on's own calls do, so there is
 * exactly one allow-list and one place it is enforced.
 *
 * ─── Why the pending flow is in memory ─────────────────────────────────────
 *
 * Mirrors `bridge/store.ts`, for the same reasons and with the same shape:
 * single-use, short-lived, bounded, and never on disk — the code verifier and
 * the client secret are live credentials for the ninety seconds a person spends
 * on a consent screen, and parking them in the meta store would mean writing
 * them somewhere backups reach for a benefit measured in seconds.
 *
 * THE LIMITATION, STATED: a deployment running several server processes behind
 * a load balancer can have the completion land on a process that did not start
 * the flow, which reads as an expired state. Single-process is the shipped
 * shape (`compose.ts` composes one server); a replicated deployment needs
 * sticky routing for this one route, or this store promoted to a table. Said
 * here rather than discovered.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AddOnHttpClient } from './egress.js';
import { hostnameAllowed } from './egress-policy.js';

/** How long a started flow stays completable. Long enough to read a consent screen. */
export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** Hard cap on in-flight flows; oldest evicted first, as the bridge store does. */
export const OAUTH_FLOW_MAX = 32;

export type OAuthRefusal =
  | 'UNKNOWN_STATE'
  | 'STATE_MISMATCH'
  | 'HOST_NOT_DECLARED'
  | 'EXCHANGE_FAILED'
  | 'NO_ACCESS_TOKEN'
  | 'NO_REFRESH_TOKEN';

export class AddOnOAuthError extends Error {
  override readonly name = 'AddOnOAuthError';
  readonly reason: OAuthRefusal;

  constructor(reason: OAuthRefusal, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** One flow in progress. Never persisted, never logged. */
interface PendingFlow {
  addOnKey: string;
  /** PKCE. The browser never sees it, which is the whole point. */
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  startedAt: number;
}

export interface StartedFlow {
  state: string;
  authorizeUrl: string;
}

/** The stored envelope for a connected oauth2 add-on. */
export interface OAuthEnvelope extends Record<string, unknown> {
  clientId: string;
  /** Kept because a refresh needs it. The ADD-ON never receives it. */
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  redirectUri: string;
}

/** RFC 7636: 43–128 chars of unreserved alphabet, then S256. */
function makeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Constant-time compare for the state parameter. */
function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface OAuthConnect {
  authorizeUrl: string;
  tokenUrl: string;
  scopes?: readonly string[] | undefined;
}

/**
 * Both OAuth endpoints must be hosts the manifest already declares for egress.
 *
 * Checked before a flow starts AND before the exchange, because the two read
 * different fields and a manifest could in principle be upgraded between them.
 */
export function assertOAuthHostsDeclared(
  connect: OAuthConnect,
  allow: readonly string[],
  addOnKey: string,
): void {
  for (const [field, raw] of [
    ['authorizeUrl', connect.authorizeUrl],
    ['tokenUrl', connect.tokenUrl],
  ] as const) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AddOnOAuthError('HOST_NOT_DECLARED', `"${addOnKey}"'s ${field} is not a URL.`);
    }
    const verdict = hostnameAllowed(url, allow);
    if (verdict !== 'ok') {
      throw new AddOnOAuthError(
        'HOST_NOT_DECLARED',
        `"${addOnKey}" declares ${field} at ${url.host}, which is not in the hostnames its ` +
          `manifest allows (${allow.join(', ') || 'none'}). Adminium will not send a client ` +
          'secret to a host the add-on never declared.',
      );
    }
  }
}

export interface OAuthFlowStore {
  start(input: {
    addOnKey: string;
    connect: OAuthConnect;
    allow: readonly string[];
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): StartedFlow;
  /** Single-use: taking a flow removes it, so a replayed code is inert. */
  take(state: string): PendingFlow | null;
  readonly size: number;
}

export function createOAuthFlowStore(now: () => number = Date.now): OAuthFlowStore {
  const flows = new Map<string, PendingFlow>();

  function sweep(): void {
    const cutoff = now() - OAUTH_FLOW_TTL_MS;
    for (const [state, flow] of flows) {
      if (flow.startedAt < cutoff) flows.delete(state);
    }
    // Bounded, so a caller looping on `start` cannot grow the heap.
    while (flows.size >= OAUTH_FLOW_MAX) {
      const oldest = flows.keys().next().value;
      if (oldest === undefined) break;
      flows.delete(oldest);
    }
  }

  return {
    start({ addOnKey, connect, allow, clientId, clientSecret, redirectUri }) {
      assertOAuthHostsDeclared(connect, allow, addOnKey);
      sweep();

      const state = randomBytes(32).toString('base64url');
      const codeVerifier = makeVerifier();
      flows.set(state, {
        addOnKey,
        codeVerifier,
        clientId,
        clientSecret,
        redirectUri,
        startedAt: now(),
      });

      const url = new URL(connect.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challengeFor(codeVerifier));
      url.searchParams.set('code_challenge_method', 'S256');
      if (connect.scopes !== undefined && connect.scopes.length > 0) {
        url.searchParams.set('scope', connect.scopes.join(' '));
      }
      return { state, authorizeUrl: url.href };
    },

    take(state) {
      sweep();
      for (const [candidate, flow] of flows) {
        if (!sameState(candidate, state)) continue;
        flows.delete(candidate);
        return flow;
      }
      return null;
    },

    get size() {
      return flows.size;
    },
  };
}

/** What a token endpoint answered, narrowed to what is used. */
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

async function postToken(
  http: AddOnHttpClient,
  tokenUrl: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  let response: Response;
  try {
    // Through the GUARDED client: the token endpoint is held to the same
    // allow-list, and the exchange gets the same redirect refusal and body cap
    // as any other outbound call.
    response = await http(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (error) {
    throw new AddOnOAuthError('EXCHANGE_FAILED', `the token request failed: ${String(error)}`);
  }
  if (!response.ok) {
    // The body is deliberately NOT included: a token endpoint's error body can
    // echo back the parameters it was sent, which here includes a client
    // secret, and this message reaches an operator's screen and the log.
    throw new AddOnOAuthError(
      'EXCHANGE_FAILED',
      `the token endpoint answered ${response.status}.`,
    );
  }
  try {
    return (await response.json()) as TokenResponse;
  } catch {
    throw new AddOnOAuthError('EXCHANGE_FAILED', 'the token endpoint did not return JSON.');
  }
}

export interface ExchangeResult {
  envelope: OAuthEnvelope;
  expiresAt: number | null;
  scopes: string[] | null;
}

function readTokens(
  body: TokenResponse,
  base: { clientId: string; clientSecret: string; redirectUri: string },
  previousRefresh: string | null,
  now: number,
): ExchangeResult {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : null;
  if (accessToken === null) {
    throw new AddOnOAuthError('NO_ACCESS_TOKEN', 'the token endpoint returned no access token.');
  }
  // A refresh response may legitimately omit `refresh_token`, meaning "keep the
  // one you have" — dropping it there would silently make the grant one-shot.
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : previousRefresh;
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : null;
  const scope = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : null;

  return {
    envelope: { ...base, accessToken, refreshToken },
    expiresAt: expiresIn === null ? null : now + expiresIn * 1000,
    scopes: scope,
  };
}

/** Completes a started flow: code + verifier + secret → tokens. */
export async function exchangeAuthorizationCode(input: {
  http: AddOnHttpClient;
  connect: OAuthConnect;
  allow: readonly string[];
  addOnKey: string;
  flow: { codeVerifier: string; clientId: string; clientSecret: string; redirectUri: string };
  code: string;
  now?: number;
}): Promise<ExchangeResult> {
  assertOAuthHostsDeclared(input.connect, input.allow, input.addOnKey);
  const body = await postToken(input.http, input.connect.tokenUrl, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.flow.redirectUri,
    client_id: input.flow.clientId,
    client_secret: input.flow.clientSecret,
    code_verifier: input.flow.codeVerifier,
  });
  return readTokens(
    body,
    {
      clientId: input.flow.clientId,
      clientSecret: input.flow.clientSecret,
      redirectUri: input.flow.redirectUri,
    },
    null,
    input.now ?? Date.now(),
  );
}

/** Trades a refresh token for a fresh access token. */
export async function refreshAccessToken(input: {
  http: AddOnHttpClient;
  connect: OAuthConnect;
  allow: readonly string[];
  addOnKey: string;
  envelope: OAuthEnvelope;
  now?: number;
}): Promise<ExchangeResult> {
  assertOAuthHostsDeclared(input.connect, input.allow, input.addOnKey);
  if (input.envelope.refreshToken === null) {
    throw new AddOnOAuthError(
      'NO_REFRESH_TOKEN',
      'this grant has no refresh token, so it cannot be renewed. Reconnect the add-on.',
    );
  }
  const body = await postToken(input.http, input.connect.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: input.envelope.refreshToken,
    client_id: input.envelope.clientId,
    client_secret: input.envelope.clientSecret,
  });
  return readTokens(
    body,
    {
      clientId: input.envelope.clientId,
      clientSecret: input.envelope.clientSecret,
      redirectUri: input.envelope.redirectUri,
    },
    input.envelope.refreshToken,
    input.now ?? Date.now(),
  );
}

/**
 * What an add-on's server half is allowed to see of an OAuth credential.
 *
 * The access token and nothing else — never the client secret (acceptance #2),
 * never the refresh token, which is the long-lived half and would let a
 * compromised add-on mint access tokens after being disconnected.
 */
export function addOnVisibleOAuthCredential(
  envelope: OAuthEnvelope,
): Record<string, unknown> {
  return { accessToken: envelope.accessToken };
}
