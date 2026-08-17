#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit the LLM allow-lists into the published package.
 *
 *   node scripts/bundle-allowlists.mjs [--check]
 *
 * WHY THIS EXISTS. `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` are derived
 * from the live registries in `@adminium/widgets`, which the server tree may
 * never import (01-architecture.md §2.3). The CLI therefore loaded them from the
 * built widgets dist BY FILE PATH — fine in a monorepo checkout, dead in every
 * deployed artifact:
 *
 *  - the Docker image runs `pnpm deploy --filter=@adminium/server --prod`, which
 *    injects only the server's DECLARED workspace deps. `@adminium/widgets` is
 *    not one (and is `private: true`, so it can never be a published dependency
 *    either). Both LLM subcommands died with "The widget registry build is
 *    missing", hinting at a `pnpm --filter` command a container user cannot run;
 *  - a future `npx adminium` tarball ships `dist` + `dashboard` only.
 *
 * So the build SNAPSHOTS the two lists — pure JSON data, no code, no import edge
 * — into `<package>/vocabulary/`, which is on the `files` allow-list and is the
 * first candidate `src/cli/allowlist.ts` probes. Same shape as
 * `bundle-dashboard.mjs`: the artifact carries what it needs, because the
 * workspace it was built from is not there at run time.
 *
 * `--check` verifies the emitted file is present and well-formed without
 * writing, so the release pipeline can fail loudly rather than publish a tarball
 * whose AI assist is dead on arrival.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const repoRoot = join(serverRoot, '..', '..');

/** Must match `BUNDLED_VOCABULARY_FILE` in src/cli/allowlist.ts. */
const OUT_DIR = join(serverRoot, 'vocabulary');
const OUT_FILE = join(OUT_DIR, 'llm-allowlist.json');

const source = join(repoRoot, 'packages', 'widgets', 'dist', 'registry', 'llm-allowlist.js');
const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(
      `LLM allow-lists not bundled at ${OUT_FILE}.\n` +
        'Run: node apps/server/scripts/bundle-allowlists.mjs',
    );
    process.exit(1);
  }
  const parsed = JSON.parse(await readFile(OUT_FILE, 'utf8'));

  // STALENESS, not just well-formedness. The snapshot is written at prepack and
  // read FIRST by src/cli/allowlist.ts, so in a dev checkout it silently
  // outranks a freshly built widgets dist. That is not hypothetical: a contract
  // corrected in the registry but not re-bundled here made the apply planner
  // bind a widget from the stale contract and re-shape a working dashboard
  // tile. When the dist is present, the snapshot must equal it.
  if (existsSync(source)) {
    const live = await import(pathToFileURL(source).href);
    const drifted = [];
    if (JSON.stringify(live.LLM_ALLOWED_TEMPLATES) !== JSON.stringify(parsed.LLM_ALLOWED_TEMPLATES)) {
      drifted.push('LLM_ALLOWED_TEMPLATES');
    }
    if (JSON.stringify(live.LLM_ALLOWED_WIDGETS) !== JSON.stringify(parsed.LLM_ALLOWED_WIDGETS)) {
      drifted.push('LLM_ALLOWED_WIDGETS');
    }
    if (
      JSON.stringify(live.LLM_WIDGET_DATA_CONTRACTS) !==
      JSON.stringify(parsed.LLM_WIDGET_DATA_CONTRACTS)
    ) {
      drifted.push('LLM_WIDGET_DATA_CONTRACTS');
    }
    if (drifted.length > 0) {
      console.error(
        `${OUT_FILE} is STALE — ${drifted.join(', ')} differ(s) from the built registry.\n` +
          'Re-bundle: node apps/server/scripts/bundle-allowlists.mjs',
      );
      process.exit(1);
    }
  }

  const ok =
    Array.isArray(parsed.LLM_ALLOWED_TEMPLATES) &&
    parsed.LLM_ALLOWED_TEMPLATES.length > 0 &&
    Array.isArray(parsed.LLM_ALLOWED_WIDGETS) &&
    parsed.LLM_ALLOWED_WIDGETS.length > 0 &&
    // Every allow-listed widget must carry its data contract, or the apply
    // planner cannot pick a binding shape the widget can read.
    parsed.LLM_WIDGET_DATA_CONTRACTS !== null &&
    typeof parsed.LLM_WIDGET_DATA_CONTRACTS === 'object' &&
    parsed.LLM_ALLOWED_WIDGETS.every((id) =>
      Array.isArray(parsed.LLM_WIDGET_DATA_CONTRACTS[id]),
    );
  if (!ok) {
    console.error(`${OUT_FILE} is present but carries no allow-lists.`);
    process.exit(1);
  }
  console.log(
    `ok — ${String(parsed.LLM_ALLOWED_TEMPLATES.length)} template(s), ` +
      `${String(parsed.LLM_ALLOWED_WIDGETS.length)} widget(s) bundled`,
  );
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(
    `Widget registry build not found at ${source}.\n` +
      'Build it first: pnpm --filter @adminium/widgets build',
  );
  process.exit(1);
}

// Computed specifier (a file URL, never a package name) — no static import edge
// for `.dependency-cruiser.cjs` `server-no-ui-widgets-charts` to catch, and none
// created: this script is build tooling, and what it writes is data.
const mod = await import(pathToFileURL(source).href);
const templates = mod.LLM_ALLOWED_TEMPLATES;
const widgets = mod.LLM_ALLOWED_WIDGETS;
const widgetContracts = mod.LLM_WIDGET_DATA_CONTRACTS;

if (!Array.isArray(templates) || !Array.isArray(widgets)) {
  console.error(`${source} does not export LLM_ALLOWED_TEMPLATES / LLM_ALLOWED_WIDGETS.`);
  process.exit(1);
}
if (widgetContracts === null || typeof widgetContracts !== 'object') {
  console.error(`${source} does not export LLM_WIDGET_DATA_CONTRACTS.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  OUT_FILE,
  `${JSON.stringify(
    {
      LLM_ALLOWED_TEMPLATES: templates,
      LLM_ALLOWED_WIDGETS: widgets,
      LLM_WIDGET_DATA_CONTRACTS: widgetContracts,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(
  `Bundled LLM allow-lists → ${OUT_FILE} ` +
    `(${String(templates.length)} templates, ${String(widgets.length)} widgets)`,
);
