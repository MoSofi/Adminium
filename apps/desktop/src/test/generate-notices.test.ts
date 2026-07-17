/**
 * `scripts/generate-notices.mjs` — the 11-electron.md §13 third-party-notices
 * gate (11-T18).
 *
 * WHY THE TEST LIVES HERE, and why it SPAWNS the script: identical to
 * `check-offline-assets.test.ts` next door. The script is repo-root because it
 * attributes the packaged app's whole production graph, but §13 is this app's
 * chapter and the notices ship in this app's bundle, so the suite that fails when
 * the gate rots is this app's. Spawning it (as CI and the `build` script do) is
 * the only way to assert the one thing that matters about a CI gate — the exit
 * code. A generator that finds an unlicensed dep and exits 0 is not a gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../../scripts/generate-notices.mjs', import.meta.url));
const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway workspace holding named package fixtures. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adminium-notices-'));
  dirs.push(dir);
  return dir;
}

/** Write a fake package (package.json + optional LICENSE) under `root/name`. */
function pkg(root: string, name: string, pkgJson: object, licenseText?: string): string {
  const dir = join(root, name);
  writeFileSync(join(mkdirp(dir), 'package.json'), JSON.stringify(pkgJson), 'utf8');
  if (licenseText !== undefined) writeFileSync(join(dir, 'LICENSE'), licenseText, 'utf8');
  return dir;
}

function mkdirp(dir: string): string {
  execFileSync('mkdir', ['-p', dir]);
  return dir;
}

interface Run {
  status: number;
  output: string;
}

/** Spawn the generator; the exit code IS the assertion. */
function run(args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('generate-notices — produces a notices file', () => {
  it('attributes a licensed package and writes the file', () => {
    const ws = workspace();
    const licensed = pkg(ws, 'ok-lib', { name: 'ok-lib', version: '1.2.3', license: 'MIT' }, 'MIT License\n\nPermission is hereby granted');
    const out = join(ws, 'NOTICES.txt');

    const result = run(['--package', licensed, '--out', out, '--license-src', join(ws, 'no-such-license')]);

    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const body = readFileSync(out, 'utf8');
    expect(body).toContain('ok-lib 1.2.3');
    expect(body).toContain('License: MIT');
    expect(body).toContain('Permission is hereby granted');
  });

  it('accepts a package that declares a licence field but ships no licence file', () => {
    const ws = workspace();
    // Most packages do exactly this — a valid SPDX id and no bundled text.
    const declared = pkg(ws, 'declared-lib', { name: 'declared-lib', version: '2.0.0', license: 'Apache-2.0' });
    const out = join(ws, 'NOTICES.txt');

    const result = run(['--package', declared, '--out', out]);

    expect(result.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('License: Apache-2.0');
  });

  it('stages the bundled LICENSE next to the notices for the §13 in-app viewer', () => {
    const ws = workspace();
    const licensed = pkg(ws, 'ok-lib', { name: 'ok-lib', version: '1.0.0', license: 'MIT' }, 'MIT');
    const out = join(ws, 'NOTICES.txt');
    const licenseOut = join(ws, 'LICENSE');
    const licenseSrc = join(ws, 'repo-LICENSE');
    writeFileSync(licenseSrc, 'GNU AFFERO GENERAL PUBLIC LICENSE', 'utf8');

    const result = run(['--package', licensed, '--out', out, '--license-out', licenseOut, '--license-src', licenseSrc]);

    expect(result.status).toBe(0);
    expect(existsSync(licenseOut)).toBe(true);
    expect(readFileSync(licenseOut, 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });
});

describe('generate-notices — fails the build on an unlicensed dependency (§13)', () => {
  it('exits non-zero and names the package when a dep ships no licence', () => {
    const ws = workspace();
    const bad = pkg(ws, 'bad-lib', { name: 'bad-lib', version: '0.1.0' });
    const out = join(ws, 'NOTICES.txt');

    const result = run(['--package', bad, '--out', out]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('bad-lib');
    expect(result.output).toContain('no license');
    // The whole point: it must NOT have written a notices file it could not fill.
    expect(existsSync(out)).toBe(false);
  });

  it('fails even when only ONE of several deps is unlicensed', () => {
    const ws = workspace();
    const ok = pkg(ws, 'ok-lib', { name: 'ok-lib', version: '1.0.0', license: 'MIT' }, 'MIT');
    const bad = pkg(ws, 'bad-lib', { name: 'bad-lib', version: '0.1.0' });

    const result = run(['--package', ok, '--package', bad, '--out', join(ws, 'NOTICES.txt')]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('bad-lib');
  });
});

describe('generate-notices — the real production graph', () => {
  it('passes: every bundled dependency of the packaged app carries a licence', () => {
    // No --package ⇒ the generator resolves apps/desktop's production graph plus
    // Electron. `--check` validates without writing. If this ever goes red, a new
    // dependency shipped with no attributable licence — a distribution risk, not
    // a flaky test.
    const result = run(['--check']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('no unlicensed dependency');
  });
});
