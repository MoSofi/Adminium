// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Print a side-by-side review sheet: English source, the current translation,
 * and its review status, for one locale and one key prefix.
 *
 * The bundles are nested JSON in two separate files per namespace, which makes
 * reading "English next to German" by hand slow and error-prone. This is the
 * view a translator reviews from; `meta.mjs review` is how they sign it off.
 *
 *   node scripts/review-sheet.mjs --locale de-DE --prefix common.nav
 *   node scripts/review-sheet.mjs --locale ar-EG --prefix errors --status mt
 *
 * `--prefix` is `<namespace>` or `<namespace>.<dotted.key.prefix>`, the same
 * shape `meta.mjs review --ns` takes. `--status` keeps only rows in that state
 * (`mt`, `src`, `reviewed`, `outdated`). Output is a Markdown table, so it can
 * be pasted into an issue or a PR description. Keys are printed in full
 * (`common.nav.home`), the form `meta.mjs review --keys` expects.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const TAGS = ['de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'zh-CN', 'zh-TW', 'ar-EG'];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const tag = flag('locale');
const prefix = flag('prefix');
const onlyStatus = flag('status');
if (tag === undefined || !TAGS.includes(tag) || prefix === undefined) {
  console.error(`usage: review-sheet.mjs --locale <${TAGS.join('|')}> --prefix <ns[.key]> [--status mt|src|reviewed|outdated]`);
  process.exit(2);
}

// Must match meta.mjs, which pins each entry to the English it was made from.
const hash = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12);

function flatten(obj, pre = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = pre === '' ? k : `${pre}.${k}`;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

function load(locale, ns) {
  const file = path.join(root, 'locales', locale, `${ns}.json`);
  if (!fs.existsSync(file)) return {};
  return flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const ns = prefix.split('.')[0];
const rest = prefix.slice(ns.length + 1);
const en = load('en-US', ns);
const target = load(tag, ns);
const metaFile = path.join(root, 'locales', tag, '.meta.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};

// Keep newlines and pipes from breaking the table.
const cell = (s) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');

const rows = [];
for (const [key, source] of Object.entries(en)) {
  if (rest !== '' && key !== rest && !key.startsWith(`${rest}.`)) continue;
  const entry = meta[`${ns}.${key}`];
  let status = entry?.status ?? 'untracked';
  // Staleness is derived, never stored: the English moved under the translation.
  if (entry !== undefined && entry.srcHash !== hash(source)) status = 'outdated';
  if (onlyStatus !== undefined && status !== onlyStatus) continue;
  rows.push(`| \`${ns}.${key}\` | ${cell(source)} | ${cell(target[key] ?? '*(missing)*')} | ${status} |`);
}

console.log(`**${tag}** · \`${prefix}\` · ${rows.length} key(s)\n`);
console.log('| Key | English | Translation | Status |');
console.log('|---|---|---|---|');
for (const row of rows) console.log(row);
