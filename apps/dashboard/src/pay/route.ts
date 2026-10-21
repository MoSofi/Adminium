// SPDX-License-Identifier: AGPL-3.0-only
/** Which pay page this is, from its address: a link, the way back from a provider, or the demo's page. */
export type PayRoute =
  | { kind: 'link'; token: string }
  | { kind: 'back'; nonce: string; left: boolean }
  | { kind: 'demo'; attempt: string }
  | { kind: 'none' };

export function routeOf(path: string, search: string): PayRoute {
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] !== 'pay') return { kind: 'none' };
  if (parts[1] === 'back' && parts[2] !== undefined) return { kind: 'back', nonce: parts[2], left: new URLSearchParams(search).has('left') };
  if (parts[1] === 'demo' && parts[2] !== undefined) return { kind: 'demo', attempt: parts[2] };
  if (parts[1] !== undefined && parts.length === 2) return { kind: 'link', token: parts[1] };
  return { kind: 'none' };
}
