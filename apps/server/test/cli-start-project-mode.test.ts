// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a project's server runs as `adminium dev` or as a server is what
 * the PROCESS was started as. A project's `.env` is deployed with the folder,
 * so a line in it must never turn a real server into a developer's machine:
 * under dev the folder's apps may install add-ons, change tables that are not
 * theirs and be given public access without the config saying so.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { fakeDeps, fakeIo, TEST_SECRET } from './cli-helpers.js';

const ENV = { ADMINIUM_SECRET: TEST_SECRET };

let root: string;
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project whose config needs no build, with a `.env` that asks for dev. */
function project(): string {
  root = mkdtempSync(join(tmpdir(), 'adminium-mode-'));
  writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"type":"module"}\n');
  writeFileSync(join(root, '.env'), 'ADMINIUM_PROJECT_MODE=dev\n');
  return root;
}

/**
 * What the runtime was opened with. Dev is the only mode that gives the public
 * API an origin of its own accord, so that value says which mode was taken.
 * (The fake runtime has no databases to connect, so the command stops after it.)
 */
async function publicOrigins(env: Record<string, string>): Promise<unknown> {
  const deps = fakeDeps({ cwd: project(), env });
  await runCli(['start', '--skip-migrate'], { io: fakeIo(), deps });
  expect(deps.openRuntime).toHaveBeenCalledOnce();
  return (vi.mocked(deps.openRuntime).mock.calls[0]?.[0] as { ADMINIUM_PUBLIC_API_ORIGINS?: unknown }).ADMINIUM_PUBLIC_API_ORIGINS;
}

describe('the mode a project’s server runs in', () => {
  it('is a server under `adminium start`, whatever the project’s .env says', async () => {
    expect(await publicOrigins({ ...ENV })).toBeUndefined();
  });

  it('is dev when the process was started as dev', async () => {
    expect(await publicOrigins({ ...ENV, ADMINIUM_PROJECT_MODE: 'dev' })).toBeDefined();
  });
});
