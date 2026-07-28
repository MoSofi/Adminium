/**
 * `toast-stack` (annex §4; cross-listed as `undo-toast` in §12) — the overlay
 * toast HOST: max-4 toasts with an icon, a message and an optional Undo, 2.6s
 * auto-dismiss (5.2s with undo), animated collapse.
 *
 * WRAPS, DOES NOT REBUILD. @adminium/ui already ships `ToastStack` (the
 * container + the `Toast` primitive) and `useToastQueue` (03 §7.2: max-4
 * clamping, FIFO overflow, per-variant auto-dismiss, pause-on-hover for both the
 * JS timers and the CSS timer bar, the undo-action duration, and promise
 * toasts). This module registers that as a widget and adds only what the
 * registry needs: config projection, the §3 payload narrowing, and the undo
 * intent. The annex's imperative `toast(msg, icon, onUndo)` API is
 * `useToastQueue().push`, re-exported through the family barrel for hosts.
 *
 * UNDO IS AN INTENT, NEVER A WRITE (04 §2.1). A toast cannot carry a callback
 * across the data boundary, so the payload carries an OPAQUE `undoToken` plus
 * the table/record it touched; pressing Undo emits a `mutate` intent and the
 * host's CRUD layer performs the reversal with audit. The widget itself never
 * writes.
 *
 * `placement: 'overlay'` — the host portals this once per app, next to its
 * queue; it is never grid-placed and never renders WidgetFrame chrome.
 */

import { ToastStack as UiToastStack } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import type { ToastEntry } from './feeds-types.js';
import type { ToastStackConfig } from './feeds-config.js';
import type { ToastItem, ToastVariant } from '@adminium/ui';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `feeds-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { toastStackConfigSchema, toastStackDemoData } from './feeds-config.js';
export type { ToastStackConfig } from './feeds-config.js';
export type { ToastEntry } from './feeds-types.js';

/**
 * The annex's imperative API (`toast(msg, icon, onUndo)`) IS @adminium/ui's
 * queue hook. Re-exported here so a host wires the widget and its imperative
 * entry point from one place (03 §7.2).
 */
export { useToastQueue, MAX_VISIBLE_TOASTS, TOAST_ACTION_DURATION } from '@adminium/ui';

const VARIANTS: ReadonlySet<string> = new Set(['success', 'error', 'warning', 'info', 'loading']);

/** Narrow a raw `variant` column value to the Toast vocabulary. */
export function toastVariantOf(value: unknown): ToastVariant {
  return typeof value === 'string' && VARIANTS.has(value) ? (value as ToastVariant) : 'info';
}

/** Narrow the ephemeral `{ toasts: [...] }` payload (annex §4). */
export function toastsOf(data: unknown): ToastEntry[] {
  const raw =
    typeof data === 'object' && data !== null && Array.isArray((data as { toasts?: unknown }).toasts)
      ? ((data as { toasts: unknown[] }).toasts as unknown[])
      : [];
  const out: ToastEntry[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.message !== 'string' || row.message === '') continue;
    out.push({
      id: typeof row.id === 'string' ? row.id : `toast-${index}`,
      message: row.message,
      variant: typeof row.variant === 'string' ? row.variant : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      undoToken: typeof row.undoToken === 'string' ? row.undoToken : undefined,
      table: typeof row.table === 'string' ? row.table : undefined,
      recordId:
        typeof row.recordId === 'string' || typeof row.recordId === 'number' ? row.recordId : undefined,
    });
  }
  return out;
}

/**
 * Annex §4 `position` → the container's fixed anchor. Logical `start`/`end`
 * utilities, so "bottom-end" is the bottom-right in LTR and the bottom-LEFT in
 * RTL — a toast belongs at the reading direction's trailing edge, and physical
 * `right-4` would strand it under the RTL sidebar. Lookup table (not
 * interpolation) so Tailwind's scanner sees every literal.
 */
const POSITION_CLASSES: Record<ToastStackConfig['position'], string> = {
  'bottom-center': 'bottom-4 start-1/2 end-auto -translate-x-1/2 rtl:translate-x-1/2',
  'bottom-end': 'bottom-4 end-4',
  'top-center': 'top-4 bottom-auto start-1/2 end-auto -translate-x-1/2 rtl:translate-x-1/2',
  'top-end': 'top-4 bottom-auto end-4',
};

export function ToastStackWidget({ config, data, onEvent }: WidgetProps<ToastStackConfig>) {
  const t = useMaybeT();
  const incoming = toastsOf(data);
  // Dismissal is local: a toast is ephemeral UI state, not a mutation, so it
  // must not round-trip through the host.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const items: ToastItem[] = incoming
    .filter((toast) => !dismissed.has(toast.id))
    .slice(0, config.maxVisible)
    .map((toast) => ({
      id: toast.id,
      variant: toastVariantOf(toast.variant),
      title: toast.message,
      description: toast.description,
      // Annex §4: 2.6s plain, 5.2s when the toast carries an Undo.
      duration: toast.undoToken === undefined ? config.duration : config.undoDuration,
      action:
        toast.undoToken === undefined
          ? undefined
          : {
              label: config.undoLabel ?? t('ui:widgets.feeds.toastStack.undoLabel', 'Undo'),
              onAction: () => {
                // Intent only — the host's CRUD layer runs the reversal with
                // audit. `table` is absent on an unbound/demo toast, and a
                // mutate intent without a target would be meaningless.
                if (toast.table !== undefined) {
                  onEvent({
                    type: 'mutate',
                    intent: 'update',
                    ...(config.binding?.connectionId === undefined
                      ? {}
                      : { connectionId: config.binding.connectionId }),
                    table: toast.table,
                    ...(toast.recordId === undefined ? {} : { recordId: toast.recordId }),
                    values: { undoToken: toast.undoToken },
                  });
                }
                setDismissed((current) => new Set(current).add(toast.id));
              },
            },
    }));

  return (
    <UiToastStack
      data-widget="toast-stack"
      data-position={config.position}
      toasts={items}
      onDismissToast={(id) => setDismissed((current) => new Set(current).add(id))}
      dismissLabel={config.dismissLabel ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      {...(config.regionLabel === undefined ? {} : { label: config.regionLabel })}
      className={POSITION_CLASSES[config.position]}
    />
  );
}
