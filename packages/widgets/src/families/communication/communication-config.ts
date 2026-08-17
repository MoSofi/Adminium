// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { CHAT_DEMO_EPOCH, mulberry32, pickFrom } from './chat-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `communication` family config schemas + deterministic demo generators — PURE
 * module (zod + chat-lib + shared-config only; no React component code).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `communication-track.definitions.ts`, which imports the config schemas and the
 * `demoData` generators. Those must NOT drag the @adminium/ui-heavy chat
 * components into the eager registry chunk — the components load only through
 * `lazy(() => import('./communication-track-components.js'))`, so the family
 * stays one on-demand chunk (04 §2.3, acceptance #3). The `boards-config`
 * convention; the component files re-export these symbols so barrel/story/test
 * import points stay one-per-widget.
 */

// ── conversation-inbox (annex §9) ──────────────────────────────────────────
/**
 * Rows: {id, name, initials, preview, ts, unread, online, group?}. Field names
 * are config-driven so the generator can bind a `conversations` table whose
 * columns are named anything (04 §5 / annex §14 auto-instantiation).
 */
export const conversationInboxConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  previewField: z.string().default('preview'),
  sentAtField: z.string().default('ts'),
  unreadField: z.string().default('unread'),
  onlineField: z.string().default('online'),
  /** Presence dots (annex §9 config `presence`). */
  presence: z.boolean().default(true),
  /** Show the group-chat glyph for rows whose `group` field is true. */
  groupChats: z.boolean().default(true),
  groupField: z.string().default('group'),
  /** Search box above the list (design: "Search conversations…"). */
  searchable: z.boolean().default(false),
  searchLabel: z.string().optional(),
  searchPlaceholder: z.string().optional(),
  /** Selecting a row clears its unread pill (annex §9). */
  clearUnreadOnSelect: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ConversationInboxConfig = z.infer<typeof conversationInboxConfigSchema>;

const INBOX_DEMO_PEOPLE = [
  { name: 'Morgan Lee', group: false },
  { name: 'Design Team', group: true },
  { name: 'Sam Park', group: false },
  { name: 'Priya Rao', group: false },
  { name: 'Casey Ford', group: false },
  { name: 'Jordan Smith', group: false },
  { name: 'Platform Guild', group: true },
] as const;

const INBOX_DEMO_PREVIEWS = [
  'Sounds good — I’ll send the revised plan.',
  'Riley: pushed the new tokens',
  'Inspection is booked for Monday.',
  'You: merged and deployed',
  'Can we move the PO approval up?',
  'Thanks for the quick turnaround!',
  'Rate limits look healthy this week.',
] as const;

/** Deterministic `record-list` of conversation rows (04 §7.7), canonical §3 `{ rows, total }`. */
export function conversationInboxDemoData(seed: number): {
  rows: Record<string, unknown>[];
  total: number;
} {
  const random = mulberry32(seed || 1);
  const rows = INBOX_DEMO_PEOPLE.map((person, index) => ({
    id: `c${index + 1}`,
    name: person.name,
    group: person.group,
    preview: pickFrom(random, INBOX_DEMO_PREVIEWS),
    // Strictly descending recency: newest first, spaced by a seeded gap so the
    // relative stamps read naturally ("2m", "18m", "1h", "Yesterday"…).
    ts: new Date(CHAT_DEMO_EPOCH - index * (1 + Math.floor(random() * 9)) * 600_000).toISOString(),
    unread: index === 0 ? 0 : Math.floor(random() * 4),
    online: random() > 0.45,
  }));
  return { rows, total: rows.length };
}

// ── chat-thread (annex §9) ─────────────────────────────────────────────────
/**
 * Ordered messages {author, body, sentAt, attachments} per conversation — every
 * field name comes from config (the track contract: "record-list of messages
 * with author/body/sentAt/attachments fields named in config").
 */
export const chatThreadConfigSchema = widgetSharedConfigSchema.extend({
  authorField: z.string().default('author'),
  bodyField: z.string().default('body'),
  sentAtField: z.string().default('sentAt'),
  attachmentsField: z.string().default('attachments'),
  /**
   * Boolean column marking the viewer's own messages. Ignored when `ownAuthor`
   * is set (an author-name match is the more common generated-app shape: a
   * `sender_fk` compared against the session user).
   */
  ownField: z.string().default('own'),
  ownAuthor: z.string().optional(),
  /** Conversation header: peer name + presence line. */
  peerName: z.string().optional(),
  peerStatus: z.string().optional(),
  peerOnline: z.boolean().default(false),
  /** Composer (annex §9 config `composer`). */
  composer: z.boolean().default(true),
  composerPlaceholder: z.string().optional(),
  sendLabel: z.string().optional(),
  /** Attachment chips under a bubble (annex §9 config `attachments`). */
  attachments: z.boolean().default(true),
  /** Italic "typing…" row bound to config (annex §9 `typingIndicator`). */
  typingIndicator: z.boolean().default(false),
  typingLabel: z.string().optional(),
  /** Day separators between day groups. */
  daySeparators: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ChatThreadConfig = z.infer<typeof chatThreadConfigSchema>;

const THREAD_DEMO_AUTHORS = ['Morgan Lee', 'Ava Reyes'] as const;
const THREAD_DEMO_THEM = [
  'Hey Ava — did you get a chance to look at the Coastal House timeline?',
  'The client wants to move the handover up a week.',
  'Sounds good — I’ll send the revised plan.',
  'Inspection is booked for Monday 8am.',
  'Legend. Thanks!',
] as const;
const THREAD_DEMO_ME = [
  'Yes! Framing looks tight but doable. I flagged two dependencies.',
  'That’s aggressive but we can try if materials land on time.',
  'Great, I’ll be on site.',
  'Merged and deployed.',
  'I’ll wire the new tokens into the dashboard next.',
] as const;
const THREAD_DEMO_FILES = [
  { name: 'coastal-house-plan.pdf', size: '2.4 MB' },
  { name: 'framing-schedule.xlsx', size: '812 KB' },
  { name: 'site-photo.jpg', size: '1.1 MB' },
] as const;

/**
 * The two day-anchors `chatThreadDemoData` hangs its messages off, as offsets
 * back from `CHAT_DEMO_EPOCH` (2026-07-14T12:00Z). Anchoring rather than
 * free-running a cursor is deliberate: the seeded jitter below can never push a
 * message across midnight, so EVERY seed yields exactly two day groups and the
 * day separator is always exercised by demoData alone (a free-running cursor
 * silently collapsed to one day for every seed).
 */
const THREAD_DEMO_DAY_ANCHORS = [
  { at: 20 * 3_600_000, count: 3 }, // 2026-07-13 16:00Z — the previous day
  { at: 3 * 3_600_000, count: 6 }, // 2026-07-14 09:00Z — the epoch day
] as const;
/** Max seeded jitter after an anchor — small enough to never cross midnight. */
const THREAD_DEMO_JITTER_MS = 90 * 60_000;

/**
 * Deterministic `record-list` of messages spanning TWO days, so the day
 * separator + author-run grouping are both exercised by demoData alone.
 * Canonical §3 `{ rows, total }` envelope.
 */
export function chatThreadDemoData(seed: number): {
  rows: Record<string, unknown>[];
  total: number;
} {
  const random = mulberry32(seed || 1);
  const rows: Record<string, unknown>[] = [];
  for (const anchor of THREAD_DEMO_DAY_ANCHORS) {
    let cursor = CHAT_DEMO_EPOCH - anchor.at;
    for (let index = 0; index < anchor.count; index++) {
      const own = random() > 0.5;
      cursor += Math.floor(random() * (THREAD_DEMO_JITTER_MS / anchor.count));
      const withFile = rows.length > 0 && random() > 0.78;
      rows.push({
        id: `m${rows.length + 1}`,
        author: own ? THREAD_DEMO_AUTHORS[1] : THREAD_DEMO_AUTHORS[0],
        own,
        body: own ? pickFrom(random, THREAD_DEMO_ME) : pickFrom(random, THREAD_DEMO_THEM),
        sentAt: new Date(cursor).toISOString(),
        attachments: withFile ? [pickFrom(random, THREAD_DEMO_FILES)] : [],
      });
    }
  }
  return { rows, total: rows.length };
}

// ── typing-indicator (annex §9) ────────────────────────────────────────────
/**
 * "Avatar + italic 'typing…' row bound to a boolean" — a `boolean-map` keyed by
 * conversation id (annex §9: "boolean per conversation"). `conversationId`
 * selects this instance's row; the display NAMES are config, not data, because
 * the thread hosting the indicator already knows its peer (the annex places it
 * as a child of `chat-thread`).
 */
export const typingIndicatorConfigSchema = widgetSharedConfigSchema.extend({
  /** Which `entries` key this instance watches. Unset → any live entry counts. */
  conversationId: z.string().optional(),
  /** 1:1 chat: the single peer whose avatar shows beside the label. */
  peerName: z.string().optional(),
  /** Group chat: the names currently typing; falls back to `peerName`. */
  typists: z.array(z.string()).default([]),
  /** Already-translated "typing…" copy (the host resolves the i18n key). */
  label: z.string().optional(),
  showAvatar: z.boolean().default(true),
  /** Avatars shown before collapsing into AvatarStack's `+N` chip. */
  maxAvatars: z.number().int().min(1).max(5).default(3),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type TypingIndicatorConfig = z.infer<typeof typingIndicatorConfigSchema>;

/**
 * Deterministic `boolean-map` of per-conversation typing state (04 §7.7), keyed
 * by the same `c1…c7` ids `conversationInboxDemoData` emits so an inbox + thread
 * + indicator demo page lines up.
 *
 * `c1` is pinned live for EVERY seed: `c1` is the inbox's first row (and so the
 * thread's default selection), and a demo/VRT frame of a typing indicator that
 * renders nothing would be a useless capture. The remaining six vary with the
 * seed, which is what threads it through (the determinism gate asserts distinct
 * seeds yield distinct payloads).
 */
export function typingIndicatorDemoData(seed: number): { entries: Record<string, boolean> } {
  const random = mulberry32(seed || 1);
  const entries: Record<string, boolean> = {};
  for (const [index] of INBOX_DEMO_PEOPLE.entries()) {
    entries[`c${index + 1}`] = index === 0 ? true : random() > 0.6;
  }
  return { entries };
}

// ── call-widget (annex §9) ─────────────────────────────────────────────────
/**
 * The ringing overlay: "{kind, peer, state}" — the §3 `record` shape. Niche by
 * the annex's own note ("kept for marketplace apps: POS support line,
 * telehealth micro-SaaS"), so it stays a thin, config-labelled shell: it renders
 * call state and emits accept/decline as `mutate` intents. It never touches a
 * media device — WebRTC (if a marketplace app ever wants it) is the host's.
 */
export const callWidgetConfigSchema = widgetSharedConfigSchema.extend({
  kindField: z.string().default('kind'),
  peerField: z.string().default('peer'),
  stateField: z.string().default('state'),
  /** Accept/decline/end controls; false → a display-only ringing card. */
  actions: z.boolean().default(true),
  voiceLabel: z.string().optional(),
  videoLabel: z.string().optional(),
  ringingLabel: z.string().optional(),
  connectingLabel: z.string().optional(),
  activeLabel: z.string().optional(),
  endedLabel: z.string().optional(),
  acceptLabel: z.string().optional(),
  declineLabel: z.string().optional(),
  endLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CallWidgetConfig = z.infer<typeof callWidgetConfigSchema>;

const CALL_DEMO_PEERS = ['Morgan Lee', 'Sam Park', 'Priya Rao', 'Casey Ford', 'Jordan Smith'] as const;

/**
 * Deterministic `record` envelope for the ringing card (04 §7.7). Pinned to
 * `ringing` for every seed — it is the annex's headline state (the expanding
 * accent ring), so it is what the demo and every VRT capture must show; the
 * peer and kind vary with the seed.
 */
export function callWidgetDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed || 1);
  return {
    row: {
      id: 'call-1',
      peer: pickFrom(random, CALL_DEMO_PEERS),
      kind: random() > 0.5 ? 'video' : 'voice',
      state: 'ringing',
      startedAt: new Date(CHAT_DEMO_EPOCH).toISOString(),
    },
  };
}

// ── ai-chat-panel (annex §9) ───────────────────────────────────────────────
/**
 * The schema-Q&A / in-dashboard AI panel SHELL (04 §11, 06 §10). Rendering
 * only: the M6 LLM layer (@adminium/llm + /api/v1/llm) lives on the server, so
 * this widget never calls a provider — `providerConfigured: false` renders the
 * "configure a provider" empty state and the host owns the send callback.
 */
export const aiChatPanelConfigSchema = widgetSharedConfigSchema.extend({
  roleField: z.string().default('role'),
  bodyField: z.string().default('body'),
  sentAtField: z.string().default('sentAt'),
  /** Starter chips the host seeds; clicking one emits it through `onSend`. */
  suggestions: z.array(z.string()).default([]),
  /**
   * Whether an LLM provider is configured (the server tells the host; the host
   * passes it down). False → the configure-a-provider empty state.
   */
  providerConfigured: z.boolean().default(true),
  /** Display-only provider/model ref shown in the header ("Claude Opus 4.5"). */
  providerLabel: z.string().optional(),
  assistantName: z.string().optional(),
  composerPlaceholder: z.string().optional(),
  sendLabel: z.string().optional(),
  /** Assistant is generating → the composer disables + a pending row shows. */
  pending: z.boolean().default(false),
  pendingLabel: z.string().optional(),
  configureTitle: z.string().optional(),
  configureBody: z.string().optional(),
  configureCtaLabel: z.string().optional(),
  /** Route the configure CTA drills through to (Studio → Settings → AI). */
  configureHref: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type AiChatPanelConfig = z.infer<typeof aiChatPanelConfigSchema>;

const AI_DEMO_PROMPTS = [
  'Which tables have no primary key?',
  'Summarise the orders table.',
  'What changed in the schema this week?',
  'Show revenue by month for 2026.',
] as const;
const AI_DEMO_ANSWERS = [
  'Two tables are missing a primary key: `audit_log` and `session_cache`. Adding one lets Adminium generate stable row links.',
  '`orders` has 14 columns and 128k rows. The high-cardinality FKs are `customer_id` and `product_id`.',
  'Three columns were added this week, all on `invoices`: `tax_rate`, `due_at`, and `voided_at`.',
  'Revenue peaked in March at $482k, then flattened around $410k for Q2.',
] as const;

/** Deterministic `record-list` of assistant/user turns (04 §7.7), canonical §3 `{ rows, total }`. */
export function aiChatPanelDemoData(seed: number): {
  rows: Record<string, unknown>[];
  total: number;
} {
  const random = mulberry32(seed || 1);
  const turns = 2 + Math.floor(random() * 3); // 2–4 Q&A pairs
  let cursor = CHAT_DEMO_EPOCH - turns * 4 * 60_000;
  const rows: Record<string, unknown>[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const index = Math.floor(random() * AI_DEMO_PROMPTS.length) % AI_DEMO_PROMPTS.length;
    cursor += 60_000;
    rows.push({
      id: `q${turn + 1}`,
      role: 'user',
      body: AI_DEMO_PROMPTS[index],
      sentAt: new Date(cursor).toISOString(),
    });
    cursor += 20_000 + Math.floor(random() * 40_000);
    rows.push({
      id: `a${turn + 1}`,
      role: 'assistant',
      body: AI_DEMO_ANSWERS[index],
      sentAt: new Date(cursor).toISOString(),
    });
  }
  return { rows, total: rows.length };
}
