#!/usr/bin/env node
/**
 * `adminium` — the CLI entry point (`bin` in package.json, 01-architecture.md
 * §4.1: "one `npx adminium` is a complete install").
 *
 * The only module allowed to end the process. Everything below it returns an
 * exit code; `runCli` is the testable boundary.
 */

import { runCli } from './run.js';

const code = await runCli(process.argv.slice(2));

// `start` and the wizard leave a listening server behind: a non-zero code must
// still exit, but a clean one must NOT tear down a server that is now serving.
// An explicit exit here would kill it, so instead we let the event loop decide —
// with no handles left (every other command closes its store), node exits on its
// own with this code.
process.exitCode = code;
