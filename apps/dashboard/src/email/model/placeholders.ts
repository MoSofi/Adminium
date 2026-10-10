// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PLACEHOLDER, AS THE EDITOR READS IT: `{{name}}` and `{{name|backup}}`,
 * and a block tied to a value (`showWhen`, `otherwise`).
 *
 * The same grammar the server renders with (the manifest package's
 * `placeholders.ts`, which the dashboard does not depend on). The two are held
 * together by the same cases in both test files: change one, and its twin's
 * test says so.
 */

/** A placeholder's name: letters, digits, `_`, `.` and `-`. */
const NAME = '[A-Za-z0-9_.-]+';

/** One placeholder, anywhere in a text. A fresh expression each call: a shared global one keeps its place between readers. */
export function placeholderPattern(): RegExp {
  return new RegExp(`\\{\\{\\s*(${NAME})\\s*(?:\\|([^{}]*))?\\}\\}`, 'g');
}

/** One placeholder as it is written. */
export interface Placeholder {
  /** The whole of it, braces included. */
  whole: string;
  name: string;
  /** The words after the bar, trimmed; `undefined` when there is no bar. */
  backup: string | undefined;
  /** Where it starts in the text. */
  at: number;
}

/** Every placeholder of a text, in reading order. */
export function placeholdersIn(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const match of text.matchAll(placeholderPattern())) {
    out.push({ whole: match[0], name: match[1] as string, backup: match[2]?.trim(), at: match.index });
  }
  return out;
}

/** Whether a value is there: held, and not blank. */
function filled(vars: Readonly<Record<string, string>>, name: string): boolean {
  return Object.hasOwn(vars, name) && String(vars[name] ?? '').trim() !== '';
}

/**
 * What one placeholder writes: its value; its backup when the value is not
 * there or is empty; and with neither, an empty value as nothing and an
 * unknown name as itself.
 */
export function placeholderValue(placeholder: Pick<Placeholder, 'whole' | 'name' | 'backup'>, vars: Readonly<Record<string, string>>): string {
  if (filled(vars, placeholder.name)) return vars[placeholder.name] as string;
  if (placeholder.backup !== undefined) return placeholder.backup;
  return Object.hasOwn(vars, placeholder.name) ? (vars[placeholder.name] ?? '') : placeholder.whole;
}

/** A text with every placeholder written out. `escape` is applied once to each piece, written and filled alike. */
export function fillPlaceholders(text: string, vars: Readonly<Record<string, string>>, escape: (piece: string) => string = (piece) => piece): string {
  let out = '';
  let cursor = 0;
  for (const placeholder of placeholdersIn(text)) {
    out += escape(text.slice(cursor, placeholder.at)) + escape(placeholderValue(placeholder, vars));
    cursor = placeholder.at + placeholder.whole.length;
  }
  return out + escape(text.slice(cursor));
}

function walk(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const entry of value) walk(entry, visit);
  else if (typeof value === 'object' && value !== null) for (const entry of Object.values(value)) walk(entry, visit);
}

/** Every name the texts of a value read, however deep, in reading order, each once: with a backup or without. */
export function placeholderNames(value: unknown): string[] {
  const out = new Set<string>();
  walk(value, (text) => {
    for (const placeholder of placeholdersIn(text)) out.add(placeholder.name);
  });
  return [...out];
}

/**
 * The names a value must be given: those written somewhere WITHOUT a backup.
 * A name that carries a backup everywhere it is written says itself what to
 * write when nothing fills it, and is asked of nobody.
 */
export function requiredPlaceholderNames(value: unknown): string[] {
  const out = new Set<string>();
  walk(value, (text) => {
    for (const placeholder of placeholdersIn(text)) if (placeholder.backup === undefined) out.add(placeholder.name);
  });
  return [...out];
}

/** A placeholder, written: `{{name}}`, or `{{name|backup}}`. A backup loses the braces it cannot hold. */
export function writePlaceholder(name: string, backup?: string | undefined): string {
  return backup === undefined ? `{{${name}}}` : `{{${name}|${backup.replaceAll(/[{}]/g, '').trim()}}}`;
}

// ── a block tied to a value ──────────────────────────────────────────────────

/** A block's own condition: shown only when this variable has a value. */
export interface ShowWhen {
  var: string;
}

/** The condition a block record carries, or null: `showWhen: { var: 'first_name' }`. */
export function showWhenOf(block: unknown): ShowWhen | null {
  if (typeof block !== 'object' || block === null) return null;
  const mark = (block as Record<string, unknown>)['showWhen'];
  if (typeof mark !== 'object' || mark === null) return null;
  const name = (mark as Record<string, unknown>)['var'];
  return typeof name === 'string' && new RegExp(`^${NAME}$`).test(name) ? { var: name } : null;
}

/** The words a block shows in its own place when its condition is not met, or null. */
export function otherwiseOf(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null;
  const text = (block as Record<string, unknown>)['otherwise'];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** The kinds of block that can say other words: the ones that are a single text. */
export const OTHERWISE_BLOCKS: readonly string[] = ['email.text', 'email.heading'];

/**
 * The blocks an email is made of for these values: a block tied to a value
 * that is not there is left out, or — a text block that says what to show
 * otherwise — written with those words in place of its own. Read by the
 * renderer and by every check of what an email will print, so a name only a
 * hidden block reads is asked of nobody.
 */
export function blocksShownFor<T>(blocks: readonly T[], vars: Readonly<Record<string, string>>): T[] {
  const out: T[] = [];
  for (const block of blocks) {
    const when = showWhenOf(block);
    if (when === null || filled(vars, when.var)) {
      out.push(block);
      continue;
    }
    const otherwise = otherwiseOf(block);
    const record = block as unknown as Record<string, unknown>;
    if (otherwise === null || !OTHERWISE_BLOCKS.includes(String(record['block']))) continue;
    const data = typeof record['data'] === 'object' && record['data'] !== null ? (record['data'] as Record<string, unknown>) : {};
    const { paras: _paras, ...rest } = data;
    out.push({ ...record, data: { ...rest, text: otherwise } } as unknown as T);
  }
  return out;
}

/** The variables the blocks of a document are tied to, each once. */
export function showWhenNames(blocks: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const block of blocks) {
    const when = showWhenOf(block);
    if (when !== null) out.add(when.var);
  }
  return [...out];
}

/**
 * The names a whole email must be given, whoever reads it: written with no
 * backup, outside a block tied to that same name. `{{first_name}}` in a block
 * shown only when there is a first name is never met unfilled.
 */
export function requiredNamesOfEmail(email: { subject?: unknown; preheader?: unknown; blocks: readonly unknown[]; footer?: unknown }): string[] {
  const out = new Set(requiredPlaceholderNames([email.subject, email.preheader, email.footer]));
  for (const block of email.blocks) {
    const tiedTo = showWhenOf(block)?.var;
    for (const name of requiredPlaceholderNames(block)) if (name !== tiedTo) out.add(name);
  }
  return [...out];
}

// ── what only the editor needs ───────────────────────────────────────────────

/** A text with the backup of its `index`-th placeholder set; `undefined` or nothing typed takes the bar away. */
export function withBackup(text: string, index: number, backup: string | undefined): string {
  const placeholder = placeholdersIn(text)[index];
  if (placeholder === undefined) return text;
  const written = writePlaceholder(placeholder.name, backup === undefined || backup.trim() === '' ? undefined : backup);
  return text.slice(0, placeholder.at) + written + text.slice(placeholder.at + placeholder.whole.length);
}

/** A value as a reader with nothing filled meets it: every backup written, every other placeholder left as it is. */
export function asMissing<T>(value: T): T {
  if (typeof value === 'string') return fillPlaceholders(value, {}) as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => asMissing(entry)) as T;
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, asMissing(entry)])) as T;
  return value;
}

/** A variable's name as a person says it: `customer.first_name` is "first name". */
export function spokenName(name: string): string {
  const last = name.split('.').at(-1) ?? name;
  return last.replaceAll(/[_-]+/g, ' ').trim() || name;
}

/** The names a document answers for itself when they are missing: each with a backup somewhere, or with a block tied to it. */
export function answeredNames(document: { subject: string; preheader: string; blocks: readonly unknown[]; footer: string }): string[] {
  const out = new Set<string>();
  const read = (value: unknown): void => {
    if (typeof value === 'string') for (const placeholder of placeholdersIn(value)) if (placeholder.backup !== undefined) out.add(placeholder.name);
    if (Array.isArray(value)) value.forEach(read);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(read);
  };
  read([document.subject, document.preheader, document.blocks, document.footer]);
  for (const name of showWhenNames(document.blocks)) out.add(name);
  return [...out];
}
