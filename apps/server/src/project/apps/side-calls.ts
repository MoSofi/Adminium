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
  requiredSchema?: { tables?: { ref: string; columns?: { ref?: string; role?: string }[] }[] } | undefined;
  publicAccess?: { table?: string; claim?: unknown; kind?: string; select?: unknown; pictures?: unknown; methods?: unknown }[] | undefined;
}

/** How a customer screen shows a picture a table keeps, said the same way in every finding. */
const HOW_PICTURES =
  "A picture column holds the staff's own address of the file (…/api/v1/files/file_…/content), which only a signed-in member of staff may open: a visitor gets a broken image. The address anyone may open is built from it: `import { createPublicClient, pictureUrl } from '@adminiumjs/public-client'`, then once, `const shown = await client.config()` (the PUBLIC client's config: it says where pictures are), and for each row `pictureUrl(loaded.value.baseUrl, shown, table, row.id, '<column>', row.<column>)`, where `table` is the name the row was listed by (`loaded.value.tables['<table>'] ?? '<table>'`) and `loaded` is what useCustomer() gave. It answers null when the row has no picture: show the page's own tile then.";

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
export function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (found) => found.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (found, lead: string) => lead + ' '.repeat(found.length - lead.length));
}

/** A caller's sort, filter or search in the options of a `.list(...)`. */
const LIST_WITH_QUERY = /\.list\(\s*[^,()]+,\s*\{[^{}]*?\b(order|where|q|filter|filters|sort|search)\s*[:,}]/;
/** A table named by a string where the endpoint's own name goes. */
const LITERAL_TABLE = /\.(list|create|get|update|remove)\(\s*(['"`])([a-z][a-z0-9_]*)\2/g;
/** `where` given as a plain object of column: value. */
const WHERE_AS_OBJECT = /\bwhere\s*:\s*\{\s*(?!column\b|and\b|or\b|not\b|['"`]?(?:column|and|or|not)['"`]?\s*:)[A-Za-z_'"`[]/;

/** Where a customer screen's table names are: said the same way in every finding, since "config.tables" alone was read as the client's config. */
const WHERE_TABLES =
  "The table names are in the CUSTOMER config, which the page gets from useCustomer(): `const loaded = useCustomer()`, then, once `loaded.state === 'ready'`, `loaded.value.tables['<table>'] ?? '<table>'` (the starter passes `loaded.value` to its screen as the prop `config`, so there it reads `config.tables[…]`). Never from `client.config()`.";

/** A component: a function whose name starts with a capital, declared at the start of a line. */
const COMPONENT = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Z]\w*)\s*\(|^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>\s*\{/;
/** A hook called: `useState(`, `React.useEffect(`, a hook of the app's own. */
const HOOK_CALL = /(?:^|[^\w.$])(?:React\.)?(use[A-Z]\w*)\s*(?:<[^>()]*>)?\s*\(/;

/**
 * Hooks called after a component may already have returned.
 *
 * `if (loading) return <p>…</p>;` and then `useEffect(…)` below it builds,
 * and stops the screen the moment the first return is passed: "Rendered more
 * hooks than during the previous render". A person meets that as a blank
 * page. Read line by line, at the depth of the component's own body: a
 * return inside a nested function or a callback is not one of the
 * component's, and is not counted.
 */
export function hooksAfterReturn(text: string): { component: string; hook: string; line: number; returnedAt: number }[] {
  const out: { component: string; hook: string; line: number; returnedAt: number }[] = [];
  // Strings and template text hold braces and words that are not code.
  const lines = text.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (found) => found[0] + ' '.repeat(Math.max(0, found.length - 2)) + found[0]).split('\n');
  let component: string | null = null;
  let depth = 0;
  /** The line of the first return the component's own body may take early; 0 while there is none. */
  let returnedAt = 0;
  /** An `if (…) {` opened at the body's own depth: a return directly inside it is an early one. */
  let ifBlock = false;
  let told = false;
  for (const [index, line] of lines.entries()) {
    if (component === null) {
      const found = COMPONENT.exec(line);
      if (found === null) continue;
      component = (found[1] ?? found[2]) as string;
      depth = 0;
      returnedAt = 0;
      ifBlock = false;
      told = false;
    } else if (depth === 1) {
      if (returnedAt !== 0 && !told) {
        const hook = HOOK_CALL.exec(line);
        if (hook !== null) {
          out.push({ component, hook: hook[1] as string, line: index + 1, returnedAt });
          told = true;
        }
      }
      if (/^\s*if\s*\(.*\)\s*return\b/.test(line) && returnedAt === 0) returnedAt = index + 1;
      ifBlock = /^\s*(?:\}\s*else\s+)?if\s*\(/.test(line) && /\{\s*$/.test(line);
    } else if (depth === 2 && ifBlock && returnedAt === 0 && /^\s*return\b/.test(line)) {
      returnedAt = index + 1;
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    if (component !== null && depth <= 0 && line.includes('}')) component = null;
  }
  return out;
}

export function sideCallIssues(root: string, key: string, manifest: unknown): SideCallIssue[] {
  const app = (manifest ?? {}) as ManifestLike;
  const tables = new Set((app.requiredSchema?.tables ?? []).map((table) => table.ref));
  const claimed = [...new Set((app.publicAccess ?? []).filter((entry) => entry.claim !== undefined && typeof entry.table === 'string').map((entry) => entry.table as string))];
  const out: SideCallIssue[] = [];

  const customer = sources(root, key, 'customer').map((source) => ({ ...source, text: code(source.text) }));
  // Customers may read a table, and no screen reads anything at all: the page shows none of what it was made to show.
  const read = (app.publicAccess ?? []).filter((entry) => typeof entry.table === 'string' && entry.claim === undefined && Array.isArray(entry.methods) && entry.methods.includes('GET')).map((entry) => entry.table as string);
  const screens = customer.filter((source) => /\.(tsx|jsx)$/.test(source.file));
  if (read.length > 0 && screens.length > 0 && !customer.some((source) => /\.\s*(?:list|get)\s*\(|\bfetch\s*\(/.test(source.text))) {
    const first = read[0] as string;
    out.push({
      side: 'customer',
      file: (screens.find((source) => /App\.(tsx|jsx)$/.test(source.file)) ?? (screens[0] as { file: string })).file,
      message: `never reads "${first}", which customers are let read (access.json): no screen calls the public client's list, so the page shows none of them. Read them once the customer config is loaded, in a useEffect: const { data } = await client.list(loaded.value.tables['${first}'] ?? '${first}', { limit: 50 }); keep them in state and show each row. A customer config has no rows of its own.`,
    });
  }
  for (const { file, text } of customer) {
    // The public client made anew at every render and named in an effect's list: the effect runs after every render, for ever.
    // Inside a component (indented): one made at the top of a file is made once.
    for (const made of text.matchAll(/^[ \t]+(?:const|let)\s+(\w+)\s*=\s*createPublicClient\s*\(/gm)) {
      const name = made[1] as string;
      if (!new RegExp(`\\},\\s*\\[[^\\]]*\\b${name}\\b[^\\]]*\\]\\s*\\)`).test(text)) continue;
      out.push({
        side: 'customer',
        file,
        message: `makes the public client at every render (const ${name} = createPublicClient(…)) and names "${name}" in a useEffect's list. A new client is a new value each time, so the effect runs again after every render: the page asks for the same rows without end, the server answers 429 "Too many requests", and the list stays empty. Make it once: const ${name} = useMemo(() => createPublicClient(loaded.value), [loaded.value]); or make it inside the effect and name only loaded.state in the list.`,
      });
      break;
    }
    const query = LIST_WITH_QUERY.exec(text);
    if (query !== null) {
      out.push({
        side: 'customer',
        file,
        message: `asks the public API for a list with "${query[1] as string}". A public list takes only limit, offset and cursor from the page, and refuses this with 400 PUBLIC_QUERY_REFUSED, so customers see an error. Read the list and sort or narrow it in the page; keep rows out of it with "filters" in access.json; and to show a person only their own row, give the entry a "claim" and call client.claim({ … }) first.`,
      });
    }
    // `tables` read from the public client's own config: it has none (the table names are in the customer config), so the
    // read throws inside the load, the list stays empty, and the page says nothing.
    const fromClient = /\b(?:const|let)\s+(\w+)\s*=\s*await\s+\w+\.config\(\s*\)/.exec(text);
    const direct = /\.config\(\s*\)\s*\)?\s*\??\.\s*tables\b/.test(text);
    if (direct || (fromClient !== null && new RegExp(`\\b${fromClient[1] as string}\\??\\.tables\\b`).test(text))) {
      out.push({
        side: 'customer',
        file,
        message: `reads "tables" from client.config(). The public client's config has no "tables" (and client.config() is a promise): that read throws, and the page stops or the list it was for stays empty. ${WHERE_TABLES}`,
      });
    }
    const named = new Set<string>();
    for (const found of text.matchAll(LITERAL_TABLE)) if (tables.has(found[3] as string)) named.add(found[3] as string);
    if (named.size > 0) {
      const one = [...named][0] as string;
      out.push({
        side: 'customer',
        file,
        message: `calls the public client with the table's short name (${[...named].map((name) => `"${name}"`).join(', ')}). A public endpoint goes by another name on each install, so the call finds nothing: \`loaded.value.tables['${one}'] ?? '${one}'\`. ${WHERE_TABLES}`,
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
        message: `reads a claimed endpoint by a name written out. Its name is the table's own endpoint name with _claimed after it: \`\${loaded.value.tables['orders'] ?? 'orders'}_claimed\` (for a table "orders"). ${WHERE_TABLES}`,
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
        message: `claims a row of "${one}" and never reads it: after client.claim(…) answers true, the person's own row is listed from the claimed endpoint, \`\${loaded.value.tables['${one}'] ?? '${one}'}_claimed\`. ${WHERE_TABLES}`,
      });
    }
  }

  // A picture a table keeps, shown to visitors: the address is built, never the column's own value.
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
  for (const entry of app.publicAccess ?? []) {
    const pictures = strings(entry.pictures);
    if (pictures.length === 0 || typeof entry.table !== 'string') continue;
    const table = entry.table;
    const pk = (app.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === table)?.columns?.find((column) => column.role === 'pk')?.ref ?? 'id';
    if (!strings(entry.select).includes(pk)) {
      out.push({
        side: 'customer',
        file: appPath(key, 'manifest', 'access.json'),
        message: `shows pictures of "${table}" (${pictures.map((name) => `"${name}"`).join(', ')}) and its "select" leaves out "${pk}". A picture's address is made from its row's "${pk}", so no picture of this table can be shown: add "${pk}" to that entry's "select".`,
      });
    }
    const reads = customer.filter(({ text }) => pictures.some((name) => new RegExp(`(?:\\.|\\[['"\`])${name}\\b`).test(text)));
    if (reads.length > 0 && !customer.some(({ text }) => /\bpictureUrl\s*\(/.test(text))) {
      out.push({
        side: 'customer',
        file: (reads[0] as { file: string }).file,
        message: `reads the picture column ${pictures.map((name) => `"${name}"`).join(', ')} of "${table}" and never calls pictureUrl: the column's own value in an <img> is a broken image for every visitor. ${HOW_PICTURES}`,
      });
    }
  }

  // pictureUrl with too few arguments answers null for every row: the page builds, and no picture ever shows.
  for (const { file, text } of customer) {
    for (const call of text.matchAll(/\bpictureUrl\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      const given = (call[1] as string).split(',').filter((part) => part.trim() !== '').length;
      if (given >= 6 || /^\s*\.\.\./.test(call[1] as string)) continue;
      out.push({
        side: 'customer',
        file,
        message: `calls pictureUrl with ${String(given)} argument${given === 1 ? '' : 's'}, and it takes six: no picture will show. ${HOW_PICTURES}`,
      });
      break;
    }
  }

  // A screen that stops as it opens, on either side.
  for (const side of ['customer', 'staff'] as const) {
    for (const { file, text } of sources(root, key, side).filter((source) => /\.[jt]sx$/.test(source.file))) {
      for (const found of hooksAfterReturn(code(text))) {
        out.push({
          side,
          file,
          message: `line ${String(found.line)}: "${found.component}" calls ${found.hook} after it may already have returned (line ${String(found.returnedAt)}). React stops the whole screen there ("Rendered more hooks than during the previous render"), and the person sees an error instead of the page. Move every hook (useState, useEffect, the app's own) above the first return of "${found.component}".`,
        });
      }
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
