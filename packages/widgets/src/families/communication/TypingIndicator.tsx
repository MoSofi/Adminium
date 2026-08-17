// SPDX-License-Identifier: AGPL-3.0-only
import { Avatar, AvatarStack } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { isTypingIn, localeOf, typingEntriesOf } from './chat-lib.js';
import type { TypingIndicatorConfig } from './communication-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure
// `communication-config` module so the registry metadata graph never eagerly
// pulls this component's @adminium/ui deps (acceptance #3); re-exported here so
// the family barrel, stories, and tests keep one import point per widget.
export { typingIndicatorConfigSchema, typingIndicatorDemoData } from './communication-config.js';
export type { TypingIndicatorConfig };

/**
 * `typing-indicator` (annex §9) — "Avatar + italic 'typing…' row bound to a
 * boolean". Binds to a `boolean-map` keyed by conversation id and renders the
 * peer's avatar (or the group's typists) beside an italic label and three
 * staggered pulsing dots.
 *
 * ALSO THE THREAD'S OWN TYPING ROW: `chat-thread` renders this same component
 * for its inline `typingIndicator` config rather than duplicating the markup —
 * the annex places this widget as a "child of thread", so one implementation
 * serves both the registered standalone instance and the embedded row. Both live
 * in the family's single lazy chunk, so the reuse costs no extra bytes.
 *
 * IDLE RENDERS NOTHING, DELIBERATELY: a typing indicator is ephemeral, and it is
 * a `placement: 'inline'` widget (no WidgetFrame card of its own), so an idle
 * instance must occupy no space rather than leave a titled empty box in the
 * thread. The `aria-live="polite"` wrapper stays mounted across the transition
 * so assistive tech announces the row when it appears — an element that is
 * itself inserted with `aria-live` on it is not reliably announced.
 *
 * RTL: pure logical flow (`flex` + `gap`), so the row mirrors with the thread.
 */

export interface TypingIndicatorProps {
  /** Whether anyone is currently typing (the bound boolean). */
  typing: boolean;
  /** Names to show avatars for; empty → label only. */
  typists?: readonly string[] | undefined;
  /** Italic copy; already translated by the host. */
  label?: string | undefined;
  showAvatar?: boolean | undefined;
  maxAvatars?: number | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

/** Staggered pulse — the three-dot "…" that reads as live typing. */
function TypingDots() {
  return (
    <span data-part="typing-dots" aria-hidden="true" className="flex items-center gap-0.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`size-1 rounded-full bg-fg-subtle motion-safe:animate-pulse ${
            index === 1 ? '[animation-delay:150ms]' : index === 2 ? '[animation-delay:300ms]' : ''
          }`}
        />
      ))}
    </span>
  );
}

export function TypingIndicator({
  typing,
  typists,
  label,
  showAvatar = true,
  maxAvatars = 3,
  locale: localeProp,
  testId,
}: TypingIndicatorProps) {
  const t = useMaybeT();
  // `format.locale` is a free-string in the shared config, so '' / 'x-1' are
  // schema-valid and would throw out of Avatar's `toLocaleUpperCase`. Normalize
  // once, at the boundary (the family convention).
  const locale = localeOf(localeProp);
  const names = (typists ?? []).filter((name) => name.trim() !== '');

  return (
    <div
      data-widget="typing-indicator"
      data-testid={testId}
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2"
    >
      {typing && (
        <span data-part="typing-indicator" className="flex items-center gap-2 py-1.5">
          {showAvatar && names.length === 1 && <Avatar name={names[0] as string} size="sm" locale={locale} />}
          {showAvatar && names.length > 1 && (
            <AvatarStack size="sm" max={maxAvatars} label={label}>
              {names.map((name) => (
                <Avatar key={name} name={name} size="sm" locale={locale} />
              ))}
            </AvatarStack>
          )}
          <span className="text-caption italic text-fg-subtle">
            {label ?? t('ui:widgets.communication.typingIndicator.label', 'typing…')}
          </span>
          <TypingDots />
        </span>
      )}
    </div>
  );
}

export function TypingIndicatorWidget({ config, data }: WidgetProps<TypingIndicatorConfig>) {
  const entries = typingEntriesOf(data);
  const typing = isTypingIn(entries, config.conversationId);
  // Group chats list their typists in config; a 1:1 thread names its single
  // peer. Neither is data: the payload is the annex's boolean, and the thread
  // hosting this row already knows who it is talking to.
  const typists = config.typists.length > 0 ? config.typists : config.peerName === undefined ? [] : [config.peerName];
  return (
    <TypingIndicator
      typing={typing}
      typists={typists}
      showAvatar={config.showAvatar}
      maxAvatars={config.maxAvatars}
      {...(config.label === undefined ? {} : { label: config.label })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
