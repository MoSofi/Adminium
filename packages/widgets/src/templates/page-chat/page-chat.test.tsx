// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-chat template tests: projects a conversation+message pair onto the
 * inbox + thread panes (email→name derivation, FK-scoped thread), routes
 * selection to the host and re-scopes the fallback thread, appends an
 * optimistic echo on send (rolled back on a rejected insert), honors a
 * host-fed messagesState, and degrades on loading/error/invalid layouts.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageChat } from './PageChat.js';
import {
  detectConversationFk,
  detectMessageFields,
  displayNameOf,
  filterMessagesRows,
  toChatMessages,
  toConversationRows,
  detectConversationFields,
} from './chat-mapping.js';
import { demoChatLayout } from './demo-layout.js';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

const CONVERSATIONS = [
  { id: 'c1', customer_email: 'morgan.lee@acme.dev', last_message_at: new Date(NOW - 120_000).toISOString(), unread: 2 },
  { id: 'c2', customer_email: 'sam.park@acme.dev', last_message_at: new Date(NOW - 5_400_000).toISOString(), unread: 0 },
];

const MESSAGES = [
  { id: 'm1', conversation_id: 'c1', sender_email: 'morgan.lee@acme.dev', body: 'Did you see the timeline?', created_at: new Date(NOW - 7_200_000).toISOString() },
  { id: 'm2', conversation_id: 'c1', sender_email: 'ava@acme.dev', body: 'Yes — looks tight but doable.', created_at: new Date(NOW - 3_600_000).toISOString() },
  { id: 'm3', conversation_id: 'c2', sender_email: 'sam.park@acme.dev', body: 'Invoice paid, thanks!', created_at: new Date(NOW - 5_400_000).toISOString() },
];

function statesFor() {
  return {
    inbox: { status: 'success' as const, data: { rows: CONVERSATIONS, total: 2 } },
    thread: { status: 'success' as const, data: { rows: MESSAGES, total: 3 } },
    attachments: { status: 'success' as const, data: { rows: [] } },
  };
}

describe('chat-mapping', () => {
  it('derives display names from emails', () => {
    expect(displayNameOf('morgan.lee@acme.dev')).toBe('Morgan Lee');
    expect(displayNameOf('sam_park@x.io')).toBe('Sam Park');
    expect(displayNameOf('Design Team')).toBe('Design Team');
  });

  it('detects message fields + the conversation FK (table-name seeded)', () => {
    const map = detectMessageFields(MESSAGES);
    expect(map.body).toBe('body');
    expect(map.sentAt).toBe('created_at');
    expect(map.author).toBe('sender_email');
    expect(detectConversationFk(MESSAGES, 'public.conversations')).toBe('conversation_id');
    expect(detectConversationFk([{ id: 1, thread_id: 't1' }], null)).toBe('thread_id');
    expect(filterMessagesRows(MESSAGES, 'conversation_id', 'c2')).toHaveLength(1);
    expect(filterMessagesRows(MESSAGES, undefined, 'c2')).toHaveLength(3);
  });

  it('finds no sender-kind column on a table that has none', () => {
    // Which is most of them. The name match is what every generated app uses
    // today and the addition must not disturb it.
    expect(detectMessageFields(MESSAGES).senderKind).toBeUndefined();
  });

  it.each(['sender_kind', 'sender_type', 'author_kind', 'author_type'])(
    'detects `%s` as the sender-kind column',
    (column) => {
      expect(detectMessageFields([{ id: 1, [column]: 'customer' }]).senderKind).toBe(column);
    },
  );

  it.each(['role', 'type', 'direction', 'kind'])('does NOT read `%s` as a sender kind', (column) => {
    /*
     * The narrowness is the feature. This column decides which SIDE of the
     * thread a bubble lands on, so a false positive re-sides an existing app's
     * whole history — and every word here is common on tables that mean
     * something else entirely by it.
     */
    expect(detectMessageFields([{ id: 1, [column]: 'staff' }]).senderKind).toBeUndefined();
  });

  describe('which side a message lands on', () => {
    const map = { author: 'author', body: 'body', sentAt: 'created_at', senderKind: 'sender_kind' };
    const OWN = ['ava@acme.dev'];

    it('matches the author name when there is no kind column', () => {
      const rows = [
        { id: 1, author: 'ava@acme.dev', body: 'mine' },
        { id: 2, author: 'morgan@acme.dev', body: 'theirs' },
      ];
      const out = toChatMessages({ rows }, { author: 'author', body: 'body' }, OWN);
      expect(out.map((m) => m.own)).toEqual([true, false]);
    });

    it('lets the kind decide when the table has one', () => {
      const rows = [
        { id: 1, author: 'ava@acme.dev', body: 'staff reply', sender_kind: 'staff' },
        { id: 2, author: 'morgan@acme.dev', body: 'visitor', sender_kind: 'customer' },
      ];
      expect(toChatMessages({ rows }, map, OWN).map((m) => m.own)).toEqual([true, false]);
    });

    it('keeps a visitor on the visitor side even when they type a staff address', () => {
      /*
       * The criterion, and the reason the kind outranks the name at all.
       * `author` is writable by an anonymous visitor through the public
       * surface; `sender_kind` is stamped server-side and is not. Without this
       * ordering, typing a support agent's address into the name field would
       * put your own message on the agent's side of the agent's own inbox.
       */
      const rows = [{ id: 1, author: 'ava@acme.dev', body: 'not really ava', sender_kind: 'customer' }];
      expect(toChatMessages({ rows }, map, OWN)[0]?.own).toBe(false);
    });

    it("treats the business's own row as the viewer's even when the name does not match", () => {
      // A second agent's reply is still "us" in a shared inbox.
      const rows = [{ id: 1, author: 'someone.else@acme.dev', body: 'hi', sender_kind: 'staff' }];
      expect(toChatMessages({ rows }, map, OWN)[0]?.own).toBe(true);
    });

    it.each(['agent', 'operator', 'STAFF'])('reads `%s` as the business side', (kind) => {
      const rows = [{ id: 1, author: 'x@y.z', body: 'hi', sender_kind: kind }];
      expect(toChatMessages({ rows }, map, [])[0]?.own).toBe(true);
    });

    it.each(['customer', 'visitor', 'bot', ''])('reads `%s` as not the business side', (kind) => {
      const rows = [{ id: 1, author: 'ava@acme.dev', body: 'hi', sender_kind: kind }];
      // The empty string is the interesting one: it is "no answer", so the row
      // falls back to the author match rather than silently becoming theirs.
      expect(toChatMessages({ rows }, map, OWN)[0]?.own).toBe(kind === '');
    });
  });

  it('projects conversation rows with derived names + unread counts', () => {
    const rows = toConversationRows({ rows: CONVERSATIONS }, detectConversationFields(CONVERSATIONS));
    expect(rows[0]?.name).toBe('Morgan Lee');
    expect(rows[0]?.unread).toBe(2);
    expect(rows[1]?.name).toBe('Sam Park');
  });
});

describe('PageChat', () => {
  it('renders the pair: derived inbox names, FK-scoped thread, auto-selection', async () => {
    render(<PageChat layout={demoChatLayout} now={NOW} states={statesFor()} />);
    const inbox = await screen.findByTestId('page-chat-inbox');
    expect(within(inbox).getByText('Morgan Lee')).toBeDefined();
    expect(within(inbox).getByText('Sam Park')).toBeDefined();

    // First conversation auto-selected → only c1's messages in the thread.
    const thread = screen.getByTestId('page-chat-thread');
    expect(within(thread).getByText('Did you see the timeline?')).toBeDefined();
    expect(within(thread).queryByText('Invoice paid, thanks!')).toBeNull();
  });

  it('thread select → host callback + the fallback thread re-scopes', async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();
    render(
      <PageChat
        layout={demoChatLayout}
        now={NOW}
        states={statesFor()}
        onSelectConversation={onSelectConversation}
      />,
    );
    const inbox = await screen.findByTestId('page-chat-inbox');
    await user.click(within(inbox).getByText('Sam Park'));

    expect(onSelectConversation).toHaveBeenCalledWith('c2');
    const thread = screen.getByTestId('page-chat-thread');
    expect(within(thread).getByText('Invoice paid, thanks!')).toBeDefined();
    expect(within(thread).queryByText('Did you see the timeline?')).toBeNull();
  });

  it('send appends an optimistic echo and reports (body, conversationId)', async () => {
    const user = userEvent.setup();
    let resolveSend: (() => void) | null = null;
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    render(
      <PageChat
        layout={demoChatLayout}
        now={NOW}
        states={statesFor()}
        ownAuthors={['ava@acme.dev']}
        onSendMessage={onSendMessage}
      />,
    );
    const thread = await screen.findByTestId('page-chat-thread');
    // Own-message detection: m2's sender matches ownAuthors.
    expect(thread.querySelector('[data-part="message-row"][data-own]')).not.toBeNull();

    await user.type(within(thread).getByRole('textbox', { name: 'Message' }), 'On my way.');
    await user.click(within(thread).getByRole('button', { name: 'Send' }));

    expect(onSendMessage).toHaveBeenCalledWith('On my way.', 'c1');
    expect(within(thread).getByText('On my way.')).toBeDefined(); // instant echo
    (resolveSend as unknown as () => void)();
  });

  it('rolls the echo back when the insert rejects', async () => {
    const user = userEvent.setup();
    let rejectSend: ((reason: unknown) => void) | null = null;
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    render(
      <PageChat layout={demoChatLayout} now={NOW} states={statesFor()} onSendMessage={onSendMessage} />,
    );
    const thread = await screen.findByTestId('page-chat-thread');
    await user.type(within(thread).getByRole('textbox', { name: 'Message' }), 'Will fail');
    await user.click(within(thread).getByRole('button', { name: 'Send' }));

    expect(within(thread).getByText('Will fail')).toBeDefined(); // echo while pending
    (rejectSend as unknown as (reason: unknown) => void)(new Error('NOT_NULL sender_id'));
    await waitFor(() => {
      expect(within(thread).queryByText('Will fail')).toBeNull();
    });
  });

  it('a host-fed messagesState wins over the thread instance state', async () => {
    render(
      <PageChat
        layout={demoChatLayout}
        now={NOW}
        states={statesFor()}
        messagesState={{
          status: 'success',
          data: { rows: [{ id: 'x1', conversation_id: 'c1', sender_email: 'sam@x.io', body: 'Server-scoped row', created_at: new Date(NOW).toISOString() }] },
        }}
      />,
    );
    const thread = await screen.findByTestId('page-chat-thread');
    expect(within(thread).getByText('Server-scoped row')).toBeDefined();
    expect(within(thread).queryByText('Did you see the timeline?')).toBeNull();
  });

  it('hides the composer without a send transport; degrades on error/invalid', async () => {
    const { rerender } = render(<PageChat layout={demoChatLayout} now={NOW} states={statesFor()} />);
    const thread = await screen.findByTestId('page-chat-thread');
    expect(within(thread).queryByRole('button', { name: 'Send' })).toBeNull();

    rerender(
      <PageChat
        layout={demoChatLayout}
        now={NOW}
        states={{
          ...statesFor(),
          thread: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} },
        }}
      />,
    );
    expect(screen.getByText('The messages query failed')).toBeDefined();

    rerender(<PageChat layout={{ version: 99, items: 'nope' }} now={NOW} />);
    expect(screen.getByTestId('page-chat-invalid')).toBeDefined();
  });
});

describe('page-chat chrome localization (ui:templates.chat.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { templates: { chat: { selectTitle: 'Unterhaltung auswählen' } } }
          : null,
    });
    // Zero conversations → nothing auto-selects → the thread pane prompts.
    const empty = {
      inbox: { status: 'success' as const, data: { rows: [], total: 0 } },
      thread: { status: 'success' as const, data: { rows: [], total: 0 } },
      attachments: { status: 'success' as const, data: { rows: [] } },
    };
    render(
      <I18nProvider i18n={i18n}>
        <PageChat layout={demoChatLayout} now={NOW} states={empty} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Unterhaltung auswählen')).toBeTruthy();

    cleanup();
    render(<PageChat layout={demoChatLayout} now={NOW} states={empty} />);
    expect(await screen.findByText('Select a conversation')).toBeTruthy();
  });
});
