// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a side's own code asks of Adminium that Adminium will refuse, read
 * from the source before a person meets it on the page.
 *
 * A screen builds whatever it calls: the build knows nothing of what the
 * public API takes. So a customer page that sorts or filters a list from
 * the browser, names a table by its short name, or reads a person's own row
 * without claiming it first, builds, opens, and then says "That did not work"
 * to every customer. These are found by reading the source for the call's
 * shape. It is a reading, not a proof: each finding says what it saw, and a
 * screen that does something cleverer is not refused, only told.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appDir, appPath, type AppSide } from './read-app.js';

export interface SideCallIssue {
  side: AppSide;
  /** The file, relative to the project. */
  file: string;
  message: string;
}

/** What of a manifest these checks read. */
interface ManifestLike {
  requiredSchema?: { tables?: { ref: string }[] } | undefined;
  publicAccess?: { table?: string; claim?: unknown; kind?: string }[] | undefined;
}

/** The source files of a side, a few dozen at most, with their paths. */
function sources(root: string, key: string, side: AppSide): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (folder: string, rel: string): void => {
    if (!existsSync(folder) || out.length >= 60) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(join(folder, entry.name), `${rel}/${entry.name}`);
      else if (entry.isFile() && /\.(tsx?|jsx?|mjs)$/.test(entry.name) && out.length < 60) out.push({ file: appPath(key, side, `${rel}/${entry.name}`.replace(/^\//, '')), text: readFileSync(join(folder, entry.name), 'utf8') });
    }
  };
  walk(join(appDir(root, key), side, 'src'), 'src');
  return out;
}

/** Source with its comments blanked, so a call quoted in a comment is not read as a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (found) => found.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (found, lead: string) => lead + ' '.repeat(found.length - lead.length));
}

/** A caller's sort, filter or search in the options of a `.list(...)`. */
const LIST_WITH_QUERY = /\.list\(\s*[^,()]+,\s*\{[^{}]*?\b(order|where|q|filter|filters|sort|search)\s*[:,}]/;
/** A table named by a string where the endpoint's own name goes. */
const LITERAL_TABLE = /\.(list|create|get|update|remove)\(\s*(['"`])([a-z][a-z0-9_]*)\2/g;
/** `where` given as a plain object of column: value. */
const WHERE_AS_OBJECT = /\bwhere\s*:\s*\{\s*(?!column\b|and\b|or\b|not\b|['"`]?(?:column|and|or|not)['"`]?\s*:)[A-Za-z_'"`[]/;

export function sideCallIssues(root: string, key: string, manifest: unknown): SideCallIssue[] {
  const app = (manifest ?? {}) as ManifestLike;
  const tables = new Set((app.requiredSchema?.tables ?? []).map((table) => table.ref));
  const claimed = [...new Set((app.publicAccess ?? []).filter((entry) => entry.claim !== undefined && typeof entry.table === 'string').map((entry) => entry.table as string))];
  const out: SideCallIssue[] = [];

  const customer = sources(root, key, 'customer').map((source) => ({ ...source, text: code(source.text) }));
  for (const { file, text } of customer) {
    const query = LIST_WITH_QUERY.exec(text);
    if (query !== null) {
      out.push({
        side: 'customer',
        file,
        message: `asks the public API for a list with "${query[1] as string}". A public list takes only limit, offset and cursor from the page, and refuses this with 400 PUBLIC_QUERY_REFUSED, so customers see an error. Read the list and sort or narrow it in the page; keep rows out of it with "filters" in access.json; and to show a person only their own row, give the entry a "claim" and call client.claim({ … }) first.`,
      });
    }
    const named = new Set<string>();
    for (const found of text.matchAll(LITERAL_TABLE)) if (tables.has(found[3] as string)) named.add(found[3] as string);
    if (named.size > 0) {
      const one = [...named][0] as string;
      out.push({
        side: 'customer',
        file,
        message: `calls the public client with the table's short name (${[...named].map((name) => `"${name}"`).join(', ')}). A public endpoint goes by another name on each install: use config.tables['${one}'] ?? '${one}', as the starter screen does, or the call finds nothing.`,
      });
    }
  }
  const GUIDE = 'adminium-app/references/guides/manifest-by-task--let-a-customer-find-their-own-row.md';
  for (const { file, text } of customer) {
    if (/\.claim\(\s*['"`]/.test(text)) {
      out.push({ side: 'customer', file, message: 'calls client.claim with a name first. It takes one object, the details the person typed: client.claim({ code, customer_email }), and answers true or false.' });
    }
    // Written out in full: a name built from config.tables (a template with a value in it) is the right way.
    if (/\.(list|get)\(\s*(?:'[^']*claimed[^']*'|"[^"]*claimed[^"]*"|`[^`$]*claimed[^`$]*`)/.test(text)) {
      out.push({
        side: 'customer',
        file,
        message: "reads a claimed endpoint by a name written out. Its name is the table's own endpoint name with _claimed after it: `${config.tables['orders'] ?? 'orders'}_claimed` (for a table \"orders\").",
      });
    }
  }
  if (customer.length > 0 && claimed.length === 0 && customer.some((source) => /\.claim\(/.test(source.text))) {
    out.push({
      side: 'customer',
      file: appPath(key, 'customer', 'src'),
      message: `calls client.claim(…), and access.json has no entry with a "claim": there is nothing to claim, so it always fails. Add an entry { "table", "methods": ["GET"], "select": […], "claim": { "match": ["code", "email column"] } } beside the one that lets people add a row. The whole recipe is in ${GUIDE}.`,
    });
  }
  if (customer.length > 0 && claimed.length > 0) {
    const all = customer.map((source) => source.text).join('\n');
    const where = appPath(key, 'customer', 'src');
    if (!/\.claim\(/.test(all)) {
      out.push({
        side: 'customer',
        file: where,
        message: `access.json lets a person reach their own row of ${claimed.map((table) => `"${table}"`).join(', ')} by a claim, and the screen never calls client.claim({ … }) with the details they type. Until it does, their row answers 404.`,
      });
    } else if (!/_claimed\b|_verified\b/.test(all)) {
      const one = claimed[0] as string;
      out.push({
        side: 'customer',
        file: where,
        message: `claims a row of "${one}" and never reads it: after client.claim(…) answers true, the person's own row is listed from the claimed endpoint, \`\${config.tables['${one}'] ?? '${one}'}_claimed\`.`,
      });
    }
  }

  for (const { file, text } of sources(root, key, 'staff').map((source) => ({ ...source, text: code(source.text) }))) {
    if (WHERE_AS_OBJECT.test(text)) {
      out.push({
        side: 'staff',
        file,
        message: 'passes "where" as { column: value }. It is a filter tree: { column: \'status\', op: \'eq\', value: \'open\' } (several under { and: [ … ] }). As written the list is refused, and the screen shows an error.',
      });
    }
  }
  return out;
}

/** The issues as lines for whoever fixes them. */
export const sideCallLines = (issues: readonly SideCallIssue[]): string[] => issues.map((issue) => `- ${issue.file} ${issue.message}`);
