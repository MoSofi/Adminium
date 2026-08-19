// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `connection-status` (annex §12) — spinner→success banner (pos-soft, check
 * circle) for connect/test flows, with an optional per-row Test action that
 * re-issues the check. Evidence: Adminium Console, Data Connections.
 *
 * The widget is a projection of bound `{state, host, detail}` — it never runs the
 * check itself. Test emits a `mutate` intent the host executes (04 §2.1), which
 * is what re-issues the probe and pushes a new payload back down.
 */

import { Button, MonoText, Spinner, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';

import { bindingSourceOf, oneOf, recordRowOf, stringField } from './system-lib.js';
import type { ConnectionState } from './system-lib.js';
import { CONNECTION_STATES, connectionStatusConfigSchema, connectionStatusDemoData } from './system-config.js';
import type { ConnectionStatusConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { connectionStatusConfigSchema, connectionStatusDemoData };
export type { ConnectionStatusConfig };

const STATE_SHELL: Record<ConnectionState, string> = {
  idle: 'bg-surface-2 text-fg-muted',
  connecting: 'bg-info-soft text-info',
  connected: 'bg-pos-soft text-pos',
  failed: 'bg-danger-soft text-danger',
};

/**
 * Localized per-state headline defaults: `ui:widgets.system.connectionStatus.*`
 * under an `I18nProvider`, the same English fallbacks outside one. Config
 * `messages` overrides win per state either way.
 */
function useConnectionStatusMessages(): Record<ConnectionState, string> {
  const t = useMaybeT();
  return {
    idle: t('ui:widgets.system.connectionStatus.idle', 'Not connected'),
    connecting: t('ui:widgets.system.connectionStatus.connecting', 'Connecting…'),
    connected: t('ui:widgets.system.connectionStatus.connected', 'Connected'),
    failed: t('ui:widgets.system.connectionStatus.failed', "Couldn't connect"),
  };
}

export interface ConnectionStatusViewProps {
  state: ConnectionState;
  host?: string | undefined;
  detail?: string | undefined;
  messages?: Partial<Record<ConnectionState, string>> | undefined;
  testable?: boolean | undefined;
  testLabel?: string | undefined;
  onTest?: (() => void) | undefined;
  testId?: string | undefined;
}

export function ConnectionStatusView({
  state,
  host,
  detail,
  messages,
  testable = false,
  testLabel,
  onTest,
  testId,
}: ConnectionStatusViewProps) {
  const t = useMaybeT();
  const defaultMessages = useConnectionStatusMessages();
  const headline = messages?.[state] ?? defaultMessages[state];

  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]">
      <div
        data-widget="connection-status"
        data-state={state}
        data-testid={testId}
        // A connect probe resolving is a status change worth announcing, but not
        // an interruption — polite, and only once it settles.
        role="status"
        aria-live="polite"
        className={cn('flex items-center gap-3 rounded-lg px-3.5 py-3', STATE_SHELL[state])}
      >
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
          {state === 'connecting' ? (
            <Spinner size="sm" className="size-4" />
          ) : state === 'connected' ? (
            <CheckCircle2 className="size-4" />
          ) : state === 'failed' ? (
            <XCircle className="size-4" />
          ) : (
            <Plug className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-bold">{headline}</p>
          {host !== undefined && (
            <MonoText data-part="connection-host" className="block truncate text-caption">
              {host}
            </MonoText>
          )}
          {/*
            `opacity-80` removed from both lines: over the tinted connected/failed
            shells it took the host and detail — the only two data this widget
            carries — to 3.25:1, against the 4.56:1 the token gate already
            certifies for the untinted pair. Size and weight carry the hierarchy
            against the headline. Same call as CalendarMonth.tsx:243.
          */}
          {detail !== undefined && <p className="truncate text-caption">{detail}</p>}
        </div>

        {/*
          `onTest` gates the button as much as `testable` does: an unbound
          (demo) instance has no handler, and rendering an inert Test button
          that silently does nothing is worse than rendering none.
        */}
        {testable && onTest !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            data-part="connection-test"
            disabled={state === 'connecting'}
            onClick={onTest}
          >
            {testLabel ?? t('ui:widgets.system.connectionStatus.test', 'Test')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectionStatusWidget({ config, data, onEvent }: WidgetProps<ConnectionStatusConfig>) {
  const row = recordRowOf(data);
  const state = oneOf(row === null ? undefined : stringField(row, config.stateField), CONNECTION_STATES, 'idle');
  const target = bindingSourceOf(config.binding);

  return (
    <ConnectionStatusView
      state={state}
      host={row === null ? undefined : stringField(row, config.hostField)}
      detail={row === null ? undefined : stringField(row, config.detailField)}
      messages={config.messages}
      testable={config.testable}
      testLabel={config.testLabel}
      // Unbound (demo) instances have nowhere to send the intent — the host
      // owns the probe, so without a binding the action would be a no-op.
      onTest={
        target === null
          ? undefined
          : () =>
              onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: target.connectionId,
                table: target.table,
                values: { action: 'test-connection' },
              })
      }
      testId={config.testId}
    />
  );
}
