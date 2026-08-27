#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regenerate the derived blocks of `reference/rest-api.md` from
 * `apps/server/openapi.json`.
 *
 *   node scripts/sync-rest-api.mjs [--check]
 *
 * WHY. The page's hand-written "Route groups" table named 18 prefixes. The API
 * has 31, over 161 operations — so 52 operations (a third of the surface:
 * exports, imports, scheduled-reports, email-templates, search, i18n, users,
 * permissions) appeared nowhere, and three of the rows it did have named
 * prefixes no route has ever used (`/views/*`, `/generate/*`, `/schema/*` are
 * all nested under other resources). A reference page that omits a third of the
 * API is worse than none, because it reads as complete.
 *
 * So the two derived blocks below are written from the generated spec, not by
 * hand. What stays hand-written is what a spec cannot say: what a group is FOR.
 * That lives in DESCRIPTIONS, and an undescribed prefix is a hard failure —
 * a new namespace cannot reach the docs as a bare path with no explanation.
 *
 * `--check` fails when the committed page differs from what this would write.
 * `docs-contract.test.ts` asserts the same completeness from the other side, so
 * the gate does not depend on anyone remembering to run this.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const SPEC = join(repoRoot, 'apps', 'server', 'openapi.json');
const PAGE = join(repoRoot, 'apps', 'docs', 'src', 'content', 'docs', 'reference', 'rest-api.md');

const check = process.argv.includes('--check');

/**
 * What each `/api/v1` prefix is for. Keyed by the first path segment, which is
 * how the API is actually namespaced — not by a hoped-for grouping.
 */
const DESCRIPTIONS = {
  about: 'Build version, edition, and the update check',
  'api-keys': 'Issue, list and revoke API keys',
  audit: 'The audit log — list and read single entries',
  auth: 'Login, logout, session listing, 2FA enrolment, password change and reset',
  bootstrap: 'Everything the dashboard needs on first paint, in one call',
  branding: 'Instance name, colours and logo (read is public; writes are admin)',
  connections: 'Databases Adminium is pointed at — CRUD, connection test, introspection, schema snapshots, diffs, overrides, and generation',
  data: 'Rows in your database — list, read, create, update, delete, bulk write, undo, and inbound references',
  'email-templates': 'Transactional email bodies per locale, plus a test send',
  events: 'Server-sent events — the fallback when a WebSocket cannot be established',
  exports: 'Queued exports of a whole result set, and their downloads',
  healthz: 'Liveness',
  i18n: 'Runtime translations — locales, keys, bundles, import/export, format errors',
  imports: 'CSV/spreadsheet imports — upload, dry run, run, error report',
  jobs: 'Background jobs — enqueue, poll, cancel',
  llm: 'LLM assist — provider config, runs, prompts, diffs, apply, undo',
  me: 'The signed-in user — profile, preferences, notifications, saved layouts',
  meta: 'Where the meta store lives, and relocating it',
  onboarding: 'The first-run checklist',
  pages: 'Pages and dashboards — layout, config, nav order, shared views',
  public: 'The scoped public API for customer- and staff-facing pages (off by default)',
  'public-api': 'Turn the public API on or off, and see whether this instance opted in',
  'public-scopes': 'Define what a public key may read — resources, columns, filters and time zone',
  'public-keys': 'Issue, reveal, rotate and revoke the browser-safe keys your pages use',
  permissions: 'The permission catalog every role is built from',
  readyz: 'Readiness — per-dependency verdicts, 503 when a dependency is down',
  roles: 'RBAC roles and their permission sets',
  'scheduled-reports': 'Recurring exports delivered on a schedule',
  'schema-import': 'Parse a schema file (SQL, Prisma, Drizzle, the JSON IR, …) into the IR',
  search: 'Cross-resource search for the command palette',
  surfaces: 'Hosted app surfaces — placement in the dashboard, and attaching your own domains',
  settings: 'Instance settings — defaults, branding, email, security, telemetry, workspace',
  setup: 'First-boot super-admin creation, and whether setup is still open',
  system: 'Version and instance information',
  users: 'People in the workspace — invite, suspend, delete, assign roles',
  'widget-data': 'The queries widgets run, singly and in batches',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function operations(spec) {
  const rows = [];
  for (const path of Object.keys(spec.paths)) {
    for (const method of METHODS) {
      if (spec.paths[path][method] === undefined) continue;
      rows.push({ method: method.toUpperCase(), path });
    }
  }
  return rows;
}

/** `/api/v1/connections/{id}/schema` → `connections`. */
function prefixOf(path) {
  return path.replace(/^\/api\/v1\//, '').split('/')[0];
}

function renderGroups(rows) {
  const byPrefix = new Map();
  for (const row of rows) {
    const prefix = prefixOf(row.path);
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const missing = [...byPrefix.keys()].filter((prefix) => DESCRIPTIONS[prefix] === undefined);
  if (missing.length > 0) {
    console.error(
      `No description for ${missing.map((m) => `/api/v1/${m}`).join(', ')}.\n` +
        `Add one to DESCRIPTIONS in ${'apps/docs/scripts/sync-rest-api.mjs'} — a new ` +
        'namespace must not reach the reference page as a bare path.',
    );
    process.exit(1);
  }
  const lines = ['| Group | Ops | |', '|---|---:|---|'];
  for (const prefix of [...byPrefix.keys()].sort()) {
    const count = byPrefix.get(prefix);
    const label = count === 1 ? `\`/api/v1/${prefix}\`` : `\`/api/v1/${prefix}/*\``;
    lines.push(`| ${label} | ${String(count)} | ${DESCRIPTIONS[prefix]} |`);
  }
  return lines.join('\n');
}

function renderOperations(rows) {
  const byPrefix = new Map();
  for (const row of rows) {
    const prefix = prefixOf(row.path);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(row);
  }
  const out = [];
  for (const prefix of [...byPrefix.keys()].sort()) {
    out.push(`### \`/${prefix}\``, '');
    out.push('```http');
    for (const row of byPrefix.get(prefix)) out.push(`${row.method} ${row.path}`);
    out.push('```', '');
  }
  return out.join('\n').trimEnd();
}

const BLOCKS = [
  ['groups', renderGroups],
  ['operations', renderOperations],
];

const spec = JSON.parse(await readFile(SPEC, 'utf8'));
const rows = operations(spec);
let page = await readFile(PAGE, 'utf8');

for (const [name, render] of BLOCKS) {
  const begin = `<!-- BEGIN GENERATED: ${name} -->`;
  const end = `<!-- END GENERATED: ${name} -->`;
  const from = page.indexOf(begin);
  const to = page.indexOf(end);
  if (from === -1 || to === -1) {
    console.error(`${PAGE} is missing the ${begin} … ${end} markers.`);
    process.exit(1);
  }
  page = `${page.slice(0, from + begin.length)}\n\n${render(rows)}\n\n${page.slice(to)}`;
}

const committed = await readFile(PAGE, 'utf8');
if (check) {
  if (committed !== page) {
    console.error(
      'reference/rest-api.md is STALE — the route tree no longer matches the page.\n' +
        'Re-generate it: pnpm --filter @adminium/docs run rest-api',
    );
    process.exit(1);
  }
  console.log(`ok — rest-api.md covers all ${String(rows.length)} operations`);
  process.exit(0);
}

await writeFile(PAGE, page, 'utf8');
console.log(`Wrote ${PAGE} (${String(rows.length)} operations)`);
