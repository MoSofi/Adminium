#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit `apps/server/openapi.json` from the live route tree.
 *
 *   node scripts/openapi.mjs [--check]
 *
 * WHY IT IS GENERATED AND NOT WRITTEN. Every `/api/v1` route already declares a
 * zod `schema` — `app.ts`'s `onRoute` hook throws at boot for one that does not
 * — so the request and response shapes are already stated once, in the place
 * that enforces them. A hand-maintained spec would be a second statement of the
 * same thing, and the two would disagree within a release. This reads the first
 * one: `@fastify/swagger` collects the routes, `fastify-type-provider-zod`'s
 * `jsonSchemaTransform` converts their schemas, and `app.swagger()` hands back
 * the document.
 *
 * WHY IT COMPOSES THE REAL SERVER. `buildServer` alone registers six of the
 * seventeen namespaces the dashboard calls; the rest are factories over injected
 * services that only `composeServer` knows how to build (see its header). A spec
 * generated from the skeleton would silently document a third of the API.
 *
 * THE TOPOLOGY IS PINNED, and that is a decision, not an accident. Several
 * resources register only under conditions a spec should not inherit:
 *
 *  - the desktop doors (`/desktop/*`, `POST /auth/desktop-session`) exist only
 *    under `ADMINIUM_RUNTIME=desktop`. They are Electron-shell IPC over HTTP,
 *    not a public API, and 11-electron.md §5 is their contract;
 *  - `POST /bridge/handoff` exists only when `ADMINIUM_BRIDGE_ORIGINS` is set;
 *  - `/llm/*` needs the `@adminium/widgets` vocabulary. The allow-lists gate
 *    RUNTIME validation, never a route schema, so a stand-in vocabulary
 *    produces exactly the same spec as the real one;
 *  - `/meta/*` needs a relocation host, which `adminium start` always supplies
 *    (`cli/relocation-host.ts`) — so it IS in the documented surface.
 *
 * `/public/*` is conditional too, on `ADMINIUM_PUBLIC_API_ORIGINS`, and it IS
 * documented — the opposite call from the bridge, for the opposite reason. The
 * bridge is Electron-shell IPC that happens to travel over HTTP; the public
 * namespace is the most externally-consumed surface in the product, and the
 * people who need its reference are exactly the ones writing a client against
 * it. A public API missing from the API reference is the inverse of the
 * documented-but-unimplemented problem, and just as expensive.
 *
 * The result is the API a normal self-hosted instance serves.
 *
 * `--check` regenerates into memory and fails when it differs from the committed
 * file, the same shape as `bundle-allowlists.mjs --check`: the artifact is
 * committed, so a route or schema change that nobody re-generated for is caught
 * in review rather than shipped as a stale contract.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const OUT_FILE = join(serverRoot, 'openapi.json');
const DIST = join(serverRoot, 'dist');

const check = process.argv.includes('--check');

if (!existsSync(join(DIST, 'compose.js'))) {
  console.error(
    `The server build is missing at ${DIST}.\n` +
      'Build it first: pnpm --filter @adminium/server build',
  );
  process.exit(1);
}

/**
 * The server's dist imports the workspace packages' dists in turn, so a
 * half-built tree fails deep inside Node's resolver with a path and no advice.
 * One catch turns that into the command that fixes it.
 */
async function load(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    console.error(
      `${error.message}\n\nThe workspace is not fully built. Build it: pnpm turbo run build`,
    );
    process.exit(1);
  }
}

const { default: BetterSqlite3 } = await load('better-sqlite3');
const { createSqliteMetaDb, firstRun } = await load('@adminium/meta');
const { composeServer } = await load(join(DIST, 'compose.js'));
const { envSchema } = await load(join(DIST, 'config/env.js'));
const { ConnectionManager } = await load(join(DIST, 'connections/manager.js'));
const { dsnCryptoFromSecret } = await load(join(DIST, 'connections/crypto.js'));
const { createRunService } = await load(join(DIST, 'llm/run-service.js'));
const { createApplyService } = await load(join(DIST, 'llm/apply-service.js'));

/**
 * A throwaway in-memory meta store. `composeServer` opens repositories and
 * mirrors a setting or two at boot; it never needs real data to REGISTER a
 * route, which is all this script reads.
 */
const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
await firstRun(meta);

const env = envSchema.parse({
  // Long enough for the §1.2 cookie signer and the DSN/LLM key crypto. It signs
  // nothing that outlives this process.
  ADMINIUM_SECRET: 'openapi-spec-generation-placeholder-secret',
  // INCLUDED, unlike the other conditional resources — see the topology note
  // above. Loopback host so D21's TRUST_PROXY requirement is satisfied without
  // asserting a proxy that is not there.
  ADMINIUM_PUBLIC_API_ORIGINS: 'https://example.com',
  HOST: '127.0.0.1',
});

const metaStore = {
  meta,
  url: 'sqlite::memory:',
  engine: 'sqlite',
  source: 'embedded',
  close: async () => {},
};

const runService = createRunService({ meta });
const composed = await composeServer({
  env,
  metaStore,
  manager: new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
    metaDsn: null,
  }),
  runService,
  applyService: createApplyService({ meta, runService }),
  // Registers `/llm/*` without reaching for the built widget registry — see the
  // header: the vocabulary never reaches a route schema.
  allowed: { templates: [], widgets: [], widgetDataContracts: {} },
  logger: false,
  telemetry: false,
  openapi: true,
  // Documents `/meta/placement` + `/meta/relocate`, which `adminium start` serves.
  onMetaRelocated: () => {},
});

await composed.app.ready();
const document = composed.app.swagger();
await composed.app.close();
await meta.db.destroy();

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const pathCount = Object.keys(document.paths ?? {}).length;

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(
      `${OUT_FILE} is missing.\nGenerate it: pnpm --filter @adminium/server run openapi`,
    );
    process.exit(1);
  }
  const committed = await readFile(OUT_FILE, 'utf8');
  if (committed !== serialized) {
    console.error(
      `${OUT_FILE} is STALE — the route tree no longer matches the committed spec.\n` +
        'Re-generate it: pnpm --filter @adminium/server run openapi',
    );
    process.exit(1);
  }
  console.log(`ok — openapi.json matches the route tree (${String(pathCount)} paths)`);
  process.exit(0);
}

await writeFile(OUT_FILE, serialized, 'utf8');
console.log(`Wrote ${OUT_FILE} (${String(pathCount)} paths)`);
