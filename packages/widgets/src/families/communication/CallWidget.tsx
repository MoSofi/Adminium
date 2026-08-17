// SPDX-License-Identifier: AGPL-3.0-only
import { Avatar, Button, EmptyState } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Phone, PhoneOff, Video } from 'lucide-react';

import { callKindOf, callStateOf, localeOf, recordRowOf, sourceOf, stringField } from './chat-lib.js';
import type { CallKind, CallState } from './chat-lib.js';
import type { CallWidgetConfig } from './communication-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure
// `communication-config` module so the registry metadata graph never eagerly
// pulls this component's @adminium/ui deps (acceptance #3); re-exported here so
// the family barrel, stories, and tests keep one import point per widget.
export { callWidgetConfigSchema, callWidgetDemoData } from './communication-config.js';
export type { CallWidgetConfig };

/**
 * `call-widget` (annex §9) — the ringing state: a large avatar wrapped in an
 * expanding accent ring, the voice/video kind label, and accept/decline
 * controls. The annex flags it as niche and says why it is kept: marketplace
 * apps (a POS support line, a telehealth micro-SaaS).
 *
 * A SHELL, NOT A CALL STACK: it renders `{kind, peer, state}` and emits accept /
 * decline / hang-up as `mutate` intents through `onEvent` (the host runs them
 * through the CRUD API with audit + undo, 04 §2.1). It never opens a media
 * device or a peer connection — a marketplace app that wants real WebRTC owns
 * that and drives this widget's `state` column.
 *
 * MOTION: the expanding ring is `motion-safe:animate-ping`, so it is inert under
 * `prefers-reduced-motion` (02 §6) — the static ring still reads as "ringing",
 * and the state label carries the meaning for anyone who never sees the
 * animation at all.
 *
 * RTL: centered column flow with logical gaps only; nothing to mirror.
 */

export interface CallWidgetProps {
  peer: string;
  kind: CallKind;
  state: CallState;
  actions?: boolean | undefined;
  /** Already-translated copy (the host resolves the i18n keys). */
  kindLabel?: string | undefined;
  stateLabel?: string | undefined;
  acceptLabel?: string | undefined;
  declineLabel?: string | undefined;
  endLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onAccept?: (() => void) | undefined;
  onDecline?: (() => void) | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

/** Ringing is the only state that pulses; a live call is steady. */
const RINGS: Record<CallState, boolean> = { ringing: true, connecting: true, active: false, ended: false };

export function CallWidget({
  peer,
  kind,
  state,
  actions = true,
  kindLabel,
  stateLabel,
  acceptLabel,
  declineLabel,
  endLabel,
  emptyTitle,
  emptyBody,
  onAccept,
  onDecline,
  locale: localeProp,
  testId,
}: CallWidgetProps) {
  const t = useMaybeT();
  // `format.locale` is a free-string in the shared config, so '' / 'x-1' are
  // schema-valid and would throw out of Avatar's `toLocaleUpperCase`.
  const locale = localeOf(localeProp);

  if (peer.trim() === '') {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={emptyTitle ?? t('ui:widgets.communication.callWidget.emptyTitle', 'No active call')}
        body={emptyBody ?? t('ui:widgets.communication.callWidget.emptyBody', 'An incoming call will appear here.')}
      />
    );
  }

  const ringing = RINGS[state];
  const ended = state === 'ended';
  const KindIcon = kind === 'video' ? Video : Phone;

  // The per-state default renders the RAW state value, verbatim what shipped —
  // the bundle's polished labels ("Ringing…") only differ under an
  // I18nProvider, and the config's per-state labels still override key-by-key
  // (reported for bundle alignment rather than changing rendered English here).
  const stateText =
    stateLabel ??
    {
      ringing: t('ui:widgets.communication.callWidget.ringingLabel', 'Ringing…'),
      connecting: t('ui:widgets.communication.callWidget.connectingLabel', 'Connecting…'),
      active: t('ui:widgets.communication.callWidget.activeLabel', 'In call'),
      ended: t('ui:widgets.communication.callWidget.endedLabel', 'Call ended'),
    }[state];

  return (
    <div
      data-widget="call-widget"
      data-testid={testId}
      data-call-state={state}
      data-call-kind={kind}
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center compact:gap-3 compact:p-4"
    >
      <div className="relative flex items-center justify-center">
        {/* The annex's "expanding accent ring". Purely decorative: the state
            label below carries the same information for reduced-motion users. */}
        {ringing && (
          <span
            aria-hidden="true"
            data-part="call-ring"
            className="absolute inset-0 rounded-full border-2 border-accent motion-safe:animate-ping"
          />
        )}
        <Avatar name={peer} size="2xl" locale={locale} />
      </div>

      <div className="flex flex-col items-center gap-1">
        <p className="text-body font-bold text-fg">{peer}</p>
        <p data-part="call-kind" className="flex items-center gap-1.5 text-caption font-medium text-fg-muted">
          <KindIcon aria-hidden="true" className="size-3.5" />
          {kindLabel ??
            (kind === 'video'
              ? t('ui:widgets.communication.callWidget.videoLabel', 'Video call')
              : t('ui:widgets.communication.callWidget.voiceLabel', 'Voice call'))}
        </p>
        <p data-part="call-state" className="text-caption text-fg-subtle">
          {stateText}
        </p>
      </div>

      {actions && !ended && (
        <div className="flex items-center gap-3">
          {state === 'ringing' && (
            <Button size="sm" variant="primary" iconLeft={<Phone />} onClick={onAccept}>
              {acceptLabel ?? t('ui:widgets.communication.callWidget.acceptLabel', 'Accept')}
            </Button>
          )}
          <Button size="sm" variant="destructive" iconLeft={<PhoneOff />} onClick={onDecline}>
            {state === 'active'
              ? (endLabel ?? t('ui:widgets.communication.callWidget.endLabel', 'End call'))
              : (declineLabel ?? t('ui:widgets.communication.callWidget.declineLabel', 'Decline'))}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The already-translated label for a call state, from the per-state config keys. */
function stateLabelOf(state: CallState, config: CallWidgetConfig): string | undefined {
  switch (state) {
    case 'ringing':
      return config.ringingLabel;
    case 'connecting':
      return config.connectingLabel;
    case 'active':
      return config.activeLabel;
    case 'ended':
      return config.endedLabel;
  }
}

export function CallWidgetWidget({ config, data, onEvent }: WidgetProps<CallWidgetConfig>) {
  const row = recordRowOf(data);
  const kind = callKindOf(row?.[config.kindField]);
  const state = callStateOf(row?.[config.stateField]);
  const peer = row === null ? '' : (stringField(row, config.peerField) ?? '');
  const source = sourceOf(config.binding);
  const rawId = row?.['id'];
  const recordId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined;

  /** Accept/decline are state transitions on the call row — the host writes them. */
  const transition = (next: CallState): void => {
    onEvent({
      type: 'mutate',
      intent: 'update',
      ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
      table: source.table,
      ...(recordId === undefined ? {} : { recordId }),
      values: { [config.stateField]: next },
    });
  };

  return (
    <CallWidget
      peer={peer}
      kind={kind}
      state={state}
      actions={config.actions}
      {...(kind === 'video'
        ? config.videoLabel === undefined
          ? {}
          : { kindLabel: config.videoLabel }
        : config.voiceLabel === undefined
          ? {}
          : { kindLabel: config.voiceLabel })}
      {...(stateLabelOf(state, config) === undefined ? {} : { stateLabel: stateLabelOf(state, config) })}
      {...(config.acceptLabel === undefined ? {} : { acceptLabel: config.acceptLabel })}
      {...(config.declineLabel === undefined ? {} : { declineLabel: config.declineLabel })}
      {...(config.endLabel === undefined ? {} : { endLabel: config.endLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onAccept={() => transition('active')}
      onDecline={() => transition('ended')}
    />
  );
}
