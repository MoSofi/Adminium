// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK TABLES-CAL-BOARDS `boards` M7 Wave-4 TAIL stories (annex §6): the
 * standalone `board-card` and the `inline-compose-card` quick-add — each
 * widget's loaded variant, the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices with REAL geometry
 * mirroring (acceptance #9 — the RTL frames set `dir="rtl"` so the card's tag
 * pill leads on the right, the points/grip `ms-auto` push reverses, the progress
 * bar fills from the right, and the composer's Add/Cancel row flips; a bare
 * attribute would prove nothing).
 */
import type { ReactNode } from 'react';

import { BoardCard, boardCardOf } from './BoardCard.js';
import { InlineComposeCard } from './InlineComposeCard.js';
import { boardCardConfigSchema, boardCardDemoData, inlineComposeCardDemoData } from './boards-config.js';
import { boardsTrackDefinitions } from './boards-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...boardsTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Boards (tail)' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="w-72">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('BOARD_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

/** Schema defaults + overrides — the same projection the host performs. */
function parse<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const BoardCardStory = {
  name: 'board-card',
  render: () => host('board-card', 's-card', { title: 'Card' }, boardCardDemoData(7)),
};

export const InlineComposeCardStory = {
  name: 'inline-compose-card',
  render: () => host('inline-compose-card', 's-compose', { title: 'Quick add' }, inlineComposeCardDemoData(3)),
};

export const InlineComposeCardOpen = {
  name: 'inline-compose-card (open)',
  render: () =>
    host('inline-compose-card', 's-compose-open', { defaultOpen: true }, inlineComposeCardDemoData(3)),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** board-card: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('board-card', 'bs-loaded', { title: 'Card' }, boardCardDemoData(7))}
        {host('board-card', 'bs-skeleton', { title: 'Card' }, undefined, 'loading')}
        {host('board-card', 'bs-empty', { title: 'Card', emptyState: { titleKey: 'No card' } }, { row: null })}
        {host('board-card', 'bs-error', { title: 'Card' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** inline-compose-card: the same four states for the composer. */
export const ComposeStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('inline-compose-card', 'cs-loaded', { defaultOpen: true }, inlineComposeCardDemoData(3))}
        {host('inline-compose-card', 'cs-skeleton', {}, undefined, 'loading')}
        {host('inline-compose-card', 'cs-empty', { emptyState: { titleKey: 'Nothing to compose' } }, undefined)}
        {host('inline-compose-card', 'cs-error', {}, undefined, 'error')}
      </div>
    </Frame>
  ),
};

// ── light/dark × LTR/RTL with real mirroring (acceptance #9) ───────────────

/**
 * The card in every column tone plus the composer. Under RTL the tag pill leads
 * on the right, the `ms-auto` points/grip push reverses, and the progress bar
 * fills from the right edge.
 */
export const ThemeAndDirectionMatrix = {
  render: () => {
    const config = parse(boardCardConfigSchema);
    const card = boardCardOf(boardCardDemoData(7), config);
    const row = () => (
      <div className="grid grid-cols-3 gap-3">
        {card !== null && <BoardCard card={card} columnTone="accent" showGrip={false} />}
        {card !== null && <BoardCard card={{ ...card, pct: 100, priority: 'Low' }} columnTone="pos" showGrip={false} />}
        <InlineComposeCard defaultOpen />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

/** The card with its visible-field allow-list narrowed to a bare title + owner. */
export const BoardCardMinimalFields = {
  name: 'board-card (fields allow-list)',
  render: () => {
    const card = boardCardOf(boardCardDemoData(7), parse(boardCardConfigSchema, { fields: ['owner', 'tag'] }));
    return (
      <Frame>
        <div className="w-64">{card !== null && <BoardCard card={card} showGrip={false} />}</div>
      </Frame>
    );
  },
};

// ── Interaction stories ────────────────────────────────────────────────────

/** Opening the composer and typing — Enter commits, Escape cancels. */
export const ComposeInteraction = {
  name: 'inline-compose-card (open + type)',
  render: () => (
    <Frame>
      <div className="w-64">
        <InlineComposeCard />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLElement>('[data-part="compose-open"]')?.click();
  },
};
