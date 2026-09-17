// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host runtime this dashboard publishes for project code: its React is
 * this app's React, and the lists the build's shims re-export still match
 * the React and react-dom this app ships. A React upgrade that adds an
 * export fails here, before a project library that needs it fails in a page.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import {
  ADD_ON_RUNTIME_KEY,
  PROJECT_UI_EXPORTS,
  REACT_DOM_EXPORTS,
  REACT_EXPORTS,
  clearAddOnRuntime,
  requireAddOnRuntime,
} from '@adminium/add-on-contracts/runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureProjectRuntime, resetProjectRuntime } from './runtime.js';

afterEach(() => {
  clearAddOnRuntime();
  resetProjectRuntime();
});

describe('the project runtime', () => {
  it("publishes this app's React, JSX runtime, react-dom and the kit, once", async () => {
    const first = ensureProjectRuntime();
    expect(ensureProjectRuntime()).toBe(first);
    await first;
    const runtime = requireAddOnRuntime();
    expect((globalThis as Record<string, unknown>)[ADD_ON_RUNTIME_KEY]).toBe(runtime);
    expect(runtime.react).toBe(React);
    expect(runtime.reactDom).toBe(ReactDOM);
    expect(runtime.jsx).toEqual({ jsx, jsxs, Fragment });
    expect(Object.keys(runtime.ui ?? {}).sort()).toEqual([...PROJECT_UI_EXPORTS].sort());
  });

  it('lists every export of the React it ships, and nothing else', () => {
    const shipped = Object.keys(React).sort();
    expect([...REACT_EXPORTS].sort()).toEqual(shipped);
  });

  it('lists every export of the react-dom it ships', () => {
    expect([...REACT_DOM_EXPORTS].sort()).toEqual(Object.keys(ReactDOM).sort());
  });
});
