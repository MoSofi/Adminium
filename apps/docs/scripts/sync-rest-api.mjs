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
  documents:
    'Documents drawn from your own records — the register of what was issued, the bytes ' +
    'behind each one, and the mappings that say which columns make which document. A ' +
    'document keeps a frozen copy of what it was drawn from, so editing or deleting the ' +
    'source row never changes an invoice somebody already has. Reading one needs read ' +
    'access to every table its mapping uses; a caller without all of them is told the ' +
    'document exists and not what is in it.',
  'add-ons':
    'Installed add-ons — list what a host should mount, preview what installing would do, ' +
    'install from a verified package, enable or disable per host, and uninstall',
  'api-keys': 'Issue, list and revoke API keys',
  apps:
    'Micro-SaaS apps installed into this instance — upload a built bundle or download one ' +
    'from the opt-in online catalog, browse what is staged or offered, plan its tables ' +
    'against a connection, install, update, discard a staged version, and uninstall',
  assistant:
    'The page assistant — open a session on a page, ask it something, read what the turn ' +
    'came back with, and act on the draft it proposed. Every route needs the assistant ' +
    'permission; saving what it drafts additionally needs the same permission the page’s ' +
    'own save needs. The assistant reads; nothing it does writes a record on its own.',
  audit: 'The audit log — list and read single entries',
  automations:
    'Automation rules — the trigger, the steps and the branches between them; ' +
    'the tables, columns, templates and roles a rule can name; the 30-day counters ' +
    'the cards show; and a dry run that walks the flow without executing anything',
  'automation-runs':
    'Every execution of a rule — the last seven days, the three status filters, ' +
    'one run’s full step-by-step trace, and today’s counters',
  files:
    'Uploaded files and record attachments — upload, list, download (with Range and ETag), ' +
    'attach to a record, rename, move to trash and restore',
  storage:
    'Where uploaded and generated files are stored — configure destinations ' +
    '(this server’s disk, an S3-compatible bucket, a WebDAV server), test one, ' +
    'choose the default, and move existing files between them',
  auth: 'Login, logout, session listing, 2FA enrolment, password change and reset',
  bootstrap: 'Everything the dashboard needs on first paint, in one call',
  branding: 'Instance name, colours and logo (read is public; writes are admin)',
  connections: 'Databases Adminium is pointed at — CRUD, connection test, introspection, schema snapshots, diffs, overrides, and generation',
  data: 'Rows in your database — list, read, create, update, delete, bulk write, undo, and inbound references',
  'email-blocks': 'Reusable email sections saved from the editor — list, save one, delete one',
  'email-runs': 'Campaign sends — cancel a scheduled or running run',
  'email-templates':
    'Email templates and campaigns — the documents, their language variations, the starters, ' +
    'test sends of the on-screen document, and export/import of a bundle',
  events: 'Server-sent events — the fallback when a WebSocket cannot be established',
  exports: 'Queued exports of a whole result set, and their downloads',
  healthz: 'Liveness',
  i18n: 'Runtime translations — locales, keys, bundles, import/export, format errors',
  imports: 'CSV/spreadsheet imports — upload, dry run, run, error report',
  invoices:
    'Invoice templates and invoices — the documents, their language variations, the starters, ' +
    'duplicates, and building an invoice from a template',
  jobs: 'Background jobs — enqueue, poll, cancel',
  llm: 'LLM assist — provider config, runs, prompts, diffs, apply, undo',
  me: 'The signed-in user — profile, preferences, notifications, saved layouts',
  meta: 'Where the meta store lives, and relocating it',
  onboarding: 'The first-run checklist',
  'option-lists':
    'Named sets of answers a column accepts, written once and pointed at by as many ' +
    'columns as need them. Reading one needs only a session — a create dialog has to render ' +
    'the choices to anyone who may add a row — while writing needs the same grant that points ' +
    'a column at a list. The built-in lists live in code and are served with their labels in ' +
    'the caller\'s locale; editing one makes an ordinary copy rather than changing it. Deleting ' +
    'a list a column still names is refused with 409 and the columns using it.',
  pages:
    'Pages and dashboards — layout, config, nav order, shared views, and what a template needs from a table (with a new table drafted to fit when none does)',
  project:
    'A project folder on the server that runs one — which pages and schema customizations ' +
    'differ from the deployed files, settling a page changed on both sides, the changed ' +
    'copies `adminium pull --from` writes into the project, running the project’s actions, ' +
    'the built files of its own pages and widgets, and what Studio shows about the project',
  public: 'The scoped public API for customer- and staff-facing pages (off by default)',
  'public-api': 'Turn the public API on or off, and see whether this instance opted in',
  'public-scopes': 'Define what a public key may read — resources, columns, filters and time zone',
  'public-keys': 'Issue, reveal, rotate and revoke the browser-safe keys your pages use',
  'public-endpoints': 'Build the endpoints a key can be granted — source, columns, filters, methods and limits',
  'api-docs': 'The public API catalogue behind /api-docs — what live keys can call; 404 while the page is off',
  permissions: 'The permission catalog every role is built from',
  readyz: 'Readiness — per-dependency verdicts, 503 when a dependency is down',
  'report-documents':
    'Report templates and reports — the block documents behind the report builder, the starters, ' +
    'duplicates, and building a report from a template',
  roles: 'RBAC roles and their permission sets',
  'scheduled-reports': 'Recurring exports delivered on a schedule',
  'schema-import': 'Parse a schema file (SQL, Prisma, Drizzle, the JSON IR, …) into the IR',
  search: 'Cross-resource search for the command palette',
  surfaces: 'Hosted app surfaces — placement in the dashboard, and attaching your own domains',
  settings: 'Instance settings — defaults, branding, email, security, telemetry, workspace',
  setup:
    'First-boot super-admin creation, whether setup is still open, and — in that same ' +
    'window — checking a database for an Adminium store already in it and adopting that store',
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
