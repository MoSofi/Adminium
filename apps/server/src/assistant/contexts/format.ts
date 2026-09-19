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
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const name = match[1];
    if (name !== undefined) found.add(name);
  }
  return [...found];
}

/** Cut a long line for a diff or a detail row without losing that it was cut. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
