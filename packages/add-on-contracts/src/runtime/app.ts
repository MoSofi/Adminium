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

const app = requireAddOnHost().app;

export const ApiError = app['ApiError'] as never;
export const PageActions = app['PageActions'] as never;
export const PageSurface = app['PageSurface'] as never;
export const api = app['api'] as never;
export const bootstrapQuery = app['bootstrapQuery'] as never;
export const deferredMessagesReady = app['deferredMessagesReady'] as never;
export const formatSince = app['formatSince'] as never;
export const lucideByName = app['lucideByName'] as never;
export const t = app['t'] as never;
export const useAppToasts = app['useAppToasts'] as never;
export const useShortcut = app['useShortcut'] as never;

export default app;
