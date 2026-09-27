// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LANGUAGE A MESSAGE IS WRITTEN IN, when the app reads it from the row the
 * message is about: an order placed in German is written to in German, even
 * when the person it goes to — a signed-in diner — has another language on
 * their own row. A producer that sends to an address held on its row
 * (`recipient: {column, language}`) names the row's language column beside
 * it; any other names it once for the outbox (`recipient.language: {column}`).
 * The language is written into the outbox's language column when the message
 * is queued, and the sender writes in it; a row that holds none leaves the
 * person's language (or the workspace's) in place.
 */
import type { Outbox, OutboxProducer } from '@adminium/manifest';

import type { Row } from '../crud/mask.js';
import { negotiateLocale } from '../plugins/surfaces.js';

/** A language tag as a row may hold one: `de`, `pt-BR`, `zh_TW` — one tag, never a list. */
const ONE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8}){0,3}$/;

/**
 * A row's language when a message can be written in it: one tag, of a
 * language the built-in locales place, that fits the outbox's language
 * column (`fits`, its width) — else null, and the person's language (or the
 * workspace's) is used instead of it.
 */
export function usableLanguage(value: unknown, fits: number | null = null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > 35 || (fits !== null && text.length > fits) || !ONE_TAG.test(text)) return null;
  return negotiateLocale(text.replace(/_/g, '-')) === null ? null : text;
}

/** The column of the row a message is about that holds its language, for this producer; undefined when none is named. */
export function producedLanguageColumn(definition: Pick<Outbox, 'recipient'>, producer: OutboxProducer | undefined): string | undefined {
  const own = producer?.recipient !== undefined && 'column' in producer.recipient ? producer.recipient.language : undefined;
  if (own !== undefined) return own;
  const language = definition.recipient.language;
  return typeof language === 'object' ? language.column : undefined;
}

/**
 * The language the row a message is about holds for it (`de`, `pt-BR`), or
 * null for none — or for one no message can be written in, or too long for
 * the outbox's language column (`fits`), which then leaves the person's.
 */
export function producedLanguage(definition: Pick<Outbox, 'recipient'>, producer: OutboxProducer | undefined, about: Row, fits: number | null = null): string | null {
  const column = producedLanguageColumn(definition, producer);
  return usableLanguage(column === undefined ? undefined : about[column], fits);
}
