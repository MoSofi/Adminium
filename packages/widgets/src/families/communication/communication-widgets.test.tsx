// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `communication` family (annex §9, Track COMM): render + behaviour tests for
 * conversation-inbox, chat-thread, and ai-chat-panel.
 *
 * The RTL suite is the load-bearing one (acceptance #9). happy-dom does no
 * layout, so asserting a computed pixel position would prove nothing; what
 * actually decides whether a bubble mirrors is WHICH utilities express its
 * alignment. So the tests assert (a) own bubbles dock to the inline-end edge
 * via `justify-end` and incoming ones to `justify-start`, (b) the squared
 * "tail" corner is the LOGICAL end-end / end-start corner, (c) the markup is
 * byte-identical under `dir="ltr"` and `dir="rtl"` — i.e. the mirror is the
 * browser resolving logical properties, never a JS branch — and (d) no physical
 * direction utility appears anywhere in the rendered tree.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiChatPanel } from './AiChatPanel.js';
import { CallWidget, CallWidgetWidget } from './CallWidget.js';
import { ChatThread } from './ChatThread.js';
import { ConversationInbox } from './ConversationInbox.js';
import { TypingIndicator, TypingIndicatorWidget } from './TypingIndicator.js';
import {
  CHAT_DEMO_EPOCH,
  attachmentsOf,
  callKindOf,
  callStateOf,
  chatRowsOf,
  fmtClock,
  fmtCount,
  fmtDaySeparator,
  groupMessages,
  isTypingIn,
  isoDayOf,
  localeOf,
  recordRowOf,
  sortBySentAt,
  sourceOf,
  toChatMessage,
  typingEntriesOf,
} from './chat-lib.js';
import type { ChatMessage } from './chat-lib.js';
import {
  aiChatPanelConfigSchema,
  aiChatPanelDemoData,
  callWidgetConfigSchema,
  callWidgetDemoData,
  chatThreadConfigSchema,
  chatThreadDemoData,
  conversationInboxConfigSchema,
  conversationInboxDemoData,
  typingIndicatorConfigSchema,
  typingIndicatorDemoData,
} from './communication-config.js';
import {
  aiChatPanelDefinition,
  callWidgetDefinition,
  chatThreadDefinition,
  conversationInboxDefinition,
  typingIndicatorDefinition,
} from './communication-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

afterEach(cleanup);

const DAY = 86_400_000;

function message(id: string, own: boolean, body: string, offsetMs: number, author?: string): ChatMessage {
  return {
    id,
    own,
    body,
    author: author ?? (own ? 'Ava Reyes' : 'Morgan Lee'),
    sentAt: new Date(CHAT_DEMO_EPOCH + offsetMs).toISOString(),
  };
}

/** Every physical-direction Tailwind utility the RTL policy bans (10 §5.2). */
const PHYSICAL = /(^|\s)-?(ml|mr|pl|pr)-|(^|\s)-?(left|right)-|(^|\s)border-(l|r)(-|\s|$)|(^|\s)rounded-(l|r|tl|tr|bl|br)(-|\s|$)|(^|\s)text-(left|right)(\s|$)/;

function allClassNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[class]')].map((node) => node.className);
}

// ── chat-lib ────────────────────────────────────────────────────────────────

describe('chat-lib helpers', () => {
  it('reads record-list envelopes and the bare-array shorthand', () => {
    expect(chatRowsOf({ data: [{ id: 1 }], total: 1 })).toEqual([{ id: 1 }]);
    expect(chatRowsOf([{ id: 2 }])).toEqual([{ id: 2 }]);
    expect(chatRowsOf({ snapshot: [{ id: 3 }] })).toEqual([{ id: 3 }]);
    expect(chatRowsOf(null)).toEqual([]);
    expect(chatRowsOf('nope')).toEqual([]);
  });

  /**
   * The canonical §3 `record-list` these widgets DECLARE as their dataContract,
   * and the exact shape the server's `ShapedRecordList` shaper returns. Reading
   * only `data`/`snapshot` meant a generated chat page rendered an inbox, a
   * thread and an AI panel all claiming "no messages" against a live payload of
   * twelve — invisible to the suite because every demoData emitted `{ data }`.
   */
  it('reads the canonical { rows, total } envelope the server actually returns', () => {
    const serverPayload = {
      shape: 'record-list',
      rows: [{ id: 'm1', body: 'hi' }],
      columns: [],
      total: 1,
    };
    expect(chatRowsOf(serverPayload)).toEqual([{ id: 'm1', body: 'hi' }]);
  });

  it('prefers the canonical rows key when an envelope carries both', () => {
    expect(chatRowsOf({ rows: [{ id: 'canonical' }], data: [{ id: 'shorthand' }] })).toEqual([
      { id: 'canonical' },
    ]);
  });

  it('derives the UTC day key from an ISO stamp, and tolerates garbage', () => {
    expect(isoDayOf('2026-07-14T12:00:00.000Z')).toBe('2026-07-14');
    expect(isoDayOf('not-a-date')).toBe('');
  });

  it('sorts messages ascending by sentAt, stable for equal stamps', () => {
    const a = message('a', false, 'first', 0);
    const b = message('b', false, 'second', 0); // identical stamp → index tiebreak
    const c = message('c', true, 'earlier', -1000);
    expect(sortBySentAt([a, b, c]).map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('normalizes attachment cells (strings, objects, junk)', () => {
    expect(attachmentsOf(['a.pdf'])).toEqual([{ name: 'a.pdf' }]);
    expect(attachmentsOf([{ name: 'b.csv', size: '2 KB' }])).toEqual([{ name: 'b.csv', size: '2 KB' }]);
    expect(attachmentsOf([{ size: '2 KB' }])).toEqual([]); // no name → dropped
    expect(attachmentsOf('nope')).toEqual([]);
  });

  it('maps a row to a message through config-named fields', () => {
    const row = { id: 7, sender: 'Sam Park', text: 'hi', created_at: '2026-07-14T09:00:00.000Z', files: ['x.pdf'] };
    expect(
      toChatMessage(row, 0, {
        authorField: 'sender',
        bodyField: 'text',
        sentAtField: 'created_at',
        attachmentsField: 'files',
        ownField: 'own',
      }),
    ).toEqual({
      id: 7,
      author: 'Sam Park',
      own: false,
      body: 'hi',
      sentAt: '2026-07-14T09:00:00.000Z',
      attachments: [{ name: 'x.pdf' }],
    });
  });

  it('treats a row as own when its author matches ownAuthor (the sender_fk shape)', () => {
    const fields = {
      authorField: 'sender',
      bodyField: 'text',
      sentAtField: 'ts',
      attachmentsField: 'files',
      ownField: 'own',
      ownAuthor: 'Ava Reyes',
    };
    expect(toChatMessage({ sender: 'Ava Reyes', text: 'a' }, 0, fields).own).toBe(true);
    expect(toChatMessage({ sender: 'Morgan Lee', text: 'b' }, 1, fields).own).toBe(false);
  });

  it('reads the event source off a query descriptor, falling back safely', () => {
    expect(sourceOf({ connectionId: 'c1', source: { name: 'messages' } })).toEqual({
      connectionId: 'c1',
      table: 'messages',
    });
    expect(sourceOf(undefined)).toEqual({ connectionId: undefined, table: 'records' });
  });
});

/**
 * `format.locale` is an optional free-string in the shared widget config, so
 * `''` and junk like `'x-1'` are SCHEMA-VALID and reach the widgets — and every
 * Intl constructor throws `RangeError: Incorrect locale information provided`
 * on them. Config-fuzz caught exactly this; these lock the guard down.
 */
describe('chat-lib localeOf normalizes untrusted locale tags', () => {
  it('falls back to en-US for empty, blank, and structurally invalid tags', () => {
    // Exactly the tags Intl itself rejects with a RangeError.
    for (const tag of ['', '   ', 'x-1', '!!', undefined]) {
      expect(localeOf(tag)).toBe('en-US');
    }
  });

  it('passes through real tags untouched', () => {
    for (const tag of ['en-US', 'ar-EG', 'de-DE', 'zh-Hans-CN']) {
      expect(localeOf(tag)).toBe(tag);
    }
  });

  it('passes through structurally-valid but unknown tags — Intl falls back itself', () => {
    // 'north' is a syntactically legal (5-letter, reserved) language subtag, so
    // Intl accepts it and resolves to its own default. Rewriting it would be
    // over-reach; the guard exists only for tags Intl would THROW on.
    expect(localeOf('north')).toBe('north');
    expect(() => new Intl.DateTimeFormat('north')).not.toThrow();
  });

  it('keeps every Intl-routed formatter total on a junk tag', () => {
    const iso = new Date(CHAT_DEMO_EPOCH).toISOString();
    for (const tag of ['', 'x-1']) {
      expect(() => fmtClock(tag, iso)).not.toThrow();
      expect(() => fmtCount(tag, 3)).not.toThrow();
      expect(() => fmtDaySeparator(tag, new Date(CHAT_DEMO_EPOCH), CHAT_DEMO_EPOCH)).not.toThrow();
    }
  });
});

describe('communication widgets survive a schema-valid but junk locale', () => {
  const rows = [{ id: 'c1', name: 'Morgan Lee', preview: 'hi', ts: new Date(CHAT_DEMO_EPOCH).toISOString(), unread: 2 }];
  const thread = [message('m1', false, 'incoming', 0), message('m2', true, 'outgoing', 1000)];
  const turns = [{ id: 'q1', role: 'user' as const, body: 'hi', sentAt: new Date(CHAT_DEMO_EPOCH).toISOString() }];

  for (const locale of ['', 'x-1']) {
    it(`renders all three widgets with locale=${JSON.stringify(locale)} without throwing`, () => {
      expect(() => {
        // The inbox is the sharp edge: it also runs toLocaleLowerCase(locale)
        // through its search filter.
        render(<ConversationInbox conversations={rows} locale={locale} searchable now={CHAT_DEMO_EPOCH} />);
        cleanup();
        render(<ChatThread messages={thread} locale={locale} now={CHAT_DEMO_EPOCH} />);
        cleanup();
        render(<AiChatPanel turns={turns} locale={locale} />);
      }).not.toThrow();
    });
  }

  it('still filters the inbox on a junk locale', () => {
    render(<ConversationInbox conversations={rows} locale="" searchable now={CHAT_DEMO_EPOCH} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'morgan' } });
    expect(screen.getByText('Morgan Lee')).toBeTruthy();
  });
});

describe('chat-lib groupMessages (day + author runs)', () => {
  it('splits messages into one group per UTC day, chronologically', () => {
    const groups = groupMessages([
      message('m3', false, 'today', 0),
      message('m1', false, 'two days ago', -2 * DAY),
      message('m2', true, 'yesterday', -1 * DAY),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['2026-07-12', '2026-07-13', '2026-07-14']);
    expect(groups.flatMap((g) => g.bubbles.map((b) => b.id))).toEqual(['m1', 'm2', 'm3']);
  });

  it('marks run boundaries: avatar on the first of a run, timestamp on the last', () => {
    const groups = groupMessages([
      message('a1', false, 'one', 0),
      message('a2', false, 'two', 1000),
      message('b1', true, 'reply', 2000),
    ]);
    const bubbles = groups[0]?.bubbles ?? [];
    expect(bubbles.map((b) => [b.id, b.startsRun, b.endsRun])).toEqual([
      ['a1', true, false],
      ['a2', false, true],
      ['b1', true, true],
    ]);
  });

  it('breaks a run at a day boundary, so a separator never lands inside one', () => {
    const groups = groupMessages([
      message('d1', false, 'late yesterday', -1 * DAY),
      message('d2', false, 'early today', 0),
    ]);
    expect(groups).toHaveLength(2);
    // Same author across the boundary, but each day starts + ends its own run.
    expect(groups.every((g) => g.bubbles.every((b) => b.startsRun && b.endsRun))).toBe(true);
  });

  it('breaks a run when the same author flips own (never merges sides)', () => {
    const groups = groupMessages([
      message('x1', false, 'a', 0, 'Sam'),
      message('x2', true, 'b', 1000, 'Sam'),
    ]);
    expect(groups[0]?.bubbles.map((b) => b.startsRun)).toEqual([true, true]);
  });
});

// ── conversation-inbox ──────────────────────────────────────────────────────

describe('conversation-inbox', () => {
  const rows = [
    { id: 'c1', name: 'Morgan Lee', preview: 'Sounds good', ts: new Date(CHAT_DEMO_EPOCH - 120_000).toISOString(), unread: 0, online: true },
    { id: 'c2', name: 'Design Team', preview: 'pushed tokens', ts: new Date(CHAT_DEMO_EPOCH - 3_600_000).toISOString(), unread: 3, online: false, group: true },
  ];

  it('renders a row per conversation with name, preview, and relative time', () => {
    render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Morgan Lee')).toBeTruthy();
    expect(screen.getByText('Sounds good')).toBeTruthy();
    // Relative time routes through the Intl layer (narrow style, latn digits),
    // not a hand-rolled formatter.
    expect(screen.getByText('2m ago')).toBeTruthy();
    expect(screen.getByText('1h ago')).toBeTruthy();
  });

  it('bolds the preview and shows the unread pill only for unread rows', () => {
    const { container } = render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    const unreadRow = container.querySelector('[data-conversation-id="c2"]') as HTMLElement;
    const readRow = container.querySelector('[data-conversation-id="c1"]') as HTMLElement;
    expect(within(unreadRow).getByText('3')).toBeTruthy();
    expect(unreadRow.querySelector('[data-part="conversation-preview"]')?.className).toContain('font-bold');
    expect(readRow.querySelector('[data-part="unread-pill"]')).toBeNull();
    expect(readRow.querySelector('[data-part="conversation-preview"]')?.className).toContain('font-medium');
  });

  it('renders the presence dot only when presence is on and the peer is online', () => {
    const { container, rerender } = render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-testid="avatar-presence"]')).toHaveLength(1);
    rerender(<ConversationInbox conversations={rows} presence={false} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-testid="avatar-presence"]')).toHaveLength(0);
  });

  it('shows the group glyph for group chats when groupChats is on', () => {
    const { container, rerender } = render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="group-glyph"]')).toHaveLength(1);
    rerender(<ConversationInbox conversations={rows} groupChats={false} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="group-glyph"]')).toHaveLength(0);
  });

  it('selecting a row marks it current, clears its unread pill, and reports the id', () => {
    const onSelect = vi.fn();
    const { container } = render(<ConversationInbox conversations={rows} onSelect={onSelect} now={CHAT_DEMO_EPOCH} />);
    const row = container.querySelector('[data-conversation-id="c2"]') as HTMLElement;
    expect(within(row).getByText('3')).toBeTruthy();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('c2');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.querySelector('[data-part="unread-pill"]')).toBeNull();
  });

  it('keeps the unread pill when clearUnreadOnSelect is off', () => {
    const { container } = render(
      <ConversationInbox conversations={rows} clearUnreadOnSelect={false} now={CHAT_DEMO_EPOCH} />,
    );
    const row = container.querySelector('[data-conversation-id="c2"]') as HTMLElement;
    fireEvent.click(row);
    expect(row.querySelector('[data-part="unread-pill"]')).not.toBeNull();
  });

  it('selects the first row by default and honours a controlled selectedId', () => {
    const { container, rerender } = render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelector('[data-conversation-id="c1"]')?.getAttribute('aria-current')).toBe('true');
    rerender(<ConversationInbox conversations={rows} selectedId="c2" now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelector('[data-conversation-id="c2"]')?.getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('[data-conversation-id="c1"]')?.getAttribute('aria-current')).toBeNull();
  });

  it('filters rows when searchable, and shows the no-matches empty state', () => {
    render(<ConversationInbox conversations={rows} searchable now={CHAT_DEMO_EPOCH} />);
    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'design' } });
    expect(screen.queryByText('Morgan Lee')).toBeNull();
    expect(screen.getByText('Design Team')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No conversations match')).toBeTruthy();
  });

  it('renders the empty state with per-widget copy when there are no conversations', () => {
    render(<ConversationInbox conversations={[]} emptyTitle="Nothing here" emptyBody="Say hi first." />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Say hi first.')).toBeTruthy();
  });
});

// ── chat-thread ─────────────────────────────────────────────────────────────

describe('chat-thread', () => {
  const thread = [
    message('m1', false, 'Did you see the timeline?', -1 * DAY),
    message('m2', false, 'The client wants it sooner.', -1 * DAY + 1000),
    message('m3', true, 'Doable, but tight.', 0),
  ];

  it('renders a bubble per message with the author on the first of a run', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="message-bubble"]')).toHaveLength(3);
    // Run of two from Morgan → the name renders once.
    expect(screen.getAllByText('Morgan Lee')).toHaveLength(1);
  });

  it('renders one day separator per day group, labelled through the Intl layer', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const separators = container.querySelectorAll('[data-part="day-separator"]');
    expect(separators).toHaveLength(2);
    expect(screen.getByText('yesterday')).toBeTruthy();
    expect(screen.getByText('today')).toBeTruthy();
  });

  it('groups bubbles under their day, in chronological order', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const groups = [...container.querySelectorAll<HTMLElement>('[data-part="day-group"]')];
    expect(groups.map((g) => g.dataset['day'])).toEqual(['2026-07-13', '2026-07-14']);
    expect(groups[0]?.querySelectorAll('[data-part="message-bubble"]')).toHaveLength(2);
    expect(groups[1]?.querySelectorAll('[data-part="message-bubble"]')).toHaveLength(1);
  });

  it('hides day separators when configured off', () => {
    const { container } = render(<ChatThread messages={thread} daySeparators={false} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="day-separator"]')).toHaveLength(0);
  });

  it('renders an avatar only on the first message of an incoming run, spacer otherwise', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-part="message-row"]')];
    expect(rows[0]?.querySelector('[role="img"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-part="avatar-spacer"]')).not.toBeNull();
    // Own messages never carry an avatar (they're already identified by side).
    expect(rows[2]?.querySelector('[role="img"]')).toBeNull();
  });

  it('renders the timestamp only on the last message of a run', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-part="message-row"]')];
    expect(rows[0]?.querySelector('[data-part="message-time"]')).toBeNull();
    expect(rows[1]?.querySelector('[data-part="message-time"]')).not.toBeNull();
    expect(rows[2]?.querySelector('[data-part="message-time"]')).not.toBeNull();
  });

  it('renders attachment chips under a bubble, and hides them when off', () => {
    const withFile: ChatMessage[] = [
      { ...message('f1', false, 'Plans attached', 0), attachments: [{ name: 'plan.pdf', size: '2.4 MB' }] },
    ];
    const { container, rerender } = render(<ChatThread messages={withFile} now={CHAT_DEMO_EPOCH} />);
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.getByText('2.4 MB')).toBeTruthy();
    rerender(<ChatThread messages={withFile} attachments={false} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="attachment-chips"]')).toHaveLength(0);
  });

  it('renders the peer header with a presence line', () => {
    render(<ChatThread messages={thread} peerName="Morgan Lee" peerStatus="Active now" peerOnline now={CHAT_DEMO_EPOCH} />);
    expect(screen.getByText('Active now')).toBeTruthy();
    expect(screen.getByTestId('avatar-presence')).toBeTruthy();
  });

  it('shows the typing indicator only when configured on', () => {
    const { container, rerender } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="typing-indicator"]')).toHaveLength(0);
    rerender(<ChatThread messages={thread} typingIndicator typingLabel="typing…" now={CHAT_DEMO_EPOCH} />);
    expect(screen.getByText('typing…')).toBeTruthy();
  });

  it('composer submits a trimmed draft once, then clears; empty drafts are inert', () => {
    const onSend = vi.fn();
    const { container } = render(<ChatThread messages={thread} onSend={onSend} now={CHAT_DEMO_EPOCH} />);
    const input = screen.getByLabelText('Message') as HTMLInputElement;
    const send = screen.getByLabelText('Send') as HTMLButtonElement;

    expect(send.disabled).toBe(true); // empty draft → inert
    fireEvent.change(input, { target: { value: '   ' } });
    expect(send.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  on it  ' } });
    expect(send.disabled).toBe(false);
    fireEvent.submit(container.querySelector('[data-part="composer"]') as HTMLElement);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('on it');
    expect(input.value).toBe('');
  });

  it('hides the composer when configured off', () => {
    const { container } = render(<ChatThread messages={thread} composer={false} now={CHAT_DEMO_EPOCH} />);
    expect(container.querySelectorAll('[data-part="composer"]')).toHaveLength(0);
  });

  it('renders the empty state with per-widget copy when the thread has no messages', () => {
    render(<ChatThread messages={[]} emptyTitle="No messages yet" emptyBody="Start the conversation." />);
    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(screen.getByText('Start the conversation.')).toBeTruthy();
  });
});

// ── RTL: the exit-criterion behaviour (acceptance #9) ───────────────────────

describe('chat-thread bubble alignment mirrors under RTL', () => {
  const thread = [message('m1', false, 'incoming', 0), message('m2', true, 'outgoing', 1000)];

  it('docks own bubbles to the inline-end edge and incoming ones to inline-start', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-part="message-row"]')];
    // `justify-end` resolves along the writing direction, so this IS the
    // inline-end edge in both LTR and RTL — the mirror is free.
    expect(rows[0]?.className).toContain('justify-start');
    expect(rows[0]?.dataset['own']).toBeUndefined();
    expect(rows[1]?.className).toContain('justify-end');
    expect(rows[1]?.dataset['own']).toBe('');
  });

  it('squares the LOGICAL tail corner: end-end on own, end-start on incoming', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const bubbles = [...container.querySelectorAll<HTMLElement>('[data-part="message-bubble"]')];
    expect(bubbles[0]?.className).toContain('rounded-es-sm'); // incoming: tail at inline-start
    expect(bubbles[1]?.className).toContain('rounded-ee-sm'); // own: tail at inline-end
  });

  it('aligns each bubble stamp to its own bubble edge, logically', () => {
    const { container } = render(<ChatThread messages={thread} now={CHAT_DEMO_EPOCH} />);
    const stamps = [...container.querySelectorAll<HTMLElement>('[data-part="message-time"]')];
    expect(stamps[0]?.className).toContain('text-start');
    expect(stamps[1]?.className).toContain('text-end');
  });

  it('renders byte-identical markup under ltr and rtl (the browser mirrors, not a JS branch)', () => {
    const ltr = render(<ChatThread messages={thread} dir="ltr" now={CHAT_DEMO_EPOCH} />);
    const ltrHtml = (ltr.container.firstElementChild as HTMLElement).innerHTML;
    cleanup();
    const rtl = render(<ChatThread messages={thread} dir="rtl" now={CHAT_DEMO_EPOCH} />);
    const rtlRoot = rtl.container.firstElementChild as HTMLElement;
    expect(rtlRoot.getAttribute('dir')).toBe('rtl');
    // Only the root's dir attribute differs; every class inside is identical.
    expect(rtlRoot.innerHTML).toBe(ltrHtml);
  });

  it('uses no physical-direction utility anywhere in the rendered tree', () => {
    const { container } = render(
      <ChatThread
        messages={[{ ...thread[0] as ChatMessage, attachments: [{ name: 'a.pdf', size: '1 KB' }] }, thread[1] as ChatMessage]}
        peerName="Morgan Lee"
        peerStatus="Active now"
        typingIndicator
        dir="rtl"
        now={CHAT_DEMO_EPOCH}
      />,
    );
    const offenders = allClassNames(container).filter((cls) => PHYSICAL.test(cls));
    expect(offenders).toEqual([]);
  });
});

describe('conversation-inbox selection rail mirrors under RTL', () => {
  it('marks the selected row with a LOGICAL inline-start border, not a left one', () => {
    const rows = [{ id: 'c1', name: 'Morgan Lee', preview: 'hi', unread: 0 }];
    const { container } = render(<ConversationInbox conversations={rows} now={CHAT_DEMO_EPOCH} />);
    const row = container.querySelector('[data-conversation-id="c1"]') as HTMLElement;
    expect(row.className).toContain('border-s-accent');
    expect(allClassNames(container).filter((cls) => PHYSICAL.test(cls))).toEqual([]);
  });
});

describe('ai-chat-panel alignment mirrors under RTL', () => {
  const turns = [
    { id: 'q1', role: 'user' as const, body: 'Which tables lack a PK?', sentAt: new Date(CHAT_DEMO_EPOCH).toISOString() },
    { id: 'a1', role: 'assistant' as const, body: 'Two do.', sentAt: new Date(CHAT_DEMO_EPOCH + 1000).toISOString() },
  ];

  it('docks user turns to inline-end and assistant turns to inline-start', () => {
    const { container } = render(<AiChatPanel turns={turns} />);
    const rendered = [...container.querySelectorAll<HTMLElement>('[data-part="ai-turn"]')];
    expect(rendered.map((row) => row.dataset['role'])).toEqual(['user', 'assistant']);
    expect(rendered[0]?.className).toContain('justify-end');
    expect(rendered[1]?.className).toContain('justify-start');
  });

  it('uses no physical-direction utility anywhere in the rendered tree', () => {
    const { container } = render(<AiChatPanel turns={turns} suggestions={['Summarise orders']} dir="rtl" pending />);
    expect(allClassNames(container).filter((cls) => PHYSICAL.test(cls))).toEqual([]);
  });
});

// ── ai-chat-panel ───────────────────────────────────────────────────────────

describe('ai-chat-panel', () => {
  const turns = [
    { id: 'q1', role: 'user' as const, body: 'Which tables lack a PK?', sentAt: new Date(CHAT_DEMO_EPOCH).toISOString() },
    { id: 'a1', role: 'assistant' as const, body: 'audit_log and session_cache.', sentAt: new Date(CHAT_DEMO_EPOCH + 1000).toISOString() },
  ];

  it('renders the transcript with the provider label in the header', () => {
    render(<AiChatPanel turns={turns} providerLabel="Claude Opus 4.5" assistantName="Adminium AI" />);
    expect(screen.getByText('Adminium AI')).toBeTruthy();
    expect(screen.getByText('Claude Opus 4.5')).toBeTruthy();
    expect(screen.getByText('audit_log and session_cache.')).toBeTruthy();
  });

  it('renders the configure-a-provider empty state and no composer when no provider is set', () => {
    const onConfigure = vi.fn();
    const { container } = render(<AiChatPanel turns={turns} providerConfigured={false} onConfigure={onConfigure} />);
    expect(screen.getByText('No AI provider configured')).toBeTruthy();
    // The panel is inert without a provider: no transcript, no composer.
    expect(container.querySelectorAll('[data-part="composer"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-part="ai-transcript"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Configure a provider' }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it('omits the configure CTA when the host wires no handler', () => {
    render(<AiChatPanel turns={turns} providerConfigured={false} />);
    expect(screen.queryByRole('button', { name: 'Configure a provider' })).toBeNull();
  });

  it('renders the ask-about-your-data empty state for a fresh panel', () => {
    render(<AiChatPanel turns={[]} />);
    expect(screen.getByText('Ask about your data')).toBeTruthy();
  });

  it('sends a suggestion chip as a prompt', () => {
    const onSend = vi.fn();
    render(<AiChatPanel turns={turns} suggestions={['Summarise the orders table.']} onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Summarise the orders table.' }));
    expect(onSend).toHaveBeenCalledWith('Summarise the orders table.');
  });

  it('composer submits the draft and clears it', () => {
    const onSend = vi.fn();
    const { container } = render(<AiChatPanel turns={turns} onSend={onSend} />);
    const input = screen.getByLabelText('Ask a question') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'How many orders?' } });
    fireEvent.submit(container.querySelector('[data-part="composer"]') as HTMLElement);
    expect(onSend).toHaveBeenCalledWith('How many orders?');
    expect(input.value).toBe('');
  });

  it('disables the composer and chips while a run is pending', () => {
    render(<AiChatPanel turns={turns} suggestions={['Summarise orders']} pending pendingLabel="Thinking…" />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect((screen.getByLabelText('Ask a question') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Summarise orders' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Send') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── demoData determinism + registry metadata ────────────────────────────────

describe('communication demoData is deterministic and schema-shaped', () => {
  const generators = [
    ['conversation-inbox', conversationInboxDemoData, conversationInboxConfigSchema] as const,
    ['chat-thread', chatThreadDemoData, chatThreadConfigSchema] as const,
    ['ai-chat-panel', aiChatPanelDemoData, aiChatPanelConfigSchema] as const,
  ];

  for (const [id, demoData, schema] of generators) {
    it(`${id}: same seed → identical payload; different seeds → different payloads`, () => {
      expect(JSON.stringify(demoData(7))).toBe(JSON.stringify(demoData(7)));
      expect(JSON.stringify(demoData(7))).not.toBe(JSON.stringify(demoData(42)));
    });

    it(`${id}: config schema parses {} to defaults`, () => {
      expect(schema.safeParse({}).success).toBe(true);
    });

    // The CANONICAL §3 envelope — `{ rows, total }`, exactly what the server's
    // `ShapedRecordList` returns. Asserting the canonical key here is what keeps
    // the generators honest about the contract the widgets declare: they used to
    // emit `{ data }`, which `chatRowsOf` happened to read while the real server
    // payload it never read (`rows`) left every chat widget empty.
    it(`${id}: demoData is a well-formed record-list envelope`, () => {
      const payload = demoData(3) as { rows: unknown[]; total: number };
      expect(Array.isArray(payload.rows)).toBe(true);
      expect(payload.total).toBe(payload.rows.length);
      expect(payload.rows.length).toBeGreaterThan(0);
    });
  }

  it('chat-thread demoData spans at least two days, so a separator always renders', () => {
    for (const seed of [1, 7, 42]) {
      const rows = chatThreadDemoData(seed).rows as { sentAt: string }[];
      const days = new Set(rows.map((row) => isoDayOf(row.sentAt)));
      expect(days.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('ai-chat-panel demoData alternates user → assistant turns', () => {
    const rows = aiChatPanelDemoData(7).rows as { role: string }[];
    expect(rows.length % 2).toBe(0);
    expect(rows.map((row) => row.role)).toEqual(rows.map((_, i) => (i % 2 === 0 ? 'user' : 'assistant')));
  });
});

describe('communication registry definitions (annex §9)', () => {
  const definitions = [conversationInboxDefinition, chatThreadDefinition, aiChatPanelDefinition];

  it('registers the exact annex ids in the communication family', () => {
    expect(definitions.map((d) => d.id)).toEqual(['conversation-inbox', 'chat-thread', 'ai-chat-panel']);
    expect(definitions.every((d) => d.family === 'communication')).toBe(true);
  });

  it('binds record-list and declares annex sizing in 40px half-units', () => {
    expect(definitions.every((d) => d.dataContract === 'record-list')).toBe(true);
    // annex min 3×5 / 6×5 / 4×5 → minH = round(rows × 2) = 10 (04 §6.1)
    expect(definitions.map((d) => [d.sizing.minW, d.sizing.minH])).toEqual([
      [3, 10],
      [6, 10],
      [4, 10],
    ]);
  });

  it('marks the writing widgets as data-editing (composer → insert intent)', () => {
    expect(conversationInboxDefinition.capabilities?.editsData).toBeUndefined();
    expect(chatThreadDefinition.capabilities?.editsData).toBe(true);
    expect(aiChatPanelDefinition.capabilities?.editsData).toBe(true);
    // typing-indicator only READS a boolean; call-widget emits state transitions.
    expect(typingIndicatorDefinition.capabilities?.editsData).toBeUndefined();
    expect(callWidgetDefinition.capabilities?.editsData).toBe(true);
  });

  it('registers the Wave-4 tail with the exact annex ids and §3 contracts', () => {
    expect(typingIndicatorDefinition.id).toBe('typing-indicator');
    expect(callWidgetDefinition.id).toBe('call-widget');
    // annex §9: "boolean per conversation" and "{kind, peer, state}".
    expect(typingIndicatorDefinition.dataContract).toBe('boolean-map');
    expect(callWidgetDefinition.dataContract).toBe('record');
  });

  it('places the tail per the annex ("child of thread" / "modal overlay")', () => {
    expect(typingIndicatorDefinition.placement).toBe('inline');
    expect(callWidgetDefinition.placement).toBe('overlay');
  });

  /**
   * page-chat.json holds a 3×6 optional `call` slot open for this widget. A slot
   * shorter than the widget's registered minimum persists a layout item below
   * the widget's own enforced floor (04 §6.1), so it renders clipped and reflows
   * on the first drag in edit mode.
   */
  it('sizes call-widget to fit page-chat’s call slot (3×6)', () => {
    expect(callWidgetDefinition.sizing.minW).toBeLessThanOrEqual(3);
    expect(callWidgetDefinition.sizing.minH).toBeLessThanOrEqual(6);
  });
});

describe('communication tail demoData (04 §7.7)', () => {
  it('typing-indicator: deterministic per seed, and varies across seeds', () => {
    expect(JSON.stringify(typingIndicatorDemoData(7))).toBe(JSON.stringify(typingIndicatorDemoData(7)));
    const payloads = new Set([0, 1, 7, 42, 1234, 65_535].map((s) => JSON.stringify(typingIndicatorDemoData(s))));
    expect(payloads.size).toBeGreaterThan(1);
  });

  /**
   * `c1` is the inbox's first row and so the thread's default selection: a demo
   * or VRT frame of a typing indicator that renders nothing would be a useless
   * capture, so the headline entry is pinned live for every seed while the rest
   * carry the seed variance.
   */
  it('typing-indicator: c1 is live for every seed so the demo always shows the row', () => {
    for (const seed of [0, 1, 7, 42, 1234, 65_535]) {
      expect(typingIndicatorDemoData(seed).entries['c1']).toBe(true);
    }
  });

  it('typing-indicator: keys match the conversation ids the inbox demo emits', () => {
    const inboxIds = conversationInboxDemoData(7).rows.map((row) => row['id']);
    expect(Object.keys(typingIndicatorDemoData(7).entries)).toEqual(inboxIds);
  });

  it('call-widget: deterministic per seed, varies across seeds, and always rings', () => {
    expect(JSON.stringify(callWidgetDemoData(7))).toBe(JSON.stringify(callWidgetDemoData(7)));
    const payloads = new Set([0, 1, 7, 42, 1234, 65_535].map((s) => JSON.stringify(callWidgetDemoData(s))));
    expect(payloads.size).toBeGreaterThan(1);
    // `ringing` is the annex's headline state (the expanding ring) — what the
    // demo and every VRT capture must show.
    for (const seed of [0, 1, 7, 42]) expect(callWidgetDemoData(seed).row['state']).toBe('ringing');
  });

  it('tail config schemas parse their defaults', () => {
    expect(typingIndicatorConfigSchema.safeParse({}).success).toBe(true);
    expect(callWidgetConfigSchema.safeParse({}).success).toBe(true);
  });
});

// ── typing-indicator (annex §9) ─────────────────────────────────────────────

describe('typingEntriesOf / isTypingIn', () => {
  it('reads the §3 boolean-map envelope', () => {
    expect(typingEntriesOf({ entries: { c1: true, c2: false } })).toEqual({ c1: true, c2: false });
  });

  it('reads the bare-record shorthand a thin host adapter may pass', () => {
    expect(typingEntriesOf({ c1: true })).toEqual({ c1: true });
  });

  /**
   * The driver-coercion case. MySQL returns TINYINT(1) as 1/0 and some adapters
   * stringify booleans; a strict `=== true` read would render "nobody is typing"
   * against a live payload that says otherwise.
   */
  it('coerces 1/0 and "true"/"false" cells the way boolField does', () => {
    expect(typingEntriesOf({ entries: { a: 1, b: 0, c: 'true', d: 'false' } })).toEqual({
      a: true,
      b: false,
      c: true,
      d: false,
    });
  });

  it('tolerates junk payloads', () => {
    expect(typingEntriesOf(null)).toEqual({});
    expect(typingEntriesOf('nope')).toEqual({});
    expect(typingEntriesOf([])).toEqual({});
  });

  it('selects the configured conversation, else falls back to "anyone is typing"', () => {
    const entries = { c1: false, c2: true };
    expect(isTypingIn(entries, 'c1')).toBe(false);
    expect(isTypingIn(entries, 'c2')).toBe(true);
    expect(isTypingIn(entries, 'missing')).toBe(false);
    // Unbound/demo instance: any live entry counts, so it still animates.
    expect(isTypingIn(entries)).toBe(true);
    expect(isTypingIn({ c1: false })).toBe(false);
  });
});

describe('typing-indicator', () => {
  it('renders the avatar, the italic label, and the dots when typing', () => {
    const { container } = render(<TypingIndicator typing typists={['Morgan Lee']} label="typing…" />);
    expect(screen.getByText('typing…')).toBeTruthy();
    expect(container.querySelector('[data-part="typing-dots"]')).not.toBeNull();
    expect(container.querySelector('[data-part="typing-indicator"]')).not.toBeNull();
  });

  /**
   * Idle renders nothing VISIBLE but keeps the live region mounted. A typing
   * indicator is ephemeral and is an `inline` widget (no card of its own), so an
   * idle instance must occupy no space — but an element inserted WITH
   * `aria-live` already on it is not reliably announced, so the region has to
   * outlive the transition for the row to be spoken when it appears.
   */
  it('renders nothing visible when idle, but keeps the live region mounted', () => {
    const { container } = render(<TypingIndicator typing={false} typists={['Morgan Lee']} label="typing…" />);
    expect(container.querySelector('[data-part="typing-indicator"]')).toBeNull();
    expect(screen.queryByText('typing…')).toBeNull();
    const live = container.querySelector('[data-widget="typing-indicator"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
  });

  it('stacks avatars for a group chat and collapses past maxAvatars', () => {
    const { container } = render(
      <TypingIndicator typing typists={['A One', 'B Two', 'C Three', 'D Four']} maxAvatars={2} label="typing…" />,
    );
    expect(container.textContent).toContain('+2');
  });

  it('drops blank typist names rather than rendering an empty avatar', () => {
    const { container } = render(<TypingIndicator typing typists={['', '  ']} label="typing…" />);
    expect(container.querySelectorAll('[data-part="typing-dots"]')).toHaveLength(1);
    expect(screen.getByText('typing…')).toBeTruthy();
  });

  it('uses no physical-direction utility (10 §5.2)', () => {
    const { container } = render(<TypingIndicator typing typists={['Morgan Lee']} label="typing…" />);
    expect(allClassNames(container).filter((name) => PHYSICAL.test(name))).toEqual([]);
  });

  it('widget wrapper reads the bound conversation and names the peer from config', () => {
    const config = typingIndicatorConfigSchema.parse({ conversationId: 'c2', peerName: 'Morgan Lee', label: 'typing…' });
    const { container } = render(
      <TypingIndicatorWidget
        config={config}
        data={{ entries: { c1: false, c2: true } }}
        instanceId="ti"
        onEvent={() => {}}
      />,
    );
    expect(container.querySelector('[data-part="typing-indicator"]')).not.toBeNull();
  });

  it('widget wrapper stays silent for a conversation whose boolean is false', () => {
    const config = typingIndicatorConfigSchema.parse({ conversationId: 'c1', peerName: 'Morgan Lee' });
    const { container } = render(
      <TypingIndicatorWidget
        config={config}
        data={{ entries: { c1: false, c2: true } }}
        instanceId="ti2"
        onEvent={() => {}}
      />,
    );
    // c2 is typing, but this instance is bound to c1 — it must not leak.
    expect(container.querySelector('[data-part="typing-indicator"]')).toBeNull();
  });

  /**
   * The annex places typing-indicator as a "child of thread", so the thread's
   * embedded row must BE this component, not a lookalike. Guards the reuse
   * against someone re-inlining the markup and letting the two drift.
   */
  it('is the same component chat-thread renders for its own typing row', () => {
    const { container } = render(
      <ChatThread messages={[message('m1', false, 'hi', 0)]} typingIndicator peerName="Morgan Lee" now={CHAT_DEMO_EPOCH} />,
    );
    expect(container.querySelector('[data-widget="typing-indicator"]')).not.toBeNull();
    expect(container.querySelector('[data-part="typing-dots"]')).not.toBeNull();
  });
});

// ── call-widget (annex §9) ──────────────────────────────────────────────────

describe('recordRowOf / call coercion', () => {
  it('reads the §3 record envelope and the bare-object shorthand', () => {
    expect(recordRowOf({ row: { peer: 'Morgan Lee' } })).toEqual({ peer: 'Morgan Lee' });
    expect(recordRowOf({ peer: 'Morgan Lee' })).toEqual({ peer: 'Morgan Lee' });
    expect(recordRowOf({ row: null })).toBeNull();
    expect(recordRowOf(null)).toBeNull();
    expect(recordRowOf([])).toBeNull();
  });

  it('coerces unknown kinds/states to safe defaults instead of rendering junk', () => {
    expect(callKindOf('video')).toBe('video');
    expect(callKindOf('hologram')).toBe('voice');
    expect(callKindOf(undefined)).toBe('voice');
    expect(callStateOf('active')).toBe('active');
    expect(callStateOf('exploded')).toBe('ringing');
  });
});

describe('call-widget', () => {
  it('renders the ringing card: peer, kind label, and the expanding accent ring', () => {
    const { container } = render(<CallWidget peer="Morgan Lee" kind="video" state="ringing" stateLabel="Ringing…" />);
    expect(screen.getByText('Morgan Lee')).toBeTruthy();
    expect(screen.getByText('Video call')).toBeTruthy();
    expect(screen.getByText('Ringing…')).toBeTruthy();
    expect(container.querySelector('[data-part="call-ring"]')).not.toBeNull();
  });

  /**
   * The ring is decoration. Under `prefers-reduced-motion` it must not animate —
   * hence `motion-safe:`, not a bare `animate-ping` — and the meaning has to
   * survive its absence, which is what the state label is for (02 §6).
   */
  it('animates the ring only under motion-safe, and states the call in text regardless', () => {
    const { container } = render(<CallWidget peer="Morgan Lee" kind="voice" state="ringing" stateLabel="Ringing…" />);
    const ring = container.querySelector('[data-part="call-ring"]');
    expect(ring?.className).toContain('motion-safe:animate-ping');
    expect(ring?.className).not.toMatch(/(^|\s)animate-ping/);
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-part="call-state"]')?.textContent).toBe('Ringing…');
  });

  it('does not ring once the call is connected', () => {
    const { container } = render(<CallWidget peer="Morgan Lee" kind="voice" state="active" />);
    expect(container.querySelector('[data-part="call-ring"]')).toBeNull();
  });

  it('offers Accept only while ringing; a live call offers only End', () => {
    const { rerender } = render(<CallWidget peer="Morgan Lee" kind="voice" state="ringing" />);
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy();

    rerender(<CallWidget peer="Morgan Lee" kind="voice" state="active" />);
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(screen.getByRole('button', { name: /end call/i })).toBeTruthy();
  });

  it('offers no actions once the call has ended', () => {
    render(<CallWidget peer="Morgan Lee" kind="voice" state="ended" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the empty state when no call is in flight', () => {
    render(<CallWidget peer="" kind="voice" state="ringing" emptyTitle="No active call" />);
    expect(screen.getByText('No active call')).toBeTruthy();
  });

  it('uses no physical-direction utility (10 §5.2)', () => {
    const { container } = render(<CallWidget peer="Morgan Lee" kind="video" state="ringing" />);
    expect(allClassNames(container).filter((name) => PHYSICAL.test(name))).toEqual([]);
  });
});

describe('call-widget wrapper — accept/decline are mutate intents, never writes', () => {
  const data = { row: { id: 'call-1', peer: 'Morgan Lee', kind: 'video', state: 'ringing' } };

  it('emits an update intent to the bound table on Accept', () => {
    const onEvent = vi.fn();
    const config = callWidgetConfigSchema.parse({
      binding: { connectionId: 'conn-1', source: { name: 'calls' }, shape: 'record' },
    });
    render(<CallWidgetWidget config={config} data={data} instanceId="cw" onEvent={onEvent} />);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    // The widget describes the change; the HOST runs it through the CRUD API
    // (audit + undo). It never mutates, and it never opens a media device.
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'update',
      connectionId: 'conn-1',
      table: 'calls',
      recordId: 'call-1',
      values: { state: 'active' },
    });
  });

  it('emits an update intent ending the call on Decline', () => {
    const onEvent = vi.fn();
    const config = callWidgetConfigSchema.parse({});
    render(<CallWidgetWidget config={config} data={data} instanceId="cw2" onEvent={onEvent} />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', table: 'records', values: { state: 'ended' } }),
    );
  });

  it('writes back through the CONFIGURED state column, not a hard-coded "state"', () => {
    const onEvent = vi.fn();
    const config = callWidgetConfigSchema.parse({ stateField: 'call_status' });
    render(
      <CallWidgetWidget
        config={config}
        data={{ row: { id: 'c9', peer: 'Sam Park', kind: 'voice', call_status: 'ringing' } }}
        instanceId="cw3"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: { call_status: 'ended' } }),
    );
  });

  it('omits recordId rather than inventing one when the row has no id', () => {
    const onEvent = vi.fn();
    const config = callWidgetConfigSchema.parse({});
    render(
      <CallWidgetWidget
        config={config}
        data={{ row: { peer: 'Sam Park', kind: 'voice', state: 'ringing' } }}
        instanceId="cw4"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onEvent.mock.calls[0]?.[0]).not.toHaveProperty('recordId');
  });
});

// ── the four WidgetFrame states through WidgetHost (acceptance #4) ──────────

describe('communication widgets render four states through WidgetHost', () => {
  const registry = buildRegistry([
    conversationInboxDefinition,
    chatThreadDefinition,
    typingIndicatorDefinition,
    aiChatPanelDefinition,
    callWidgetDefinition,
  ] as WidgetDefinition[]);

  for (const definition of [
    conversationInboxDefinition,
    chatThreadDefinition,
    typingIndicatorDefinition,
    aiChatPanelDefinition,
    callWidgetDefinition,
  ]) {
    it(`${definition.id}: skeleton, empty, and error states resolve through the frame`, () => {
      const { rerender } = render(
        <WidgetHost widgetId={definition.id} instanceId={`${definition.id}-l`} data={{ status: 'loading' }} registry={registry} />,
      );
      // Reads the DECLARED silhouette rather than hard-coding 'list': the family
      // is no longer all lists (call-widget is a 'card'), and a definition whose
      // skeleton drifts from what it renders should fail here.
      expect(document.querySelector(`[data-skeleton-variant="${definition.skeleton}"]`)).not.toBeNull();

      rerender(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-e`}
          config={{ emptyState: { titleKey: 'Nothing yet' } }}
          data={{ status: 'success', data: { data: [], total: 0 } }}
          registry={registry}
        />,
      );
      expect(screen.getByText('Nothing yet')).toBeTruthy();

      const refetch = vi.fn();
      rerender(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-x`}
          data={{ status: 'error', error: new Error('COMM_FORBIDDEN'), refetch }}
          registry={registry}
        />,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  }
});

// ── chrome localization (the boards-family pattern) ─────────────────────────

describe('communication chrome localization (ui:widgets.communication.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              widgets: {
                communication: {
                  chatThread: { emptyTitle: 'Noch keine Nachrichten', emptyBody: 'Nachrichten erscheinen hier.' },
                  callWidget: { ringingLabel: 'Klingelt …' },
                },
              },
            }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <ChatThread messages={[]} now={CHAT_DEMO_EPOCH} />
        <CallWidget peer="Morgan Lee" kind="voice" state="ringing" />
      </I18nProvider>,
    );
    expect(screen.getByText('Noch keine Nachrichten')).toBeTruthy();
    // The per-state default routes through the per-state callWidget label keys.
    expect(screen.getByText('Klingelt …')).toBeTruthy();

    cleanup();
    render(<ChatThread messages={[]} now={CHAT_DEMO_EPOCH} />);
    expect(screen.getByText('No messages yet')).toBeTruthy();
    cleanup();
    // Outside a provider the fallback is the polished English label (adopted
    // from the bundle 2026-07-28; the raw state value no longer renders).
    render(<CallWidget peer="Morgan Lee" kind="voice" state="ringing" />);
    expect(screen.getByText('Ringing…')).toBeTruthy();
  });
});
