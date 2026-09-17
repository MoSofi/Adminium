// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `scripts/dev-setup.mjs` — the step `pnpm dev` runs before anything else.
 *
 * WHY THE TEST LIVES HERE. The script is repo-root because `pnpm dev` is, but
 * what it writes is this app's environment: `ADMINIUM_SECRET` and
 * `ADMINIUM_SOURCE_URL` are read by `apps/server/src/config/env.ts` and by
 * nothing else. There is no import edge — the script is SPAWNED, exactly as
 * `pnpm dev` spawns it, which is also the only way to assert the thing that
 * matters most about it.
 *
 * ─── The rule that must never break silently ───────────────────────────────
 *
 * `ADMINIUM_SECRET` derives, through HKDF, the key that encrypts every stored
 * DSN and API key. A secret regenerated on a later run would make everything
 * already stored undecryptable — and the failure would arrive long after the
 * change that caused it, on someone else's machine, looking like data
 * corruption rather than like a setup script. That is precisely the shape of
 * bug a test has to hold, because no reviewer will notice its absence.
 *
 * So the first assertion here is a second run: byte-identical `.env`.
 *
 * ─── Why it runs in a COPY of the repo ─────────────────────────────────────
 *
 * The script derives the repo root from its own location, which is the right
 * design for a `pnpm dev` step and means it cannot be pointed elsewhere by a
 * flag. Running it in place would write into the developer's own `.env`. So the
 * fixture mirrors the three paths it touches — the script, the demo seed, and
 * `apps/server/package.json` (for `better-sqlite3`, which is this app's
 * dependency and not the root's) — and the copy writes into the temp dir.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const script = join(repoRoot, 'scripts', 'dev-setup.mjs');
const seed = join(repoRoot, 'apps', 'desktop', 'resources', 'demo', 'demo-seed.mjs');

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A minimal mirror of the repo: only the paths the script reads. */
function fixture(): string {
  // realpath: on macOS the temp dir is /var/... which is a symlink to
  // /private/var/..., and the script resolves the real path. Comparing the two
  // spellings is a false failure, not a bug in either.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-dev-setup-')));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(script, join(root, 'scripts', 'dev-setup.mjs'));
  mkdirSync(join(root, 'apps', 'desktop', 'resources', 'demo'), { recursive: true });
  cpSync(seed, join(root, 'apps', 'desktop', 'resources', 'demo', 'demo-seed.mjs'));
  mkdirSync(join(root, 'apps', 'server'), { recursive: true });
  // Symlinked, not copied: node_modules is large and the script only resolves
  // `better-sqlite3` through this package's manifest.
  symlinkSync(join(repoRoot, 'apps', 'server', 'package.json'), join(root, 'apps', 'server', 'package.json'));
  symlinkSync(join(repoRoot, 'apps', 'server', 'node_modules'), join(root, 'apps', 'server', 'node_modules'));
  return root;
}

function run(root: string, env: Record<string, string> = {}, args: string[] = []): string {
  return execFileSync(process.execPath, [join(root, 'scripts', 'dev-setup.mjs'), ...args], {
    encoding: 'utf8',
    // A clean environment: the developer's own ADMINIUM_* must not leak in and
    // change what the script decides to do.
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...env },
  });
}

function envValue(root: string, key: string): string | null {
  const path = join(root, '.env');
  if (!existsSync(path)) return null;
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(readFileSync(path, 'utf8'));
  return m === null ? null : (m[1] ?? '').trim();
}

describe('scripts/dev-setup.mjs', () => {
  it('makes a fresh clone runnable: a secret, a sample database, and a source to boot on', () => {
    const root = fixture();
    const out = run(root);

    expect(out).toContain('wrote .env with a new ADMINIUM_SECRET');
    expect(out).toContain('created .dev/sample.db');
    expect(out).toContain('pointed ADMINIUM_SOURCE_URL at the sample database');

    // 32 random bytes, hex.
    expect(envValue(root, 'ADMINIUM_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(root, '.dev', 'sample.db'))).toBe(true);
    // ABSOLUTE: a relative sqlite path would resolve against the server's own
    // working directory, which is apps/server under the dev watcher.
    expect(envValue(root, 'ADMINIUM_SOURCE_URL')).toBe(`sqlite:${join(root, '.dev', 'sample.db')}`);
  });

  it('NEVER regenerates the secret — a second run is byte-identical', () => {
    const root = fixture();
    run(root);
    const first = readFileSync(join(root, '.env'), 'utf8');

    const out = run(root);

    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(first);
    expect(out).toContain('nothing to do');
  });

  it('fills in an empty ADMINIUM_SECRET in place, which is the `.env.example` copy', () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), '# mine\nADMINIUM_SECRET=\nPORT=4600\n', 'utf8');

    const out = run(root);

    expect(out).toContain('filled in the empty ADMINIUM_SECRET');
    expect(envValue(root, 'ADMINIUM_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    // Nothing else in the file moved.
    const body = readFileSync(join(root, '.env'), 'utf8');
    expect(body).toContain('# mine');
    expect(body).toContain('PORT=4600');
    // And exactly one line defines it.
    expect(body.match(/^ADMINIUM_SECRET=/gm)).toHaveLength(1);
  });

  it('never overrides a source the developer configured, and builds no sample it would not use', () => {
    const root = fixture();
    const mine = 'postgres://localhost:5432/mine';
    writeFileSync(join(root, '.env'), `ADMINIUM_SECRET=${'a'.repeat(64)}\nADMINIUM_SOURCE_URL=${mine}\n`, 'utf8');

    const out = run(root);

    expect(envValue(root, 'ADMINIUM_SOURCE_URL')).toBe(mine);
    expect(existsSync(join(root, '.dev', 'sample.db'))).toBe(false);
    expect(out).toContain('nothing to do');
  });

  it('treats a source in the SHELL as configured too', () => {
    const root = fixture();

    const out = run(root, { ADMINIUM_SOURCE_URL: 'postgres://shell/db' });

    // The secret still gets written — that one is per-clone, not per-shell.
    expect(envValue(root, 'ADMINIUM_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(envValue(root, 'ADMINIUM_SOURCE_URL')).toBe(null);
    expect(out).not.toContain('pointed ADMINIUM_SOURCE_URL');
  });

  it('`--print` changes nothing', () => {
    const root = fixture();

    const out = run(root, {}, ['--print']);

    expect(out).toContain('would:');
    expect(existsSync(join(root, '.env'))).toBe(false);
    expect(existsSync(join(root, '.dev'))).toBe(false);
  });

  it('reports a missing seed script and still writes the secret, because it must never fail `pnpm dev`', () => {
    const root = fixture();
    rmSync(join(root, 'apps', 'desktop', 'resources', 'demo', 'demo-seed.mjs'));

    const out = run(root);

    expect(out).toContain('wrote .env with a new ADMINIUM_SECRET');
    expect(out).toContain('skipped the sample database');
    expect(envValue(root, 'ADMINIUM_SECRET')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is what `pnpm dev` runs, and `.dev/` is not committed', () => {
    // The wiring is the feature: a script nothing calls sets nothing up.
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev']).toMatch(/^node scripts\/dev-setup\.mjs &&/);
    expect(readFileSync(join(repoRoot, '.gitignore'), 'utf8')).toMatch(/^\/\.dev\/$/m);
    // And `dev` builds what it needs first, so a fresh clone needs no `pnpm build`.
    const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { dependsOn?: string[] }>;
    };
    expect(turbo.tasks['dev']?.dependsOn).toContain('^build');
  });

  it('is the three commands CONTRIBUTING.md promises', () => {
    const contributing = readFileSync(join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing).toContain('corepack enable');
    expect(contributing).toContain('pnpm install');
    expect(contributing).toContain('pnpm dev');
    // The comment rule and the decision pages both live here now.
    expect(contributing).toContain('anatomy/decisions');
    expect(contributing).toContain('Leave the history to git');
  });
});
