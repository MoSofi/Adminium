// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `scripts/check-offline-assets.mjs` — the 11-electron.md §7 gate (11-T09).
 *
 * WHY THE TEST LIVES HERE. The script is repo-root because it scans two apps'
 * build outputs, but §7 is this app's chapter and the offline guarantee is this
 * app's promise, so the suite that fails when the gate rots should be this app's
 * too. There is no import edge — the script is SPAWNED, exactly as CI and the
 * `build` script spawn it — which is also what lets a test assert the one thing
 * that matters about a CI gate and cannot be asserted any other way: the exit
 * code. A gate that reports violations and exits 0 is not a gate, and only a real
 * process can tell you which it is.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../../scripts/check-offline-assets.mjs', import.meta.url));
const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway build-output directory holding `files` (name → contents). */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'adminium-offline-'));
  fixtures.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
  return dir;
}

interface Run {
  status: number;
  output: string;
}

/** Spawn the gate over `dir`. Never throws — the exit code IS the assertion. */
function run(dir: string): Run {
  try {
    const stdout = execFileSync(process.execPath, [script, '--root', dir], {
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

describe('check-offline-assets — §7 must-fail list', () => {
  it('fails on a Google Fonts stylesheet link (§7 fonts row)', () => {
    const result = run(
      fixture({
        'index.html':
          '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope&display=swap">',
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fonts.googleapis.com');
    expect(result.output).toContain('blocked-host');
  });

  it('fails on a fonts.gstatic.com woff2 in CSS (the second hop of the same mistake)', () => {
    const result = run(fixture({ 'a.css': '@font-face{src:url(https://fonts.gstatic.com/s/manrope.woff2)}' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fonts.gstatic.com');
  });

  it('fails on a CDN <script> (§7 icons row: no CDN script/link)', () => {
    const result = run(fixture({ 'index.html': '<script src="https://unpkg.com/leaflet/leaflet.js"></script>' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('html-remote-tag');
  });

  it('fails on a Leaflet/OSM tile URL (§7 maps row)', () => {
    const result = run(fixture({ 'app.js': 'const t="https://tile.openstreetmap.org/{z}/{x}/{y}.png";' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('tile.openstreetmap.org');
  });

  it('fails on a remote @import — how Google Fonts is usually added', () => {
    const result = run(fixture({ 'a.css': '@import url("https://fonts.googleapis.com/css2?family=X");' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('css-remote-import');
  });

  // ─── Scheme-relative: the shape that bypassed every rule above ──────────────
  //
  // Every one of the five tests before this writes an explicit `https://`, and
  // every pattern in the script required one — so `//fonts.googleapis.com/css2`,
  // the canonical historical Google Fonts embed, sailed through all four
  // BLOCKED_HOSTS entries and this whole suite reported ok. On a page served from
  // loopback it resolves to `http://fonts.googleapis.com/…`: a real request, and
  // unstyled text at 30,000 feet. There is no CSP on the SPA to catch it either.

  it('fails on a SCHEME-RELATIVE Google Fonts link (no https:, same request)', () => {
    const result = run(
      fixture({ 'index.html': '<link rel="stylesheet" href="//fonts.googleapis.com/css2?family=Inter">' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fonts.googleapis.com');
    // Both rules must see it: the position rule AND the host rule. The host half
    // is the one that was fully bypassable.
    expect(result.output).toContain('html-remote-tag');
    expect(result.output).toContain('blocked-host');
  });

  it('fails on a scheme-relative gstatic preconnect and a jsDelivr script', () => {
    const result = run(
      fixture({
        'index.html': [
          '<link rel="preconnect" href="//fonts.gstatic.com">',
          '<script src="//cdn.jsdelivr.net/npm/chart.js"></script>',
        ].join('\n'),
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fonts.gstatic.com');
    expect(result.output).toContain('cdn.jsdelivr.net');
  });

  it('fails on a scheme-relative @import url() in CSS', () => {
    const result = run(fixture({ 'a.css': '@import url(//fonts.googleapis.com/css2?family=Manrope);' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fonts.googleapis.com');
  });

  it('fails on an ESCAPED-slash tile URL (`https:\\/\\/…`, as JSON-in-a-bundle writes it)', () => {
    // Same root cause: the pattern demanded a literal `//`, and a URL inside a
    // JSON string baked into a chunk does not have one.
    const result = run(
      fixture({ 'app.js': String.raw`const t = "https:\/\/tile.openstreetmap.org/{z}/{x}/{y}.png";` }),
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('tile.openstreetmap.org');
    expect(result.output).toContain('blocked-host');
  });
});

describe('check-offline-assets — the default answer is NO', () => {
  it('fails on a host nobody has reviewed, not merely on the known-bad ones', () => {
    // The whole design in one test: a deny-list only catches the CDNs someone
    // thought of, and the remote asset that breaks the offline build will be one
    // nobody thought of. An unknown host must be a failure by default.
    const result = run(fixture({ 'app.js': 'fetch("https://analytics.some-new-vendor.io/collect");' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('unallowlisted-host');
    expect(result.output).toContain('analytics.some-new-vendor.io');
  });

  it('refuses to pass when the build output is missing (a scan of nothing is not a check)', () => {
    const result = run(join(tmpdir(), 'adminium-offline-does-not-exist'));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('MISSING BUILD OUTPUT');
  });
});

describe('check-offline-assets — what it must NOT flag', () => {
  it('passes the URLs the product legitimately ships', () => {
    // Each of these is in ALLOWED_HOSTS with a reason; together they are the
    // shapes a false positive would most likely take. If this goes red, the gate
    // has started blocking the build for URLs nothing ever fetches.
    const result = run(
      fixture({
        'app.js': [
          'const ns = "http://www.w3.org/2000/svg";',
          'const schema = "https://json-schema.org/draft/2020-12/schema";',
          'const docs = "https://docs.adminium.dev";',
          'const src = "https://github.com/MoSofi/Adminium";',
          'const err = "https://react.dev/errors/";',
          'const ollama = "http://localhost:11434";',
          'const demo = "https://hooks.acme.dev/orders/new";',
          'const sample = "https://your-instance.example/api/v1/tables";',
          'const hint = "https://…";',
        ].join('\n'),
        'index.html': '<link rel="stylesheet" href="/assets/index.css"><script src="/assets/index.js"></script>',
      }),
    );
    expect(result.output).toContain('ok');
    expect(result.status).toBe(0);
  });

  it('does not mistake a JavaScript comment for a scheme-relative URL', () => {
    // The cost of catching `//fonts.googleapis.com`: `//` is also the line
    // comment, so a careless pattern turns every bundle red. A hit needs BOTH a
    // preceding quote/paren AND a dotted host — every line here defeats one of
    // those, and all of them appear in real build output.
    const result = run(
      fixture({
        'app.js': [
          // Scheme-relative only. An EXPLICIT `https://cdn…` in a comment is
          // still a violation and always was — the gate reads literals, not
          // syntax, and a reviewed allowlist entry is the answer for those.
          // What must not fail is the `//` that is merely a comment.
          '// a comment mentioning //fonts.googleapis.com',
          'const sep = "//";',
          'const path = "//" + host;',
          'const re = /^\\/\\/(.+)$/;',
          'const rel = "/assets/app.js";',
          '//# sourceMappingURL=app.js.map',
        ].join('\n'),
      }),
    );
    expect(result.output).toContain('ok');
    expect(result.status).toBe(0);
  });

  it('ignores sourcemaps — they embed original sources, and nothing evaluates them', () => {
    const result = run(fixture({ 'app.js.map': '{"sourcesContent":["// see https://fonts.googleapis.com/x"]}' }));
    expect(result.status).toBe(0);
  });
});
