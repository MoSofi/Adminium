// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Can customers reach this server?" — answered from what this server knows,
 * without calling anyone.
 *
 * A customer pays on a page this server serves, and the provider tells this
 * server how it went by calling it. Both need an address the internet can
 * reach over https. The server cannot prove that from inside (it would have to
 * call itself from outside), so this reads the facts it owns and names the
 * first one that rules online payments out, with the value it saw:
 *
 *   network-off  the operator switched network features off (`ADMINIUM_NETWORK_FEATURES`)
 *   desktop      the desktop app: this computer only
 *   not-set      no public address has been set or learned yet
 *   this-computer  a localhost or loopback address
 *   private-network  a LAN or private address
 *   dot-local    a `.local` name (only the local network resolves it)
 *   not-https    an `http://` address: payment pages need https
 *   proxy-hidden a proxy forwards requests but `ADMINIUM_TRUST_PROXY` is off, so
 *                every customer would look like the proxy
 *   reachable    nothing above applies
 *
 * Staff recording, manual ways to pay and the staff preview work whatever the
 * answer is; the dashboard says so.
 */
import { addressKind } from '../llm/outbound.js';
import { isLoopbackHost, normalizePublicOrigin } from '../security/public-origin.js';

export const REACHABILITY_STATES = [
  'network-off',
  'desktop',
  'not-set',
  'this-computer',
  'private-network',
  'dot-local',
  'not-https',
  'proxy-hidden',
  'reachable',
] as const;
export type ReachabilityState = (typeof REACHABILITY_STATES)[number];

export interface ReachabilityFacts {
  /** `ADMINIUM_NETWORK_FEATURES`. */
  networkFeatures: boolean;
  /** `ADMINIUM_RUNTIME === 'desktop'`. */
  desktop: boolean;
  /** `system.publicOrigin`, as stored (null when not set or learned). */
  publicOrigin: string | null;
  /** `ADMINIUM_TRUST_PROXY`. */
  trustProxy: boolean;
  /** The request asking carried `X-Forwarded-For` or `X-Forwarded-Proto`. */
  forwarded: boolean;
}

export interface Reachability {
  state: ReachabilityState;
  /** The address the answer is about, when there is one. */
  origin: string | null;
  /**
   * PayPal delivers webhooks to port 443 only. True when the address names
   * another port, so the card can warn before a PayPal webhook never arrives.
   */
  notPort443: boolean;
}

function hostKind(hostname: string): 'this-computer' | 'private-network' | 'dot-local' | 'public' {
  if (isLoopbackHost(hostname)) return 'this-computer';
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (host.endsWith('.local')) return 'dot-local';
  const kind = addressKind(host);
  if (kind === 'loopback') return 'this-computer';
  if (kind === 'private' || kind === 'metadata') return 'private-network';
  return 'public';
}

export function reachability(facts: ReachabilityFacts): Reachability {
  const origin = facts.publicOrigin === null ? null : normalizePublicOrigin(facts.publicOrigin);
  const url = origin === null ? null : new URL(origin);
  const notPort443 = url !== null && url.port !== '' && url.port !== '443';
  const answer = (state: ReachabilityState): Reachability => ({ state, origin, notPort443 });
  if (!facts.networkFeatures) return answer('network-off');
  if (facts.desktop) return answer('desktop');
  if (url === null) return answer('not-set');
  const kind = hostKind(url.hostname);
  if (kind !== 'public') return answer(kind);
  if (url.protocol !== 'https:') return answer('not-https');
  if (facts.forwarded && !facts.trustProxy) return answer('proxy-hidden');
  return answer('reachable');
}

/** True when online payments (pay pages, provider checkouts) may be offered at all. */
export function onlinePaymentsPossible(answer: Reachability): boolean {
  return answer.state === 'reachable';
}
