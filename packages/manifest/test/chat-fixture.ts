// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A live chat add-on with its four tables and its settings table, as the
 * engine reads them: what the manifest's own checks start from.
 */
type Doc = Record<string, unknown>;

const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
const nullable = { nullable: true };
/** A fresh numbered key each time: a test that breaks one table's key breaks no other's. */
const key = (): Doc => ({ ref: 'id', type: 'int', role: 'pk' });
const moment = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'timestamptz', ...more });
const yesNo = (ref: string, value = false): Doc => ({ ref, type: 'bool', default: value });
const whole = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'int', ...more });

/** A chat add-on with all four tables and its settings, as the engine reads them. */
export function chatAddOn(): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'live-chat',
    name: 'Live chat',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'live-chat.description', fallback: 'Live chat on your website.' },
    categories: ['marketing'],
    compatibility: { minAdminiumVersion: '0.3.64' },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      settingsTable: 'chat_settings',
      chat: { conversations: 'conversations', messages: 'messages', answers: 'answers', choices: 'choices' },
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'conversations',
          columns: [
            key(),
            moment('started_at'),
            moment('last_message_at'),
            { ref: 'state', type: 'enum', enum: ['bot', 'waiting', 'open', 'closed'] },
            text('language', 10),
            text('name', 200, nullable),
            text('email', 320, nullable),
            text('came_from', undefined, nullable),
            yesNo('outside_hours'),
            text('taken_by', 64, nullable),
            moment('taken_at', nullable),
            moment('last_visitor_at', nullable),
            moment('last_staff_at', nullable),
            moment('closed_at', nullable),
            text('became_table', 64, nullable),
            text('became_key', 200, nullable),
            whole('automatic_count', { default: 0 }),
          ],
        },
        {
          ref: 'messages',
          columns: [
            { ref: 'id', type: 'bigint', role: 'pk' },
            { ref: 'conversation_id', type: 'fk', references: 'conversations' },
            { ref: 'kind', type: 'enum', enum: ['visitor', 'staff', 'automatic', 'system'] },
            text('body'),
            text('event', 30, nullable),
            text('answer_ref', 64, nullable),
            text('author_id', 64, nullable),
            yesNo('drafted'),
            moment('sent_at'),
            moment('mailed_at', nullable),
          ],
        },
        {
          ref: 'answers',
          columns: [key(), text('ref', 64, { unique: true }), { ref: 'versions', type: 'json' }, yesNo('active', true), whole('position', { default: 0 })],
        },
        {
          ref: 'choices',
          columns: [
            key(),
            { ref: 'conversation_id', type: 'fk', references: 'conversations' },
            whole('message_id'),
            text('answer_ref', 64, nullable),
            { ref: 'outcome', type: 'enum', enum: ['answered', 'hand-over', 'error', 'budget', 'cap', 'off'] },
            text('model', 100, nullable),
            whole('tokens_in'),
            whole('tokens_out'),
            moment('at'),
          ],
        },
        {
          ref: 'chat_settings',
          columns: [
            key(),
            { ref: 'hours', type: 'json', nullable: true },
            text('time_zone', 64, nullable),
            { ref: 'closed_until', type: 'date', nullable: true },
            { ref: 'welcome', type: 'json', nullable: true },
            { ref: 'outside_words', type: 'json', nullable: true },
            yesNo('automatic'),
            whole('daily_tokens', { default: 0 }),
            yesNo('milo_drafts'),
            { ref: 'tell', type: 'json', nullable: true },
            whole('transcripts_months', { nullable: true, default: 12 }),
            { ref: 'theme', type: 'enum', enum: ['light', 'dark', 'visitor'], default: 'light' },
          ],
        },
      ],
    },
    roles: [
      {
        key: 'agent',
        name: 'Chat agent',
        permissions: [
          'table:@conversations:read',
          'table:@messages:read',
          'table:@choices:read',
          'table:@answers:read',
          'table:@answers:create',
          'table:@answers:update',
          'table:@answers:delete',
          'table:@chat_settings:read',
          'table:@chat_settings:update',
        ],
      },
    ],
  };
}
