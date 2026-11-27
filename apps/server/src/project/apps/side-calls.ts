// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a side's own code asks of Adminium that Adminium will refuse, read
 * from the source before a person meets it on the page.
 *
 * A screen builds whatever it calls: the build knows nothing of what the
 * public API takes. So a customer page that sorts or filters a list its
 * entry does not declare, names a table by its short name, or reads a person's own row
 * without claiming it first, builds, opens, and then says "That did not work"
 * to every customer. These are found by reading the source for the call's
 * shape. It is a reading, not a proof: each finding says what it saw, and a
 * screen that does something cleverer is not refused, only told.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appDir, appPath, type AppSide } from './read-app.js';
import { afterBracket, callOpening, listQueryMessages, partsOf } from './side-list-queries.js';

export interface SideCallIssue {
  side: AppSide;
  /** The file, relative to the project. */
  file: string;
  message: string;
}

/** What of a manifest these checks read. */
interface ManifestLike {
  compatibility?: { minAdminiumVersion?: unknown } | undefined;
  requiredSchema?: { tables?: { ref: string; columns?: { ref?: string; role?: string }[] }[] } | undefined;
  publicAccess?: { table?: string; claim?: unknown; kind?: string; select?: unknown; pictures?: unknown; methods?: unknown; children?: unknown; expect?: unknown }[] | undefined;
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

/** A table named by a string where the endpoint's own name goes. */
const LITERAL_TABLE = new RegExp(`${callOpening('list|create|get|update|remove')}${/\s*(?<quote>['"`])(?<name>[a-z][a-z0-9_]*)\k<quote>/.source}`, 'g');
/** A call whose first argument is one bare name: `client.create(ORDERS, …)`. What the name holds is looked up. */
const HELD_TABLE = new RegExp(`${callOpening('list|create|createTree|createWithRank|quote|get|update|remove')}${/\s*(?<name>[A-Za-z_$][\w$]*)\s*[,)]/.source}`, 'g');
/** A claimed endpoint's name written out: one built from config.tables (a template with a value in it) is the right way. */
const CLAIMED_WRITTEN_OUT = new RegExp(`${callOpening('list|get')}${/\s*(?:'[^']*claimed[^']*'|"[^"]*claimed[^"]*"|`[^`$]*claimed[^`$]*`)/.source}`);
/** Any read a screen makes: the public client's, typed or not, or its own fetch. */
const ANY_READ = new RegExp(`${callOpening('list|get')}|\\bfetch\\s*\\(`);
/** `where` given as a plain object of column: value. */
const WHERE_AS_OBJECT = /\bwhere\s*:\s*\{\s*(?!column\b|and\b|or\b|not\b|['"`]?(?:column|and|or|not)['"`]?\s*:)[A-Za-z_'"`[]/;

/** Where a customer screen's table names are: said the same way in every finding, since "config.tables" alone was read as the client's config. */
const WHERE_TABLES =
  "The table names are in the CUSTOMER config, which the page gets from useCustomer(): `const loaded = useCustomer()`, then, once `loaded.state === 'ready'`, `loaded.value.tables['<table>'] ?? '<table>'` (the starter passes `loaded.value` to its screen as the prop `config`, so there it reads `config.tables[…]`). Never from `client.config()`.";

/** A create a customer page makes one row at a time: `create` and `createWithRank` send the row's own values and nothing below it. */
const BARE_CREATE = new RegExp(callOpening('create|createWithRank'), 'g');

/** What a name is set to where it is declared (`const orders = …`), or null. */
const heldAs = (name: string, text: string): string | null => new RegExp(`\\b(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+)`).exec(text)?.[1]?.trim() ?? null;

/**
 * The table a create's first argument names, as the starter and the guides write it: a name in quotes, `tables['orders']`,
 * `tables[ORDERS]` with ORDERS a name in quotes, or a name held as one of these. Null when the source does not say (a prop).
 */
export function createdTable(target: string, text: string, depth = 0): string | null {
  const read = /\btables\s*(?:\?\.)?(?:\[\s*(?:['"`]([a-z][a-z0-9_]*)['"`]|([A-Za-z_$][\w$]*))\s*\]|\.([a-z][a-z0-9_]*))/.exec(target);
  if (read !== null) {
    if (read[1] !== undefined || read[3] !== undefined) return (read[1] ?? read[3]) as string;
    const held = depth < 3 ? heldAs(read[2] as string, text) : null;
    return held === null ? null : (/^(['"`])([a-z][a-z0-9_]*)\1/.exec(held)?.[2] ?? null);
  }
  const literal = /^(['"`])([a-z][a-z0-9_]*)\1$/.exec(target.trim());
  if (literal !== null) return literal[2] as string;
  if (depth >= 3 || !/^[A-Za-z_$][\w$]*$/.test(target.trim())) return null;
  const held = heldAs(target.trim(), text);
  return held === null ? null : createdTable(held, text, depth + 1);
}

/** The public creates that must come with rows below them: an order with at least one line. */
function entriesNeedingChildren(app: ManifestLike): { table: string; child: string; min: number; writable: string[]; expects: boolean }[] {
  const out: { table: string; child: string; min: number; writable: string[]; expects: boolean }[] = [];
  for (const entry of app.publicAccess ?? []) {
    if (typeof entry.table !== 'string' || !Array.isArray(entry.methods) || !entry.methods.includes('POST')) continue;
    if (entry.children === null || typeof entry.children !== 'object' || Array.isArray(entry.children)) continue;
    for (const [child, shape] of Object.entries(entry.children as Record<string, { min?: unknown; writable?: unknown } | null>)) {
      const min = shape?.min;
      if (typeof min !== 'number' || min < 1) continue;
      const writable = Array.isArray(shape?.writable) ? shape.writable.filter((column): column is string => typeof column === 'string') : [];
      out.push({ table: entry.table, child, min, writable, expects: entry.expect !== undefined });
      break;
    }
  }
  return out;
}

/**
 * A row made with `create` where access.json asks for rows below it with every one (an order and its lines, `min: 1`):
 * `create` sends the row alone, so the server refuses each one (`PUBLIC_WRITE_REFUSED`, "too-few") and the shop's
 * checkout can never succeed, while check, build and the look at the page all pass. Seen 2026-11-26.
 * Found by the table the call names; or, when it names none this can read, by the child's name among what it sends.
 */
export function createsWithoutChildren(text: string, app: ManifestLike): { table: string; child: string; min: number; writable: string[]; expects: boolean }[] {
  const needing = entriesNeedingChildren(app);
  if (needing.length === 0) return [];
  const found = new Map<string, (typeof needing)[number]>();
  for (const call of text.matchAll(BARE_CREATE)) {
    const open = call.index + call[0].length - 1;
    const args = partsOf(text, open + 1, afterBracket(text, open) - 1);
    if (args.length === 0) continue;
    const table = createdTable(args[0] as string, text);
    const byTable = table === null ? undefined : needing.find((entry) => entry.table === table);
    // Not said by the first argument: the values sent name the child themselves (`order_lines: [...]`).
    const byChild = table !== null || args[1] === undefined ? undefined : needing.find((entry) => new RegExp(`(?:^|[{,\\s])['"]?${entry.child}['"]?\\s*:`).test(args[1] as string));
    const entry = byTable ?? byChild;
    if (entry !== undefined) found.set(entry.table, entry);
  }
  return [...found.values()];
}

/** Calls that run a callback later, when the handler that made them has long returned. */
const LATER = /(?:\.\s*(?:then|catch|finally)|\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask|requestIdleCallback)|\bset[A-Z][\w$]*)\s*\(\s*(?:async\s*)?$/;

/** Source with what is inside its quotes blanked, so a word in a sentence is never read as code. Lengths are kept. */
function unquoted(text: string): string {
  return text.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (found) => found[0] + ' '.repeat(found.length - 2) + found[0]);
}

/** The index of the bracket that closes the one at `open` (`{`, `(` or `[`), or -1. */
function closes(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const mark = text[at];
    if (mark === '{' || mark === '(' || mark === '[') depth += 1;
    else if (mark === '}' || mark === ')' || mark === ']') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

interface FunctionSpan {
  /** Where its head starts, and where its body starts and ends. */
  head: number;
  from: number;
  to: number;
  params: string;
}

/** Every function in a source: `function f(a) {…}`, a method, `(a) => {…}`, `a => …` and an arrow whose body is one expression. */
function functionsIn(text: string): FunctionSpan[] {
  const out: FunctionSpan[] = [];
  // function f(…) {…}  and  name(…) {…}  (never if/for/while/switch/catch, which only look like one).
  for (const found of text.matchAll(/(?:\bfunction\b\s*\*?\s*[\w$]*|\b(?!(?:if|for|while|switch|catch|return|await|typeof|function)\b)[\w$]+)\s*(?:<[^<>()]*>)?\s*\(/g)) {
    const open = found.index + found[0].length - 1;
    const close = closes(text, open);
    if (close < 0) continue;
    const after = /^\s*(?::[^{};=]{1,200})?\s*\{/.exec(text.slice(close + 1, close + 260));
    if (after === null) continue;
    const from = close + 1 + after[0].length - 1;
    const to = closes(text, from);
    if (to > from) out.push({ head: found.index, from, to, params: text.slice(open + 1, close) });
  }
  // Arrows: `(a, b) => …` and `a => …`.
  for (const found of text.matchAll(/=>/g)) {
    let at = found.index - 1;
    while (at >= 0 && /\s/.test(text[at] as string)) at -= 1;
    let head: number;
    let params: string;
    if (text[at] === ')') {
      // Back to its opening bracket (a return type between is passed over by the caller's own `)`).
      let depth = 0;
      let open = at;
      for (; open >= 0; open -= 1) {
        if (text[open] === ')') depth += 1;
        else if (text[open] === '(') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (open < 0) continue;
      head = open;
      params = text.slice(open + 1, at);
    } else {
      const name = /[\w$]+$/.exec(text.slice(Math.max(0, at - 60), at + 1));
      if (name === null) continue;
      head = at + 1 - name[0].length;
      params = name[0];
    }
    let from = found.index + 2;
    while (from < text.length && /\s/.test(text[from] as string)) from += 1;
    if (text[from] === '{') {
      const to = closes(text, from);
      if (to > from) out.push({ head, from, to, params });
      continue;
    }
    // One expression: up to the comma, semicolon or closing bracket that ends it.
    let to = from;
    for (; to < text.length; to += 1) {
      const mark = text[to] as string;
      if (mark === '(' || mark === '[' || mark === '{') {
        const end = closes(text, to);
        if (end < 0) break;
        to = end;
      } else if (mark === ')' || mark === ']' || mark === '}' || mark === ',' || mark === ';') break;
    }
    out.push({ head, from: from - 1, to, params });
  }
  return out;
}

/**
 * An event's `currentTarget` read after the handler has let go: after an `await` whose statement has ended, or
 * inside a callback that runs later (`.then(…)`, a timer, a state updater). React clears `currentTarget` when the
 * handler returns, so the read is null, the line throws, and a send that worked is told to the visitor as one that
 * failed ("Something went wrong", and the message was saved: seen 2026-11-26). The event's name, or null.
 * `await send(new FormData(event.currentTarget))` is read before the wait, and is fine.
 */
export function currentTargetAfterAwait(source: string): string | null {
  const text = unquoted(code(source));
  const functions = functionsIn(text);
  const declares = (span: FunctionSpan, name: string): boolean => new RegExp(`(?:^|[\\s,({])${name.replace(/\$/g, '\\$')}\\s*(?:[:,=)]|$)`).test(span.params);
  for (const use of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*currentTarget\b/g)) {
    const name = use[1] as string;
    const at = use.index;
    const around = functions.filter((span) => span.from < at && at < span.to).sort((a, b) => b.from - a.from);
    const ownerAt = around.findIndex((span) => declares(span, name));
    if (ownerAt < 0) continue;
    const owner = around[ownerAt] as FunctionSpan;
    // The functions between the read and the handler that was given the event, the outermost first.
    const between = around.slice(0, ownerAt).reverse();
    if (between.some((span) => LATER.test(text.slice(owner.from, span.head)))) return name;
    // Where the handler itself reaches the read: the read, or the start of the function that holds it.
    const reached = between[0]?.head ?? at;
    const inner = functions.filter((span) => span.from > owner.from && span.to <= owner.to && span !== owner);
    for (const wait of text.slice(owner.from, reached).matchAll(/\bawait\b/g)) {
      const from = owner.from + wait.index;
      // An await of a function inside the handler is that function's own wait.
      if (inner.some((span) => span.from < from && from < span.to)) continue;
      // Its statement has ended before the read: a `;` at its own depth, or the block it stands in has closed.
      let depth = 0;
      for (let k = from; k < reached; k += 1) {
        const mark = text[k] as string;
        if (mark === '(' || mark === '[' || mark === '{') depth += 1;
        else if (mark === ')' || mark === ']' || mark === '}') depth -= 1;
        if ((mark === ';' && depth <= 0) || depth < 0) return name;
      }
    }
  }
  return null;
}

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

/** What a create without its rows below it is told, the same way each time. */
function createWithoutChildrenMessage(entry: { table: string; child: string; min: number; writable: string[]; expects: boolean }): string {
  const row = entry.writable.length === 0 ? '{ … }' : `{ ${entry.writable.slice(0, 4).join(', ')} }`;
  return (
    `makes a row of "${entry.table}" with client.create, and access.json asks for at least ${String(entry.min)} row${entry.min === 1 ? '' : 's'} of "${entry.child}" with each one. ` +
    `create sends the row alone, so the server refuses every one (PUBLIC_WRITE_REFUSED, "too-few") and nothing is ever saved. ` +
    `Send the row and its ${entry.child} in one write: client.createTree(ref, { values: { … }, children: { ${entry.child}: [{ values: ${row} }] }${entry.expects ? ', expect: { total } (the total from client.quote(ref, { values, children }) first)' : ''} }), with ref the same endpoint name the create was given. The values it sends for "${entry.table}" never hold the ${entry.child}.`
  );
}

export function sideCallIssues(root: string, key: string, manifest: unknown): SideCallIssue[] {
  const app = (manifest ?? {}) as ManifestLike;
  const tables = new Set((app.requiredSchema?.tables ?? []).map((table) => table.ref));
  const claimed = [...new Set((app.publicAccess ?? []).filter((entry) => entry.claim !== undefined && typeof entry.table === 'string').map((entry) => entry.table as string))];
  const out: SideCallIssue[] = [];

  const customer = sources(root, key, 'customer').map((source) => ({ ...source, text: code(source.text) }));
  // Names the side sets to a table's short name and to nothing else: `const ORDERS = 'orders'`. A name that is anywhere
  // set to something worked out (`const orders = config.tables[ORDERS] ?? ORDERS`) is the endpoint's name, and is left alone.
  const heldShortNames = new Map<string, string>();
  const workedOut = new Set<string>();
  for (const { text } of customer) {
    for (const found of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([^;\n]+)/g)) {
      const literal = /^(['"`])([a-z][a-z0-9_]*)\1(?:\s+as\s+const)?\s*$/.exec((found[2] as string).trim());
      if (literal !== null && tables.has(literal[2] as string)) heldShortNames.set(found[1] as string, literal[2] as string);
      else workedOut.add(found[1] as string);
    }
  }
  for (const name of workedOut) heldShortNames.delete(name);
  // Customers may read a table, and no screen reads anything at all: the page shows none of what it was made to show.
  const read = (app.publicAccess ?? []).filter((entry) => typeof entry.table === 'string' && entry.claim === undefined && Array.isArray(entry.methods) && entry.methods.includes('GET')).map((entry) => entry.table as string);
  const screens = customer.filter((source) => /\.(tsx|jsx)$/.test(source.file));
  if (read.length > 0 && screens.length > 0 && !customer.some((source) => ANY_READ.test(source.text))) {
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
    // A search, sort or filter is judged against what that list's own entry declares.
    for (const message of listQueryMessages(text, app)) out.push({ side: 'customer', file, message });
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
    for (const found of text.matchAll(LITERAL_TABLE)) if (tables.has(found.groups?.name as string)) named.add(found.groups?.name as string);
    // The short name kept in a name of the side's own (`export const ORDERS = 'orders'`, in this file or another) and given
    // to the call as it is: the same call, one step away. (Seen 2026-11-27: every form of a site answered PUBLIC_REF_NOT_FOUND.)
    for (const found of text.matchAll(HELD_TABLE)) {
      const table = heldShortNames.get(found.groups?.name as string);
      if (table !== undefined) named.add(table);
    }
    if (named.size > 0) {
      const one = [...named][0] as string;
      out.push({
        side: 'customer',
        file,
        message: `calls the public client with the table's short name (${[...named].map((name) => `"${name}"`).join(', ')}). A public endpoint goes by another name on each install, so the call finds nothing: \`loaded.value.tables['${one}'] ?? '${one}'\`. ${WHERE_TABLES}`,
      });
    }
  }
  // A row that must come with rows below it, made with a create that sends none.
  {
    const said = new Set<string>();
    let unread = false;
    for (const { file, text } of customer) {
      for (const entry of createsWithoutChildren(text, app)) {
        if (said.has(entry.table)) continue;
        said.add(entry.table);
        out.push({ side: 'customer', file, message: createWithoutChildrenMessage(entry) });
      }
      // A create whose table this cannot read (a prop, a value passed in).
      for (const call of text.matchAll(BARE_CREATE)) {
        const open = call.index + call[0].length - 1;
        const first = partsOf(text, open + 1, afterBracket(text, open) - 1)[0];
        // (Never `Object.create(null)`, which is no write at all.)
        if (first !== undefined && /^[A-Za-z_$][\w$.]*$/.test(first) && !/^(?:null|undefined|true|false|this)$/.test(first) && !/\b(?:Object|Reflect)\s*$/.test(text.slice(0, call.index)) && createdTable(first, text) === null) unread = true;
      }
    }
    // Nothing on the side sends a row with its rows below it, and some create names a table this cannot read: said of the side.
    const tree = customer.some(({ text }) => /\.\s*createTree\s*(?:<[^()]*>)?\s*\(/.test(text));
    for (const entry of entriesNeedingChildren(app)) {
      if (said.has(entry.table) || tree || !unread) continue;
      out.push({ side: 'customer', file: appPath(key, 'customer', 'src'), message: `never calls client.createTree, and ${createWithoutChildrenMessage(entry).replace(/^makes a row of /, 'access.json lets customers make a row of ').replace(' with client.create, and access.json asks', ' and asks')}` });
    }
  }
  // An event read after its handler has let go: the send works, and the visitor is told it failed.
  for (const side of ['customer', 'staff'] as const) {
    for (const { file, text } of side === 'customer' ? customer : sources(root, key, side).map((source) => ({ ...source, text: code(source.text) }))) {
      const name = currentTargetAfterAwait(text);
      if (name === null) continue;
      out.push({
        side,
        file,
        message: `reads ${name}.currentTarget after the handler has let go (after an await, or in a callback that runs later). React has cleared it by then: the read is null, the line throws, and a send that worked is told to the person as one that failed. Keep the element first, before any await: const form = ${name}.currentTarget; then use form (form.reset(), new FormData(form)).`,
      });
    }
  }
  const GUIDE = 'adminium-app/references/guides/manifest-by-task--let-a-customer-find-their-own-row.md';
  for (const { file, text } of customer) {
    if (/\.claim\(\s*['"`]/.test(text)) {
      out.push({ side: 'customer', file, message: 'calls client.claim with a name first. It takes one object, the details the person typed: client.claim({ code, customer_email }), and answers true or false.' });
    }
    if (CLAIMED_WRITTEN_OUT.test(text)) {
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
