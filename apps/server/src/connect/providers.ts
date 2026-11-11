// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operators that can hand this instance a database connection
 * ("Connect Supabase").
 *
 * An operator who runs Adminium for other people (a trial host, an agency)
 * may run a small service that signs the person in to their database
 * provider, lets them pick or create a project, and hands the connection
 * details back ONCE. This instance never talks to the provider: no OAuth
 * client, no provider API, no token is kept here. It only knows the
 * operator's address, set in the environment, and redeems a one-time code
 * there (`./handoff.ts`, `./redeem.ts`).
 *
 * A list with one entry, so a second provider is a row here and a variable
 * beside `ADMINIUM_SUPABASE_CONNECT_URL`, not a rewrite.
 */
import type { Env } from '../config/env.js';

export const CONNECT_PROVIDERS = [{ id: 'supabase', variable: 'ADMINIUM_SUPABASE_CONNECT_URL' }] as const;

export type ConnectProviderId = (typeof CONNECT_PROVIDERS)[number]['id'];

export const CONNECT_PROVIDER_IDS = CONNECT_PROVIDERS.map((provider) => provider.id) as [ConnectProviderId, ...ConnectProviderId[]];

export interface ConnectProvider {
  id: ConnectProviderId;
  /** The operator's address: the browser is sent here, and `<url>/redeem` is called. */
  url: string;
}

/**
 * An operator's connect address, or null when it may not be one.
 *
 * https only: the redeem answer can carry a database password, and the code
 * and verifier that buy it travel there. No name or password in the address,
 * no fragment, no query (the instance writes its own). A path is kept, so an
 * operator can serve several providers from one host.
 */
export function parseConnectUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '' || value.includes('?') || value.includes('#')) return null;
  if (url.hostname === '') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The providers this instance offers, in the list's order: those whose variable is set. */
export function connectProviders(env: Pick<Env, 'ADMINIUM_SUPABASE_CONNECT_URL'>): ConnectProvider[] {
  return CONNECT_PROVIDERS.flatMap((provider) => {
    const url = env[provider.variable];
    return url === undefined ? [] : [{ id: provider.id, url }];
  });
}

/** Where the browser is sent: the operator's page, told who is asking and how to prove it later. */
export function startUrl(provider: ConnectProvider, input: { instance: string; state: string; challenge: string }): string {
  const url = new URL(provider.url);
  url.searchParams.set('instance', input.instance);
  url.searchParams.set('state', input.state);
  // Always S256(verifier), base64url without padding (RFC 7636): there is no plain method to name.
  url.searchParams.set('challenge', input.challenge);
  return url.toString();
}

/** Where the instance redeems the code: `<url>/redeem`. */
export function redeemUrl(provider: ConnectProvider): string {
  const url = new URL(provider.url);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/redeem`;
  return url.toString();
}
