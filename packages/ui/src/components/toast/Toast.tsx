import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconTile, type Tone } from '../icon-tile/index.js';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

const variantTone: Record<ToastVariant, Tone> = {
  success: 'pos',
  error: 'danger',
  warning: 'warn',
  info: 'info',
  loading: 'accent',
};

const toneBarBg: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/**
 * Default auto-dismiss durations in ms (03-component-library.md §7.2).
 * The imperative queue manager that actually fires dismissal is wave 2 —
 * here the duration only drives the visual `nb-toastbar` countdown.
 */
export const TOAST_DEFAULT_DURATIONS: Record<ToastVariant, number | null> = {
  success: 2600,
  info: 3400,
  warning: 4200,
  error: 5200,
  loading: null,
};

export interface ToastActionSpec {
  /** Action button text (Undo / Download / …). */
  label: string;
  onAction: () => void;
}

export interface ToastProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  variant?: ToastVariant | undefined;
  title: ReactNode;
  description?: ReactNode;
  /** Optional action button (Undo / Download). */
  action?: ToastActionSpec | undefined;
  /** Called when the close button is pressed; the button renders only when set. */
  onDismiss?: (() => void) | undefined;
  /** Accessible label for the close button (required — i18n). */
  dismissLabel: string;
  /**
   * Timer-bar duration in ms; `null` disables the bar. Defaults per variant
   * (success 2600 / info 3400 / warning 4200 / error 5200 / loading none).
   */
  duration?: number | null | undefined;
}

/**
 * Toast — single toast primitive: icon tile · title · description · optional
 * action · close · bottom timer bar (`nb-toastbar` scaleX). Slide-in via
 * `nb-toastin`, RTL-mirrored to `nb-toastin-rtl`
 * (research/design-system.md §3 Tier 3). Queue semantics (max 4,
 * auto-dismiss, `toast.*` imperative API) are wave 2 — this is the
 * controlled primitive.
 */
export function Toast({
  variant = 'info',
  title,
  description,
  action,
  onDismiss,
  dismissLabel,
  duration,
  className,
  ...props
}: ToastProps) {
  const tone = variantTone[variant];
  const effectiveDuration = duration === undefined ? TOAST_DEFAULT_DURATIONS[variant] : duration;

  const icons: Record<ToastVariant, ReactNode> = {
    success: <CheckCircle2 />,
    error: <XCircle />,
    warning: <AlertTriangle />,
    info: <Info />,
    loading: <Loader2 className="animate-[nb-spin_.8s_linear_infinite]" />,
  };

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      data-variant={variant}
      className={cn(
        'pointer-events-auto relative flex w-[360px] max-w-full items-start gap-3 overflow-hidden',
        'rounded-lg border border-border bg-surface p-3.5 pb-4 shadow-menu',
        'animate-[nb-toastin_.24s_cubic-bezier(.2,.7,.3,1)] rtl:animate-[nb-toastin-rtl_.24s_cubic-bezier(.2,.7,.3,1)]',
        className,
      )}
      {...props}
    >
      <IconTile size="sm" tone={tone} icon={icons[variant]} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-snug text-fg">{title}</div>
        {description === undefined || description === null ? null : (
          <div className="mt-0.5 text-body-sm text-fg-muted">{description}</div>
        )}
        {action === undefined ? null : (
          <button
            type="button"
            onClick={action.onAction}
            className={cn(
              'mt-1.5 text-[12.5px] font-bold text-accent hover:underline',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss === undefined ? null : (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cn(
            'nb-ib -me-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {effectiveDuration === null ? null : (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-3">
          <div
            data-testid="toast-timer-bar"
            className={cn(
              'h-full w-full [transform-origin:0%_50%] rtl:[transform-origin:100%_50%]',
              'animate-[nb-toastbar_var(--adm-duration,4200ms)_linear_forwards]',
              toneBarBg[tone],
            )}
            style={{ '--adm-duration': `${effectiveDuration}ms` }}
          />
        </div>
      )}
    </div>
  );
}

export interface ToastItem {
  /** Stable id used for dismissal. */
  id: string;
  variant?: ToastVariant | undefined;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastActionSpec | undefined;
  duration?: number | null | undefined;
}

export interface ToastStackProps extends ComponentPropsWithRef<'div'> {
  /** Toasts to render, newest first (the stack grows from inline-end bottom). */
  toasts: readonly ToastItem[];
  /** Dismiss callback wired to every toast's close button. */
  onDismissToast: (id: string) => void;
  /** Accessible label for each toast's close button (required — i18n). */
  dismissLabel: string;
  /** Accessible name for the region (e.g. "Notifications"). */
  label?: string | undefined;
}

/**
 * ToastStack — fixed container at bottom / inline-end (RTL-mirrored via the
 * logical `end-4`) rendering a controlled list of toasts. Max-4 clamping,
 * FIFO overflow and auto-dismiss timers are the wave-2 queue manager's job;
 * callers own the array here.
 */
export function ToastStack({
  toasts,
  onDismissToast,
  dismissLabel,
  label,
  className,
  ...props
}: ToastStackProps) {
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        'pointer-events-none fixed bottom-4 end-4 z-[100] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2.5',
        className,
      )}
      {...props}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          variant={toast.variant ?? 'info'}
          title={toast.title}
          description={toast.description}
          action={toast.action}
          duration={toast.duration}
          dismissLabel={dismissLabel}
          onDismiss={() => onDismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

/** Alias — some docs refer to the stack container as the toast viewport. */
export const ToastViewport = ToastStack;
