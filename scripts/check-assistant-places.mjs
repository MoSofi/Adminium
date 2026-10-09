#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant tells a person WHERE something is done from a table of the
 * dashboard's screens kept on the server (apps/server/src/assistant/places.ts):
 * each with its route's path and the guard the screen is wrapped in. The
 * routes themselves are code in the dashboard. Nothing ties the two at
 * compile time, so this does:
 *
 *   - every path in the table is a route of one of the dashboard's routers;
 *   - its guard is the one that route's screen is wrapped in: the key of
 *     `<StudioGuard requires="…">`, `studio` for a bare `<StudioGuard>`,
 *     `none` for a screen with no guard.
 *
 * A screen that is moved, removed or put behind another permission fails
 * here, instead of becoming a dead or forbidden link in an answer.
 *
 * A script and not a test: a test that reads another package's source is
 * replayed from the build cache when only that other package changed.
 *
 *   node scripts/check-assistant-places.mjs              check the tree
 *   node scripts/check-assistant-places.mjs --self-test  prove the reader sees a difference
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTERS = ['apps/dashboard/src/studio/routes.tsx', 'apps/dashboard/src/app/router.tsx'];
const TABLE = 'apps/server/src/assistant/places.ts';

const GUARD = /<StudioGuard(?:\s+requires="([^"]+)")?\s*>/;
const guardIn = (text) => {
  const found = GUARD.exec(text);
  return found === null ? null : (found[1] ?? 'studio');
};

/** path → guard, for every route one router file declares. */
export function routesOf(source) {
  // A screen's component, declared in the file as a function, and the guard in its body.
  const guardOf = new Map();
  for (const match of source.matchAll(/function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
    guardOf.set(match[1], guardIn(match[2]) ?? 'none');
  }
  const routes = new Map();
  for (const match of source.matchAll(/createRoute\(\{([\s\S]*?)\n\s*\}\)/g)) {
    const block = match[1];
    const path = /path: '([^']+)'/.exec(block)?.[1];
    if (path === undefined) continue;
    const component = /component: (\w+)/.exec(block)?.[1];
    // A guard written in the route itself wins; then the named component's; a lazy or foreign component has none here.
    routes.set(path, guardIn(block) ?? (component === undefined ? 'none' : (guardOf.get(component) ?? 'none')));
  }
  return routes;
}

/** The table's rows: path and guard, in source order. */
export function placesOf(source) {
  const rows = [...source.matchAll(/\{ path: '([^']+)', guard: '([^']+)'/g)].map((match) => ({ path: match[1], guard: match[2] }));
  if (rows.length === 0) throw new Error(`${TABLE}: no place was found (looked for "{ path: '…', guard: '…'")`);
  return rows;
}

/** One line per place that is not a route, or whose guard is not the route's. Empty when they agree. */
export function differences(places, routes) {
  const out = [];
  const seen = new Set();
  for (const place of places) {
    if (seen.has(place.path)) out.push(`${place.path} is listed twice`);
    seen.add(place.path);
    const guard = routes.get(place.path);
    if (guard === undefined) out.push(`${place.path} is not a route of the dashboard`);
    else if (guard !== place.guard) out.push(`${place.path} is listed with guard '${place.guard}', and its screen is behind '${guard}'`);
  }
  return out;
}

function selfTest() {
  const router = [
    'function TeamRouteComponent() {\n  return (\n    <StudioGuard requires="users.manage">\n      <Team />\n    </StudioGuard>\n  );\n}',
    'function FilesRouteComponent() {\n  return (\n    <StudioGuard>\n      <Files />\n    </StudioGuard>\n  );\n}',
    "const teamRoute = createRoute({\n  getParentRoute: () => shell,\n  path: '/settings/team',\n  component: TeamRouteComponent,\n})",
    "const filesRoute = createRoute({\n  path: '/files',\n  component: FilesRouteComponent,\n})",
    "const helpRoute = createRoute({\n  path: '/help',\n  component: HelpPageLazy,\n})",
    "const auditRoute = createRoute({\n  path: '/audit',\n  component: () => (\n    <StudioGuard requires=\"audit.read\">\n      <Audit />\n    </StudioGuard>\n  ),\n})",
  ].join('\n\n');
  const routes = routesOf(router);
  const table = (rows) => placesOf(rows.map((row) => `  { path: '${row[0]}', guard: '${row[1]}', name: 'x', what: 'y' },`).join('\n'));
  const agree = differences(table([['/settings/team', 'users.manage'], ['/files', 'studio'], ['/help', 'none'], ['/audit', 'audit.read']]), routes);
  if (agree.length !== 0) throw new Error(`self-test: a table that matches was reported: ${agree.join('; ')}`);
  const differ = differences(table([['/settings/team', 'roles.manage'], ['/gone', 'none'], ['/files', 'none'], ['/help', 'none'], ['/help', 'none']]), routes);
  const expected = ["/settings/team is listed with guard 'roles.manage'", '/gone is not a route', "/files is listed with guard 'none'", '/help is listed twice'];
  for (const text of expected) {
    if (!differ.some((line) => line.includes(text))) throw new Error(`self-test: not reported: ${text} (got ${JSON.stringify(differ)})`);
  }
  if (differ.length !== expected.length) throw new Error(`self-test: reported too much: ${JSON.stringify(differ)}`);
  let threw = false;
  try {
    placesOf('nothing here');
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('self-test: an empty table was not reported');
  console.log('assistant places: the self-test passed.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const routes = new Map();
  for (const file of ROUTERS) for (const [path, guard] of routesOf(readFileSync(join(root, file), 'utf8'))) routes.set(path, guard);
  const places = placesOf(readFileSync(join(root, TABLE), 'utf8'));
  const found = differences(places, routes);
  if (found.length > 0) {
    console.error(`The places the assistant may name (${TABLE}) are not the dashboard's:`);
    for (const line of found) console.error(`  ${line}`);
    console.error('Correct the table: its path and guard are the route\'s (see the header of scripts/check-assistant-places.mjs).');
    process.exit(1);
  }
  console.log(`assistant places ok: ${String(places.length)} places, each a route with the guard listed.`);
}
