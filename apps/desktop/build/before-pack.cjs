// SPDX-License-Identifier: AGPL-3.0-only
/**
 * electron-builder's `beforePack` hook: the server package gets what its npm
 * `prepack` gives it, before it is packed.
 *
 * The server reads three folders beside its `dist/` that are not in git; the
 * server's `prepack` makes them for npm. The archive takes the workspace
 * package as it is on disk, so without this step the app shipped with none of
 * them (0.3.31):
 *
 *  - `vocabulary/llm-allowlist.json` (`bundle-allowlists.mjs`): the widget,
 *    template and icon lists the AI may use. Without it the server starts with
 *    no AI side at all: no Milo ("Route GET:/api/v1/assistant/availability …
 *    not found") and no `/llm` routes;
 *  - `samples/demo-seed.mjs` (`bundle-samples.mjs`): the sample database seed
 *    for `adminium new --sample`. The app's own demo card is handed its copy
 *    in `resources/demo/`; this keeps the packed server the same as npm's;
 *  - `skills/` (`bundle-skills.mjs`): the Designer's skill pages and its
 *    built-in styles. Without it the Designer worked with no skill pages and
 *    its Style picker offered only "Let the Designer choose".
 *
 * The dashboard is not one of them: the app carries its own copy in
 * `resources/`. This runs here, at packing, and not in the build, because the
 * build is cached and these folders are outside its outputs.
 * `after-pack.cjs` then checks the archive holds each one.
 */
const { spawnSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const { join } = require('node:path');

/** The server's own bundling scripts, in the order its `prepack` runs them. */
const BUNDLES = [
  ['bundle-allowlists.mjs', 'the AI allow-lists'],
  ['bundle-samples.mjs', 'the sample database seed'],
  ['bundle-skills.mjs', 'the skills'],
];

exports.BUNDLES = BUNDLES;

exports.default = async function beforePack(context) {
  // The server the archive takes: the workspace package this app links to.
  const server = realpathSync(join(context.packager.projectDir, 'node_modules', '@adminium', 'server'));
  for (const [script, what] of BUNDLES) {
    const done = spawnSync(process.execPath, [join(server, 'scripts', script)], { stdio: 'inherit' });
    if (done.status !== 0) throw new Error(`before-pack: ${what} could not be bundled into ${server} (${script}, exit ${String(done.status)})`);
  }
};
