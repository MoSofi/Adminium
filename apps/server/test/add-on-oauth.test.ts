// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host-run OAuth2 + PKCE flow (26-T08, D2, acceptance #2).
 *
 * The claim under test is "the add-on never sees the client secret", and the
 * things that make it true are: Adminium runs the exchange, the verifier never
 * leaves this process, the refresh token is never handed out, and the endpoints
 * are held to the same allow-list as every other outbound call.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createAddOnHttpClient, type AddOnHttpClient } from '../src/add-ons/egress.js';
import {
  AddOnOAuthError,
  addOnVisibleOAuthCredential,
  assertOAuthHostsDeclared,
  createOAuthFlowStore,
  exchangeAuthorizationCode,
  OAUTH_FLOW_MAX,
  refreshAccessToken,
  type OAuthEnvelope,
} from '../src/add-ons/oauth.js';

const CONNECT = {
  authorizeUrl: 'https://api.canva.com/oauth/authorize',
  tokenUrl: 'https://api.canva.com/oauth/token',
  scopes: ['design:read', 'asset:read'],
};
const ALLOW = ['api.canva.com'];

const START = {
  addOnKey: 'import-canva',
  connect: CONNECT,
  allow: ALLOW,
  clientId: 'client-123',
  clientSecret: 'shhh-secret',
  redirectUri: 'https://adminium.example/studio/add-ons/callback',
};

/** A guarded client whose fetch answers with `body`, recording the request. */
function tokenClient(
  calls: Array<{ url: string; body: string }>,
  body: unknown = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'design:read' },
  status = 200,
): AddOnHttpClient {
  return createAddOnHttpClient({
    key: 'import-canva',
    allow: ALLOW,
    hasOutboundHttp: true,
    fetchImpl: ((input: unknown, init: RequestInit) => {
      calls.push({ url: String(input), body: String(init.body ?? '') });
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof globalThis.fetch,
  });
}

describe('26-T08: starting a flow', () => {
  it('builds an authorize URL with PKCE S256 and a state', () => {
    const store = createOAuthFlowStore();
    const { state, authorizeUrl } = store.start(START);
    const url = new URL(authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://api.canva.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('scope')).toBe('design:read asset:read');

    // THE point of PKCE here: the browser is sent the challenge, never the
    // verifier, so an intercepted authorization code is useless on its own.
    expect(authorizeUrl).not.toContain('code_verifier');
    // And the client secret is not in a URL a browser will visit.
    expect(authorizeUrl).not.toContain('shhh-secret');
  });

  it('never puts the same state on two flows', () => {
    const store = createOAuthFlowStore();
    const seen = new Set(Array.from({ length: 20 }, () => store.start(START).state));
    expect(seen.size).toBe(20);
  });

  it('is single-use: taking a state twice gives nothing the second time', () => {
    // A replayed authorization code must be inert.
    const store = createOAuthFlowStore();
    const { state } = store.start(START);
    expect(store.take(state)).not.toBeNull();
    expect(store.take(state)).toBeNull();
  });

  it('expires a flow nobody completed', () => {
    let now = 1_700_000_000_000;
    const store = createOAuthFlowStore(() => now);
    const { state } = store.start(START);
    now += 11 * 60 * 1000;
    expect(store.take(state)).toBeNull();
  });

  it('is bounded, so looping on start cannot grow the heap', () => {
    const store = createOAuthFlowStore();
    for (let i = 0; i < OAUTH_FLOW_MAX * 3; i += 1) store.start(START);
    expect(store.size).toBeLessThanOrEqual(OAUTH_FLOW_MAX);
  });

  it('refuses an unknown state without leaking whether one was close', () => {
    const store = createOAuthFlowStore();
    store.start(START);
    expect(store.take('not-a-real-state')).toBeNull();
  });
});

describe('26-T08: the OAuth hosts are held to the add-on allow-list', () => {
  it('refuses a tokenUrl on a host the manifest never declared', () => {
    // The gap the manifest validator leaves: it requires both URLs and does not
    // require their hosts to be in `network.allow`. Adminium will not POST a
    // client secret to a host the operator never consented to.
    expect(() =>
      assertOAuthHostsDeclared(
        { ...CONNECT, tokenUrl: 'https://evil.example/token' },
        ALLOW,
        'import-canva',
      ),
    ).toThrow(AddOnOAuthError);
    try {
      assertOAuthHostsDeclared(
        { ...CONNECT, tokenUrl: 'https://evil.example/token' },
        ALLOW,
        'import-canva',
      );
    } catch (error) {
      expect((error as AddOnOAuthError).reason).toBe('HOST_NOT_DECLARED');
      expect((error as Error).message).toContain('will not send a client secret');
    }
  });

  it('refuses an authorizeUrl on an undeclared host too', () => {
    expect(() =>
      assertOAuthHostsDeclared(
        { ...CONNECT, authorizeUrl: 'https://evil.example/authorize' },
        ALLOW,
        'import-canva',
      ),
    ).toThrow(/authorizeUrl/);
  });

  it('refuses at START, before any state is minted', () => {
    const store = createOAuthFlowStore();
    expect(() =>
      store.start({ ...START, connect: { ...CONNECT, tokenUrl: 'https://evil.example/t' } }),
    ).toThrow(AddOnOAuthError);
    expect(store.size).toBe(0);
  });

  it('accepts declared hosts', () => {
    expect(() => assertOAuthHostsDeclared(CONNECT, ALLOW, 'import-canva')).not.toThrow();
  });
});

describe('26-T08: exchanging the code', () => {
  it('sends the verifier and the secret, and returns the tokens', async () => {
    const store = createOAuthFlowStore();
    const { state, authorizeUrl } = store.start(START);
    const flow = store.take(state)!;
    const calls: Array<{ url: string; body: string }> = [];

    const result = await exchangeAuthorizationCode({
      http: tokenClient(calls),
      connect: CONNECT,
      allow: ALLOW,
      addOnKey: 'import-canva',
      flow,
      code: 'auth-code-1',
      now: 1_700_000_000_000,
    });

    const sent = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.url).toBe(CONNECT.tokenUrl);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('auth-code-1');
    expect(sent.get('client_secret')).toBe('shhh-secret');
    // The verifier matches the challenge the browser was given.
    const verifier = sent.get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      new URL(authorizeUrl).searchParams.get('code_challenge'),
    );

    expect(result.envelope.accessToken).toBe('at-1');
    expect(result.envelope.refreshToken).toBe('rt-1');
    expect(result.expiresAt).toBe(1_700_000_000_000 + 3_600_000);
    expect(result.scopes).toEqual(['design:read']);
  });

  it('refuses a token endpoint that returns no access token', async () => {
    const store = createOAuthFlowStore();
    const flow = store.take(store.start(START).state)!;
    await expect(
      exchangeAuthorizationCode({
        http: tokenClient([], { token_type: 'bearer' }),
        connect: CONNECT,
        allow: ALLOW,
        addOnKey: 'import-canva',
        flow,
        code: 'c',
      }),
    ).rejects.toMatchObject({ reason: 'NO_ACCESS_TOKEN' });
  });

  it('never echoes the token endpoint body into the error', async () => {
    // An OAuth error body routinely echoes the parameters it was sent, which
    // here includes a client secret — and this message reaches a screen and a log.
    const store = createOAuthFlowStore();
    const flow = store.take(store.start(START).state)!;
    let caught: unknown;
    try {
      await exchangeAuthorizationCode({
        http: tokenClient([], { error: 'invalid_client', sent_secret: 'shhh-secret' }, 400),
        connect: CONNECT,
        allow: ALLOW,
        addOnKey: 'import-canva',
        flow,
        code: 'c',
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as AddOnOAuthError).reason).toBe('EXCHANGE_FAILED');
    expect((caught as Error).message).not.toContain('shhh-secret');
    expect((caught as Error).message).toContain('400');
  });

  it('goes through the GUARDED client, so a redirect off the host is refused', async () => {
    const store = createOAuthFlowStore();
    const flow = store.take(store.start(START).state)!;
    const redirecting = createAddOnHttpClient({
      key: 'import-canva',
      allow: ALLOW,
      hasOutboundHttp: true,
      fetchImpl: (() =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'https://evil.example/t' } }),
        )) as unknown as typeof globalThis.fetch,
    });
    await expect(
      exchangeAuthorizationCode({
        http: redirecting,
        connect: CONNECT,
        allow: ALLOW,
        addOnKey: 'import-canva',
        flow,
        code: 'c',
      }),
    ).rejects.toMatchObject({ reason: 'EXCHANGE_FAILED' });
  });
});

describe('26-T08: refresh', () => {
  const envelope: OAuthEnvelope = {
    clientId: 'client-123',
    clientSecret: 'shhh-secret',
    accessToken: 'at-old',
    refreshToken: 'rt-1',
    redirectUri: START.redirectUri,
  };

  it('trades the refresh token for a new access token', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const result = await refreshAccessToken({
      http: tokenClient(calls, { access_token: 'at-2', expires_in: 60 }),
      connect: CONNECT,
      allow: ALLOW,
      addOnKey: 'import-canva',
      envelope,
      now: 1_700_000_000_000,
    });
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('refresh_token');
    expect(result.envelope.accessToken).toBe('at-2');
    expect(result.expiresAt).toBe(1_700_000_000_000 + 60_000);
  });

  it('KEEPS the old refresh token when the response omits one', async () => {
    // A refresh response may legitimately omit `refresh_token`, meaning "keep
    // the one you have". Dropping it would silently make the grant one-shot.
    const result = await refreshAccessToken({
      http: tokenClient([], { access_token: 'at-2', expires_in: 60 }),
      connect: CONNECT,
      allow: ALLOW,
      addOnKey: 'import-canva',
      envelope,
    });
    expect(result.envelope.refreshToken).toBe('rt-1');
  });

  it('takes a rotated refresh token when one IS returned', async () => {
    const result = await refreshAccessToken({
      http: tokenClient([], { access_token: 'at-2', refresh_token: 'rt-2' }),
      connect: CONNECT,
      allow: ALLOW,
      addOnKey: 'import-canva',
      envelope,
    });
    expect(result.envelope.refreshToken).toBe('rt-2');
  });

  it('says so plainly when a grant has no refresh token to use', async () => {
    await expect(
      refreshAccessToken({
        http: tokenClient([]),
        connect: CONNECT,
        allow: ALLOW,
        addOnKey: 'import-canva',
        envelope: { ...envelope, refreshToken: null },
      }),
    ).rejects.toMatchObject({ reason: 'NO_REFRESH_TOKEN' });
  });

  it('re-checks the host on refresh, not only at connect', async () => {
    const http = tokenClient([]);
    await expect(
      refreshAccessToken({
        http,
        connect: { ...CONNECT, tokenUrl: 'https://evil.example/token' },
        allow: ALLOW,
        addOnKey: 'import-canva',
        envelope,
      }),
    ).rejects.toMatchObject({ reason: 'HOST_NOT_DECLARED' });
  });
});

describe('26-T08: acceptance #2 — the add-on never sees the client secret', () => {
  it('hands the add-on the access token and nothing else', () => {
    const visible = addOnVisibleOAuthCredential({
      clientId: 'client-123',
      clientSecret: 'shhh-secret',
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      redirectUri: START.redirectUri,
    });

    expect(visible).toEqual({ accessToken: 'at-1' });
    // The refresh token is withheld too, and for its own reason: it is the
    // long-lived half, and a compromised add-on holding one could mint access
    // tokens after being disconnected.
    expect(JSON.stringify(visible)).not.toContain('rt-1');
    expect(JSON.stringify(visible)).not.toContain('shhh-secret');
    expect(JSON.stringify(visible)).not.toContain('client-123');
  });
});
