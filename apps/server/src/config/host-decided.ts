// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The variables a project folder never decides when a host opens it: the desktop app, and any server in trial or
 * hosted mode (`project/boot.ts`). Kept here, apart from `cli/start-project.ts` which re-exports it, so the project
 * boot can read it without importing the CLI.
 */
import { OPERATOR_DECIDED_ENV } from './env.js';

/**
 * What a host that opens folders it did not make must decide itself: where the
 * server listens, what it trusts, what it runs and where its own files are. A
 * folder's `.env` that names one of these is not obeyed (and is told so).
 *
 * `NODE_OPTIONS`, `PATH` and `ELECTRON_RUN_AS_NODE` are here because the
 * environment the file fills is handed on to every program the server starts.
 */
export const HOST_DECIDED_ENV: readonly string[] = [
  'HOST',
  'PORT',
  'ADMINIUM_HOST',
  'ADMINIUM_PORT',
  'ADMINIUM_RUNTIME',
  'ADMINIUM_BOOT_TOKEN',
  'ADMINIUM_STATIC_ROOT',
  'ADMINIUM_BUNDLED_ADD_ONS',
  'ADMINIUM_BUNDLED_APPS',
  'ADMINIUM_DEMO_SEED_SCRIPT',
  'ADMINIUM_TRUST_PROXY',
  'ADMINIUM_TRUSTED_PROXIES',
  'ADMINIUM_DESIGNER',
  // Signs the archives this host restores: the operator's key, never a folder's.
  'ADMINIUM_ARCHIVE_KEY',
  // Written into every staff browser's content security policy, or called by the server: not a folder's to choose.
  'ADMINIUM_MAP_SERVER',
  'ADMINIUM_ROUTING_SERVER',
  'ADMINIUM_PROJECT_MODE',
  'ADMINIUM_PROJECT_DIR',
  'ADMINIUM_DESKTOP_PROJECT',
  'ADMINIUM_DESKTOP_PROGRAMS',
  'ADMINIUM_DESKTOP_SINGLE_USER',
  /*
   * Every trial and operator variable (plan 75 §5.1, S8): who may reach what, which databases, folders and
   * network, the setup token, the links shown, the operator endpoint and AI. In trial and hosted mode the
   * folder's `.env` is not read at all and its config cannot set these (`project/boot.ts`).
   */
  ...OPERATOR_DECIDED_ENV,
  'NODE_OPTIONS',
  'PATH',
  'ELECTRON_RUN_AS_NODE',
];
