// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `empty-state` (annex §12) — centred card content: 56px tone-soft icon tile,
 * bold title, muted body ≤36ch, primary/secondary actions. Variants: plain, CTA,
 * upload drop-zone.
 *
 * Registered as a widget in its own right because the annex lists it once and
 * page templates place it directly (a hub page's "nothing here yet" body). Note
 * this is DISTINCT from `WidgetFrame`'s built-in empty state, which every other
 * widget gets automatically from its `isEmpty` predicate (04 §4) — that one is
 * frame chrome, this one is placeable content.
 *
 * Wraps @adminium/ui's `EmptyState`; this file adds the registry config surface
 * (variant, glyph name, action hrefs) and routes the CTAs through `onEvent` so
 * the widget never navigates itself (04 §2.1).
 */

import { Button, EmptyState, IconTile } from '@adminium/ui';
import { UploadCloud } from 'lucide-react';

import { systemIcon } from './system-icons.js';
import { uiToneOf } from './system-lib.js';
import { emptyStateConfigSchema, emptyStateDemoData } from './system-config.js';
import type { EmptyStateConfig } from './system-config.js';
import type { WidgetEvent, WidgetProps } from '../../registry/types.js';

export { emptyStateConfigSchema, emptyStateDemoData };
export type { EmptyStateConfig };

export function EmptyStateWidget({ config, onEvent }: WidgetProps<EmptyStateConfig>) {
  const isDropzone = config.variant === 'dropzone';
  const showActions = config.variant !== 'plain';

  const go = (href: string | undefined) => {
    if (href !== undefined && href !== '') onEvent({ type: 'drill-through', href } satisfies WidgetEvent);
  };

  const icon = isDropzone ? <UploadCloud /> : systemIcon(config.glyph);

  const actions =
    showActions && (config.primaryLabel !== undefined || config.secondaryLabel !== undefined) ? (
      <>
        {config.primaryLabel !== undefined && (
          <Button size="sm" onClick={() => go(config.primaryHref)}>
            {config.primaryLabel}
          </Button>
        )}
        {config.secondaryLabel !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => go(config.secondaryHref)}>
            {config.secondaryLabel}
          </Button>
        )}
      </>
    ) : undefined;

  const body = (
    <EmptyState
      data-widget="empty-state"
      data-variant={config.variant}
      data-testid={config.testId}
      compact={config.compact}
      preset={config.preset}
      tone={uiToneOf(config.tone)}
      {...(icon === undefined ? {} : { icon })}
      // `heading`, not `title`: `title` is the WidgetFrame header on every widget.
      title={config.heading ?? ''}
      {...(config.body === undefined ? {} : { body: config.body })}
      {...(actions === undefined ? {} : { actions })}
    />
  );

  if (!isDropzone) return <div className="flex h-full items-center justify-center px-[var(--widget-pad)] pb-[var(--widget-pad)]">{body}</div>;

  // Drop-zone variant: the annex's dashed-border target framing around the same
  // centred content. The zone is presentational here — `upload-dropzone` (annex
  // §8, media family) owns real file intake.
  return (
    <div className="flex h-full items-center justify-center px-[var(--widget-pad)] pb-[var(--widget-pad)]">
      <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-border-strong">
        {body}
      </div>
    </div>
  );
}

/** Re-exported for template composition + stories. */
export { EmptyState, IconTile };
