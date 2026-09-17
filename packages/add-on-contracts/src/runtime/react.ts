// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `react` shim a bundle build aliases `react` to (see `./index.ts`).
 *
 * Every export is read from the host runtime when this module initialises, so
 * a built bundle carries these lines instead of a bare `import … from 'react'`.
 * Types are not re-exported and need not be: TypeScript erases type imports,
 * and `tsc` still checks them against the real `react` types.
 */

import { requireAddOnRuntime } from './index.js';

const react = requireAddOnRuntime().react as Record<string, unknown>;

export const Activity = react['Activity'] as never;
export const Children = react['Children'] as never;
export const Component = react['Component'] as never;
export const Fragment = react['Fragment'] as never;
export const Profiler = react['Profiler'] as never;
export const PureComponent = react['PureComponent'] as never;
export const StrictMode = react['StrictMode'] as never;
export const Suspense = react['Suspense'] as never;
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = react['__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE'] as never;
export const __COMPILER_RUNTIME = react['__COMPILER_RUNTIME'] as never;
export const act = react['act'] as never;
export const cache = react['cache'] as never;
export const cacheSignal = react['cacheSignal'] as never;
export const captureOwnerStack = react['captureOwnerStack'] as never;
export const cloneElement = react['cloneElement'] as never;
export const createContext = react['createContext'] as never;
export const createElement = react['createElement'] as never;
export const createRef = react['createRef'] as never;
export const forwardRef = react['forwardRef'] as never;
export const isValidElement = react['isValidElement'] as never;
export const lazy = react['lazy'] as never;
export const memo = react['memo'] as never;
export const startTransition = react['startTransition'] as never;
export const unstable_useCacheRefresh = react['unstable_useCacheRefresh'] as never;
export const use = react['use'] as never;
export const useActionState = react['useActionState'] as never;
export const useCallback = react['useCallback'] as never;
export const useContext = react['useContext'] as never;
export const useDebugValue = react['useDebugValue'] as never;
export const useDeferredValue = react['useDeferredValue'] as never;
export const useEffect = react['useEffect'] as never;
export const useEffectEvent = react['useEffectEvent'] as never;
export const useId = react['useId'] as never;
export const useImperativeHandle = react['useImperativeHandle'] as never;
export const useInsertionEffect = react['useInsertionEffect'] as never;
export const useLayoutEffect = react['useLayoutEffect'] as never;
export const useMemo = react['useMemo'] as never;
export const useOptimistic = react['useOptimistic'] as never;
export const useReducer = react['useReducer'] as never;
export const useRef = react['useRef'] as never;
export const useState = react['useState'] as never;
export const useSyncExternalStore = react['useSyncExternalStore'] as never;
export const useTransition = react['useTransition'] as never;
export const version = react['version'] as never;

/** The classic JSX transform calls `React.createElement` on the default export. */
export default react;
