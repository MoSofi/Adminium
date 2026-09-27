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

/** The column of the row a message is about that holds its language, for this producer; undefined when none is named. */
export function producedLanguageColumn(definition: Pick<Outbox, 'recipient'>, producer: OutboxProducer | undefined): string | undefined {
  const own = producer?.recipient !== undefined && 'column' in producer.recipient ? producer.recipient.language : undefined;
  if (own !== undefined) return own;
  const language = definition.recipient.language;
  return typeof language === 'object' ? language.column : undefined;
}

/** The language the row a message is about holds for it (`de`, `pt-BR`), or null for none. */
export function producedLanguage(definition: Pick<Outbox, 'recipient'>, producer: OutboxProducer | undefined, about: Row): string | null {
  const column = producedLanguageColumn(definition, producer);
  const value = column === undefined ? undefined : about[column];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
