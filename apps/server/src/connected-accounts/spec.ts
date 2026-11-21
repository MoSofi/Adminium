// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an add-on's manifest and its install's app registration say about
 * connecting accounts: the endpoints, the permissions, how to read who
 * connected, and the one address the provider sends a person back to.
 *
 * ─── THE CALLBACK IS FIXED ──────────────────────────────────────────────────
 * Every business registers {@link callbackPath} at Google and Microsoft by
 * hand, once, so it never moves. It is built from `system.publicOrigin`, never
 * from a request. Its GET does no work: it hands the code to a door page,
 * which POSTs it (`routes/connect-door`).
 */
import type { AddOnManifest } from '@adminium/manifest';
import { OAUTH_TENANT, OAUTH_TENANT_SLOT } from '@adminium/add-on-contracts';

import { AddOnOAuthError, assertOAuthHostsDeclared } from '../add-ons/oauth.js';
import type { Reachability } from '../payments/reachability.js';

/** Where the door's stranger pages live. */
export const CONNECT_DOOR_PATH = '/x/connect';

/** The address a provider sends a person back to. Registered by hand at the provider: never change it. */
export function callbackPath(addOnKey: string): string {
  return `/api/v1/add-ons/${addOnKey}/oauth/callback`;
}

/** Matches {@link callbackPath} for any add-on key. */
export const CALLBACK_PATH = /^\/api\/v1\/add-ons\/[a-z][a-z0-9-]{1,79}\/oauth\/callback$/;

export function redirectUriFor(origin: string, addOnKey: string): string {
  return `${origin}${callbackPath(addOnKey)}`;
}

/** What an add-on declares about its connected accounts, narrowed and checked. */
export interface AccountSpec {
  key: string;
  per: 'install' | 'row';
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  scopes: readonly string[];
  requiredScopes: readonly string[];
  authorizeParams: Readonly<Record<string, string>>;
  identity: { subject: string; address: readonly string[] };
  tenantDefault: string | null;
  allow: readonly string[];
}

/** The spec of an add-on that keeps connected accounts; null for any other. */
export function accountSpecOf(manifest: AddOnManifest): AccountSpec | null {
  const connect = manifest.addOn.connect;
  if (connect.kind !== 'oauth2' || connect.accounts === undefined || connect.identity === undefined) return null;
  if (connect.authorizeUrl === undefined || connect.tokenUrl === undefined) return null;
  return {
    key: manifest.key,
    per: connect.accounts,
    authorizeUrl: connect.authorizeUrl,
    tokenUrl: connect.tokenUrl,
    revokeUrl: connect.revokeUrl ?? null,
    scopes: connect.scopes ?? [],
    requiredScopes: connect.requiredScopes ?? [],
    authorizeParams: connect.authorizeParams ?? {},
    identity: connect.identity,
    tenantDefault: connect.tenant?.default ?? null,
    allow: manifest.addOn.network?.allow ?? [],
  };
}

/**
 * The install's registration at the provider, kept in the one credential row:
 * one secret to rotate, however many people connected.
 */
export interface AppRegistration extends Record<string, unknown> {
  oauthApp: 1;
  clientId: string;
  clientSecret: string;
  tenant: string | null;
  /** The public address the redirect was given for: when it moves, the provider needs the new one. */
  redirectOrigin: string | null;
  /** The day the client secret ends, when the studio wrote it down (`YYYY-MM-DD`). */
  secretEndsOn: string | null;
  /** The end date the managers were last told about, so they are told once. */
  secretToldFor: string | null;
}

export function registrationOf(held: { kind: string; secret: Record<string, unknown> } | null): AppRegistration | null {
  if (held === null || held.kind !== 'oauth2' || held.secret['oauthApp'] !== 1) return null;
  const { clientId, clientSecret, tenant, redirectOrigin, secretEndsOn, secretToldFor } = held.secret;
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') return null;
  return {
    oauthApp: 1,
    clientId,
    clientSecret,
    tenant: typeof tenant === 'string' ? tenant : null,
    redirectOrigin: typeof redirectOrigin === 'string' ? redirectOrigin : null,
    secretEndsOn: typeof secretEndsOn === 'string' ? secretEndsOn : null,
    secretToldFor: typeof secretToldFor === 'string' ? secretToldFor : null,
  };
}

/** The two addresses for this registration, with its directory in the slot, each on a host the manifest declares. */
export function endpointsFor(spec: AccountSpec, registration: Pick<AppRegistration, 'tenant'>): { authorizeUrl: string; tokenUrl: string } {
  const tenant = registration.tenant ?? spec.tenantDefault;
  const fill = (raw: string): string => {
    if (!raw.includes(OAUTH_TENANT_SLOT)) return raw;
    if (tenant === null || !OAUTH_TENANT.test(tenant)) {
      throw new AddOnOAuthError('HOST_NOT_DECLARED', `"${spec.key}" needs a directory (tenant) that reads as one.`);
    }
    return raw.replace(OAUTH_TENANT_SLOT, tenant);
  };
  const endpoints = { authorizeUrl: fill(spec.authorizeUrl), tokenUrl: fill(spec.tokenUrl) };
  assertOAuthHostsDeclared(endpoints, spec.allow, spec.key);
  return endpoints;
}

/** A scope as a provider may echo it: lower case, and the last part of a full address. */
function scopeWord(scope: string): string {
  const lower = scope.toLowerCase();
  return lower.slice(lower.lastIndexOf('/') + 1);
}

/**
 * The permissions asked for and not given. A reply that names no scopes at all
 * means "what you asked", as OAuth 2.0's token response defines it (RFC 6749).
 */
export function missingScopes(required: readonly string[], granted: readonly string[] | null): string[] {
  if (granted === null) return [];
  const words = new Set(granted.map(scopeWord));
  return required.filter((scope) => !words.has(scopeWord(scope)));
}

/** The claims of an ID token. It comes straight from the token endpoint over TLS, so its signature is not what protects it. */
function claimsOf(idToken: string): Record<string, unknown> | null {
  const part = idToken.split('.')[1];
  if (part === undefined) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface AccountIdentity {
  subject: string;
  address: string | null;
}

/** Who signed in: a stable id and an address, or null when the answer does not say, or was not made for this client. */
export function identityOf(spec: Pick<AccountSpec, 'identity'>, idToken: string | null, clientId: string): AccountIdentity | null {
  if (idToken === null) return null;
  const claims = claimsOf(idToken);
  if (claims === null) return null;
  const audience = claims['aud'];
  if (!(audience === clientId || (Array.isArray(audience) && audience.includes(clientId)))) return null;
  const subject = claims[spec.identity.subject];
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) return null;
  let address: string | null = null;
  // An address the provider says it has not verified is not shown as who connected.
  if (claims['email_verified'] !== false) {
    for (const claim of spec.identity.address) {
      const value = claims[claim];
      if (typeof value === 'string' && value.includes('@') && value.length <= 320) {
        address = value;
        break;
      }
    }
  }
  return { subject, address };
}

/**
 * What this server's address allows, from `payments/reachability.ts`:
 *  - `cannot-connect`: not public https (the desktop app, a LAN). Nobody can
 *    finish a provider's sign-in, so no link is offered;
 *  - `poll-only`: a sign-in works, a provider's calls in would not arrive;
 *  - `push`: both.
 */
export type ConnectReach = 'cannot-connect' | 'poll-only' | 'push';

export function connectReachOf(answer: Pick<Reachability, 'state'>): ConnectReach {
  if (answer.state === 'reachable') return 'push';
  return answer.state === 'proxy-hidden' ? 'poll-only' : 'cannot-connect';
}
