// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE MESSAGE PER VALUE, NOT PER ROW (`producer.repeatBy`).
 *
 * A producer sends once for a row: the outbox's own rows are the log it
 * dedupes by. An offer is not a row, though — a ticket offered to Lee, taken
 * back, then offered to Zoe (or to Lee again) is a new offer each time, with
 * a link made afresh, and each must be emailed. So a producer may name a
 * column of the row its message is about; the message keeps a digest of that
 * column's value (`outbox.columns.repeatKey`), and a new value is a new
 * message. The digest, never the value: the column may be a link's secret.
 */
import { createHash } from 'node:crypto';

import type { Outbox, OutboxProducer } from '@adminium/manifest';

import type { Row } from '../crud/mask.js';

/** A value as the digest reads it: an instant as its ISO text, anything else as its text; empty is none. */
function spelled(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/** The outbox column that keeps the digest and the digest of this row's value — undefined for a producer that sends once per row. */
export function repeatKeyOf(definition: Outbox, producer: OutboxProducer, about: Row): { column: string; key: string | null } | undefined {
  const column = definition.columns.repeatKey;
  if (producer.repeatBy === undefined || column === undefined) return undefined;
  const value = spelled(about[producer.repeatBy]);
  return { column, key: value === null ? null : createHash('sha256').update(JSON.stringify([producer.kind, value])).digest('base64url') };
}
