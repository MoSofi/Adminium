// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE `adminium dev` LISTENS: this computer only, unless it is told
 * otherwise.
 *
 * Off loopback the public API is not registered without
 * ADMINIUM_TRUST_PROXY, and dev used to listen on 0.0.0.0: every customer
 * side answered 404 "Route not found" to everything, with one log line to
 * say why. Found building a shop from a website template. A HOST in the
 * environment, the project's `.env` or `--host` still decides, and dev then
 * says before it starts that a customer side will not load there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { fakeDeps, fakeIo, TEST_SECRET } from './cli-helpers.js';

const DEV = { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_PROJECT_MODE: 'dev' };

let root: string;
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function project(dotenv = ''): string {
  root = mkdtempSync(join(tmpdir(), 'adminium-dev-host-'));
  writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"type":"module"}\n');
  writeFileSync(join(root, '.env'), dotenv);
  return root;
}

/** The address the runtime was opened with, and what the command said on stderr. (The fake runtime has no databases, so it stops after.) */
async function started(env: Record<string, string>, argv: string[] = [], dotenv = ''): Promise<{ host: unknown; err: string }> {
  const deps = fakeDeps({ cwd: project(dotenv), env });
  const io = fakeIo();
  await runCli(['start', '--skip-migrate', ...argv], { io, deps });
  expect(deps.openRuntime).toHaveBeenCalledOnce();
  return { host: (vi.mocked(deps.openRuntime).mock.calls[0]?.[0] as { HOST?: unknown }).HOST, err: io.stderr() };
}

describe('where a project listens under `adminium dev`', () => {
  it('is this computer only, with nothing set, and nothing is said', async () => {
    const { host, err } = await started({ ...DEV });
    expect(host).toBe('127.0.0.1');
    expect(err).not.toContain('customer side');
  });

  it('is what HOST, the project’s .env or --host says, and dev says a customer side will not load there', async () => {
    for (const [env, argv, dotenv] of [
      [{ ...DEV, HOST: '0.0.0.0' }, [], ''],
      [{ ...DEV }, [], 'HOST=0.0.0.0\n'],
      [{ ...DEV }, ['--host', '0.0.0.0'], ''],
    ] as const) {
      const { host, err } = await started(env, [...argv], dotenv);
      expect(host).toBe('0.0.0.0');
      expect(err).toContain("An app's customer side will not load on 0.0.0.0: the public API needs ADMINIUM_TRUST_PROXY=1 when HOST is 0.0.0.0.");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says nothing off loopback once the proxy is trusted', async () => {
    const { host, err } = await started({ ...DEV, HOST: '0.0.0.0', ADMINIUM_TRUST_PROXY: '1' });
    expect(host).toBe('0.0.0.0');
    expect(err).not.toContain('customer side');
  });

  it('is left to the server’s own default under `adminium start`', async () => {
    const { host, err } = await started({ ADMINIUM_SECRET: TEST_SECRET });
    expect(host).toBe('0.0.0.0');
    expect(err).not.toContain('customer side');
  });
});
