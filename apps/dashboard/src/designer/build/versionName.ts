// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A version's name in the person's language, where its shape is one the
 * server gives it itself. The names are kept in English, with the number in
 * front ("v14 · Your edit to Menu.tsx"); a name of any other shape, one the
 * Designer wrote, is shown as it is kept.
 */
import { t } from '../../i18n/t.js';

/** The name's own part, after its number: "Cart and pickup" of "v3 · Cart and pickup". Null when it is the number alone. */
export function versionLabel(name: string): string | null {
  const rest = name.replace(/^v\d+\s*·\s*/, '');
  if (rest === '' || /^v\d+$/.test(rest)) return null;
  const many = /^Your edit to (\d+) files$/.exec(rest);
  if (many !== null) return t('designer:versions.yourEdits', 'Your edit to {count} files', { count: Number(many[1]) });
  const one = /^Your edit to (.+)$/.exec(rest);
  if (one !== null) return t('designer:versions.yourEdit', 'Your edit to {file}', { file: one[1] ?? '' });
  const back = /^Back to (v\d+)$/.exec(rest);
  if (back !== null) return t('designer:versions.backTo', 'Back to {version}', { version: back[1] ?? '' });
  return rest;
}

/** The whole name, worded: its number, then its own part when it has one. */
export function versionName(name: string): string {
  const number = /^v\d+/.exec(name)?.[0];
  const label = versionLabel(name);
  if (number === undefined) return label ?? name;
  return label === null ? number : `${number} · ${label}`;
}
