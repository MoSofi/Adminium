// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host API a dashboard publishes to an add-on's page bundle (51c).
 *
 * Two properties, and the second is the one that decays. First: the shims
 * refuse clearly when the host forgot to install a runtime, or installed one of
 * another version — because the alternative is a hook failing three frames deep
 * inside somebody else's bundle. Second: each shim exports EXACTLY the names
 * its list promises. A list is only an API if nothing can be exported past it,
 * and a name added to one side and not the other is either a symbol nobody can
 * import or a symbol nobody meant to publish.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  ADD_ON_APP_EXPORTS,
  ADD_ON_I18N_EXPORTS,
  ADD_ON_QUERY_EXPORTS,
  ADD_ON_ROUTER_EXPORTS,
  ADD_ON_UI_EXPORTS,
  HOST_API_VERSION,
  clearAddOnRuntime,
  installAddOnRuntime,
  requireAddOnHost,
  type AddOnHostApi,
} from '../src/runtime/index.js';

const stub = (names: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(names.map((name) => [name, () => name]));

function install(over: Partial<AddOnHostApi> = {}): void {
  installAddOnRuntime({
    react: {},
    jsx: { jsx: null, jsxs: null, Fragment: null },
    host: {
      version: HOST_API_VERSION,
      ui: stub(ADD_ON_UI_EXPORTS),
      router: stub(ADD_ON_ROUTER_EXPORTS),
      query: stub(ADD_ON_QUERY_EXPORTS),
      i18n: stub(ADD_ON_I18N_EXPORTS),
      app: stub(ADD_ON_APP_EXPORTS),
      ...over,
    },
  });
}

afterEach(() => {
  clearAddOnRuntime();
});

describe('requireAddOnHost', () => {
  it('names the call the host forgot, rather than returning undefined', () => {
    installAddOnRuntime({ react: {}, jsx: { jsx: null, jsxs: null, Fragment: null } });
    expect(() => requireAddOnHost()).toThrow(/installAddOnRuntime/);
  });

  it('refuses a host publishing a different API version, and says which is which', () => {
    install({ version: HOST_API_VERSION + 1 });
    expect(() => requireAddOnHost()).toThrow(new RegExp(`${HOST_API_VERSION}`));
    // The refusal is the whole point: mounting across a version gap is how a
    // page renders blank with nothing in the console.
    expect(() => requireAddOnHost()).toThrow(/blank/);
  });

  it('returns the five namespaces at the version this package defines', () => {
    install();
    const host = requireAddOnHost();
    expect(host.version).toBe(HOST_API_VERSION);
    expect(Object.keys(host).sort()).toEqual(['app', 'i18n', 'query', 'router', 'ui', 'version']);
  });
});

describe('the shims export exactly what their lists promise', () => {
  const cases: ReadonlyArray<[string, readonly string[], () => Promise<Record<string, unknown>>]> = [
    ['ui', ADD_ON_UI_EXPORTS, () => import('../src/runtime/ui.js')],
    ['router', ADD_ON_ROUTER_EXPORTS, () => import('../src/runtime/router.js')],
    ['query', ADD_ON_QUERY_EXPORTS, () => import('../src/runtime/query.js')],
    ['i18n', ADD_ON_I18N_EXPORTS, () => import('../src/runtime/i18n.js')],
    ['app', ADD_ON_APP_EXPORTS, () => import('../src/runtime/app.js')],
  ];

  for (const [name, list, load] of cases) {
    it(`${name}: every name, nothing more`, async () => {
      install();
      const mod = await load();
      const exported = Object.keys(mod)
        .filter((key) => key !== 'default')
        .sort();
      expect(exported).toEqual([...list].sort());
      // And each one is the host's value, not a copy of its own.
      for (const key of list) expect(typeof mod[key]).toBe('function');
    });
  }

  it('the UI list is the census of what a real page imports', () => {
    // 51 §0.4 counted these off `apps/dashboard/src/invoices/**`. Moving the
    // number is a deliberate act — every name here is public API the day a
    // published add-on imports it.
    expect(ADD_ON_UI_EXPORTS).toHaveLength(22);
    expect(ADD_ON_UI_EXPORTS).toContain('Modal');
    expect(ADD_ON_UI_EXPORTS).not.toContain('Tone');
  });

  it('publishes the host itself, not a copy of it', () => {
    // The fifth namespace is the one an add-on could not fake: `t` reads the
    // running catalogue, `api` carries the session's CSRF token, `useAppToasts`
    // pushes into the tree the user is looking at. 254 import sites in the
    // invoice surface alone depend on these being the host's own.
    expect(ADD_ON_APP_EXPORTS).toContain('t');
    expect(ADD_ON_APP_EXPORTS).toContain('api');
    expect(ADD_ON_APP_EXPORTS).toContain('useAppToasts');
    expect(ADD_ON_APP_EXPORTS).toHaveLength(11);
  });

  it('publishes no way to build a route or a second query client', () => {
    // A page lives under ONE host-registered route, and gets the host's cache
    // through `useQueryClient` — never a `new QueryClient()` of its own.
    expect(ADD_ON_ROUTER_EXPORTS).not.toContain('createRoute');
    expect(ADD_ON_ROUTER_EXPORTS).not.toContain('Link');
    expect(ADD_ON_QUERY_EXPORTS).toContain('useQueryClient');
  });
});
