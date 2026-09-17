// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HOST RUNTIME CONTRACT: how code loaded at run time gets React from the
 * page that loads it.
 *
 * Two kinds of code arrive as ES modules the host did not build: an add-on's
 * client bundle, and a project's own pages and widgets (49-developer-projects.md
 * §6). Both must render with the host's React. Two copies of React in one page
 * are two reconcilers arguing over one DOM tree: hooks throw, context is empty.
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
 * The project UI kit (`@adminiumjs/adminium/ui`, 49 §6.2): what a host puts in
 * `ui`. `definePage` and `defineWidget` are not here; they are plain functions
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
