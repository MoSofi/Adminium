// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-settings` template (04 §10; comp: Notification Settings
 * .dc.html) — an event × delivery-channel preference matrix with PER-CELL
 * AUTOSAVE choreography: every toggle fires immediately (no Save button), the
 * header indicator walks idle → saving → saved, and in-flight cells carry the
 * ToggleMatrix dirty dot until the host confirms them.
 *
 * PRESENTATIONAL AND HOST-DRIVEN (the PageCrud/PageWizard discipline): cell
 * truth lives in the `events` prop — the ui ToggleMatrix is driven fully
 * controlled, so a host rollback (failed PUT) visibly snaps the cell back.
 * The template never fetches and never translates; labels flow in with
 * English fallbacks (04 §2 — widgets never translate).
 *
 * UNAVAILABLE CHANNELS (§8.2 never-hide-always-explain): a channel with
 * `available: false` stays fully togglable — the intent is STORED — and its
 * column header carries a tag plus an explanation line under the matrix. A
 * silently disabled column would hide the product truth; a hidden column
 * would lose the stored intent. Both are wrong; this is the third way.
 */
import { useMaybeT } from '@adminium/i18n/react';
import {
  Button,
  EmptyState,
  Spinner,
  ToggleMatrix,
  cn,
  type ToggleMatrixColumn,
  type ToggleMatrixGroup,
} from '@adminium/ui';
import { AlertTriangle, Check, Info, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

export const PAGE_SETTINGS_TEMPLATE_ID = 'page-settings';

export interface SettingsChannelDef {
  id: string;
  label: string;
  /** False = no transport in this build; the column stays togglable. */
  available: boolean;
  /** REQUIRED alongside `available: false` — the §8.2 explanation. */
  reason?: string | undefined;
}

export interface SettingsEventDef {
  key: string;
  label: string;
  description?: string | undefined;
  /** channelId → on/off — the stored truth, host-owned. */
  channels: Readonly<Record<string, boolean>>;
}

/** Header indicator states for the autosave choreography. */
export type SettingsSaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string };

/** Cell identity used by `pendingCells` (host mirrors this exact key). */
export function settingsCellId(eventKey: string, channelId: string): string {
  return `${eventKey}\x00${channelId}`;
}

export interface PageSettingsLabels {
  title: string;
  subtitle: string;
  matrixLabel: string;
  rowHeader: string;
  saving: string;
  saved: string;
  unavailableTag: string;
  loading: string;
  errorTitle: string;
  retry: string;
  emptyTitle: string;
  emptyBody: string;
}

/**
 * The localized default labels (the chrome ShortcutsPanel pattern): bundle
 * strings under an `I18nProvider`, this English copy otherwise. Explicit
 * `labels` overrides keep winning key-by-key. `saved` is deliberately NOT
 * `widgets.system.autosaveIndicator.saved` — that key reads "All changes
 * saved" while this indicator reads "Saved".
 */
export function usePageSettingsLabels(): PageSettingsLabels {
  const t = useMaybeT();
  return useMemo(
    () => ({
      title: t('ui:templates.settings.title', 'Notification settings'),
      subtitle: t('ui:templates.settings.subtitle', "Choose what you're notified about and how"),
      matrixLabel: t('ui:templates.settings.matrixLabel', 'Notify me about'),
      rowHeader: t('ui:templates.settings.rowHeader', 'Event'),
      saving: t('ui:widgets.system.autosaveIndicator.saving', 'Saving…'),
      saved: t('ui:templates.settings.saved', 'Saved'),
      unavailableTag: t('ui:templates.settings.unavailableTag', 'Not available yet'),
      loading: t('ui:templates.settings.loading', 'Loading preferences'),
      errorTitle: t('ui:templates.settings.errorTitle', 'These settings failed to load'),
      retry: t('ui:action.retry', 'Retry'),
      emptyTitle: t('ui:templates.settings.emptyTitle', 'Nothing to configure yet'),
      emptyBody: t('ui:templates.settings.emptyBody', 'Notification events appear here as producers ship.'),
    }),
    [t],
  );
}

export interface PageSettingsProps {
  /** Envelope body (`page.config`) — reserved for stored chrome; unused keys ignored. */
  config?: Record<string, unknown> | undefined;
  channels: readonly SettingsChannelDef[];
  events: readonly SettingsEventDef[];
  status?: 'loading' | 'error' | 'ready' | undefined;
  errorMessage?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Header indicator; hosts drive it from their PUT lifecycle. */
  saveState?: SettingsSaveState | undefined;
  /** Cells with an unconfirmed write — render the dirty diff dot. */
  pendingCells?: ReadonlySet<string> | undefined;
  /** Per-cell autosave hook: fires with the REQUESTED next value. */
  onToggle?: ((eventKey: string, channelId: string, next: boolean) => void) | undefined;
  labels?: Partial<PageSettingsLabels> | undefined;
  testId?: string | undefined;
}

export function PageSettings({
  config,
  channels,
  events,
  status = 'ready',
  errorMessage,
  onRetry,
  saveState = { state: 'idle' },
  pendingCells,
  onToggle,
  labels: labelOverrides,
  testId,
}: PageSettingsProps) {
  void config;
  const defaultLabels = usePageSettingsLabels();
  const labels = { ...defaultLabels, ...labelOverrides };

  const columns = useMemo<ToggleMatrixColumn[]>(
    () =>
      channels.map((channel) => ({
        id: channel.id,
        label: channel.available ? channel.label : `${channel.label} · ${labels.unavailableTag}`,
      })),
    [channels, labels.unavailableTag],
  );

  const groups = useMemo<ToggleMatrixGroup[]>(
    () => [{ id: 'events', rows: events.map((event) => ({ id: event.key, label: event.label })) }],
    [events],
  );

  const unavailable = channels.filter((channel) => !channel.available);

  return (
    <div data-template="page-settings" data-testid={testId} className="flex h-full flex-col gap-4">
      {/* --- header + autosave indicator ------------------------------------- */}
      <div data-part="settings-header" className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-extrabold tracking-tight text-fg">{labels.title}</h2>
          <p className="mt-0.5 text-body-sm text-fg-muted">{labels.subtitle}</p>
        </div>
        <span
          data-part="saved-indicator"
          data-state={saveState.state}
          aria-live="polite"
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold transition-opacity',
            saveState.state === 'idle' && 'opacity-0',
            saveState.state === 'saving' && 'bg-surface-2 text-fg-muted',
            saveState.state === 'saved' && 'bg-pos-soft text-pos',
            saveState.state === 'error' && 'bg-danger-soft text-danger',
          )}
        >
          {saveState.state === 'saving' ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : saveState.state === 'saved' ? (
            <Check aria-hidden className="size-3.5" />
          ) : saveState.state === 'error' ? (
            <AlertTriangle aria-hidden className="size-3.5" />
          ) : null}
          {saveState.state === 'saving'
            ? labels.saving
            : saveState.state === 'saved'
              ? labels.saved
              : saveState.state === 'error'
                ? saveState.message
                : null}
        </span>
      </div>

      {/* --- body -------------------------------------------------------------- */}
      {status === 'loading' ? (
        <div data-part="settings-loading" className="flex flex-1 items-center justify-center py-16">
          <Spinner label={labels.loading} />
        </div>
      ) : status === 'error' ? (
        <EmptyState
          tone="danger"
          title={labels.errorTitle}
          body={errorMessage}
          actions={
            onRetry === undefined ? undefined : (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {labels.retry}
              </Button>
            )
          }
        />
      ) : events.length === 0 || channels.length === 0 ? (
        <EmptyState compact preset="no-data" title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface">
          <ToggleMatrix
            label={labels.matrixLabel}
            rowHeader={labels.rowHeader}
            columns={columns}
            groups={groups}
            getCellState={(rowId, colId) => {
              const event = events.find((candidate) => candidate.key === rowId);
              return event?.channels[colId] === true ? 'on' : 'off';
            }}
            isDirty={(rowId, colId) => pendingCells?.has(settingsCellId(rowId, colId)) === true}
            onToggle={(rowId, colId, next) => onToggle?.(rowId, colId, next)}
          />
        </div>
      )}

      {/* --- §8.2 channel explanations ------------------------------------------ */}
      {unavailable.length > 0 && status === 'ready' ? (
        <ul data-part="channel-notes" className="flex flex-col gap-1.5">
          {unavailable.map((channel) => (
            <li
              key={channel.id}
              data-channel={channel.id}
              className="flex items-start gap-2 text-caption text-fg-muted"
            >
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <span>
                <span className="font-semibold text-fg">{channel.label}</span>
                {channel.reason === undefined ? null : <> — {channel.reason}</>}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
