// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Process entrypoint: loadEnv → buildServer → listen, with graceful shutdown
 * on SIGTERM/SIGINT (01-architecture.md §8.1 — the fuller boot sequence gains
 * meta connect/migrations/backup gates in wave 2).
 */
import { buildServer, type AdminiumServer } from './app.js';
import { loadEnv } from './config/env.js';

export interface StartOptions {
  /** Injectable for tests; defaults to the real `process`. */
  proc?: Pick<NodeJS.Process, 'once' | 'exit'> | undefined;
}

export async function start(opts: StartOptions = {}): Promise<AdminiumServer> {
  const proc = opts.proc ?? process;
  const env = loadEnv();
  const app = await buildServer({ env });

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => proc.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        proc.exit(1);
      },
    );
  };
  proc.once('SIGTERM', () => shutdown('SIGTERM'));
  proc.once('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: env.HOST });
  return app;
}
