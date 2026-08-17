// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM allowed-vocabulary loading for the CLI.
 *
 * `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` live in `@adminium/widgets`,
 * which **the server tree may never import** (01-architecture.md §2.3, enforced
 * by `.dependency-cruiser.cjs` `server-no-ui-widgets-charts`). Routes solve this
 * by having the app-wiring layer inject them (`LlmRoutesDeps.allowed`); the CLI
 * has no wiring layer above it, so it reads them as DATA at runtime. Every
 * specifier below is computed, so no static import edge exists for the rule to
 * catch and none is created — the ban is about the compiled import graph, and
 * this respects it.
 *
 * THE CANDIDATE ORDER IS THE WHOLE POINT. `@adminium/widgets` is not a
 * dependency of `@adminium/server` and cannot become one: it is `private: true`,
 * so it can never be published, and `pnpm deploy --filter=@adminium/server
 * --prod` (the Dockerfile) injects only declared workspace deps. Probing
 * node_modules or a monorepo `packages/` path therefore finds NOTHING in any
 * deployed artifact — the image and the tarball both — and both LLM subcommands
 * died there with a "run `pnpm --filter @adminium/widgets build`" hint that a
 * container or npm user cannot act on. So the build SNAPSHOTS the two lists into
 * the package itself (`scripts/bundle-allowlists.mjs`, run at `prepack` beside
 * the dashboard bundling) and that snapshot is probed FIRST. The dist paths
 * remain as the dev-checkout fallback, where they do work and where nobody
 * should have to run a bundling step to use the CLI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { AllowedVocabularies } from '@adminium/llm';

import { CliError } from './exit.js';

/** Path inside the widgets package that exports the two allow-lists. */
const ALLOWLIST_SUBPATH = join('dist', 'registry', 'llm-allowlist.js');

/**
 * The build-emitted snapshot inside the published package. Kept next to the
 * resolver so `scripts/bundle-allowlists.mjs` and this lookup share one path.
 */
export const BUNDLED_VOCABULARY_FILE = join('vocabulary', 'llm-allowlist.json');

function packageRoot(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

/**
 * Candidate allow-list sources, in precedence order. Exported for the test — the
 * point of the resolver is the ORDER, and asserting on it beats asserting on
 * whichever candidate happens to exist on the machine running the suite.
 */
export function allowlistCandidates(moduleUrl: string = import.meta.url): string[] {
  const root = packageRoot(moduleUrl);
  return [
    // Published/deployed: the JSON snapshot this package carries. FIRST, because
    // it is the only one that exists in the Docker image or an npm install.
    join(root, BUNDLED_VOCABULARY_FILE),
    // Dev checkout: apps/server/../../packages/widgets/… (what demo-v01.mjs uses).
    join(root, '..', '..', 'packages', 'widgets', ALLOWLIST_SUBPATH),
    // A hoisted node_modules layout that happens to expose the package.
    join(root, 'node_modules', '@adminium', 'widgets', ALLOWLIST_SUBPATH),
  ].map((candidate) => resolve(candidate));
}

interface AllowlistModule {
  LLM_ALLOWED_TEMPLATES?: readonly string[];
  LLM_ALLOWED_WIDGETS?: readonly string[];
  LLM_WIDGET_DATA_CONTRACTS?: Readonly<Record<string, readonly string[]>>;
}

/** Read one candidate; `null` when it is absent or does not carry both lists. */
async function readCandidate(candidate: string): Promise<AllowedVocabularies | null> {
  if (!existsSync(candidate)) return null;
  let mod: AllowlistModule;
  if (candidate.endsWith('.json')) {
    try {
      mod = JSON.parse(readFileSync(candidate, 'utf8')) as AllowlistModule;
    } catch {
      return null;
    }
  } else {
    // Computed specifier: a file URL, never a package name — no static edge.
    mod = (await import(pathToFileURL(candidate).href)) as AllowlistModule;
  }
  const templates = mod.LLM_ALLOWED_TEMPLATES;
  const widgets = mod.LLM_ALLOWED_WIDGETS;
  if (templates === undefined || widgets === undefined) return null;
  // Optional on purpose: a snapshot bundled before widget contracts existed
  // still satisfies this loader, and the apply planner degrades to choosing a
  // binding shape from the bound columns rather than refusing to load.
  const widgetContracts = mod.LLM_WIDGET_DATA_CONTRACTS;
  return widgetContracts === undefined
    ? { templates, widgets }
    : { templates, widgets, widgetContracts };
}

/**
 * Load the allow-lists. Throws a {@link CliError} when no candidate resolves —
 * in a shipped artifact that means the `prepack` bundling step did not run,
 * which is a packaging bug; in a dev tree it means the widgets dist is unbuilt.
 * The hint names both, because the message has to be actionable for whichever
 * of the two the reader is holding.
 */
export async function loadAllowedVocabularies(
  moduleUrl: string = import.meta.url,
): Promise<AllowedVocabularies> {
  for (const candidate of allowlistCandidates(moduleUrl)) {
    const loaded = await readCandidate(candidate);
    if (loaded !== null) return loaded;
  }
  throw new CliError('The widget vocabulary is missing, so no AI prompt can be built.', {
    hint:
      'In a source checkout, build it: `pnpm --filter @adminium/widgets build`.\n' +
      'In a released build this is a packaging bug — please report it, quoting your ' +
      '`adminium --version`.',
  });
}
