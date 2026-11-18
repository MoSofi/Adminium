// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHAT: THE ADD-ON BLOCK'S `chat` WORD.
 *
 * A live chat add-on names which of its own tables hold the conversations,
 * their messages, the answers staff wrote for automatic replies, and the
 * record of each choice the answerer made:
 *
 * ```json
 * "addOn": { "chat": { "conversations": "conversations", "messages": "messages", "answers": "answers", "choices": "choices" } }
 * ```
 *
 * The engine keeps the conversation for a stranger (no add-on code runs for
 * one): it writes every conversation, every message and every choice, so
 * each table must have the columns the engine reads and writes, by these
 * names and of these kinds ({@link CHAT_COLUMNS}), and a numbered key (the
 * messages' key is the cursor a visitor's window asks "since"). Staff write
 * the answers and the add-on's one settings row ({@link CHAT_SETTINGS_COLUMNS});
 * nothing of the add-on (no role, no app's grant, no step) writes the other
 * three, and no public entry of the add-on opens any of the four.
 *
 * Where a question left outside hours becomes a row of an app is the app's
 * word, not the add-on's: an app opens a table to it through a
 * `publicAccess` entry under the reserved key `chat` (see `public-access.ts`).
 *
 * Pure: no I/O, and nothing imported from the manifest's own schema file, so
 * that file may import this one.
 */
import { z } from 'zod';

import { FORMS_BECAME_TABLE_MAX, contractColumns, describeContractColumn, type ContractColumn, type FormsAddOnShape } from './forms.js';
import { refSchema, type ReferenceIssue } from './refs.js';

/** The block: the add-on's own tables, by ref. All four are required. */
export const addOnChatSchema = z
  .object({
    conversations: refSchema,
    messages: refSchema,
    answers: refSchema,
    choices: refSchema,
  })
  .strict();
export type AddOnChat = z.infer<typeof addOnChatSchema>;

/** The four parts a chat block names. */
export type ChatPart = keyof AddOnChat;
export const CHAT_PARTS = ['conversations', 'messages', 'answers', 'choices'] as const satisfies readonly ChatPart[];

/** The category a package that declares chat is filed under. */
export const CHAT_CATEGORY = 'marketing';

/** What one column of a chat table, or of its settings table, must be. */
export type ChatColumn = ContractColumn<ChatPart>;

/** Where a conversation stands: with the automatic answerer, waiting for a person, with a person, or over. */
export const CHAT_STATES = ['bot', 'waiting', 'open', 'closed'] as const;
/** Who wrote a message: the visitor, a staff member, the automatic answerer, or Adminium (a line that says what happened). */
export const CHAT_MESSAGE_KINDS = ['visitor', 'staff', 'automatic', 'system'] as const;
/**
 * The words a system line's `event` holds. `asked` is the visitor asking for a
 * person ("Talk to a person"); `handed-over` is the automatic answerer handing
 * the conversation to a person by itself.
 */
export const CHAT_EVENTS = ['taken', 'asked', 'handed-over', 'closed', 'reopened', 'left'] as const;
/** What the answerer did with one visitor message. */
export const CHAT_OUTCOMES = ['answered', 'hand-over', 'error', 'budget', 'cap', 'off'] as const;
/** How the visitor's window is drawn: light, dark, or as the visitor's own device is set. */
export const CHAT_THEMES = ['light', 'dark', 'visitor'] as const;
/** The longest a visitor's or staff member's message may be. */
export const CHAT_MESSAGE_MAX = 2000;

const { text, moment, date, json, whole, bool, choice, link } = contractColumns;

/**
 * The columns each part has, which the engine reads and writes by these
 * names. A table may have more of its own; on the tables Adminium alone
 * writes (conversations, messages, choices) each other column is one an
 * insert may leave out. A column not marked nullable is always written, so
 * it may not be nullable either.
 */
export const CHAT_COLUMNS: Readonly<Record<ChatPart, Readonly<Record<string, ChatColumn>>>> = {
  conversations: {
    started_at: moment(),
    last_message_at: moment(),
    state: choice(CHAT_STATES),
    /** The language the visitor's window was drawn in. */
    language: text(10),
    /** What the visitor typed as their name and e-mail: never confirmed. */
    name: text(200, true),
    email: text(320, true),
    /** The page the window was opened on, without its query. */
    came_from: text(2048, true),
    /** Started while nobody was in. */
    outside_hours: bool(),
    /** The staff member who took the conversation, and when. */
    taken_by: text(64, true),
    taken_at: moment(true),
    /** The last time the visitor's window, and a staff member, were seen: the visitor's is their presence. */
    last_visitor_at: moment(true),
    last_staff_at: moment(true),
    closed_at: moment(true),
    /** The row of an app the conversation became (`<app>:<table>` and its key). */
    became_table: text(FORMS_BECAME_TABLE_MAX, true),
    became_key: text(200, true),
    /** How many automatic answers the conversation has had. */
    automatic_count: whole(),
  },
  messages: {
    conversation_id: link('conversations'),
    kind: choice(CHAT_MESSAGE_KINDS),
    body: text(CHAT_MESSAGE_MAX),
    /** A system line's word ({@link CHAT_EVENTS}). */
    event: text(30, true),
    /** The answer an automatic message gave, by its ref. */
    answer_ref: text(64, true),
    /** The staff member who wrote it. */
    author_id: text(64, true),
    /** A person sent a draft the assistant wrote. */
    drafted: bool(),
    sent_at: moment(),
    /** When the message went to the visitor by mail, after they left. */
    mailed_at: moment(true),
  },
  answers: {
    ref: { ...text(64), unique: true },
    /** `{ [locale]: { title, text, examples: string[] } }`, the default language required. */
    versions: json(),
    active: bool(),
    position: whole(),
  },
  choices: {
    conversation_id: link('conversations'),
    /** The visitor message the choice was about. */
    message_id: whole(),
    /** The answer chosen; empty when the conversation was handed to a person. */
    answer_ref: text(64, true),
    outcome: choice(CHAT_OUTCOMES),
    model: text(100, true),
    tokens_in: whole(),
    tokens_out: whole(),
    at: moment(),
  },
};

/**
 * The columns of the add-on's one settings row (`addOn.settingsTable`). The
 * row is made at install from its columns' defaults, and a `json` or `date`
 * column takes no default, so those are nullable: the engine reads an empty
 * one as nothing set.
 */
export const CHAT_SETTINGS_COLUMNS: Readonly<Record<string, ChatColumn>> = {
  /** The weekly hours: `{ "mon": [["09:00", "17:30"]], … }`. */
  hours: json(true),
  /** The business's time zone the hours are in; empty: the server's. */
  time_zone: text(64, true),
  /** Closed until this day (a holiday). */
  closed_until: date(true),
  /** The window's first words, and what it says outside hours, per language. */
  welcome: json(true),
  outside_words: json(true),
  /** Automatic answers on, and the tokens a day they may spend (0: none). */
  automatic: bool(),
  daily_tokens: whole(),
  /** The assistant drafts replies for staff on these conversations. */
  milo_drafts: bool(),
  /** Who is told of a waiting conversation: `[{ "kind": "role" | "person", "id" }]`. */
  tell: json(true),
  /** How many months conversations are kept; empty keeps them until removed. */
  transcripts_months: whole(true),
  theme: choice(CHAT_THEMES),
};

/** The parts only Adminium writes: staff write the answers. */
const ADMINIUM_WRITES: readonly ChatPart[] = ['conversations', 'messages', 'choices'];

/** The actions on a table no grant gives on a table only Adminium writes. */
const WRITES = ['create', 'update', 'import'] as const;

/** What the checks read of the add-on beside its chat block. */
export interface ChatAddOnShape extends FormsAddOnShape {
  /** Whether the add-on declares forms too. */
  forms?: boolean | undefined;
}

/** Everything wrong with an add-on's chat block, against its own tables, settings table, roles, entries and steps. */
export function chatBlockIssues(block: AddOnChat, m: ChatAddOnShape): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const tables = new Map(m.tables.map((table, t) => [table.ref, { table, t }]));
  const at = (...rest: (string | number)[]) => ['addOn', 'chat', ...rest];

  if (!m.categories.includes(CHAT_CATEGORY)) out.push({ path: ['categories'], message: `an add-on that declares chat is filed under the "${CHAT_CATEGORY}" category` });
  // Each door is vouched for, and its rows kept, per package: one package with both would mix the two.
  if (m.forms === true) out.push({ path: at(), message: 'an add-on declares forms or chat, not both: each is a package of its own' });

  const seen = new Map<string, ChatPart>();
  for (const part of CHAT_PARTS) {
    const ref = block[part];
    const other = seen.get(ref);
    if (other !== undefined) out.push({ path: at(part), message: `"${ref}" holds the ${other} already: each part of chat is a table of its own` });
    seen.set(ref, part);
  }

  for (const part of CHAT_PARTS) {
    const ref = block[part];
    const found = tables.get(ref);
    if (found === undefined) {
      out.push({ path: at(part), message: `"${ref}" is not one of this add-on's tables` });
      continue;
    }
    const { table, t } = found;
    const contract = CHAT_COLUMNS[part];
    out.push(...columnIssues(table, t, `the ${part}`, contract, block));

    // A numbered key: the engine's own increment, which the messages' cursor reads.
    const k = table.columns.findIndex((column) => column.role === 'pk');
    const key = table.columns[k];
    if (key === undefined) out.push({ path: at(part), message: `"${ref}" holds the ${part}, so its rows are numbered: give it an int key (role "pk")` });
    else if (key.type !== 'int' && key.type !== 'bigint') out.push({ path: ['requiredSchema', 'tables', t, 'columns', k, 'type'], message: `"${ref}" holds the ${part}, so its rows are numbered: its key "${key.ref}" is an int or a bigint, not ${key.type}` });

    // The engine serves a stranger the conversation and nothing else: no public entry of the add-on opens a chat table.
    (m.publicAccess ?? []).forEach((entry, e) => {
      if (entry.table === ref) out.push({ path: ['publicAccess', e, 'table'], message: `"${ref}" holds the ${part}, which Adminium alone serves to strangers: no public entry opens it` });
    });

    if (ADMINIUM_WRITES.includes(part)) {
      // A table only Adminium writes: every other column is one its insert may leave out.
      table.columns.forEach((column, c) => {
        if (contract[column.ref] !== undefined || column.role === 'pk' || column.nullable === true || column.default !== undefined || m.decided?.(ref, column.ref) === true) return;
        out.push({ path: ['requiredSchema', 'tables', t, 'columns', c], message: `"${ref}" is written by Adminium alone, which never fills "${column.ref}": make it nullable or give it a default` });
      });
      out.push(...onlyAdminiumWrites(ref, t, part, m));
    }
  }

  // The settings the engine reads: the hours, the words, the answerer's budget, who is told.
  const settings = m.settingsTable === undefined ? undefined : tables.get(m.settingsTable);
  if (m.settingsTable === undefined) {
    out.push({ path: ['addOn', 'settingsTable'], message: 'an add-on that declares chat keeps its hours, words and answerer in a one-row settings table: name it in addOn.settingsTable' });
  } else if (settings !== undefined) {
    out.push(...columnIssues(settings.table, settings.t, "the chat's settings", CHAT_SETTINGS_COLUMNS, block));
  }
  return out;
}

/** Each column a contract names, on one table: there, of its kind, its values, its width, its emptiness and its link. */
function columnIssues(table: FormsAddOnShape['tables'][number], t: number, holds: string, contract: Readonly<Record<string, ChatColumn>>, block: AddOnChat): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const ref = table.ref;
  for (const [name, want] of Object.entries(contract)) {
    const c = table.columns.findIndex((column) => column.ref === name);
    const column = table.columns[c];
    if (column === undefined) {
      out.push({ path: ['requiredSchema', 'tables', t, 'columns'], message: `"${ref}" holds ${holds}, so it has a column "${name}" (${describeContractColumn(want)})` });
      continue;
    }
    const say = (message: string, ...rest: (string | number)[]) => out.push({ path: ['requiredSchema', 'tables', t, 'columns', c, ...rest], message: `"${ref}.${name}" ${message}` });
    if (!want.types.includes(column.type)) {
      say(`is read and written by Adminium as ${describeContractColumn(want)}, not ${column.type}`, 'type');
      continue;
    }
    if (want.nullable === true && column.nullable !== true) say('is written empty until there is something to put in it: make it nullable', 'nullable');
    if (want.nullable !== true && column.nullable === true) say('always holds a value, which Adminium reads: make it not nullable', 'nullable');
    if (want.unique === true && column.unique !== true) say('names one row: make it unique', 'unique');
    if (want.atLeast !== undefined && column.maxLength !== undefined && column.maxLength < want.atLeast) say(`takes up to ${String(want.atLeast)} characters: leave out maxLength, or make it at least that`, 'maxLength');
    if (want.values !== undefined) {
      const values = new Set(column.enum ?? []);
      if (values.size !== want.values.length || !want.values.every((value) => values.has(value))) say(`takes exactly ${want.values.map((value) => `"${value}"`).join(', ')}`, 'enum');
    }
    if (want.links !== undefined) {
      const target = block[want.links];
      if (column.references !== target) say(`links to the ${want.links} ("${target}")`, 'references');
    }
  }
  return out;
}

/**
 * Nothing of the add-on writes a table only Adminium writes: no role's
 * create, update or import, no app's grant beyond reading, no step (and, as
 * for every chat table, no public entry). Staff read them and delete them.
 */
function onlyAdminiumWrites(ref: string, t: number, part: ChatPart, m: ChatAddOnShape): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const why = `the ${part} are written by Adminium alone`;
  const roles = m.roles ?? [];
  roles.forEach((role, r) => {
    const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
    const grants = new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])]);
    for (const action of WRITES) {
      if (grants.has(`table:@${ref}:${action}`) || grants.has(`table:@*:${action}`)) {
        out.push({ path: ['roles', r, 'permissions'], message: `"${role.key}" may ${action} "${ref}", and ${why}: a role reads and deletes them` });
      }
    }
  });
  (m.tables[t]?.appGrants?.actions ?? []).forEach((action, a) => {
    if (action !== 'read') out.push({ path: ['requiredSchema', 'tables', t, 'appGrants', 'actions', a], message: `${why}: an app's role may only read "${ref}"` });
  });
  (m.steps ?? []).forEach((step, s) => {
    if (step.writes.table === ref) out.push({ path: ['addOn', 'steps', s, 'writes', 'table'], message: `${why}: the step "${step.key}" may not write a row of "${ref}"` });
  });
  return out;
}
