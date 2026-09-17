// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a document provider (the invoices add-on) is installed on this
 * instance — what the editor's primary button reads off: with a provider,
 * an invoice's primary is *Send invoice* (render + deliver); with none,
 * it reads *Save invoice* and only saves.
 *
 * STUB. Its future source is `GET /api/v1/documents/providers`, which
 * nothing serves yet; until it does every instance reads as
 * provider-less and the button says *Save invoice*.
 */
export interface ProviderState {
  installed: boolean;
}

const NONE: ProviderState = { installed: false };

export function useProvider(): ProviderState {
  return NONE;
}
