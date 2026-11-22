// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A customer screen's search, sort and filter on a public list, judged against
 * what that list's entry in `manifest/access.json` declares.
 *
 * The server takes `q`, `order` and `where` from a page when the entry names
 * them (`searchable`, `orderable`, `filterable`) and refuses the rest with 400
 * PUBLIC_QUERY_REFUSED. So each parameter is read against its own field, and a
 * finding names the exact path to declare.
 *
 * It is a reading of the source. When a call's list cannot be told and one of
 * the lists it may be declares the parameter, nothing is said: telling a model
 * to remove a search that works costs more than missing one that does not.
 */
import { compareSemver, doorKeysOf, SHOPPER_DEFAULT_OPS, SHOPPER_OPS, SHOPPER_SEARCH_MIN, WORD_FLOORS } from '@adminium/manifest';

import { publicEntryRefs } from '../../apps/manifest-public.js';

/** What of a public entry is read here. A draft may hold anything, so nothing is assumed of its shape. */
interface EntryLike {
  table?: unknown;
  key?: unknown;
  kind?: unknown;
  path?: unknown;
  methods?: unknown;
  claim?: unknown;
  claimedBy?: unknown;
  identity?: unknown;
  visibleWith?: unknown;
  level?: unknown;
  unlockBy?: unknown;
  withhold?: unknown;
  searchable?: unknown;
  orderable?: unknown;
  filterable?: unknown;
}

export interface ListQueryManifest {
  compatibility?: { minAdminiumVersion?: unknown } | undefined;
  requiredSchema?: { tables?: readonly { ref: string }[] } | undefined;
  publicAccess?: readonly object[] | undefined;
}

/** A list the customer key reads, with where its entry stands in `publicAccess`. */
interface ServedList {
  index: number;
  ref: string;
  table: string;
  entry: EntryLike;
}

type Field = 'searchable' | 'orderable' | 'filterable';

const PARAMETERS: ReadonlyMap<string, { field: Field; word: 'publicAccess.searchable' | 'publicAccess.orderable' | 'publicAccess.filterable' }> = new Map([
  ['q', { field: 'searchable', word: 'publicAccess.searchable' }],
  ['order', { field: 'orderable', word: 'publicAccess.orderable' }],
  ['where', { field: 'filterable', word: 'publicAccess.filterable' }],
]);

/** Names a model reaches for that the public client does not have: it drops them, and sends nothing. */
const MISNAMED: ReadonlyMap<string, { option: string; shape: string }> = new Map([
  ['filter', { option: 'where', shape: "{ column: 'status', op: 'eq', value: 'open' } (several under { and: [ … ] })" }],
  ['filters', { option: 'where', shape: "{ column: 'status', op: 'eq', value: 'open' } (several under { and: [ … ] })" }],
  ['sort', { option: 'order', shape: "'column.asc' or 'column.desc'" }],
  ['search', { option: 'q', shape: 'the text the person typed' }],
]);

const REFUSED = 'the server answers 400 PUBLIC_QUERY_REFUSED, so customers see an error';

/**
 * The source of a pattern for a call to one of `methods`, up to its opening
 * bracket, with or without a type (`.list<Cake>(`), which may run over lines.
 * No space follows a type's `<`, so `page.list < 3` is not read as a call.
 */
export const callOpening = (methods: string): string => String.raw`\.\s*(?:${methods})\s*(?:<(?![ \t])[^()]*?>)?\s*\(`;

/** The index just past the string opening at `open`, a template's `${…}` included. */
function afterString(text: string, open: number): number {
  const quote = text[open];
  for (let at = open + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === '\\') at += 1;
    else if (char === quote) return at + 1;
    else if (quote === '`' && char === '$' && text[at + 1] === '{') at = afterBracket(text, at + 1) - 1;
  }
  return text.length;
}

/** The index past whatever starts at `at`: a whole string, a whole bracket, or one character. */
function skip(text: string, at: number): number {
  const char = text[at] as string;
  if (char === "'" || char === '"' || char === '`') return afterString(text, at);
  if (char === '(' || char === '[' || char === '{') return afterBracket(text, at);
  return at + 1;
}

/** The index just past the bracket that closes the one at `open`. */
function afterBracket(text: string, open: number): number {
  let at = open + 1;
  while (at < text.length) {
    const char = text[at];
    if (char === ')' || char === ']' || char === '}') return at + 1;
    at = skip(text, at);
  }
  return text.length;
}

/** The parts of `text` between `from` and `to`, split at the commas outside any bracket or string. */
function partsOf(text: string, from: number, to: number): string[] {
  const out: string[] = [];
  let start = from;
  let at = from;
  while (at < to) {
    if (text[at] === ',') {
      out.push(text.slice(start, at));
      at += 1;
      start = at;
    } else {
      at = skip(text, at);
    }
  }
  out.push(text.slice(start, to));
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** The options an object literal sets, those of a spread object (`...(term ? { q: term } : {})`) included. */
function optionsOf(object: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const part of partsOf(object, 1, afterBracket(object, 0) - 1)) {
    if (part.startsWith('...')) {
      let at = 3;
      while (at < part.length) {
        const char = part[at];
        if (char === '{') {
          const end = afterBracket(part, at);
          out.push(...optionsOf(part.slice(at, end)));
          at = end;
        } else if (char === "'" || char === '"' || char === '`') {
          at = afterString(part, at);
        } else {
          at += 1;
        }
      }
      continue;
    }
    const named = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*(?::\s*([\s\S]*))?$/.exec(part);
    if (named !== null) out.push({ name: named[1] as string, value: named[2] ?? '' });
  }
  return out;
}

/** Each `.list(name, { … })` in the source, with what names the list and what it asks. */
function listCalls(text: string): { target: string; options: { name: string; value: string }[] }[] {
  const out: { target: string; options: { name: string; value: string }[] }[] = [];
  for (const found of text.matchAll(new RegExp(callOpening('list'), 'g'))) {
    const open = found.index + found[0].length - 1;
    const args = partsOf(text, open + 1, afterBracket(text, open) - 1);
    if (args.length >= 2 && (args[1] as string).startsWith('{')) out.push({ target: args[0] as string, options: optionsOf(args[1] as string) });
  }
  return out;
}

/** The endpoint a call's first argument names, or null when the source does not say. */
function endpointNamed(target: string, text: string, tables: ReadonlySet<string>, depth = 0): { table: string; ref: string } | null {
  const read = /\btables\s*(?:\?\.)?(?:\[\s*['"`]([a-z][a-z0-9_]*)['"`]\s*\]|\.([a-z][a-z0-9_]*))/.exec(target);
  if (read !== null) {
    const table = (read[1] ?? read[2]) as string;
    const suffix = /_(claimed|verified|unlocked)\b/.exec(target.replace(read[0], ''));
    return { table, ref: suffix === null ? table : `${table}_${suffix[1] as string}` };
  }
  const literal = /^(['"`])([a-z][a-z0-9_]*)\1$/.exec(target);
  if (literal !== null) return { table: literal[2] as string, ref: literal[2] as string };
  if (!/^[A-Za-z_$][\w$]*$/.test(target)) return null;
  if (depth < 2) {
    const held = new RegExp(`\\b(?:const|let)\\s+${target.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`).exec(text);
    if (held !== null) return endpointNamed((held[1] as string).trim(), text, tables, depth + 1);
  }
  return tables.has(target) ? { table: target, ref: target } : null;
}

/** The lists the customer key reads, each with the endpoint name its entry becomes. */
function servedLists(app: ListQueryManifest, entries: readonly EntryLike[]): ServedList[] {
  const floor = app.compatibility?.minAdminiumVersion;
  const doors = doorKeysOf(typeof floor === 'string' ? { compatibility: { minAdminiumVersion: floor } } : {});
  const kept = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => typeof entry.table === 'string' && (entry.path === undefined || typeof entry.path === 'string') && (entry.key === undefined || !doors.includes(entry.key as string)));
  const refs = publicEntryRefs(kept.map(({ entry }) => entry) as unknown as Parameters<typeof publicEntryRefs>[0], {});
  return kept
    .map(({ entry, index }, at) => ({ index, ref: refs[at] as string, table: entry.table as string, entry }))
    .filter(({ entry }) => (entry.key ?? 'customer') === 'customer' && entry.kind !== 'availability' && Array.isArray(entry.methods) && entry.methods.includes('GET'));
}

/**
 * Why an entry may not declare a shopper's list, in the words of the manifest's
 * own rule (`shopperListIssues`), which has the last say; null when it may.
 */
function whyNotDeclarable(entry: EntryLike, entries: readonly EntryLike[]): string | null {
  if (entry.claim !== undefined || entry.claimedBy !== undefined || entry.identity !== undefined || entry.visibleWith !== undefined || entry.level !== undefined) {
    return 'only a list anyone reads with no sign-in may';
  }
  if (!Array.isArray(entry.methods) || entry.methods.length !== 1) return 'only a list whose "methods" is ["GET"] alone may';
  if (entry.unlockBy !== undefined) return 'a list a code opens may not';
  if (entry.withhold !== undefined) return 'a list that withholds columns from some readers may not';
  const holdsPeople = entries.some((other) => {
    const claim = other.claim as { by?: unknown } | undefined;
    return (
      (other.table === entry.table && claim !== undefined && claim.by === undefined) ||
      (other.identity as { table?: unknown } | undefined)?.table === entry.table ||
      (other.claimedBy as { table?: unknown } | undefined)?.table === entry.table
    );
  });
  return holdsPeople ? `"${String(entry.table)}" holds people, and a list of people may not` : null;
}

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');
const filterColumn = (filter: unknown): string => (typeof filter === 'string' ? filter : String((filter as { column?: unknown } | null)?.column));

/** The columns a literal `order` names; a value only known when the page runs names none. */
function orderColumns(value: string): string[] {
  const whole = /^(['"`])([^'"`$]*)\1$/.exec(value.trim());
  const said = whole !== null ? [whole[2] as string] : [...value.matchAll(/['"`]([a-z][a-z0-9_]*\.(?:asc|desc)(?:\s*,\s*[a-z][a-z0-9_]*\.(?:asc|desc))*)['"`]/g)].map((found) => found[1] as string);
  const columns = said.flatMap((order) => order.split(',').map((part) => (part.split('.')[0] ?? '').trim()));
  return [...new Set(columns.filter((column) => column.length > 0))];
}

/** Each `{ column, op }` a literal `where` asks. */
function whereAsks(value: string): { column: string; op: string | null }[] {
  const out: { column: string; op: string | null }[] = [];
  for (const leaf of value.matchAll(/\{[^{}]*\}/g)) {
    const column = /\bcolumn\s*:\s*['"`]([A-Za-z_]\w*)['"`]/.exec(leaf[0]);
    if (column === null) continue;
    out.push({ column: column[1] as string, op: /\bop\s*:\s*['"`](\w+)['"`]/.exec(leaf[0])?.[1] ?? null });
  }
  return out;
}

/** What is wrong with a parameter the entry does declare, or null. */
function declaredIssue(name: string, value: string, list: ServedList): string | null {
  const at = `publicAccess[${String(list.index)}]`;
  const head = `asks the public API for a list with "${name}" on "${list.table}"`;
  if (name === 'order') {
    const allowed = listOf(list.entry.orderable).map(String);
    const outside = orderColumns(value).filter((column) => !allowed.includes(column));
    if (outside.length === 0) return null;
    return `${head}, and ${at}.orderable in manifest/access.json does not list ${quoted(outside)}: ${REFUSED}. Add ${quoted(outside)} to manifest/access.json, at ${at}.orderable (columns of that entry's "select" that are never empty), or order by one it lists: ${quoted(allowed)}.`;
  }
  if (name !== 'where') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && !/^\{\s*(?:\.\.\.|['"]?(?:column|and|or)\b)/.test(trimmed)) {
    return `${head}, and passes it as { column: value }: ${REFUSED}. "where" is a filter tree: { column: 'status', op: 'eq', value: 'open' } (several under { and: [ … ] }).`;
  }
  if (/(?:^|[{,\s])['"]?or['"]?\s*:/.test(value.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''"))) {
    return `${head} using "or": ${REFUSED}. On a public list, conditions are joined by "and" only: make one request per choice, or use { column, op: 'in', value: [ … ] } when ${at}.filterable lets that column take "in".`;
  }
  const declared = listOf(list.entry.filterable);
  const allowed = declared.map(filterColumn);
  const asks = whereAsks(value);
  const outside = [...new Set(asks.map((ask) => ask.column).filter((column) => !allowed.includes(column)))];
  if (outside.length > 0) {
    return `${head}, and ${at}.filterable in manifest/access.json does not list ${quoted(outside)}: ${REFUSED}. Add ${quoted(outside)} to manifest/access.json, at ${at}.filterable (columns of that entry's "select"), or filter by one it lists: ${quoted(allowed)}.`;
  }
  for (const ask of asks) {
    if (ask.op === null) continue;
    const filter = declared.find((candidate) => filterColumn(candidate) === ask.column);
    const ops = typeof filter === 'string' ? SHOPPER_DEFAULT_OPS : listOf((filter as { ops?: unknown } | undefined)?.ops).map(String);
    if (ops.includes(ask.op as never)) continue;
    const fix = (SHOPPER_OPS as readonly string[]).includes(ask.op)
      ? `Write that column in manifest/access.json, at ${at}.filterable, as { "column": "${ask.column}", "ops": [${quoted([...ops, ask.op])}] }, or use an operator it takes.`
      : `A public list never takes "${ask.op}": use one of ${quoted([...SHOPPER_OPS])}.`;
    return `${head}, and ${at}.filterable lets "${ask.column}" take ${quoted([...ops])}, not "${ask.op}": ${REFUSED}. ${fix}`;
  }
  return null;
}

/** What to do to declare a parameter on the entries that may hold it. */
function declareIssue(name: string, value: string, lists: readonly ServedList[], field: Field, floorLine: string): string {
  const columns = name === 'order' ? orderColumns(value) : name === 'where' ? [...new Set(whereAsks(value).map((ask) => ask.column))] : [];
  const example = columns.length > 0 ? `[${quoted(columns)}]` : name === 'q' ? `["<text column from that entry's select>"]` : `["<column from that entry's select>"]`;
  const where = lists.map((list) => (lists.length === 1 ? `publicAccess[${String(list.index)}].${field}` : `publicAccess[${String(list.index)}].${field} (table "${list.table}")`)).join(' or ');
  const on = lists.length === 1 ? `"${(lists[0] as ServedList).table}"` : 'this list';
  const rule =
    name === 'q'
      ? ` Each must be a text column, and a search must be at least ${String(SHOPPER_SEARCH_MIN)} characters, so do not send "q" for fewer.`
      : name === 'order'
        ? ' Each must be a column of that entry\'s "select" that is never empty.'
        : ' Each must be a column of that entry\'s "select".';
  return `asks the public API for a list with "${name}" on ${on}, and its entry does not declare "${field}": ${REFUSED}. To keep it, declare it in manifest/access.json, at ${where}, for example "${field}": ${example}.${rule}${floorLine} Otherwise remove "${name}" from this call and sort or narrow the rows in the page.`;
}

/** The findings of one file of a customer side, already stripped of its comments. */
export function listQueryMessages(text: string, app: ListQueryManifest): string[] {
  const entries = (app.publicAccess ?? []) as readonly EntryLike[];
  const served = servedLists(app, entries);
  const tables = new Set([...(app.requiredSchema?.tables ?? []).map((table) => table.ref), ...entries.flatMap((entry) => (typeof entry.table === 'string' ? [entry.table] : []))]);
  const floor = app.compatibility?.minAdminiumVersion;
  const out = new Set<string>();

  for (const call of listCalls(text)) {
    const named = endpointNamed(call.target, text, tables);
    const exact = named === null ? [] : served.filter((list) => list.ref === named.ref);
    const lists = named === null ? served : exact.length > 0 ? exact : served.filter((list) => list.table === named.table);

    for (const { name, value } of call.options) {
      const misnamed = MISNAMED.get(name);
      if (misnamed !== undefined) {
        out.add(`passes "${name}" to client.list${named === null ? '' : ` for "${named.table}"`}. The public client has no option "${name}" and drops it without an error, so the list comes back as if nothing was asked. The option is "${misnamed.option}": ${misnamed.shape}.`);
        continue;
      }
      const parameter = PARAMETERS.get(name);
      if (parameter === undefined) continue;
      const { field, word } = parameter;

      if (lists.length === 0) {
        const table = named === null ? 'this table' : `"${named.table}"`;
        out.add(`asks the public API for a list with "${name}" on ${table}, and no entry in manifest/access.json, at publicAccess, lets customers read ${table} with "GET": the list answers 404 PUBLIC_REF_NOT_FOUND. Add an entry that reads it; to show a person only their own row, give that entry a "claim" and call client.claim({ … }) first.`);
        continue;
      }
      const declaring = lists.filter((list) => listOf(list.entry[field]).length > 0);
      if (declaring.length > 0) {
        // More than one list it may be, and one takes this: not told, since the screen may well be right.
        if (lists.length > 1) continue;
        const issue = declaredIssue(name, value, declaring[0] as ServedList);
        if (issue !== null) out.add(issue);
        continue;
      }
      const open = lists.filter((list) => whyNotDeclarable(list.entry, entries) === null);
      if (open.length === 0) {
        const list = lists[0] as ServedList;
        const at = `publicAccess[${String(list.index)}]`;
        out.add(`asks the public API for a list with "${name}" on "${list.table}", and ${at} cannot declare "${field}": ${whyNotDeclarable(list.entry, entries) as string}, so ${REFUSED}. Remove "${name}" from this call, then sort or narrow the rows in the page. To keep rows out of the list for everyone, use ${at}.filters in manifest/access.json.`);
        continue;
      }
      const needed = WORD_FLOORS[word] as string;
      const floorLine = typeof floor === 'string' && compareSemver(floor, needed) >= 0 ? '' : ` Also set manifest/app.json, at compatibility.minAdminiumVersion, to "${needed}" or later: a release before it refuses "${field}".`;
      out.add(declareIssue(name, value, open, field, floorLine));
    }
  }
  return [...out];
}
