// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns a stranger's create holds to plain text (`anonymous.plainText`),
 * on each table of one connection, wherever the create was declared: an
 * endpoint (every app's public access became one) or a key scope written by
 * hand.
 *
 * Read by the doors that CHANGE a row: a column a create judges is judged on
 * every change that writes it too — through the row's own link, a signed-in
 * person's rows or a batch — whichever key or entry the change comes through,
 * so a buyer's name refused on the order is not written in by a change after.
 *
 * It also holds the person's own column a create fills such a column from
 * (`identity.fill`: the account's `name` into the order's `buyer_name`): the
 * account's change of it is judged by the same rule, where the person sees
 * the refusal and can fix it, rather than on every order the name is copied
 * into after.
 *
 * Tables are matched by their own name, whatever schema is written before
 * it: two schemas holding a table of one name share their plain-text columns,
 * which refuses more, never less.
 */
import { publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { linkFreeText, plainColumn, plainRule, stricterRule, type PlainTextColumn, type PlainTextRule } from './anonymous-caps.js';
import { parseDefinition } from './endpoint.js';

/**
 * Plain-text columns by table, under the table's own name (a schema before it
 * or not), each with its rule: a column two creates declare holds to the
 * stricter of the two.
 */
export type PlainTextOn = ReadonlyMap<string, ReadonlyMap<string, PlainTextRule>>;

const bareName = (table: string): string => table.slice(table.lastIndexOf('.') + 1);

/** Just what a stored scope says about its resources' plain-text columns. */
const scopeSchema = z.object({
  resources: z
    .array(
      z
        .object({
          ref: z.string().optional(),
          table: z.string(),
          anonymous: z
            .object({ plainText: z.array(z.union([z.string(), z.object({ column: z.string(), digits: z.number().optional(), max: z.number().optional() })])).optional() })
            .passthrough()
            .optional(),
          findOrCreate: z.object({ identityRef: z.string(), fill: z.record(z.string(), z.string()).optional() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

/** One create as read here: its table, its plain-text columns, and the person it fills from. */
interface Declared {
  table: string;
  plainText: readonly PlainTextColumn[];
  person: { ref: string; fill: Readonly<Record<string, string>> } | null;
}

export async function plainTextOn(meta: MetaDb, connectionId: string): Promise<PlainTextOn> {
  const out = new Map<string, Map<string, PlainTextRule>>();
  const add = (table: string, columns: readonly (readonly [string, PlainTextRule])[]) => {
    if (columns.length === 0) return;
    const name = bareName(table);
    const rules = out.get(name) ?? new Map<string, PlainTextRule>();
    for (const [column, rule] of columns) {
      const was = rules.get(column);
      rules.set(column, was === undefined ? rule : stricterRule(was, rule));
    }
    out.set(name, rules);
  };
  /** Each set of creates with the tables their refs name: an identity's ref is read in the set that declares it. */
  const sets: { tableOf: Map<string, string>; creates: Declared[] }[] = [];
  const endpoints: Declared[] = [];
  const endpointTables = new Map<string, string>();
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    if (!parsed.ok) continue;
    const def = parsed.definition;
    endpointTables.set(row.ref, def.source);
    const f = def.find_or_create;
    endpoints.push({ table: def.source, plainText: def.anonymous?.plain_text ?? [], person: f === undefined ? null : { ref: f.identity_ref, fill: f.fill ?? {} } });
  }
  sets.push({ tableOf: endpointTables, creates: endpoints });
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = scopeSchema.safeParse(document);
    if (!parsed.success) continue;
    const tableOf = new Map(parsed.data.resources.flatMap((r) => (r.ref === undefined ? [] : [[r.ref, r.table] as const])));
    sets.push({
      tableOf,
      creates: parsed.data.resources.map((r) => ({
        table: r.table,
        plainText: r.anonymous?.plainText ?? [],
        person: r.findOrCreate === undefined ? null : { ref: r.findOrCreate.identityRef, fill: r.findOrCreate.fill ?? {} },
      })),
    });
  }
  for (const { tableOf, creates } of sets) {
    for (const create of creates) {
      const judged = new Map(create.plainText.map((entry) => [plainColumn(entry), plainRule(entry)] as const));
      add(create.table, [...judged]);
      // The person's column a judged column is filled from (a person's column → the create's column), under its rule.
      const people = create.person === null ? undefined : (tableOf.get(create.person.ref) ?? endpointTables.get(create.person.ref));
      if (people === undefined || create.person === null) continue;
      add(
        people,
        Object.entries(create.person.fill).flatMap(([personColumn, rowColumn]) => {
          const rule = judged.get(rowColumn);
          return rule === undefined ? [] : [[personColumn, rule] as const];
        }),
      );
    }
  }
  return out;
}

/**
 * A few seconds of what a connection declares, for the doors that ask on every
 * change: a `plainText` an install or an endpoint save adds applies to a
 * change at most this late (a create judges its own entry's at once).
 */
const RECENT_MS = 5_000;
const recentByMeta = new WeakMap<MetaDb, Map<string, { at: number; columns: Promise<PlainTextOn> }>>();

/** {@link plainTextOn} as it stood a moment ago at most. */
export function recentPlainTextOn(meta: MetaDb, connectionId: string, now = Date.now()): Promise<PlainTextOn> {
  let recent = recentByMeta.get(meta);
  if (recent === undefined) recentByMeta.set(meta, (recent = new Map()));
  const hit = recent.get(connectionId);
  if (hit !== undefined && now - hit.at < RECENT_MS) return hit.columns;
  const columns = plainTextOn(meta, connectionId);
  recent.set(connectionId, { at: now, columns });
  columns.catch(() => recent.delete(connectionId));
  return columns;
}

/** The first column a change writes that a create on its table holds to plain text, and that is not; or null. */
export function notPlainOn(declared: PlainTextOn, table: string, values: Readonly<Record<string, unknown>>): string | null {
  const columns = declared.get(bareName(table));
  if (columns === undefined) return null;
  for (const [column, rule] of columns) {
    if (Object.prototype.hasOwnProperty.call(values, column) && !linkFreeText(values[column], rule)) return column;
  }
  return null;
}
