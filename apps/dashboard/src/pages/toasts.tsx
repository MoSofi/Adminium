// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App-level toast queue (09-generated-app.md §4.1 mutations + undo): one
 * `useToastQueue` + `ToastStack` mounted by AppShell; pages push through
 * context. `useUndoToast` is the undo-first mutation companion — a successful
 * mutation's `undoToken` becomes a 5.2 s toast whose Undo action calls
 * `POST /api/v1/data/undo/:token` and invalidates the data + widget caches.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { ToastStack, useToastQueue, type UseToastQueueReturn } from '@adminium/ui';

import { undoMutation } from '../api/crud.js';
import { t } from '../i18n/t.js';

const ToastQueueContext = createContext<UseToastQueueReturn | null>(null);

export function AppToastProvider({ children }: { children: ReactNode }) {
  const queue = useToastQueue();
  return (
    <ToastQueueContext.Provider value={queue}>
      {children}
      <ToastStack
        {...queue.stackProps}
        dismissLabel={t('common.dismiss', 'Dismiss')}
        label={t('common.notifications', 'Notifications')}
      />
    </ToastQueueContext.Provider>
  );
}

export function useAppToasts(): UseToastQueueReturn {
  const queue = useContext(ToastQueueContext);
  if (queue === null) {
    throw new Error('useAppToasts must be used inside <AppToastProvider> (mounted by AppShell).');
  }
  return queue;
}

export interface UndoToastOptions {
  title: string;
  /** From the mutation reply; `null` renders a plain success toast. */
  undoToken: string | null;
  /** Runs after a successful undo (e.g. to restore selection). */
  onUndone?: (() => void) | undefined;
}

export function useUndoToast(): (options: UndoToastOptions) => void {
  const queue = useAppToasts();
  const queryClient = useQueryClient();

  return useCallback(
    ({ title, undoToken, onUndone }: UndoToastOptions) => {
      queue.push({
        variant: 'success',
        title,
        ...(undoToken === null
          ? {}
          : {
              action: {
                label: t('common.undo', 'Undo'),
                onAction: () => {
                  undoMutation(undoToken)
                    .then(() => {
                      void queryClient.invalidateQueries({ queryKey: ['data'] });
                      void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
                      onUndone?.();
                      queue.push({ variant: 'info', title: t('undo.done', 'Change undone') });
                    })
                    .catch((error: unknown) => {
                      queue.push({
                        variant: 'error',
                        title: t('undo.failed', 'Could not undo this change'),
                        description: error instanceof Error ? error.message : undefined,
                      });
                    });
                },
              },
            }),
      });
    },
    [queue, queryClient],
  );
}
