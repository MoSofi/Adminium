// SPDX-License-Identifier: AGPL-3.0-only
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { toneMixBorderClasses } from '../../lib/tones.js';

/** Alert tone vocabulary (info/pos/warn/danger callouts). */
export type AlertTone = 'info' | 'pos' | 'warn' | 'danger';

const toneClasses: Record<AlertTone, string> = {
  info: 'bg-info-soft [&_[data-part=alert-icon]]:text-info',
  pos: 'bg-pos-soft [&_[data-part=alert-icon]]:text-pos',
  warn: 'bg-warn-soft [&_[data-part=alert-icon]]:text-warn',
  danger: 'bg-danger-soft [&_[data-part=alert-icon]]:text-danger',
};

const defaultIcons: Record<AlertTone, ReactNode> = {
  info: <Info />,
  pos: <CheckCircle2 />,
  warn: <AlertTriangle />,
  danger: <XCircle />,
};

export interface AlertProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Semantic tone. Default `info`. */
  tone?: AlertTone | undefined;
  /** Override the leading icon (defaults per tone). */
  icon?: ReactNode;
  /** Bold first line. */
  title: ReactNode;
  /** Supporting copy (children also land here). */
  body?: ReactNode;
  /** Optional CTA (link/Button) rendered under the body. */
  action?: ReactNode;
  /**
   * ARIA live semantics: pass `alert` when the callout appears dynamically
   * for a failure, `status` for polite updates. Static page content omits it.
   */
  role?: 'alert' | 'status' | undefined;
}

/**
 * Alert / Callout — tone-soft background + `color-mix` tone border, icon +
 * title + body + optional CTA; tones info/pos/warn/danger
 * (research/design-system.md §3 Tier 3).
 */
export function Alert({
  tone = 'info',
  icon,
  title,
  body,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3.5',
        toneClasses[tone],
        toneMixBorderClasses[tone],
        className,
      )}
      {...props}
    >
      <span data-part="alert-icon" aria-hidden="true" className="mt-px shrink-0 [&_svg]:size-4 [&_svg]:stroke-2">
        {icon ?? defaultIcons[tone]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-bold leading-snug text-fg">{title}</div>
        {body === undefined && children === undefined ? null : (
          <div className="mt-0.5 text-body-sm text-fg-muted">{body ?? children}</div>
        )}
        {action === undefined || action === null ? null : <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
