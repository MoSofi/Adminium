// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `react/compiler-runtime` shim (see `./index.ts`). Libraries compiled
 * with the React Compiler import its `c` helper, which React 19 publishes as
 * `__COMPILER_RUNTIME.c` on the React namespace itself.
 */

import { requireAddOnRuntime } from './index.js';

const compiler = requireAddOnRuntime().react['__COMPILER_RUNTIME'] as { c?: unknown } | undefined;

export const c = compiler?.c as never;
