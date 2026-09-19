// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TYPES of the dashboard's own helpers, as an add-on page sees them.
 *
 * The four library namespaces beside this one need no types from here: an
 * add-on writes `import { Button } from '@adminium/ui'`, keeps the real package
 * as a devDependency for its types, and only the BUILD swaps the specifier for
 * the shim. Aliases are a runtime concern; types are not.
 *
 * `app` has no such package behind it — the dashboard is the implementation —
 * so its signatures are written here, and they are public API. They are narrow
 * on purpose: each one is the shape the first real consumer actually uses, not
 * everything the host happens to export. A name earns its way in when a page
 * needs it.
 *
 * ONE NAME LEFT THIS LIST THE DAY IT WAS WRITTEN, and the reason is worth
 * keeping. `deferredMessagesReady` was here because the invoice surface calls
 * it — to load the engine's `invoices` namespace. It takes the host's CLOSED
 * set of deferred namespaces, so declaring it as `(namespace: string)` did not
 * typecheck against the real one, which is the type system pointing out that an
 * add-on has no business naming an ENGINE namespace. Its own strings ship in
 * its own bundle.
 *
 * NOTHING HOLDS THESE TRUE BY ITSELF, so the host proves it: the dashboard's
 * `add-ons/runtime.ts` publishes its real implementations `satisfies
 * AddOnAppNamespace`, so a signature that drifts fails the DASHBOARD's build
 * rather than an add-on's, in another repository, after a release. Both of the
 * corrections above were found that way, within a minute of writing them.
 */
import type { ComponentType, ReactNode } from 'react';

/** `apiFetch` returns the WHOLE body; these are the verbs a page uses. */
export interface AddOnApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, payload?: unknown): Promise<T>;
  put<T>(path: string, payload: unknown): Promise<T>;
  patch<T>(path: string, payload: unknown): Promise<T>;
  delete<T>(path: string, payload?: unknown): Promise<T>;
}

/** What `api` rejects with. A page reads it through `instanceof`. */
export interface AddOnApiError extends Error {
  readonly status: number;
  /** SCREAMING_SNAKE canonical code, e.g. `SESSION_EXPIRED`. */
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;
}

export interface AddOnApiErrorConstructor {
  new (
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    details?: unknown,
  ): AddOnApiError;
  readonly prototype: AddOnApiError;
}

/**
 * The host's translator. The FALLBACK IS REQUIRED, and that is the contract
 * rather than an oversight: it is what renders before a namespace has loaded,
 * and in a locale that has no translation for the key at all.
 */
export type AddOnTranslate = (
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
) => string;

export interface AddOnToast {
  variant: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string | undefined;
}

/** What `useAppToasts()` answers with. */
export interface AddOnToastQueue {
  push(toast: AddOnToast): void;
}

/** The topbar's title, subtitle and back link for the screen being rendered. */
export interface AddOnPageActionsProps {
  title?: string | undefined;
  subtitle?: string | undefined;
  documentTitle?: string | undefined;
  backTo?: string | undefined;
  titleAdornment?: ReactNode;
  /** The actions themselves — rendered into the shell's own topbar slot. */
  children?: ReactNode;
}

export interface AddOnPagePaddingPair {
  x: number;
  y: number;
}

export type AddOnPagePadding = 'none' | 'standard' | AddOnPagePaddingPair;
export type AddOnPageWidth = 'full' | 'narrow' | 'content' | 'page' | 'wide' | 'dash';

/** The frame every dashboard screen sits in, so an add-on's page looks like one. */
export interface AddOnPageSurfaceProps {
  padding?: AddOnPagePadding | undefined;
  width?: AddOnPageWidth | undefined;
  fill?: boolean | undefined;
  testId?: string | undefined;
  className?: string | undefined;
  /** Required, as the host requires it: an empty surface is not a screen. */
  children: ReactNode;
}

/** The closed set of headings the shortcuts panel groups by. */
export type AddOnShortcutGroup = 'General' | 'Navigation' | 'Actions' | 'View' | 'Editing' | 'Data';

export interface AddOnShortcutDef {
  /** Unique id, e.g. `invoices-save`. */
  id: string;
  group: AddOnShortcutGroup;
  /** Already translated at the registration site. */
  label: string;
  /** Display keys; `'then'` marks a chord separator. */
  keys: readonly string[];
  when?: (() => boolean) | undefined;
  handler?: ((event: KeyboardEvent) => void) | undefined;
}

/** A lucide icon resolved by name; an unknown name yields the neutral glyph. */
export type AddOnIconLookup = (name: string) => ComponentType<{ className?: string }>;

/** Flat, dotted keys per locale tag: `{ 'de-DE': { 'manager.title': '…' } }`. */
export type AddOnMessageBundles = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * Hand the host every locale this add-on ships and get back a translator bound
 * to them.
 *
 * The add-on never names the namespace it lands in — the host derives one from
 * the add-on's key — so two add-ons that both think of their words as
 * `documents` cannot read each other's. Call it once, at module scope, and use
 * the function it returns for every string.
 */
export type AddOnRegisterMessages = (
  addOnKey: string,
  bundles: AddOnMessageBundles,
) => AddOnTranslate;

/** Relative time in the session's locale, sharing the host's cached formatters. */
export type AddOnFormatSince = (
  epochMs: number | null,
  localeTag: string,
  now: number,
) => string | null;

/**
 * The whole `app` namespace, as one type the host can be checked against.
 *
 * `bootstrapQuery` is deliberately loose: it hands back the host's own
 * react-query options object, which this package cannot name without taking a
 * dependency on react-query for a single signature. A page passes it straight
 * to `useQuery`, which is where its real shape is checked.
 */
export interface AddOnAppNamespace {
  ApiError: AddOnApiErrorConstructor;
  PageActions: ComponentType<AddOnPageActionsProps>;
  PageSurface: ComponentType<AddOnPageSurfaceProps>;
  api: AddOnApiClient;
  bootstrapQuery: () => unknown;
  formatSince: AddOnFormatSince;
  lucideByName: AddOnIconLookup;
  registerMessages: AddOnRegisterMessages;
  t: AddOnTranslate;
  useAppToasts: () => AddOnToastQueue;
  useShortcut: (def: AddOnShortcutDef) => void;
}
