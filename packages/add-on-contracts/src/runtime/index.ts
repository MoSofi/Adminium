// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HOST RUNTIME CONTRACT: how code loaded at run time gets React from the
 * page that loads it.
 *
 * Two kinds of code arrive as ES modules the host did not build: an add-on's
 * client bundle, and a project's own pages and widgets. Both must render with
 * the host's React. Two copies of React in one page are two reconcilers arguing
 * over one DOM tree: hooks throw, context is empty.
 *
 * So the host publishes its React on a well-known global before it imports any
 * such module, and the module's build replaces `react`, `react/jsx-runtime`,
 * `react/compiler-runtime` and `react-dom` with the shims beside this file,
 * which read that global. A built bundle then has no bare import a browser
 * would have to resolve, loads from a plain same-origin URL (the CSP needs
 * nothing beyond `'self'`), and still uses exactly one React.
 *
 * This is a copy of the contract `Adminiumjs/add-ons` defines in
 * `packages/host/src/runtime/`, with two optional additions that code written
 * against the original never reads: `reactDom`, and `ui` (the UI kit a project
 * imports from `@adminiumjs/adminium/ui`). `test/runtime.test.ts` pins the
 * shared part, so the two copies cannot drift apart silently.
 *
 * ─── The ordering rule ─────────────────────────────────────────────────────
 *
 * A host MUST call {@link installAddOnRuntime} before it imports a bundle. The
 * shims read the global when their module initialises, so a bundle imported
 * first sees nothing, and the error it throws names the missing call instead
 * of failing later as `undefined is not a function` inside a hook.
 */

/**
 * The React values a bundle may use. An index signature on purpose: the host
 * passes its React namespace straight through, and bundled libraries reach for
 * more of it than any hand-written list would guess.
 */
export type AddOnReactRuntime = Readonly<Record<string, unknown>>;

/** The automatic JSX runtime's entry points. */
export interface AddOnJsxRuntime {
  jsx: unknown;
  jsxs: unknown;
  Fragment: unknown;
}

export interface AddOnRuntime {
  react: AddOnReactRuntime;
  jsx: AddOnJsxRuntime;
  /** The host's `react-dom` namespace, for `createPortal` and friends. */
  reactDom?: Readonly<Record<string, unknown>> | undefined;
  /** The project UI kit, keyed by the names in {@link PROJECT_UI_EXPORTS}. */
  ui?: Readonly<Record<string, unknown>> | undefined;
  /** The host API an add-on PAGE is built against (51c). */
  host?: AddOnHostApi | undefined;
}

/**
 * THE HOST API — what a dashboard publishes to an add-on's page bundle (51c).
 *
 * Four namespaces, each aliased at build time to the shim beside this file, so
 * an add-on's page imports `@adminium/ui`, `@tanstack/react-router`,
 * `@tanstack/react-query` and `@adminium/i18n` by their real names and gets the
 * HOST's copies. Two of those are not optional niceties: a second react-query
 * is a second cache behind an empty provider, and a second router is a second
 * history — both render a blank screen with no error at all.
 *
 * WHY RAW LIBRARIES RATHER THAN A CURATED KIT. `PROJECT_UI_EXPORTS` above is a
 * curated surface, and it is right for a project's own pages: someone writing
 * one is writing new code against a small API. An add-on page is EXISTING code
 * moving across a repository boundary — 51d moves 11,100 lines of it — and a
 * curated kit would mean rewriting every one of those files to import
 * different names for the same components. The lists below are a census of
 * what that code actually imports, not a guess at what it might.
 *
 * WHAT THIS COSTS, SAID OUT LOUD. Every name in the four lists below is public
 * API from the moment a published add-on imports it. `version` is how that is
 * survivable: it is pinned in the manifest as `addOn.hostApi`, and a host that
 * does not recognise a version refuses the page by name instead of mounting it
 * into a blank screen.
 */
export interface AddOnHostApi {
  /** Matches `HOST_API_VERSION`; a bundle built against another is refused. */
  version: number;
  /** `@adminium/ui`, keyed by {@link ADD_ON_UI_EXPORTS}. */
  ui: Readonly<Record<string, unknown>>;
  /** `@tanstack/react-router`, keyed by {@link ADD_ON_ROUTER_EXPORTS}. */
  router: Readonly<Record<string, unknown>>;
  /** `@tanstack/react-query`, keyed by {@link ADD_ON_QUERY_EXPORTS}. */
  query: Readonly<Record<string, unknown>>;
  /** `@adminium/i18n`, keyed by {@link ADD_ON_I18N_EXPORTS}. */
  i18n: Readonly<Record<string, unknown>>;
  /** The DASHBOARD's own helpers, keyed by {@link ADD_ON_APP_EXPORTS}. */
  app: Readonly<Record<string, unknown>>;
}

/** The host API version this package defines; `addOn.hostApi` must equal it. */
export const HOST_API_VERSION = 1;

/**
 * Read the host API, or explain exactly what the host forgot — and never
 * return a half-installed one, because the failure a bundle would otherwise
 * hit is `undefined is not a function` three stack frames inside a hook.
 */
export function requireAddOnHost(): AddOnHostApi {
  const { host } = requireAddOnRuntime();
  if (host === undefined) {
    throw new Error(
      'This host published no add-on host API. Install the runtime with ' +
        'installAddOnRuntime({ react, jsx, host }) BEFORE importing a page bundle.',
    );
  }
  if (host.version !== HOST_API_VERSION) {
    throw new Error(
      `This page was built against host API ${HOST_API_VERSION}, and the host publishes ` +
        `${host.version}. Upgrade whichever is older; mounting it anyway is how a blank ` +
        'screen with no error happens.',
    );
  }
  return host;
}

/**
 * The global a host publishes on. A global rather than an argument because
 * JSX compiles to `jsx(...)` calls at module scope: a bundle's first
 * expression may already need the runtime.
 */
export const ADD_ON_RUNTIME_KEY = '__ADMINIUM_ADD_ON_RUNTIME__';

interface RuntimeCarrier {
  [ADD_ON_RUNTIME_KEY]?: AddOnRuntime;
}

const carrier = (): RuntimeCarrier => globalThis as unknown as RuntimeCarrier;

/** Called by the HOST, once, before importing any bundle. */
export function installAddOnRuntime(runtime: AddOnRuntime): void {
  carrier()[ADD_ON_RUNTIME_KEY] = runtime;
}

/** Whether a host has published a runtime yet. */
export function hasAddOnRuntime(): boolean {
  return carrier()[ADD_ON_RUNTIME_KEY] !== undefined;
}

/** Read the runtime, or explain precisely what the host forgot. */
export function requireAddOnRuntime(): AddOnRuntime {
  const runtime = carrier()[ADD_ON_RUNTIME_KEY];
  if (runtime === undefined) {
    throw new Error(
      'No add-on runtime was installed by the host. Call installAddOnRuntime({ react, jsx }) ' +
        'BEFORE importing any add-on bundle — the bundle reads it as its module initialises, ' +
        'so installing it afterwards is too late.',
    );
  }
  return runtime;
}

/** For a host to clear between tests. */
export function clearAddOnRuntime(): void {
  delete carrier()[ADD_ON_RUNTIME_KEY];
}

/**
 * What the `react` shim re-exports: React 19's public surface. A name a
 * bundle imports that is missing here fails its build, never its page, and
 * the dashboard's test compares this list with the React it ships.
 */
export const REACT_EXPORTS = [
  'Activity',
  'Children',
  'Component',
  'Fragment',
  'Profiler',
  'PureComponent',
  'StrictMode',
  'Suspense',
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  '__COMPILER_RUNTIME',
  'act',
  'cache',
  'cacheSignal',
  'captureOwnerStack',
  'cloneElement',
  'createContext',
  'createElement',
  'createRef',
  'forwardRef',
  'isValidElement',
  'lazy',
  'memo',
  'startTransition',
  'unstable_useCacheRefresh',
  'use',
  'useActionState',
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useEffectEvent',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useOptimistic',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
  'version',
] as const;

/** What the `react/jsx-runtime` shim exports (`jsxDEV` maps to `jsx`). */
export const JSX_RUNTIME_EXPORTS = ['Fragment', 'jsx', 'jsxDEV', 'jsxs'] as const;

/** What the `react-dom` shim re-exports. `react-dom/client` is the host's alone. */
export const REACT_DOM_EXPORTS = [
  '__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  'createPortal',
  'flushSync',
  'preconnect',
  'prefetchDNS',
  'preinit',
  'preinitModule',
  'preload',
  'preloadModule',
  'requestFormReset',
  'unstable_batchedUpdates',
  'useFormState',
  'useFormStatus',
  'version',
] as const;

/**
 * The project UI kit (`@adminiumjs/adminium/ui`): what a host puts in `ui`.
 * `definePage` and `defineWidget` are not here; they are plain functions
 * inside the kit module itself, so a build can read a page's settings without
 * a host.
 */
export const PROJECT_UI_EXPORTS = [
  'Button',
  'Card',
  'DataTable',
  'EmptyState',
  'GeneratedPage',
  'Grid',
  'Icon',
  'Input',
  'Link',
  'Page',
  'Select',
  'Stack',
  'Stat',
  'Switch',
  'toast',
  'useCurrentUser',
  'useMutation',
  'useNavigate',
  'useRecord',
  'useRecords',
] as const;

export type ProjectUiExport = (typeof PROJECT_UI_EXPORTS)[number];

/**
 * THE DASHBOARD'S OWN HELPERS — the fifth namespace (51d, O7).
 *
 * The first four are libraries an add-on could in principle bundle for itself
 * (wrongly, but it could). These eleven are the HOST: its translation function,
 * its API client, its toast bus, its page chrome, its icon resolver. An add-on
 * page cannot reimplement them — a second `t()` reads a second catalogue, a
 * second API client misses the CSRF token, a second toast bus renders toasts
 * nobody sees — so they are published rather than copied.
 *
 * THIS IS THE SURFACE O7 ADDED, AND IT IS THE WIDER HALF OF THE DOOR. It was
 * found by counting: the invoice surface imports these at 254 sites across 72
 * of its 85 files, which is what turned "move the page" from a file move into
 * an API decision. `t` alone is 59 of them.
 *
 * `formatSince` lives in `team/teamApi.ts` today, which is an accident of where
 * it was first needed — it is a pure `Intl.RelativeTimeFormat` wrapper over the
 * host's cached formatters. Published here rather than copied, so two relative
 * clocks cannot disagree on the same screen.
 */
export const ADD_ON_APP_EXPORTS = [
  'ApiError',
  'PageActions',
  'PageSurface',
  'api',
  'bootstrapQuery',
  'deferredMessagesReady',
  'formatSince',
  'lucideByName',
  't',
  'useAppToasts',
  'useShortcut',
] as const;
export type AddOnAppExport = (typeof ADD_ON_APP_EXPORTS)[number];

/**
 * `@adminium/ui` — the components an add-on page may import (51c).
 *
 * A census, not a guess: every symbol the invoice surface imports from the
 * kit, which is the first and largest page to move. Adding a
 * name here is adding public API and is a deliberate act; `add-on-host.test.ts`
 * holds the shim and this list equal so neither can grow quietly.
 */
export const ADD_ON_UI_EXPORTS = [
  'Alert',
  'AutosaveIndicator',
  'Badge',
  'Button',
  'EmptyState',
  'IconButton',
  'Modal',
  'ModalBody',
  'ModalFooter',
  'ModalHeader',
  'Popover',
  'PopoverContent',
  'PopoverTrigger',
  'SearchInput',
  'SegmentedControl',
  'Spinner',
  'Tabs',
  'TabsContent',
  'TabsList',
  'TabsTrigger',
  'Tag',
  'cn',
] as const;
export type AddOnUiExport = (typeof ADD_ON_UI_EXPORTS)[number];

/**
 * `@tanstack/react-router` — navigation only.
 *
 * No `Link`, no route-building: an add-on page lives under one route the HOST
 * registered (`/add-ons/$key/$`), and giving it the router's route API would
 * let it define routes the host's tree has never heard of.
 */
export const ADD_ON_ROUTER_EXPORTS = ['useBlocker', 'useNavigate', 'useParams', 'useSearch'] as const;
export type AddOnRouterExport = (typeof ADD_ON_ROUTER_EXPORTS)[number];

/**
 * `@tanstack/react-query` — the host's client, never a second one.
 *
 * `QueryClient` is here as a TYPE consumers annotate with; a page that
 * constructs one gets its own cache, which is the bug this namespace exists to
 * prevent, and `useQueryClient` is what it should reach for instead.
 */
export const ADD_ON_QUERY_EXPORTS = [
  'QueryClient',
  'queryOptions',
  'useMutation',
  'useQuery',
  'useQueryClient',
] as const;
export type AddOnQueryExport = (typeof ADD_ON_QUERY_EXPORTS)[number];

/**
 * `@adminium/i18n` — turning the session's locale id into something `Intl`
 * understands. `tagForLocale` is the one the invoice surface actually calls
 * (`de_DE` → `de-DE`); `LocaleId` travels with it as a type, which needs no
 * runtime export.
 */
export const ADD_ON_I18N_EXPORTS = ['tagForLocale'] as const;
export type AddOnI18nExport = (typeof ADD_ON_I18N_EXPORTS)[number];
