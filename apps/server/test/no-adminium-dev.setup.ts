// SPDX-License-Identifier: AGPL-3.0-only
/**
 * No test reaches adminium.dev.
 *
 * Since 0.3.16 the two catalogue switches default to ON, so a server composed
 * in a test with network features on would ask the real adminium.dev for its
 * lists the moment something read them: a test that passes or fails by the
 * state of a web site, and a call out of CI nobody meant. A test that wants a
 * list gives the client its own `fetchImpl`; one that wants the list off sets
 * the switch. Anything else that gets as far as the real fetch stops here.
 */
const REAL = globalThis.fetch;
const OURS = /(^|\.)adminium\.dev$/i;

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  let host = '';
  try {
    host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname;
  } catch {
    // Not an absolute address: nothing of ours.
  }
  if (OURS.test(host)) {
    return Promise.reject(new Error(`a test reached ${host}: give the catalogue client a fetchImpl, or switch the list off (apps.catalogEnabled, addOns.catalogEnabled)`));
  }
  return REAL(input, init);
}) as typeof fetch;
