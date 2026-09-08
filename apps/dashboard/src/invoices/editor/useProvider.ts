// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a document provider (the invoices add-on, 34-invoices-add-on.md
 * §3.9 "What the add-on still owns") is installed on this instance — what
 * the editor's primary button reads off (34 O24): with a provider, an
 * invoice's primary is *Send invoice* (render + deliver, §7.3/§7.7); with
 * none, it reads *Save invoice* and only saves (24 D6).
 *
 * STUB. Its future source is `GET /api/v1/documents/providers` (34-T12),
 * which nothing serves yet; until it does every instance reads as
 * provider-less and the button says *Save invoice*.
 */
export interface ProviderState {
  installed: boolean;
}

const NONE: ProviderState = { installed: false };

export function useProvider(): ProviderState {
  return NONE;
}
