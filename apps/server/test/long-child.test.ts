// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A program that runs until stopped (the phone door's bundler), started for
 * real: it is the program asked for, with its own arguments; it is ended when
 * stopped; and it says how it ended on its own.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startLongChild } from '../src/designer/child.js';
import { nodeProgram } from '../src/project/programs.js';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'adminium-long-child-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const start = (code: string, ...rest: string[]) => {
  const launch = nodeProgram(['-e', code, '--', ...rest]);
  return startLongChild(launch.command, launch.args, { cwd, env: { ...process.env, ...launch.env } });
};
const until = async (test: () => boolean): Promise<void> => {
  const end = Date.now() + 10_000;
  while (!test()) {
    if (Date.now() > end) throw new Error('waited too long');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('a program that runs until stopped', () => {
  it('is the program asked for, with its arguments, and is ended when stopped', async () => {
    const child = start("console.log('here ' + process.argv.slice(1).join(',')); setInterval(() => {}, 1000);", 'one', 'two');
    await until(() => child.output().includes('here one,two'));
    child.stop();
    expect(await child.ended).toBeNull();
  });

  it('says the code a program ended with on its own', async () => {
    const child = start("console.error('no'); process.exit(7);");
    expect(await child.ended).toBe(7);
    expect(child.output()).toContain('no');
  });
});
