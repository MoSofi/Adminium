#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium` — the CLI entry point (`bin` in package.json,: "one `npx
 * @adminiumjs/adminium` is a complete install").
 *
 * The only module allowed to end the process. Everything below it returns an
 * exit code; `runCli` is the testable boundary.
 *
 * The Node check runs first, and `run.js` is loaded only after it passes. That
 * is why `run.js` is a dynamic import: ESM runs static imports before this
 * file's own code, and `run.js` reaches better-sqlite3, which crashes an old
 * Node outright instead of throwing (see node-support.ts). The two static
 * imports below have no imports of their own; keep it that way.
 */

import { EXIT_CONFIG } from './exit.js';
import { unsupportedNodeMessage } from './node-support.js';

const refusal = unsupportedNodeMessage(process.versions);

if (refusal !== null) {
  process.stderr.write(refusal);
  process.exitCode = EXIT_CONFIG;
} else {
  const { runCli } = await import('./run.js');
  const code = await runCli(process.argv.slice(2));

  // `start` and the wizard leave a listening server behind: a non-zero code must
  // still exit, but a clean one must NOT tear down a server that is now serving.
  // An explicit exit here would kill it, so instead we let the event loop decide —
  // with no handles left (every other command closes its store), node exits on its
  // own with this code.
  process.exitCode = code;
}
