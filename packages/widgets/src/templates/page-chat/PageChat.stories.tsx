/**
 * `page-chat` template stories (09 §7.9): the demo-mode composition
 * (inbox + thread + attachments rail), a bound conversation+message pair with
 * email→name derivation and a live optimistic-echo composer, the
 * loading/error states through the `states` override, and the empty inbox —
 * four states, matching the template-story idiom.
 */
import { PageChat } from './PageChat.js';
import { demoChatLayout } from './demo-layout.js';

const meta = {
  title: 'Templates/PageChat',
};
export default meta;

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

const CONVERSATIONS = [
  { id: 'c1', subject: 'Coastal House timeline', customer_email: 'morgan.lee@acme.dev', last_message_at: new Date(NOW - 120_000).toISOString(), unread: 2 },
  { id: 'c2', subject: 'Invoice #4821', customer_email: 'sam.park@acme.dev', last_message_at: new Date(NOW - 5_400_000).toISOString(), unread: 0 },
];

const MESSAGES = [
  { id: 'm1', conversation_id: 'c1', sender_email: 'morgan.lee@acme.dev', body: 'Did you get a chance to look at the timeline?', created_at: new Date(NOW - 86_400_000).toISOString() },
  { id: 'm2', conversation_id: 'c1', sender_email: 'ava@acme.dev', body: 'Yes — framing looks tight but doable.', created_at: new Date(NOW - 3_600_000).toISOString() },
  { id: 'm3', conversation_id: 'c2', sender_email: 'sam.park@acme.dev', body: 'Invoice paid, thanks!', created_at: new Date(NOW - 5_400_000).toISOString() },
];

/** Demo mode (04 §5.3): no adapter — every widget seeds from its instance id. */
export const DemoMode = {
  render: () => <PageChat layout={demoChatLayout} now={NOW} />,
};

/** Bound pair: FK-scoped thread, email→name derivation, optimistic composer. */
export const BoundConversations = {
  render: () => (
    <PageChat
      layout={demoChatLayout}
      now={NOW}
      states={{
        inbox: { status: 'success', data: { rows: CONVERSATIONS, total: 2 } },
        thread: { status: 'success', data: { rows: MESSAGES, total: 3 } },
        attachments: { status: 'success', data: { rows: [] } },
      }}
      ownAuthors={['ava@acme.dev']}
      onSendMessage={() => new Promise((resolve) => setTimeout(resolve, 400))}
    />
  ),
};

/** Loading + failed queries — slot-level states, page never crashes. */
export const LoadingAndError = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageChat layout={demoChatLayout} now={NOW} states={{ inbox: { status: 'loading' }, thread: { status: 'loading' } }} />
      <PageChat
        layout={demoChatLayout}
        now={NOW}
        states={{
          inbox: { status: 'success', data: { rows: CONVERSATIONS } },
          thread: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} },
        }}
      />
    </div>
  ),
};

/** Empty inbox — the widget's own all-caught-up state carries the pane. */
export const EmptyInbox = {
  render: () => (
    <PageChat
      layout={demoChatLayout}
      now={NOW}
      states={{
        inbox: { status: 'success', data: { rows: [] } },
        thread: { status: 'success', data: { rows: [] } },
      }}
    />
  ),
};
