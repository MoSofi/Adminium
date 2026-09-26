// SPDX-License-Identifier: AGPL-3.0-only
/**
 * U+0000 — the one character no engine keeps alike.
 *
 * Postgres refuses it in any text it is sent (`invalid byte sequence for
 * encoding "UTF8": 0x00`), and its escape in a `jsonb` value; MySQL and SQLite
 * take it. So a value carrying one is a 500 on Postgres and something else on
 * the other two, whether it is written (`crud/column-rules.ts` refuses it on
 * every write) or only read with: an id in a path, a search, a filter's value,
 * a sort. {@link refuseNulInRequest} refuses it in every `/api/` request's path
 * parameters and query string, before a route reads either, with the same 400
 * on every engine — and on Adminium's own store, which may be Postgres too.
 *
 * A request's BODY is read too — every `/api/` route's, so what reaches
 * Adminium's own store (a user's name, a role's description, a setting, a
 * page's title) is refused as a schema refusal of that field would be — except
 * where the body carries a ROW's values for the write service (`crud/`), which
 * refuses the character itself and names the column the way a form shows it.
 * Those parts are marked where their schema is declared ({@link rowValues}),
 * never listed by route: a new route that takes a row's values in one of those
 * schemas is left to the write service by construction, and any other body is
 * read.
 */
import type { FastifyRequest } from 'fastify';

import { AppError } from '../errors.js';

const NUL = '\u0000';
/** The JSON escape for U+0000: JSON text can carry the character without holding it. */
const ESCAPED_NUL = /\\u0000/;

/**
 * Whether a value carries U+0000 anywhere text is read from it: the string
 * itself, any string or key inside an object or array, and — when `json` —
 * the members of JSON text the string holds (the escape, once parsed, is the
 * character). Walked with a stack, not by recursion, and one item at a time,
 * so neither a deep nor a long value overflows it. A Date, a byte array and
 * any other object a driver binds itself carry no text of ours.
 */
export function holdsNul(value: unknown, json: boolean): boolean {
  const stack: unknown[] = [value];
  if (json && typeof value === 'string' && ESCAPED_NUL.test(value)) {
    try {
      stack.push(JSON.parse(value));
    } catch {
      // Not JSON at all: whatever reads it refuses it in its own words.
    }
  }
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') {
      if (next.includes(NUL)) return true;
    } else if (Array.isArray(next)) {
      for (const item of next as unknown[]) stack.push(item);
    } else if (typeof next === 'object' && next !== null) {
      const proto = Object.getPrototypeOf(next) as unknown;
      if (proto !== Object.prototype && proto !== null) continue;
      for (const [key, member] of Object.entries(next as Record<string, unknown>)) {
        if (key.includes(NUL)) return true;
        stack.push(member);
      }
    }
  }
  return false;
}

/** The schema nodes that carry a row's values to the write service. */
const ROW_VALUES = new WeakSet<object>();

/**
 * Marks a schema as carrying a source row's values (a record's `values`, a
 * public entry's row): its part of a body is left to the write service, which
 * refuses U+0000 in it naming the column. Returns the schema itself.
 */
export function rowValues<T extends object>(schema: T): T {
  ROW_VALUES.add(schema);
  return schema;
}

type Pattern = readonly string[];

/** A zod schema's definition, read structurally (zod 4 keeps it on `_zod.def`). */
interface Def {
  type?: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  valueType?: unknown;
  element?: unknown;
  options?: readonly unknown[];
  in?: unknown;
}
const defOf = (schema: unknown): Def | undefined => (schema as { _zod?: { def?: Def } } | null)?._zod?.def;

const PATTERNS = new WeakMap<object, Pattern[]>();

/**
 * The places in a body schema that carry a row's values, as paths whose `*`
 * stands for any record key or array index: `values`,
 * `children.*.*.values`, `rows.*`. Read once per schema.
 */
function rowValuePaths(schema: unknown): Pattern[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const cached = PATTERNS.get(schema);
  if (cached !== undefined) return cached;
  const out: Pattern[] = [];
  const walk = (node: unknown, path: string[], depth: number): void => {
    if (typeof node !== 'object' || node === null || depth > 24) return;
    if (ROW_VALUES.has(node)) {
      out.push(path);
      return;
    }
    const def = defOf(node);
    switch (def?.type) {
      case 'object':
        for (const [key, child] of Object.entries(def.shape ?? {})) walk(child, [...path, key], depth + 1);
        return;
      case 'record':
        walk(def.valueType, [...path, '*'], depth + 1);
        return;
      case 'array':
        walk(def.element, [...path, '*'], depth + 1);
        return;
      case 'union':
        for (const option of def.options ?? []) walk(option, path, depth + 1);
        return;
      case 'pipe':
        walk(def.in, path, depth + 1);
        return;
      default:
        // optional, nullable, default, readonly, catch and the rest wrap one schema.
        if (def?.innerType !== undefined) walk(def.innerType, path, depth + 1);
    }
  };
  walk(schema, [], 0);
  PATTERNS.set(schema, out);
  return out;
}

/** How deep a body is read: deeper is refused outright, never walked. No body Adminium takes comes close. */
export const MAX_BODY_DEPTH = 64;

/** One place in a body, linked to its parent: the dotted path is spelled only when it is reported. */
interface Place {
  value: unknown;
  key: string | null;
  parent: Place | null;
  depth: number;
  /** The skip patterns this place's path still agrees with. */
  live: readonly number[];
}

const pathOf = (place: Place, last?: string): string => {
  const parts: string[] = last === undefined ? [] : [last];
  for (let at: Place | null = place; at !== null && at.key !== null; at = at.parent) parts.push(at.key);
  return parts.reverse().join('.');
};

/** What a body walk found: U+0000 at a path, a body nested deeper than it reads, or nothing. */
type BodyFinding = { kind: 'nul' | 'deep'; path: string } | null;

/**
 * The first place in a body holding U+0000 (`name`, `blocks.3.data.text`),
 * leaving out the places `skip` names; or the first place nested deeper than
 * {@link MAX_BODY_DEPTH}. Linear in the body's size: each place links to its
 * parent instead of copying the path, and a skip pattern is matched one
 * segment at a time as the walk goes down.
 */
function nulInBody(body: unknown, skip: readonly Pattern[]): BodyFinding {
  const stack: Place[] = [{ value: body, key: null, parent: null, depth: 0, live: skip.map((_, i) => i) }];
  const child = (parent: Place, value: unknown, key: string): Place => ({
    value,
    key,
    parent,
    depth: parent.depth + 1,
    live: parent.live.filter((i) => {
      const segment = skip[i]![parent.depth];
      return segment === '*' || segment === key;
    }),
  });
  while (stack.length > 0) {
    const place = stack.pop()!;
    if (place.depth > 0 && place.live.some((i) => skip[i]!.length === place.depth)) continue;
    const { value } = place;
    if (typeof value === 'string') {
      if (holdsNul(value, true)) return { kind: 'nul', path: pathOf(place) };
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    if (place.depth >= MAX_BODY_DEPTH) return { kind: 'deep', path: pathOf(place) };
    if (Array.isArray(value)) {
      const items = value as unknown[];
      for (let i = items.length - 1; i >= 0; i -= 1) stack.push(child(place, items[i], String(i)));
      continue;
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) continue;
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key] of entries) if (key.includes(NUL)) return { kind: 'nul', path: pathOf(place, key.replaceAll(NUL, '')) };
    for (let i = entries.length - 1; i >= 0; i -= 1) stack.push(child(place, entries[i]![1], entries[i]![0]));
  }
  return null;
}

/**
 * A request refused for U+0000 in a path parameter or the query string: 400
 * `VALIDATION_FAILED`, naming where (`in`) and which parameter, in the shape a
 * schema's refusal of a parameter has. The public API answers it with its own
 * refusal (`PUBLIC_QUERY_REFUSED`, the parameter in `params`).
 */
export class NulInRequest extends AppError {
  override readonly name = 'NulInRequest';
  constructor(
    readonly where: 'params' | 'querystring' | 'body',
    readonly parameter: string,
    /** `too-deep`: a body nested deeper than {@link MAX_BODY_DEPTH}, refused unread. */
    readonly issue: 'invalid-character' | 'too-deep' = 'invalid-character',
  ) {
    super(400, 'VALIDATION_FAILED', `Request ${where} failed validation.`, {
      in: where,
      issues: [
        {
          path: parameter,
          code: issue,
          message: issue === 'too-deep' ? `Nested deeper than ${String(MAX_BODY_DEPTH)} levels.` : 'Contains a character that cannot be read (U+0000).',
        },
      ],
    });
  }
}

/** The first parameter of `values` carrying U+0000 — raw, or escaped in JSON text (`where`, a filter) — or null. */
function nulParameter(values: unknown): string | null {
  if (typeof values !== 'object' || values === null) return null;
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    if (name.includes(NUL)) return name.replaceAll(NUL, '');
    // Any parameter may be JSON text (`where=`, a filter tree): read as JSON where it parses.
    if (holdsNul(value, true)) return name;
  }
  return null;
}

/**
 * The hook: every `/api/` request's path parameters, then its query string,
 * then its body but for a row's values.
 * Runs before a route's own validation, so a refusal is the same whichever
 * route, engine or store the value would have reached.
 */
export async function refuseNulInRequest(request: FastifyRequest): Promise<void> {
  // The ROUTE, not the request line: `/%61pi/…` and `GET http://host/api/…` reach `/api/` routes too.
  if (!isApiRoute(request)) return;
  const param = nulParameter(request.params);
  if (param !== null) throw new NulInRequest('params', param);
  const query = nulParameter(request.query);
  if (query !== null) throw new NulInRequest('querystring', query);
  if (typeof request.body !== 'object' || request.body === null) return;
  const found = nulInBody(request.body, rowValuePaths(request.routeOptions.schema?.body));
  if (found !== null) throw new NulInRequest('body', found.path, found.kind === 'deep' ? 'too-deep' : 'invalid-character');
}

/**
 * Whether a request reached one of the API's routes: by the route it matched,
 * which is what the router decided on the DECODED path — never by the request
 * line, which may spell the same route another way (`/%61pi/v1/me`, or the
 * absolute form `GET http://host/api/v1/me`).
 */
export function isApiRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url?.startsWith('/api/') === true;
}

/**
 * A pagination cursor's text (base64url of what the server wrote), or null
 * when it is not one: a cursor is read back by the database, so U+0000 in it
 * — which no cursor the server wrote holds — is as malformed as bad base64.
 */
export function cursorText(raw: string): string | null {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  return holdsNul(text, true) ? null : text;
}
