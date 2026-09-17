// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host runtime contract (`src/runtime/`).
 *
 * The global's name and the `{ react, jsx }` part are shared with the copy in
 * `Adminiumjs/add-ons` (`packages/host/src/runtime/index.ts`), whose built
 * bundles already read them. They are pinned here as literals: renaming the
 * key, or the fields an add-on reads, breaks every add-on built against it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADD_ON_RUNTIME_KEY,
  JSX_RUNTIME_EXPORTS,
  PROJECT_UI_EXPORTS,
  REACT_DOM_EXPORTS,
  REACT_EXPORTS,
  clearAddOnRuntime,
  hasAddOnRuntime,
  installAddOnRuntime,
  requireAddOnRuntime,
  type AddOnRuntime,
} from '../src/runtime/index.js';

/** A stand-in namespace whose every value is a distinct object, so identity is checkable. */
function namespace(names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, { name }]));
}

function fakeRuntime(opts: { reactDom?: boolean } = {}): AddOnRuntime {
  const react = namespace(REACT_EXPORTS);
  react['__COMPILER_RUNTIME'] = { c: () => 'memo cache' };
  return {
    react,
    jsx: { jsx: () => 'jsx', jsxs: () => 'jsxs', Fragment: Symbol.for('react.fragment') },
    ...(opts.reactDom === false ? {} : { reactDom: namespace(REACT_DOM_EXPORTS) }),
  };
}

const exportNames = (mod: Record<string, unknown>): string[] =>
  Object.keys(mod)
    .filter((name) => name !== 'default')
    .sort();

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  clearAddOnRuntime();
});

describe('the global', () => {
  it('is the one the add-ons repo publishes on', () => {
    expect(ADD_ON_RUNTIME_KEY).toBe('__ADMINIUM_ADD_ON_RUNTIME__');
  });

  it('is installed, read and cleared on globalThis', () => {
    expect(hasAddOnRuntime()).toBe(false);
    const runtime = fakeRuntime();
    installAddOnRuntime(runtime);
    expect(hasAddOnRuntime()).toBe(true);
    expect((globalThis as Record<string, unknown>)['__ADMINIUM_ADD_ON_RUNTIME__']).toBe(runtime);
    expect(requireAddOnRuntime()).toBe(runtime);
    clearAddOnRuntime();
    expect(hasAddOnRuntime()).toBe(false);
  });

  it('names the missing call when nothing was installed', () => {
    expect(() => requireAddOnRuntime()).toThrow(/installAddOnRuntime\(\{ react, jsx \}\).*BEFORE/s);
  });
});

describe('the shims', () => {
  it('re-export every React name from the host, and React itself as the default', async () => {
    const runtime = fakeRuntime();
    installAddOnRuntime(runtime);
    const mod = (await import('../src/runtime/react.js')) as Record<string, unknown>;
    expect(exportNames(mod)).toEqual([...REACT_EXPORTS].sort());
    for (const name of REACT_EXPORTS) expect(mod[name]).toBe(runtime.react[name]);
    expect(mod['default']).toBe(runtime.react);
  });

  it('give the JSX runtime, with jsxDEV as jsx', async () => {
    const runtime = fakeRuntime();
    installAddOnRuntime(runtime);
    const mod = (await import('../src/runtime/jsx-runtime.js')) as Record<string, unknown>;
    expect(exportNames(mod)).toEqual([...JSX_RUNTIME_EXPORTS].sort());
    expect(mod['jsx']).toBe(runtime.jsx.jsx);
    expect(mod['jsxs']).toBe(runtime.jsx.jsxs);
    expect(mod['jsxDEV']).toBe(runtime.jsx.jsx);
    expect(mod['Fragment']).toBe(runtime.jsx.Fragment);
  });

  it("give the compiler runtime's memo-cache helper", async () => {
    const runtime = fakeRuntime();
    installAddOnRuntime(runtime);
    const mod = (await import('../src/runtime/compiler-runtime.js')) as Record<string, unknown>;
    expect(mod['c']).toBe((runtime.react['__COMPILER_RUNTIME'] as { c: unknown }).c);
  });

  it('leave the compiler helper undefined for a React without one', async () => {
    const runtime = fakeRuntime();
    installAddOnRuntime({ ...runtime, react: { ...runtime.react, __COMPILER_RUNTIME: undefined } });
    const mod = (await import('../src/runtime/compiler-runtime.js')) as Record<string, unknown>;
    expect(mod['c']).toBeUndefined();
  });

  it("re-export the host's react-dom", async () => {
    const runtime = fakeRuntime();
    installAddOnRuntime(runtime);
    const mod = (await import('../src/runtime/react-dom.js')) as Record<string, unknown>;
    expect(exportNames(mod)).toEqual([...REACT_DOM_EXPORTS].sort());
    for (const name of REACT_DOM_EXPORTS) expect(mod[name]).toBe(runtime.reactDom?.[name]);
    expect(mod['default']).toBe(runtime.reactDom);
  });

  it('refuse react-dom from a host that did not publish it', async () => {
    installAddOnRuntime(fakeRuntime({ reactDom: false }));
    await expect(import('../src/runtime/react-dom.js')).rejects.toThrow(/did not publish react-dom/);
  });

  it('fail at import, by name, when the host installed nothing', async () => {
    await expect(import('../src/runtime/react.js')).rejects.toThrow(/No add-on runtime was installed/);
    await expect(import('../src/runtime/jsx-runtime.js')).rejects.toThrow(/No add-on runtime was installed/);
  });
});

describe('the project UI kit names', () => {
  it('are unique and sorted, so a host and a build compare them as lists', () => {
    expect(new Set(PROJECT_UI_EXPORTS).size).toBe(PROJECT_UI_EXPORTS.length);
    expect([...PROJECT_UI_EXPORTS]).toEqual(
      [...PROJECT_UI_EXPORTS].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
  });

  it('leave the define helpers to the kit module', () => {
    expect(PROJECT_UI_EXPORTS).not.toContain('definePage');
    expect(PROJECT_UI_EXPORTS).not.toContain('defineWidget');
  });
});
