// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `react-dom` shim a bundle build aliases `react-dom` to (see
 * `./index.ts`). A bundle may portal and flush with the host's `react-dom`;
 * it never creates a root of its own, so `react-dom/client` has no shim.
 */

import { requireAddOnRuntime } from './index.js';

const runtime = requireAddOnRuntime();
if (runtime.reactDom === undefined) {
  throw new Error(
    'This host did not publish react-dom. Install the runtime with installAddOnRuntime({ react, jsx, reactDom }).',
  );
}
const reactDom = runtime.reactDom as Record<string, unknown>;

export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = reactDom['__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE'] as never;
export const createPortal = reactDom['createPortal'] as never;
export const flushSync = reactDom['flushSync'] as never;
export const preconnect = reactDom['preconnect'] as never;
export const prefetchDNS = reactDom['prefetchDNS'] as never;
export const preinit = reactDom['preinit'] as never;
export const preinitModule = reactDom['preinitModule'] as never;
export const preload = reactDom['preload'] as never;
export const preloadModule = reactDom['preloadModule'] as never;
export const requestFormReset = reactDom['requestFormReset'] as never;
export const unstable_batchedUpdates = reactDom['unstable_batchedUpdates'] as never;
export const useFormState = reactDom['useFormState'] as never;
export const useFormStatus = reactDom['useFormStatus'] as never;
export const version = reactDom['version'] as never;

export default reactDom;
