// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page of code `adminium eject` writes in place of a page file
 * (49-developer-projects.md §7).
 *
 * Version 1 is a starting point, not an expansion into components: the page
 * file's settings become a constant, and the UI kit's `GeneratedPage` draws
 * them with the template they name, so the page looks and works as it did.
 * The constant is written as a TypeScript object literal the developer will
 * edit by hand: unquoted keys where JavaScript allows them, single quotes,
 * one value per line unless a short list or object fits on one.
 */

import { isPageSlug } from './paths.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LINE_WIDTH = 100;

function quote(text: string): string {
  const escaped = JSON.stringify(text).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'");
  return `'${escaped}'`;
}

function key(name: string): string {
  return IDENTIFIER.test(name) ? name : quote(name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` as TypeScript source, for a place indented by `indent`. */
export function objectLiteral(value: unknown, indent = ''): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${String(value)} has no literal in a page file`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return quote(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => objectLiteral(item, inner));
    const flat = `[${items.join(', ')}]`;
    if (!flat.includes('\n') && indent.length + flat.length <= LINE_WIDTH) return flat;
    return `[\n${items.map((item) => `${inner}${item},`).join('\n')}\n${indent}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([name, item]) => `${key(name)}: ${objectLiteral(item, inner)}`);
    if (entries.length === 0) return '{}';
    const flat = `{ ${entries.join(', ')} }`;
    if (!flat.includes('\n') && entries.length <= 4 && indent.length + flat.length <= LINE_WIDTH) return flat;
    return `{\n${entries.map((entry) => `${inner}${entry},`).join('\n')}\n${indent}}`;
  }
  throw new Error(`a ${typeof value} has no literal in a page file`);
}

/** `orders-by-month` → `OrdersByMonthPage`. */
export function componentName(slug: string): string {
  const base = slug
    .split('-')
    .filter((part) => part !== '')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(base) ? `Page${base}` : `${base}Page`;
}

function titleOf(page: Record<string, unknown>, slug: string): string {
  const title = page['title'];
  if (typeof title === 'string' && title !== '') return title;
  if (isPlainObject(title) && typeof title['fallback'] === 'string' && title['fallback'] !== '') return title['fallback'];
  return slug;
}

/**
 * The source of `pages/<slug>.tsx` for a page file's settings: the file
 * without its file-only keys (`PageFileDocument.portable`).
 */
export function ejectedPageSource(slug: string, portable: Readonly<Record<string, unknown>>): string {
  if (!isPageSlug(slug)) throw new Error(`"${slug}" is not a page address`);
  const nav = isPlainObject(portable['nav']) ? portable['nav'] : {};
  const icon = typeof nav['icon'] === 'string' ? nav['icon'] : null;
  const navParts = [
    typeof nav['group'] === 'string' ? `group: ${quote(nav['group'])}` : null,
    typeof nav['order'] === 'number' ? `order: ${JSON.stringify(nav['order'])}` : null,
    nav['hidden'] === true ? 'hidden: true' : null,
  ].filter((part): part is string => part !== null);
  return [
    '/**',
    ` * The page at /p/${slug}, ejected from pages/${slug}.json by \`adminium eject\`.`,
    ' *',
    ' * `page` is that file\'s settings, and `GeneratedPage` draws them with the',
    ' * template they name, so the page looks and works as it did. This file is',
    ' * yours now: change the settings, or replace the page with components of',
    ' * your own. Regenerating the database no longer changes this page.',
    ' */',
    "import { GeneratedPage, definePage } from '@adminiumjs/adminium/ui';",
    '',
    `const page = ${objectLiteral(portable)};`,
    '',
    'export default definePage({',
    `  title: ${quote(titleOf(portable, slug))},`,
    ...(icon === null ? [] : [`  icon: ${quote(icon)},`]),
    ...(navParts.length === 0 ? [] : [`  nav: { ${navParts.join(', ')} },`]),
    `  component: function ${componentName(slug)}() {`,
    '    return <GeneratedPage page={page} />;',
    '  },',
    '});',
    '',
  ].join('\n');
}
