// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `react/jsx-runtime` shim a bundle build aliases to (see `./index.ts`).
 *
 * The automatic JSX transform emits `jsx`/`jsxs` calls at module scope, which
 * is why the runtime is a global. `react/jsx-dev-runtime` aliases here too: a
 * production build never emits `jsxDEV`, and one that did gets `jsx`.
 */

import { requireAddOnRuntime } from './index.js';

const runtime = requireAddOnRuntime().jsx;

export const jsx = runtime.jsx as never;
export const jsxs = runtime.jsxs as never;
export const jsxDEV = runtime.jsx as never;
export const Fragment = runtime.Fragment as never;
