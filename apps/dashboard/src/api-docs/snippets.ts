// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The explorer's code samples: the comp's three tabs, written against
 * the contract this deployment actually has.
 *
 * - `Authorization: Bearer <key>` — there is no `apikey` header;
 * - `X-Adminium-Public-Session` on an endpoint that needs a signed-in
 *   customer;
 * - JavaScript is `@adminiumjs/public-client`, the one client that exists;
 * - Python is `requests`;
 * - one-row writes send `{ "values": … }`, a batch sends `{ "rows": [ … ] }`.
 *
 * A sample names the key `$ADMINIUM_KEY` (or `ADMINIUM_KEY`) and NEVER the
 * one pasted into the playground: a sample is made to be copied into a
 * repository, and a key in a copied sample is a leaked key.
 */
import type { CatalogueEndpoint } from './apiDocsApi.js';
import { RECORDS_PREFIX, sampleBody, sampleValues, type Card } from './model.js';

export type Language = 'curl' | 'js' | 'python';
export const LANGUAGES: readonly Language[] = ['curl', 'js', 'python'];

const SESSION_HEADER = 'X-Adminium-Public-Session';

/** JSON → a Python literal (`true` → `True`, `null` → `None`). */
function python(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(python).join(', ')}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${JSON.stringify(k)}: ${python(v)}`);
  return `{${entries.join(', ')}}`;
}

/** JSON → a JavaScript object literal with bare keys where they are identifiers. */
function js(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(js).join(', ')}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${js(v)}`,
  );
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

function curl(baseUrl: string, endpoint: CatalogueEndpoint, card: Card): string {
  const byId = card.path.endsWith('/:id');
  const path = card.path.replace(':id', '$ID');
  let url = `${baseUrl}${RECORDS_PREFIX}${path}`;
  if (card.id === 'list') url += `?limit=${String(endpoint.limit)}`;
  // Double quotes where the shell must expand `$ID`.
  const quoted = byId ? `"${url}"` : `'${url}'`;
  const lines = [card.http === 'GET' ? `curl ${quoted}` : `curl -X ${card.http} ${quoted}`];
  lines.push(`  -H "Authorization: Bearer $ADMINIUM_KEY"`);
  if (endpoint.auth === 'authenticated') lines.push(`  -H "${SESSION_HEADER}: $SESSION"`);
  const body = sampleBody(endpoint, card);
  if (body !== undefined) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(body)}'`);
  }
  return lines.join(' \\\n');
}

function javascript(baseUrl: string, endpoint: CatalogueEndpoint, card: Card): string {
  const ref = `'${endpoint.ref}'`;
  const head = [
    `import { createPublicClient } from '@adminiumjs/public-client'`,
    ``,
    `const client = createPublicClient({`,
    `  baseUrl: '${baseUrl}',`,
    `  publishableKey: ADMINIUM_KEY,`,
    `})`,
    ``,
  ];
  if (endpoint.auth === 'authenticated') {
    head.push(`// This endpoint answers a signed-in customer: call client.claim(…) first.`);
  }
  const values = js(sampleValues(endpoint));
  const call: Record<Card['id'], string> = {
    list: `const { data } = await client.list(${ref}, { limit: ${String(endpoint.limit)} })`,
    one: `const row = await client.get(${ref}, id)`,
    create: `const row = await client.create(${ref}, ${values})`,
    update: `const row = await client.update(${ref}, id, ${values})`,
    replace: `const row = await client.replace(${ref}, id, ${values})`,
    delete: `await client.remove(${ref}, id)`,
    batch: `const { count } = await client.batch(${ref}, [${values}])`,
  };
  return [...head, call[card.id]].join('\n');
}

function py(baseUrl: string, endpoint: CatalogueEndpoint, card: Card): string {
  const headers =
    endpoint.auth === 'authenticated'
      ? `{"Authorization": f"Bearer {ADMINIUM_KEY}", "${SESSION_HEADER}": SESSION}`
      : `{"Authorization": f"Bearer {ADMINIUM_KEY}"}`;
  const head = [`import requests`, ``, `BASE = "${baseUrl}${RECORDS_PREFIX}"`, `HEADERS = ${headers}`, ``];
  const url = card.path.endsWith('/:id')
    ? `f"{BASE}/${endpoint.ref}/{id}"`
    : card.id === 'batch'
      ? `f"{BASE}/${endpoint.ref}/batch"`
      : `f"{BASE}/${endpoint.ref}"`;
  const verb = card.http.toLowerCase();
  const body = sampleBody(endpoint, card);
  const args = [url];
  if (card.id === 'list') args.push(`params={"limit": ${String(endpoint.limit)}}`);
  if (body !== undefined) args.push(`json=${python(body)}`);
  args.push('headers=HEADERS');
  return [...head, `r = requests.${verb}(`, ...args.map((a) => `    ${a},`), `)`, `print(r.json())`].join('\n');
}

export function snippet(language: Language, baseUrl: string, endpoint: CatalogueEndpoint, card: Card): string {
  if (language === 'curl') return curl(baseUrl, endpoint, card);
  if (language === 'js') return javascript(baseUrl, endpoint, card);
  return py(baseUrl, endpoint, card);
}
