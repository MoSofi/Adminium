// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW THE DOOR ASKS THE AUTOMATIC ANSWERER, and what it does with the choice.
 *
 * The answerer (`answerer.ts`, its own piece) picks one of the owner's
 * answers for the visitor's last message, or hands the conversation to a
 * person; it logs every choice itself through the store's `logChoice`.
 * Without one, the door holds {@link HAND_OVER_ANSWERER}, which hands every
 * conversation to a person without calling anything.
 *
 * What the door does with a choice:
 *  - an answer: an automatic message with the answer's text in the visitor's
 *    language when the answer has that version, else in the default
 *    language's (the window marks it with its language);
 *  - a hand-over: the conversation waits for a person, with a system line
 *    `handed-over` (the answerer handed it over, never the visitor).
 */
import type { FormLanguage } from '@adminium/add-on-contracts/forms';
import { sql } from 'kysely';
import { z } from 'zod';

import type { Row } from '../crud/mask.js';
import { jsonOf } from '../forms/catalog.js';
import type { ChatAnswerer, ChatAnswererInput } from './answerer.js';
import type { LiveChat } from './catalog.js';
import { yes } from './settings.js';

/** The answerer's own interface (`answerer.ts`). */
export type { ChatAnswerer, ChatAnswererInput, ChatChoice } from './answerer.js';
/** The answerer when none is given (a server built without one): every conversation goes to a person, and nothing is called. */
export const HAND_OVER_ANSWERER: ChatAnswerer = { pick: async () => ({ kind: 'hand-over', outcome: 'off' }) };

/** How many of the visitor's messages the answerer reads. */
export const ANSWERER_MESSAGES = 6;

const versionSchema = z.object({ title: z.string(), text: z.string(), examples: z.array(z.string()).max(50).default([]) }).passthrough();

/** One of the owner's answers: its versions by language. */
export interface ChatAnswer {
  ref: string;
  versions: Partial<Record<string, { title: string; text: string; examples: string[] }>>;
}

/** An answer's versions as stored, each read whole or left out. */
export function versionsOf(value: unknown): ChatAnswer['versions'] {
  const read = jsonOf(value);
  if (read === null || typeof read !== 'object' || Array.isArray(read)) return {};
  const out: ChatAnswer['versions'] = {};
  for (const [language, version] of Object.entries(read as Record<string, unknown>)) {
    const parsed = versionSchema.safeParse(version);
    if (parsed.success) out[language] = { title: parsed.data.title, text: parsed.data.text, examples: parsed.data.examples };
  }
  return out;
}

/** The owner's active answers, in their order (`refs`: only these). */
export async function readAnswers(chat: LiveChat, refs?: readonly string[]): Promise<ChatAnswer[]> {
  const { table, pk } = chat.answers;
  let query = chat.db.selectFrom(table.id as never).selectAll();
  if (refs !== undefined) {
    if (refs.length === 0) return [];
    query = query.where(sql.ref('ref'), 'in', [...refs] as never);
  }
  const rows = (await query.orderBy(sql.ref('position') as never).orderBy(sql.ref(pk) as never).execute()) as Row[];
  return rows.filter((row) => refs !== undefined || yes(row['active'])).flatMap((row) => (typeof row['ref'] === 'string' ? [{ ref: row['ref'], versions: versionsOf(row['versions']) }] : []));
}

/** The answers as the answerer is given them: their default-language versions; an answer without one is left out. */
export function answererAnswers(answers: readonly ChatAnswer[], defaultLanguage: string): ChatAnswererInput['answers'] {
  return answers.flatMap((answer) => {
    const version = answer.versions[defaultLanguage];
    return version === undefined ? [] : [{ ref: answer.ref, title: version.title, text: version.text, examples: version.examples }];
  });
}

/** The text an answer gives a visitor, and the language it is in: theirs when written, else the default language's. */
export function answerText(answer: ChatAnswer, language: FormLanguage | string, defaultLanguage: string): { text: string; language: string } | null {
  const own = answer.versions[language];
  if (own !== undefined && own.text.trim() !== '') return { text: own.text, language };
  const fallback = answer.versions[defaultLanguage];
  return fallback === undefined ? null : { text: fallback.text, language: defaultLanguage };
}

/** The language an automatic message's text is in: the version of its answer whose text it holds; else the conversation's. */
export function automaticLanguage(answer: ChatAnswer | undefined, body: string, fallback: string): string {
  if (answer === undefined) return fallback;
  for (const [language, version] of Object.entries(answer.versions)) if (version?.text === body) return language;
  return fallback;
}
