// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's feedback pieces and icons: `toast`, `EmptyState` and
 * `Icon`.
 */

import { createElement, type ReactNode } from 'react';
import { EmptyState as UiEmptyState } from '@adminium/ui';
import type { EmptyStateProps, IconProps, ToastOptions } from '@adminium/server/ui';

import { lucideByName } from '../../lib/lucide.js';
import { pushProjectToast } from '../toastBridge.js';

export function toast(message: string, options: ToastOptions = {}): void {
  const shown = pushProjectToast({
    variant: options.tone ?? 'success',
    title: message,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.duration === undefined ? {} : { duration: options.duration }),
  });
  // Only possible outside the app shell, which no project code reaches.
  if (!shown) console.warn('[project] toast() was called before the dashboard was ready:', message);
}

export function EmptyState({ title, description, icon, actions }: EmptyStateProps): ReactNode {
  return (
    <UiEmptyState
      title={title}
      body={description}
      actions={actions}
      {...(icon === undefined ? {} : { icon: createElement(lucideByName(icon), { 'aria-hidden': true }) })}
    />
  );
}

export function Icon({ name, size = 16, label }: IconProps): ReactNode {
  return createElement(lucideByName(name), {
    size,
    strokeWidth: 2,
    ...(label === undefined ? { 'aria-hidden': true } : { 'aria-label': label, role: 'img' }),
  });
}
