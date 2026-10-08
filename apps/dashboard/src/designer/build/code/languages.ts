// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The language of a file, by its ending. Only the language objects are taken
 * from the packages: their bundled setups bring completion, lint and HTML,
 * which this editor does not have and would triple its weight for.
 */
import { cssLanguage } from '@codemirror/lang-css';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { defineLanguageFacet, Language } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { parser as markdownParser } from '@lezer/markdown';

/** Markdown as text with its headings and marks told apart: no preview, no nested languages. */
const markdownLanguage = new Language(defineLanguageFacet(), markdownParser, [], 'markdown');

const BY_ENDING: readonly (readonly [RegExp, Language])[] = [
  [/\.tsx$/i, tsxLanguage],
  [/\.jsx$/i, jsxLanguage],
  [/\.ts$/i, typescriptLanguage],
  [/\.(mjs|js)$/i, javascriptLanguage],
  [/\.css$/i, cssLanguage],
  [/\.json$/i, jsonLanguage],
  [/\.md$/i, markdownLanguage],
];

/** The language's name for a path, or null for plain text. */
export function languageName(path: string): string | null {
  return BY_ENDING.find(([ending]) => ending.test(path))?.[1].name ?? null;
}

export function languageFor(path: string): Extension {
  return BY_ENDING.find(([ending]) => ending.test(path))?.[1] ?? [];
}
