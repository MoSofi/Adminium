// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "MAKE AN ENQUIRY" FROM A WEBSITE CHAT: what the new row holds.
 *
 * In hours a person is there to judge whether a chat is a lead, so the row is
 * made by them, under their own rights, through the dashboard's own create
 * route (the route sends it as the person: every grant, column limit, rule
 * and audit of an ordinary create). This module only says where and what:
 *
 *  - where: the table an app the chat is attached to opens to it (a
 *    `publicAccess` entry under the reserved key `chat`, the first by app and
 *    table name: `question.ts`'s rule, so a question left outside hours and
 *    an enquiry made in hours land in the same table);
 *  - what: the entry's own defaults (the CRM's source `chat`), then, by name
 *    among the entry's writable columns, the conversation's first visitor
 *    message, the name and the address the visitor typed. Never a consent
 *    column: a typed address agrees to nothing (`may_email` stays off).
 */
import type { Row } from '../crud/mask.js';
import type { FormsScopes, FormsTable } from '../forms/scope.js';
import type { LiveChat } from './catalog.js';
import { EMAIL_COLUMNS, NAME_COLUMNS, QUESTION_COLUMNS, questionTable } from './question.js';
import type { ChatConversation } from './store.js';

/** Columns an enquiry made from a chat never fills: a typed address gives no consent. */
export const NEVER_FILLED = /^(?:may_?e?mail|.*consent.*|marketing.*|newsletter.*)$/i;

/** What is missing for an enquiry: no app opens a table to the chat, or its entry opens no column for the question. */
export type EnquiryMissing = 'no-table' | 'no-question-column';

export type EnquiryPlan = { ok: true; opened: FormsTable; values: Row } | { ok: false; missing: EnquiryMissing };

/** The first of `names` the entry opens for writing, or null. */
function columnFor(opened: FormsTable, names: readonly string[]): string | null {
  return names.find((name) => opened.resource.writable.has(name) && !opened.entry.decided.includes(name)) ?? null;
}

/** Where an enquiry from this conversation goes, and what it holds (see the header). */
export async function planEnquiry(scopes: FormsScopes, chat: Pick<LiveChat, 'connectionId' | 'addOn'>, conversation: Pick<ChatConversation, 'name' | 'email'>, firstMessage: string | null): Promise<EnquiryPlan> {
  const opened = await questionTable(scopes, chat);
  if (opened === null) return { ok: false, missing: 'no-table' };
  const question = columnFor(opened, QUESTION_COLUMNS);
  if (question === null) return { ok: false, missing: 'no-question-column' };
  const values: Row = {};
  for (const [column, value] of Object.entries(opened.resource.defaults)) if (!NEVER_FILLED.test(column)) values[column] = value;
  if (firstMessage !== null) values[question] = firstMessage;
  const name = columnFor(opened, NAME_COLUMNS);
  if (name !== null && conversation.name !== null) values[name] = conversation.name;
  const email = columnFor(opened, EMAIL_COLUMNS);
  if (email !== null && conversation.email !== null) values[email] = conversation.email;
  return { ok: true, opened, values };
}
