// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lets project code call `toast()` as a plain function.
 *
 * The app's toast queue is a React context (`pages/toasts.tsx`), and a
 * project's click handler is not a component. `ProjectToastBridge`, mounted by
 * the app shell inside the queue's provider, hands the queue's `push` to this
 * module, and the kit's `toast` calls it.
 */

import { useEffect } from 'react';
import type { PushToastOptions } from '@adminium/ui';

import { useAppToasts } from '../pages/toasts.js';

type Push = (options: PushToastOptions) => string;

let current: Push | null = null;

export function pushProjectToast(options: PushToastOptions): boolean {
  if (current === null) return false;
  current(options);
  return true;
}

export function ProjectToastBridge(): null {
  const { push } = useAppToasts();
  useEffect(() => {
    current = push;
    return () => {
      if (current === push) current = null;
    };
  }, [push]);
  return null;
}
