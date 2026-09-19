// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `@adminium/add-on-sdk` shim: the DASHBOARD's own helpers (51d, O7).
 *
 * Unlike the four library shims beside it, there is no npm package behind
 * this specifier — the host IS the implementation. An add-on page imports its
 * `t`, its API client, its toasts and its page chrome from here, and gets the
 * running dashboard rather than a copy of it: a second `t()` reads a second
 * catalogue, a second API client carries no CSRF token, and a second toast bus
 * renders toasts into a tree nobody is looking at.
 *
 * The names are `ADD_ON_APP_EXPORTS` and nothing else; `add-on-host.test.ts`
 * holds the two equal.
 */

import { requireAddOnHost } from './index.js';
import type { AddOnAppNamespace } from './app-types.js';

export type * from './app-types.js';

const app = requireAddOnHost().app as unknown as AddOnAppNamespace;

export const ApiError = app.ApiError;
export const PageActions = app.PageActions;
export const PageSurface = app.PageSurface;
export const api = app.api;
export const bootstrapQuery = app.bootstrapQuery;
export const formatSince = app.formatSince;
export const lucideByName = app.lucideByName;
export const registerMessages = app.registerMessages;
export const t = app.t;
export const useAppToasts = app.useAppToasts;
export const useShortcut = app.useShortcut;

export default app;
