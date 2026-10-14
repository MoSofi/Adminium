// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Turning a page's own schema into the section of the prompt that describes
 * its document format.
 *
 * Generated, never hand-written. The alternative is a second description of
 * every envelope, maintained beside the first one and wrong the day after
 * somebody adds a field — and the model would then be drafting against a
 * format the save no longer accepts.
 */

import { placeholderNames } from '@adminium/manifest';
import { z } from 'zod';

/** One page's envelope as JSON Schema, rendered for the prompt. */
export function jsonSchemaOf(schema: z.ZodType): string {
  return JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}

/** `- kind — what it is`, one per line, in the vocabulary's own order. */
export function blockVocabulary(
  kinds: readonly string[],
  meanings: Readonly<Record<string, string>>,
): string {
  return kinds.map((kind) => `- ${kind} — ${meanings[kind] ?? 'a block of this page'}`).join('\n');
}

/** `{{name}}` occurrences in a rendered document, de-duplicated, in first-seen order. */
export function varsUsedIn(text: string): string[] {
  return placeholderNames(text);
}

/** Cut a long line for a diff or a detail row without losing that it was cut. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** One line a document's diff compares: what the value is (its path, without list positions) and the value. */
export interface DiffPiece {
  label: string;
  piece: string;
}

/**
 * Every value under `value`, in stored order, as the pieces a diff compares.
 *
 * EVERY value, and none of it clipped: two documents that differ must not
 * project the same lines, or the Diff tab says "+0 −0" over a real change. A
 * text is a sentence a line, so that one added sentence is one added line; a
 * list item made of plain values (a table row, a KPI, a chart point) is one
 * line, its values side by side.
 */
export function diffPieces(value: unknown, path = ''): DiffPiece[] {
  if (typeof value === 'string') return sentencesOf(value).map((piece) => ({ label: path, piece }));
  if (typeof value === 'number' || typeof value === 'boolean') return [{ label: path, piece: String(value) }];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const row = rowOf(entry);
      if (row === null) return diffPieces(entry, path);
      return row === '' ? [] : [{ label: path, piece: row }];
    });
  }
  if (typeof value !== 'object' || value === null) return [];
  // An `id` names a part, it is not part of what the document says: a redraft renumbers its blocks,
  // items and steps, and that alone must not read as a change.
  return Object.entries(value).flatMap(([key, entry]) => (key === 'id' ? [] : diffPieces(entry, path === '' ? key : `${path}.${key}`)));
}

/** A list item that is itself a short row of plain values, as one line; `null` when it is anything else. */
function rowOf(entry: unknown): string | null {
  const cells = Array.isArray(entry)
    ? entry
    : typeof entry === 'object' && entry !== null
      ? Object.entries(entry)
          .filter(([key]) => key !== 'id')
          .map(([, cell]) => cell as unknown)
      : null;
  if (cells === null || cells.length === 0) return null;
  if (!cells.every((cell) => typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')) return null;
  return cells
    .map(String)
    .filter((cell) => cell !== '')
    .join(' · ');
}

/** A text as the lines it is compared by: its sentences, a long one cut into pieces. Nothing is dropped. */
function sentencesOf(value: string): string[] {
  return value
    .split(/\n+|(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
    .flatMap((sentence) => sentence.match(/.{1,200}/gu) ?? []);
}
