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
let done = 0;

async function worker() {
  const page = await context.newPage();
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const { story, theme } = job;
    const storyUrl = `${url}/iframe.html?id=${story.id}&globals=theme:${theme}`;
    try {
      await page.goto(storyUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-vrt-ready="true"]', { timeout: 15_000 });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Storybook chrome (#storybook-root wrapper padding etc.) is not ours,
        // but the story renders inside it — analyze the whole document and
        // exclude only the SB-injected error/loader overlays.
        .exclude('.sb-errordisplay')
        .exclude('.sb-preparing-story')
        .analyze();
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
    } catch (err) {
      violations.push({
        story: story.id,
        theme,
        impact: 'critical',
        id: 'sweep-error',
        help: `story failed to render: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
        nodes: [],
      });
    }
    done += 1;
    if (done % 25 === 0) console.log(`[a11y] ${done}/${done + jobs.length} runs complete`);
  }
  await page.close();
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

if (blocking.length > 0) {
  console.error(`\n[a11y] FAIL — ${blocking.length} critical/serious axe violations.`);
  process.exit(1);
}
console.log(`\n[a11y] PASS — zero critical/serious violations across ${stories.length} stories × ${THEMES.join('+')}.`);
