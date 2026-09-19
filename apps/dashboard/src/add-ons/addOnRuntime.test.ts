// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the dashboard actually publishes to an add-on page bundle (51c/51d).
 *
 * The contracts package holds the shims equal to their lists; this holds the
 * HOST equal to the same lists. Both ends matter and they fail differently: a
 * name missing from the shim cannot be imported, while a name missing here
 * imports fine and is `undefined` at the call site, three frames inside
 * somebody else's bundle.
 *
 * It also pins the reason the imports in `runtime.ts` are written out one by
 * one instead of `import * as ui`: the namespace form put 2.6 KiB gz into the
 * ENTRY chunk by widening what this lazy chunk shares with the others.
 */
import {
  ADD_ON_APP_EXPORTS,
  ADD_ON_I18N_EXPORTS,
  ADD_ON_QUERY_EXPORTS,
  ADD_ON_ROUTER_EXPORTS,
  ADD_ON_UI_EXPORTS,
  HOST_API_VERSION,
  clearAddOnRuntime,
  requireAddOnHost,
} from '@adminium/add-on-contracts/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureAddOnRuntime, resetAddOnRuntime } from './runtime.js';

beforeEach(async () => {
  clearAddOnRuntime();
  resetAddOnRuntime();
  await ensureAddOnRuntime();
});

afterEach(() => {
  clearAddOnRuntime();
  resetAddOnRuntime();
});

describe('the host API the dashboard publishes', () => {
  it('is at the version this build of the contract defines', () => {
    expect(requireAddOnHost().version).toBe(HOST_API_VERSION);
  });

  const cases: ReadonlyArray<[keyof ReturnType<typeof requireAddOnHost>, readonly string[]]> = [
    ['ui', ADD_ON_UI_EXPORTS],
    ['router', ADD_ON_ROUTER_EXPORTS],
    ['query', ADD_ON_QUERY_EXPORTS],
    ['i18n', ADD_ON_I18N_EXPORTS],
    ['app', ADD_ON_APP_EXPORTS],
  ];

  for (const [namespace, list] of cases) {
    it(`${String(namespace)}: publishes every name on its list, and nothing else`, () => {
      const published = requireAddOnHost()[namespace] as Readonly<Record<string, unknown>>;
      expect(Object.keys(published).sort()).toEqual([...list].sort());
      for (const name of list) expect(published[name]).toBeDefined();
    });
  }
});
