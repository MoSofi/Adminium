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
import type { AddOnAppNamespace, AddOnApiError } from './app-types.js';

export type * from './app-types.js';

const app = requireAddOnHost().app as unknown as AddOnAppNamespace;

export const ApiError = app.ApiError;
/** The same name as a TYPE, so `catch (e: ApiError)` compiles. */
export type ApiError = AddOnApiError;
/*
 * "Shown in" (from 0.3.49): a page that imports these sets its
 * `compatibility.minAdminiumVersion` to 0.3.49 or later, so it is never
 * mounted on a host without them.
 */
export const CurrentWorkspaceChip = app.CurrentWorkspaceChip;
export const HiddenHereNote = app.HiddenHereNote;
export const ShownInChips = app.ShownInChips;
export const ShownInControl = app.ShownInControl;
export const ShownInField = app.ShownInField;
export const ShownInHeader = app.ShownInHeader;
export const WorkspaceFilter = app.WorkspaceFilter;
/** Undefined on a host older than it. */
export const DocumentPaymentPanel = app.DocumentPaymentPanel;
export const PageActions = app.PageActions;
export const PageSurface = app.PageSurface;
export const api = app.api;
export const formatSince = app.formatSince;
export const lucideByName = app.lucideByName;
export const registerMessages = app.registerMessages;
export const t = app.t;
export const useLocaleTag = app.useLocaleTag;
export const useAppToasts = app.useAppToasts;
export const useShortcut = app.useShortcut;
export const useShownInList = app.useShownInList;
export const useShownInPicker = app.useShownInPicker;
export const useShownInScope = app.useShownInScope;

export default app;
