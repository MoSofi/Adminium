// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY PLACE A PAGE NAMES A TABLE, AND ONE WALK OVER THEM.
 *
 * A stored page names tables in a handful of places: its own table, its
 * grants, a column's link, a related tab, a page-level total, a dashboard's
 * domain, and each widget's query. A page saved into a file names each of
 * them by the app's own table ref (`orders`), with no database and no schema;
 * the install turns each into the target's table.
 *
 * The list is CLOSED. A place not on it is not read as a table, so a value
 * there is never resolved and never passed through as one. The guard test
 * (`test/envelope-refs-guard.test.ts`) fails when a page template or a stored
 * page schema holds a table anywhere this list does not name.
 *
 * Free text that mentions a table (`archetype.reasons`) is text and stays as
 * it is. A form's relation field names a table too, as `table` or
 * `table.column`; it is bound by `bindForm` against the target's relations,
 * and only read here for its ref.
 */

/** How a place holds its table. */
export type TableRefForm =
  /** A table id: `public.orders` stored, the ref `orders` in a file. */
  | 'id'
  /** A grant: `table:<table>:<action>`. */
  | 'grant'
  /** A widget query: `source.name` (and `schema`), `counts.table`, `team.target.table`, with its `connectionId`. */
  | 'query'
  /** A form's relation field: `table` or `table.column`, bound by `bindForm`. */
  | 'relation';

export interface EnvelopeTablePath {
  /** Dot path from the envelope's root; `[]` is every item of an array. */
  path: string;
  form: TableRefForm;
}

/** Every place an envelope holds a table. */
export const ENVELOPE_TABLE_PATHS: readonly EnvelopeTablePath[] = [
  { path: 'source.table', form: 'id' },
  { path: 'access.permissions[]', form: 'grant' },
  { path: 'config.columns[].fk.table', form: 'id' },
  { path: 'config.columns[].reverse.table', form: 'id' },
  { path: 'config.derived.measures[].table', form: 'id' },
  { path: 'config.detail.tabs[].table', form: 'id' },
  { path: 'config.domain.tables[]', form: 'id' },
  { path: 'config.layout.items[].config.binding', form: 'query' },
  { path: 'config.layout.items[].config.statBindings[]', form: 'query' },
  { path: 'config.form.sections[].fields[].relation', form: 'relation' },
];

/** Inside a widget query, the places that name a table. */
export const QUERY_TABLE_PATHS: readonly string[] = ['source.name', 'counts.table', 'team.target.table'];

/** Every path, a widget query's own spelled out: what the guard test checks a found table against. */
export function expandedTablePaths(): string[] {
  return ENVELOPE_TABLE_PATHS.flatMap((entry) =>
    entry.form === 'query' ? QUERY_TABLE_PATHS.map((inner) => `${entry.path}.${inner}`) : [entry.path],
  );
}

/** A table of the target, as a ref resolves to it. */
export interface TargetTable {
  /** The model's id: `schema.name` on every engine. */
  id: string;
  name: string;
  schema: string | null;
}

export interface RefTarget {
  connectionId: string;
  /** Only a Postgres query names a schema. */
  postgres: boolean;
  /** The target's table for an app's table ref, or null when it has none. */
  table: (ref: string) => TargetTable | null;
}

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function segmentsOf(path: string): string[] {
  return path.split('.').flatMap((part) => (part.endsWith('[]') ? [part.slice(0, -2), '[]'] : [part]));
}

/**
 * Calls `at` for each value found at `path` under `root`, with a setter that
 * replaces it. Arrays and objects on the way are copied, so `root` is never
 * changed; the copy is answered.
 */
function rewriteAt(root: unknown, path: string, at: (value: unknown, where: string) => unknown): unknown {
  const segments = segmentsOf(path);
  const walk = (node: unknown, i: number, where: string): unknown => {
    if (i === segments.length) return at(node, where);
    const segment = segments[i]!;
    if (segment === '[]') {
      if (!Array.isArray(node)) return node;
      return node.map((item, index) => walk(item, i + 1, `${where}[${String(index)}]`));
    }
    if (!isNode(node) || !(segment in node)) return node;
    return { ...node, [segment]: walk(node[segment], i + 1, where === '' ? segment : `${where}.${segment}`) };
  };
  return walk(root, 0, '');
}

const GRANT = /^table:(.+):([a-z]+)$/;

/** The ref a relation field names: `orders` of `orders.customer_id`. */
function relationRef(value: string): string {
  const at = value.indexOf('.');
  return at === -1 ? value : value.slice(0, at);
}

/** A query's table for a ref, as that query spells it on the target: `schema.name` on Postgres, else the name. */
function qualified(table: TargetTable, postgres: boolean): string {
  return postgres && table.schema !== null ? `${table.schema}.${table.name}` : table.name;
}

/** Every table ref a document names, with where. Read from a file, before any table exists. */
export function tableRefsOf(document: unknown): { ref: string; where: string }[] {
  const out: { ref: string; where: string }[] = [];
  for (const entry of ENVELOPE_TABLE_PATHS) {
    rewriteAt(document, entry.path, (value, where) => {
      if (entry.form === 'id' && typeof value === 'string') out.push({ ref: value, where });
      if (entry.form === 'grant' && typeof value === 'string') {
        const grant = GRANT.exec(value);
        if (grant !== null) out.push({ ref: grant[1]!, where });
      }
      if (entry.form === 'relation' && typeof value === 'string') out.push({ ref: relationRef(value), where });
      if (entry.form === 'query' && isNode(value)) {
        for (const inner of QUERY_TABLE_PATHS) {
          rewriteAt(value, inner, (named, at) => {
            if (typeof named === 'string') out.push({ ref: named, where: `${where}.${at}` });
            return named;
          });
        }
      }
      return value;
    });
  }
  return out;
}

/**
 * The document with every table ref turned into the target's table, or the
 * refs it could not. A relation field is left for `bindForm`, which binds it
 * against the target's relations.
 */
export function resolveTableRefs(document: unknown, target: RefTarget): { document: unknown; problems: string[] } {
  const problems: string[] = [];
  const find = (ref: string, where: string): TargetTable | null => {
    const table = target.table(ref);
    if (table === null) problems.push(`${where}: "${ref}" is not a table of this app`);
    return table;
  };
  let out = document;
  for (const entry of ENVELOPE_TABLE_PATHS) {
    if (entry.form === 'relation') continue;
    out = rewriteAt(out, entry.path, (value, where) => {
      if (entry.form === 'id') {
        if (typeof value !== 'string') return value;
        return find(value, where)?.id ?? value;
      }
      if (entry.form === 'grant') {
        const grant = typeof value === 'string' ? GRANT.exec(value) : null;
        if (grant === null) return value;
        const table = find(grant[1]!, where);
        return table === null ? value : `table:${table.id}:${grant[2]!}`;
      }
      if (!isNode(value)) return value;
      return bindQuery(value, where, target, find);
    });
  }
  return { document: out, problems };
}

/** One widget query on the target: its connection, its table (a schema only on Postgres), its counts' and team's tables. */
function bindQuery(query: Node, where: string, target: RefTarget, find: (ref: string, where: string) => TargetTable | null): Node {
  const out: Node = { ...query, connectionId: target.connectionId };
  const source = query['source'];
  if (isNode(source) && typeof source['name'] === 'string') {
    const table = find(source['name'], `${where}.source.name`);
    const { schema: _file, ...rest } = source;
    out['source'] = table === null ? rest : { ...rest, name: table.name, ...(target.postgres && table.schema !== null ? { schema: table.schema } : {}) };
  }
  const counts = query['counts'];
  if (isNode(counts) && typeof counts['table'] === 'string') {
    const table = find(counts['table'], `${where}.counts.table`);
    if (table !== null) out['counts'] = { ...counts, table: qualified(table, target.postgres) };
  }
  const team = query['team'];
  const goals = isNode(team) ? team['target'] : undefined;
  if (isNode(team) && isNode(goals) && typeof goals['table'] === 'string') {
    const table = find(goals['table'], `${where}.team.target.table`);
    if (table !== null) out['team'] = { ...team, target: { ...goals, table: qualified(table, target.postgres) } };
  }
  return out;
}
