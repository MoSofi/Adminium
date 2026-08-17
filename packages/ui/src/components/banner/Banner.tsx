// SPDX-License-Identifier: AGPL-3.0-only
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import type { AlertTone } from '../alert/Alert.js';

const toneClasses: Record<AlertTone, string> = {
  info: 'bg-info-soft border-[color-mix(in_srgb,var(--info)_30%,transparent)] [&_[data-part=banner-icon]]:text-info',
  pos: 'bg-pos-soft border-[color-mix(in_srgb,var(--pos)_30%,transparent)] [&_[data-part=banner-icon]]:text-pos',
  warn: 'bg-warn-soft border-[color-mix(in_srgb,var(--warn)_30%,transparent)] [&_[data-part=banner-icon]]:text-warn',
  danger:
    'bg-danger-soft border-[color-mix(in_srgb,var(--danger)_30%,transparent)] [&_[data-part=banner-icon]]:text-danger',
};

const defaultIcons: Record<AlertTone, ReactNode> = {
  info: <Info />,
  pos: <CheckCircle2 />,
  warn: <AlertTriangle />,
  danger: <XCircle />,
};

export interface BannerProps extends ComponentPropsWithRef<'div'> {
  /** Semantic tone. Default `info`. */
  tone?: AlertTone | undefined;
  /** Override the leading icon. */
  icon?: ReactNode;
  /** Inline action (link/small button) after the message. */
  action?: ReactNode;
  /** Called when the dismiss button is pressed; renders only when set. */
  onDismiss?: (() => void) | undefined;
  /** Accessible label for the dismiss button (required when dismissible — i18n). */
  dismissLabel?: string | undefined;
}

/**
 * Banner — full-width top alert variant: tone-soft strip with a `color-mix`
 * bottom hairline, icon + message + optional action, dismissible
 * (research/design-system.md §3 Tier 3). Mount above the app shell.
 */
export function Banner({
  tone = 'info',
  icon,
  action,
  onDismiss,
  dismissLabel,
  className,
  children,
  ...props
}: BannerProps) {
  return (
    <div
      data-tone={tone}
      className={cn(
        'flex w-full items-center gap-2.5 border-b px-4 py-2.5',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <span data-part="banner-icon" aria-hidden="true" className="shrink-0 [&_svg]:size-4 [&_svg]:stroke-2">
        {icon ?? defaultIcons[tone]}
      </span>
      <div className="min-w-0 flex-1 text-body-sm font-semibold text-fg">{children}</div>
      {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cn(
            'nb-ib -me-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
