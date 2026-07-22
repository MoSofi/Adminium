import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { TOAST_DEFAULT_DURATIONS } from './Toast.js';
import type { ToastActionSpec, ToastItem, ToastVariant } from './Toast.js';

/** Max simultaneously visible toasts (03-component-library.md §7.2). */
export const MAX_VISIBLE_TOASTS = 4;

/** Auto-dismiss duration for toasts carrying an action (Undo/Download). */
export const TOAST_ACTION_DURATION = 5200;

/**
 * Pauses every timer bar's CSS countdown while the stack is hovered, keeping
 * the visual bar in sync with the paused JS timers. Passed to `ToastStack`
 * through `stackProps.className`.
 */
export const TOAST_HOVER_PAUSE_CLASS =
  '[&:hover_[data-testid=toast-timer-bar]]:[animation-play-state:paused]';

export interface PushToastOptions {
  variant?: ToastVariant | undefined;
  title: ReactNode;
  description?: ReactNode;
  /** Action button (Undo/Download). Dismisses the toast after firing unless `keepOnAction`. */
  action?: ToastActionSpec | undefined;
  /**
   * Auto-dismiss in ms; `null` keeps the toast until dismissed. Defaults per
   * variant (success 2600 / info 3400 / warning 4200 / error 5200 / loading ∞;
   * 5200 whenever an action is present).
   */
  duration?: number | null | undefined;
  /** Keep the toast open after its action fires (default dismisses it). */
  keepOnAction?: boolean | undefined;
  /** Reuse a caller-supplied id (e.g. to update the same toast later). */
  id?: string | undefined;
}

export type UpdateToastPatch = Partial<Omit<PushToastOptions, 'id'>>;

export interface ToastPromiseMessages<T> {
  loading: ReactNode;
  success: ReactNode | ((value: T) => ReactNode);
  error: ReactNode | ((reason: unknown) => ReactNode);
}

export interface ToastStackBindings {
  toasts: ToastItem[];
  onDismissToast: (id: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  className: string;
}

export interface UseToastQueueReturn {
  /** Visible toasts, newest first — feed straight into `ToastStack`. */
  toasts: ToastItem[];
  /** Enqueue a toast; returns its id. Overflow beyond 4 queues FIFO. */
  push: (options: PushToastOptions) => string;
  /** Dismiss one toast by id, or every toast (and the queue) with no args. */
  dismiss: (id?: string) => void;
  /** Patch a toast in place (loading→done: pass variant/title; timer restarts). */
  update: (id: string, patch: UpdateToastPatch) => void;
  /** Loading toast that resolves to success/error with the promise. */
  promise: <T>(promise: Promise<T>, messages: ToastPromiseMessages<T>) => Promise<T>;
  /** Pause all auto-dismiss timers (wired to stack hover). */
  pauseAll: () => void;
  /** Resume timers with their remaining time. */
  resumeAll: () => void;
  /**
   * Spread onto `ToastStack` (add the i18n `dismissLabel` yourself):
   * `<ToastStack {...queue.stackProps} dismissLabel={t('common.dismiss')} />`
   */
  stackProps: ToastStackBindings;
}

interface TimerRecord {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

let toastSeq = 0;

function resolveDuration(options: {
  variant?: ToastVariant | undefined;
  duration?: number | null | undefined;
  action?: ToastActionSpec | undefined;
}): number | null {
  if (options.duration !== undefined) return options.duration;
  if (options.action !== undefined) return TOAST_ACTION_DURATION;
  return TOAST_DEFAULT_DURATIONS[options.variant ?? 'info'];
}

/**
 * useToastQueue — imperative toast queue manager
 * (03-component-library.md §7.2): max 4 visible newest-first,
 * overflow queues FIFO and enters as older toasts dismiss, per-variant
 * auto-dismiss, pause-on-hover (JS timers + CSS timer bar), undo-action
 * toasts and promise toasts (loading → success/error). Mount one queue per
 * app next to a single `ToastStack`.
 */
export function useToastQueue(): UseToastQueueReturn {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const visibleRef = useRef<ToastItem[]>([]);
  const queueRef = useRef<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, TimerRecord>());
  const pausedRef = useRef(false);

  const flush = useCallback(() => {
    setToasts([...visibleRef.current]);
  }, []);

  const clearTimer = useCallback((id: string) => {
    const record = timersRef.current.get(id);
    if (record?.handle != null) clearTimeout(record.handle);
    timersRef.current.delete(id);
  }, []);

  // dismiss and startTimer are mutually recursive (timer fire → dismiss →
  // promote queued toast → start its timer); indirection via ref.
  const dismissRef = useRef<(id?: string) => void>(() => {});

  const startTimer = useCallback((id: string, duration: number | null) => {
    if (duration === null) return;
    const record: TimerRecord = { handle: null, remaining: duration, startedAt: Date.now() };
    if (!pausedRef.current) {
      record.handle = setTimeout(() => dismissRef.current(id), duration);
    }
    timersRef.current.set(id, record);
  }, []);

  const dismiss = useCallback(
    (id?: string) => {
      if (id === undefined) {
        for (const toast of visibleRef.current) clearTimer(toast.id);
        visibleRef.current = [];
        queueRef.current = [];
        flush();
        return;
      }
      const index = visibleRef.current.findIndex((t) => t.id === id);
      if (index === -1) {
        queueRef.current = queueRef.current.filter((t) => t.id !== id);
        return;
      }
      clearTimer(id);
      visibleRef.current = visibleRef.current.filter((t) => t.id !== id);
      // Promote queued toasts FIFO into the freed slots (as the newest rows).
      while (queueRef.current.length > 0 && visibleRef.current.length < MAX_VISIBLE_TOASTS) {
        const next = queueRef.current.shift() as ToastItem;
        visibleRef.current = [next, ...visibleRef.current];
        startTimer(next.id, next.duration ?? null);
      }
      flush();
    },
    [clearTimer, flush, startTimer],
  );
  dismissRef.current = dismiss;

  const toItem = useCallback(
    (id: string, options: PushToastOptions): ToastItem => {
      const duration = resolveDuration(options);
      const action =
        options.action === undefined
          ? undefined
          : options.keepOnAction
            ? options.action
            : {
                label: options.action.label,
                onAction: () => {
                  options.action?.onAction();
                  dismissRef.current(id);
                },
              };
      return {
        id,
        variant: options.variant,
        title: options.title,
        description: options.description,
        action,
        duration,
      };
    },
    [],
  );

  const push = useCallback(
    (options: PushToastOptions): string => {
      const id = options.id ?? `toast_${++toastSeq}`;
      const item = toItem(id, options);
      if (visibleRef.current.length >= MAX_VISIBLE_TOASTS) {
        queueRef.current = [...queueRef.current, item];
      } else {
        visibleRef.current = [item, ...visibleRef.current];
        startTimer(id, item.duration ?? null);
        flush();
      }
      return id;
    },
    [flush, startTimer, toItem],
  );

  const update = useCallback(
    (id: string, patch: UpdateToastPatch) => {
      const apply = (current: ToastItem): ToastItem =>
        toItem(id, {
          variant: 'variant' in patch ? patch.variant : current.variant,
          title: 'title' in patch ? (patch.title as ReactNode) : current.title,
          description: 'description' in patch ? patch.description : current.description,
          action: 'action' in patch ? patch.action : current.action,
          ...('duration' in patch ? { duration: patch.duration } : {}),
          ...(patch.keepOnAction !== undefined ? { keepOnAction: patch.keepOnAction } : {}),
        });

      const index = visibleRef.current.findIndex((t) => t.id === id);
      if (index !== -1) {
        const next = apply(visibleRef.current[index] as ToastItem);
        visibleRef.current = visibleRef.current.map((t) => (t.id === id ? next : t));
        clearTimer(id);
        startTimer(id, next.duration ?? null);
        flush();
        return;
      }
      queueRef.current = queueRef.current.map((t) => (t.id === id ? apply(t) : t));
    },
    [clearTimer, flush, startTimer, toItem],
  );

  const promise = useCallback(
    <T,>(input: Promise<T>, messages: ToastPromiseMessages<T>): Promise<T> => {
      const id = push({ variant: 'loading', title: messages.loading, duration: null });
      input.then(
        (value) => {
          update(id, {
            variant: 'success',
            title: typeof messages.success === 'function' ? messages.success(value) : messages.success,
            duration: TOAST_DEFAULT_DURATIONS.success,
          });
        },
        (reason: unknown) => {
          update(id, {
            variant: 'error',
            title: typeof messages.error === 'function' ? messages.error(reason) : messages.error,
            duration: TOAST_DEFAULT_DURATIONS.error,
          });
        },
      );
      return input;
    },
    [push, update],
  );

  const pauseAll = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    const now = Date.now();
    for (const record of timersRef.current.values()) {
      if (record.handle !== null) {
        clearTimeout(record.handle);
        record.handle = null;
        record.remaining = Math.max(0, record.remaining - (now - record.startedAt));
      }
    }
  }, []);

  const resumeAll = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    for (const [id, record] of timersRef.current.entries()) {
      record.startedAt = Date.now();
      record.handle = setTimeout(() => dismissRef.current(id), record.remaining);
    }
  }, []);

  useEffect(
    () => () => {
      for (const record of timersRef.current.values()) {
        if (record.handle !== null) clearTimeout(record.handle);
      }
      timersRef.current.clear();
    },
    [],
  );

  const stackProps = useMemo<ToastStackBindings>(
    () => ({
      toasts,
      onDismissToast: dismiss,
      onMouseEnter: pauseAll,
      onMouseLeave: resumeAll,
      className: TOAST_HOVER_PAUSE_CLASS,
    }),
    [toasts, dismiss, pauseAll, resumeAll],
  );

  return { toasts, push, dismiss, update, promise, pauseAll, resumeAll, stackProps };
}
