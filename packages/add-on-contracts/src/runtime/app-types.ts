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

/**
 * What `api` rejects with. A page reads it through `instanceof` AND annotates
 * with it, so the shim exports the name as a value and a TYPE both — the first
 * consumer wrote `catch (error: ApiError)` and the value-only export failed
 * with "refers to a value, but is being used as a type here".
 */
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

/** The button a toast may carry — Undo, Download, Retry. */
export interface AddOnToastAction {
  label: string;
  onAction: () => void;
}

export interface AddOnToast {
  variant?: 'success' | 'error' | 'info' | 'warning' | 'loading' | undefined;
  title: ReactNode;
  description?: ReactNode;
  action?: AddOnToastAction | undefined;
  /** `null` keeps the toast until it is dismissed. */
  duration?: number | null | undefined;
}

/**
 * What `useAppToasts()` answers with — a subset of the kit's queue, and the
 * subset is the point: a page may raise a toast and dismiss one, and has no
 * business reaching the stack's own props or its hover timers.
 */
export interface AddOnToastQueue {
  push(toast: AddOnToast): string;
  dismiss(id?: string): void;
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
 * The BCP-47 tag the viewer is reading in — `de-DE`, `ar-EG`.
 *
 * THIS REPLACED `bootstrapQuery`, and the replacement is the better API for a
 * reason worth keeping. Publishing the query options meant publishing a shape
 * this package cannot name without depending on react-query, so it was typed
 * `unknown` — and `useQuery(bootstrapQuery())` then did not compile at all.
 * Looking at what the page actually wanted from the whole bootstrap payload,
 * it was this one string, for a date formatter.
 */
export type AddOnLocaleTag = () => string;

/** The whole `app` namespace, as one type the host can be checked against. */
/**
 * The host's Payment panel for an invoice made on the Invoices page: its
 * balance, its payments and refunds, the pay link and "Record a payment", as
 * the record page shows them. It loads its own code and words when it first
 * mounts, and renders nothing for a document that takes no payments.
 */
export interface AddOnDocumentPaymentPanelProps {
  /** The invoice document's id. */
  documentId: string;
  /** A payment or refund changed the invoice (its balance, its status): the page reads it again. */
  onChanged?: (() => void) | undefined;
}

/**
 * "SHOWN IN": where an item an add-on keeps (an invoice layout, a template)
 * is listed. In every workspace (`all`, the default), or in the chosen ones
 * (`chosen`, possibly none). It narrows lists and pickers; a send never asks.
 * The add-on stores it on its own rows and sends it back on a PATCH; the
 * host draws it and says which workspaces this person may see (from their
 * session: no workspace-managing permission is needed).
 *
 * A server with no workspaces draws none of it: `scope.active` is false, the
 * control and the filter draw nothing, and a list is not narrowed.
 */
export interface AddOnShownIn {
  mode: 'all' | 'chosen';
  /** The chosen workspaces; empty for `all`, and for "chosen, none". */
  workspaceIds: string[];
}

/** A workspace as "Shown in" draws it. */
export interface AddOnShownInWorkspace {
  id: string;
  name: string;
  /** Up to two letters for its tile. */
  initials: string;
  position: number;
}

/** The workspaces this person sees, and which one this tab is in. */
export interface AddOnShownInScope {
  /** The workspaces this person sees, by position. Empty when the server has none (or none for them). */
  workspaces: AddOnShownInWorkspace[];
  /** Whether "Shown in" is drawn at all: only when there is a workspace to choose. */
  active: boolean;
  /** Whether "Other databases" (the databases in no workspace) is a group for this person. */
  otherDatabases: boolean;
  /** How the menu shows workspaces: one at a time, or all in one menu. */
  view: 'one' | 'all';
  /** The tab's workspace (an id, or `~other` for "Other databases"); null when the tab is in none. */
  currentWorkspaceId: string | null;
}

/**
 * A list's "Shown in" cut. In One at a time it follows the tab's workspace;
 * in All in one menu it is the list's own Workspace filter. Send
 * `workspaceId` with the list's request (as `?workspaceId=`, which only
 * narrows), and keep the rows `keeps` keeps ("Other databases" is no
 * workspace the server knows, so its cut is made here).
 */
export interface AddOnShownInList {
  scope: AddOnShownInScope;
  workspaceId: string | undefined;
  keeps: (shownIn: AddOnShownIn | undefined) => boolean;
  /** Whether the list draws its "Shown in" column (or card chips). */
  showColumn: boolean;
  /** The Workspace filter's value and setter, for `WorkspaceFilter`: drawn in All in one menu only, null otherwise. */
  filter: { value: string; onChange: (next: string) => void } | null;
}

/** A picker's cut: what is listed in the tab's workspace, in either view. */
export type AddOnShownInPicker = Pick<AddOnShownInList, 'scope' | 'workspaceId' | 'keeps'>;

/** Where an item is listed, as chips: a list cell or a card's foot. */
export interface AddOnShownInChipsProps {
  shownIn: AddOnShownIn | undefined;
  className?: string | undefined;
}

/** "Shown in" on an item's editor: the two choices, and the workspaces under the second. Controlled. */
export interface AddOnShownInControlProps {
  value: AddOnShownIn;
  onChange: (next: AddOnShownIn) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * `ShownInControl`, saved as it changes: each change is its own small write
 * (`save`, a PATCH of `{ shownIn }`), one at a time and in order; a write that
 * fails puts the control back and says so.
 */
export interface AddOnShownInFieldProps {
  /** What the server holds now. */
  value: AddOnShownIn | undefined;
  /** Writes one change; resolves when the server has it. */
  save: (next: AddOnShownIn) => Promise<unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** A list's "Workspace" select, for All in one menu: `''` is every workspace. Pass `useShownInList().filter`. */
export interface AddOnWorkspaceFilterProps {
  value: string;
  onChange: (next: string) => void;
}

/** A chosen item that is not listed in the tab's workspace: it still sends, and the note says where it is listed. */
export interface AddOnHiddenHereNoteProps {
  shownIn: AddOnShownIn;
}

export interface AddOnAppNamespace {
  ApiError: AddOnApiErrorConstructor;
  /** The tab's workspace, when a list is narrowed to it (One at a time): drawn under a list page's title. From 0.3.49. */
  CurrentWorkspaceChip: ComponentType;
  /** From 0.3.49. */
  HiddenHereNote: ComponentType<AddOnHiddenHereNoteProps>;
  /** From 0.3.49. */
  ShownInChips: ComponentType<AddOnShownInChipsProps>;
  /** From 0.3.49. */
  ShownInControl: ComponentType<AddOnShownInControlProps>;
  /** From 0.3.49. */
  ShownInField: ComponentType<AddOnShownInFieldProps>;
  /** A list's "Shown in" column header. From 0.3.49. */
  ShownInHeader: ComponentType;
  /** From 0.3.49. */
  WorkspaceFilter: ComponentType<AddOnWorkspaceFilterProps>;
  /**
   * Every host from this one on publishes it. An older host has none, so the
   * type says so: a page checks it is there before rendering it.
   */
  DocumentPaymentPanel: ComponentType<AddOnDocumentPaymentPanelProps> | undefined;
  PageActions: ComponentType<AddOnPageActionsProps>;
  PageSurface: ComponentType<AddOnPageSurfaceProps>;
  api: AddOnApiClient;
  formatSince: AddOnFormatSince;
  lucideByName: AddOnIconLookup;
  registerMessages: AddOnRegisterMessages;
  t: AddOnTranslate;
  useLocaleTag: AddOnLocaleTag;
  useAppToasts: () => AddOnToastQueue;
  useShortcut: (def: AddOnShortcutDef) => void;
  /** A list's "Shown in" cut. From 0.3.49. */
  useShownInList: () => AddOnShownInList;
  /** A picker's "Shown in" cut. From 0.3.49. */
  useShownInPicker: () => AddOnShownInPicker;
  /** The workspaces this person sees, and the tab's. From 0.3.49. */
  useShownInScope: () => AddOnShownInScope;
}
