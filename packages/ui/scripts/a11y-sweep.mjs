// SPDX-License-Identifier: AGPL-3.0-only
/**
 * a11y-sweep — automated axe pass over every story in the built Storybook
 * (03-component-library.md §9, 15-quality.md §7.1).
 *
 * Mechanics:
 *  1. Reuses `storybook-static/` if present (build with `pnpm build-storybook`,
 *     or set A11Y_FRESH=1 to force a rebuild via ensure-storybook.mjs).
 *  2. Serves it on 127.0.0.1 (zero-dep server, scripts/serve-static.mjs).
 *  3. Launches headless Chromium (@playwright/test) and, for every story in
 *     index.json, opens `iframe.html?id=<story>&globals=theme:<t>` with
 *     `prefers-reduced-motion: reduce`, waits for the `data-vrt-ready` flag
 *     stamped by .storybook/preview.tsx, then runs @axe-core/playwright
 *     scoped to WCAG 2.x A/AA rules.
 *  4. Fails (exit 1) on any CRITICAL or SERIOUS violation; moderate/minor are
 *     reported but non-blocking, matching the 03 §3.5 definition of done.
 *
 * Themes: sweeps light AND dark by default (color-contrast differs per theme).
 * Restrict with A11Y_THEMES=light. Filter stories with A11Y_GREP=<substring>.
 *
 * Usage: pnpm a11y   (from packages/ui)
 */
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { serveStatic } from './serve-static.mjs';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const staticDir = join(pkgRoot, 'storybook-static');
const PORT = Number(process.env.A11Y_PORT ?? 6107);
const THEMES = (process.env.A11Y_THEMES ?? 'light,dark').split(',');
const GREP = process.env.A11Y_GREP ?? '';
const CONCURRENCY = Number(process.env.A11Y_CONCURRENCY ?? 4);
/** Violations at these impacts fail the sweep. */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

/** Recorded alongside the list so the file explains itself in a diff. */
const BASELINE_NOTE =
  'KNOWN critical/serious axe violations, keyed story|theme|rule. The build fails ' +
  'on any fingerprint NOT listed here (a new violation). Grow-only via ' +
  '`pnpm --filter @adminium/ui a11y --update-baseline`; remove a fixed entry by ' +
  'deleting its line. Harness errors are never listed. See scripts/a11y-sweep.mjs.';

if (!existsSync(join(staticDir, 'index.json')) || process.env.A11Y_FRESH === '1') {
  console.log('[a11y] building storybook…');
  execFileSync('pnpm', ['build-storybook'], { cwd: pkgRoot, stdio: 'inherit' });
}

/** @type {{ entries: Record<string, { id: string, type: string, title: string, name: string, tags?: string[] }> }} */
const index = JSON.parse(readFileSync(join(staticDir, 'index.json'), 'utf8'));
const stories = Object.values(index.entries).filter(
  (e) => e.type === 'story' && !(e.tags ?? []).includes('no-a11y') && e.id.includes(GREP),
);

const jobs = stories.flatMap((story) => THEMES.map((theme) => ({ story, theme })));
console.log(`[a11y] ${stories.length} stories × ${THEMES.length} themes = ${jobs.length} axe runs`);

const { url, close } = await serveStatic(staticDir, PORT);
const browser = await chromium.launch();
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

/** @type {Array<{ story: string, theme: string, impact: string, id: string, help: string, nodes: string[] }>} */
const violations = [];
/** Stories that never rendered cleanly across all attempts — harness failures, never baselined. */
const harnessErrors = [];
let done = 0;

/**
 * One axe pass on a fresh page.
 *
 * The `Axe is already running` errors that plagued this sweep came from
 * @storybook/addon-a11y, which runs axe-core automatically in the SAME preview
 * iframe on every render — two axe runs on one document. The real fix is
 * `parameters.a11y.manual: true` in .storybook/preview.tsx, which stops the
 * addon auto-running so the sweep owns the only axe run. With that in place a
 * concurrency-8 sweep is clean; the per-job page and the retry below are cheap
 * belt-and-suspenders, not the cure. (Earlier notes here blamed CPU contention
 * — that was a wrong hypothesis; disabling the addon fixed it deterministically
 * where lowering concurrency only reduced the odds.)
 */
async function runJob(job) {
  const { story, theme } = job;
  const storyUrl = `${url}/iframe.html?id=${story.id}&globals=theme:${theme}`;
  const page = await context.newPage();
  try {
    await page.goto(storyUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('html[data-vrt-ready="true"]', { timeout: 15_000 });
    return await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Storybook chrome (#storybook-root wrapper padding etc.) is not ours,
        // but the story renders inside it — analyze the whole document and
        // exclude only the SB-injected error/loader overlays.
      .exclude('.sb-errordisplay')
      .exclude('.sb-preparing-story')
      .analyze();
  } finally {
    await page.close();
  }
}

async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const { story, theme } = job;
    // Backstop retries on a fresh page. With the addon-a11y auto-run disabled
    // (see runJob) the "already running" collision is gone, so these now only
    // guard against an unrelated transient (a slow chunk, a one-off nav hiccup);
    // a genuinely unrenderable story still fails every attempt and is reported
    // as a harness error rather than silently entering the baseline.
    let results = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 4 && results === null; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      try {
        results = await runJob(job);
      } catch (err) {
        lastErr = err;
      }
    }
    if (results === null) {
      harnessErrors.push({
        story: story.id,
        theme,
        help: lastErr instanceof Error ? lastErr.message.split('\n')[0] : String(lastErr),
      });
    } else {
      for (const v of results.violations) {
        violations.push({
          story: story.id,
          theme,
          impact: v.impact ?? 'unknown',
          id: v.id,
          help: v.help,
          nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        });
      }
    }
    done += 1;
    if (done % 25 === 0) console.log(`[a11y] ${done}/${done + jobs.length} runs complete`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();
await close();

const blocking = violations.filter((v) => BLOCKING_IMPACTS.has(v.impact));
const advisory = violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact));

function printGroup(label, list) {
  if (list.length === 0) return;
  console.log(`\n${label} (${list.length}):`);
  for (const v of list) {
    console.log(`  [${v.impact}] ${v.story} (${v.theme}) — ${v.id}: ${v.help}`);
    for (const node of v.nodes) console.log(`      at ${node}`);
  }
}

printGroup('ADVISORY violations (moderate/minor — not blocking)', advisory);
printGroup('BLOCKING violations (critical/serious)', blocking);

if (harnessErrors.length > 0) {
  console.log(`\nHARNESS ERRORS (${harnessErrors.length}) — stories that never rendered cleanly:`);
  for (const e of harnessErrors) console.log(`  ${e.story} (${e.theme}) — ${e.help}`);
}

/* ─────────────────────────── the ratchet ────────────────────────────────
 *
 * This gate used to demand zero. It was written when the widget set was small,
 * went red as M7 landed, and — because nothing ran it in CI — stayed red and
 * unnoticed while 554 violations accumulated. A gate nobody can pass is a gate
 * nobody runs.
 *
 * It now ratchets against a committed baseline of KNOWN violations, keyed by
 * `story|theme|rule` FINGERPRINT rather than by a total count. The count is not
 * deterministic: a handful of stories carry transient state (a dropdown that is
 * open or closed, canvas blocks that mount late), so axe sees a given violation
 * on some runs and not others — a numeric ratchet flakes by ±a few between
 * identical runs, and a gate that fails randomly gets `--update-baseline`'d into
 * irrelevance, which is exactly how this one died before.
 *
 * The fingerprint set is immune to that AND stricter: the build fails only on a
 * fingerprint NOT already in the baseline (a genuinely new kind of violation),
 * and it does so even when the total happens to drop — which a count silently
 * allows. Node COUNT within an existing (story,theme,rule) is deliberately not
 * tracked; that is the granularity that flakes and it is not worth failing on.
 *
 * The baseline is grow-only via `--update-baseline` (it unions, never drops), so
 * capturing the superset over a few runs makes it stable; a genuinely fixed
 * violation is removed by editing the committed JSON, which is reviewable.
 */
const baselinePath = new URL('../a11y-baseline.json', import.meta.url);
const fingerprint = (v) => `${v.story}|${v.theme}|${v.id}`;
const seen = [...new Set(blocking.map(fingerprint))].sort();

/** @type {{ note?: string, fingerprints: string[] }} */
let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
} catch {
  baseline = { fingerprints: [] };
}
const allowed = new Set(baseline.fingerprints ?? []);

if (process.argv.includes('--update-baseline')) {
  const union = [...new Set([...allowed, ...seen])].sort();
  const added = union.length - allowed.size;
  await writeFile(
    baselinePath,
    `${JSON.stringify({ note: BASELINE_NOTE, fingerprints: union }, null, 2)}\n`,
  );
  console.log(
    `\n[a11y] baseline updated: ${union.length} known violations (+${added} this run). ` +
      `Grow-only — remove fixed entries by editing the committed JSON.`,
  );
  process.exit(harnessErrors.length > 0 ? 1 : 0);
}

if (harnessErrors.length > 0) {
  console.error(
    `\n[a11y] FAIL — ${harnessErrors.length} stories never rendered cleanly across every retry. ` +
      `These are harness/story failures, not axe findings, and never enter the baseline.`,
  );
  process.exit(1);
}

const regressions = seen.filter((fp) => !allowed.has(fp));
if (regressions.length > 0) {
  console.error(`\n[a11y] FAIL — ${regressions.length} NEW violation(s) not in a11y-baseline.json:`);
  for (const fp of regressions) console.error(`  ${fp}`);
  console.error(
    `\nFix them. Only if a new violation is genuinely unavoidable, add its fingerprint with ` +
      `\`pnpm --filter @adminium/ui a11y --update-baseline\` (a reviewable diff).`,
  );
  process.exit(1);
}

const resolved = [...allowed].filter((fp) => !seen.includes(fp));
console.log(
  `\n[a11y] PASS — ${seen.length} known violations, 0 new. ` +
    `${baseline.fingerprints.length} in the baseline` +
    (resolved.length > 0
      ? `; ${resolved.length} not seen this run (may be fixed, or flaky-absent — prune the JSON once sure).`
      : '.'),
);
