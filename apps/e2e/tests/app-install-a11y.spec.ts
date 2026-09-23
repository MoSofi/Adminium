// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/apps` and the install wizard under axe: the page with nothing
 * installed, the page with an app on it, the uninstall dialog, and each of
 * the wizard's steps — including the plan step with its DDL preview open,
 * which is the one state that paints a dark code block on a themed page.
 * Each in light and dark, in English and in Arabic (right to left) — every
 * string the flow looks for is read from the locale files by key
 * (`localeText.ts`). Zero serious/critical violations is the gate; lesser
 * counts are annotated per state so a regression in them is visible in the
 * report.
 *
 * Also the states an install passes through that are easy to leave unswept:
 * stopped part way (the server's own 409 reply to a first attempt), Done, and
 * an install from before prefixes (its banner and the rename dialog).
 *
 * The online app catalogue adds two more (b G8-D7): the shelf with catalogue
 * rows on it — a switch, a warn-toned "needs a newer Adminium" line and a
 * disabled Install, none of which the offline shelf paints — and the update
 * consent dialog, which is a second DDL block inside a modal. Both are reached
 * WITHOUT the network: the cached catalogue document is written into the store
 * by hand and the update is to a version already on disk, exactly as
 * `app-catalogue.spec.ts` does it.
 *
 * THE SWEEP ASSERTS IT ANALYSED SOMETHING. An `AxeBuilder` pointed at a
 * selector that matches nothing returns zero violations and reports success, so
 * every state also asserts a floor on `passes` — without it this file could go
 * green while measuring an empty page, which is the failure mode a11y suites
 * fail in silently.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * modal `aria-hidden` and traps focus inside it; axe's `aria-hidden-focus` rule
 * reads the trapped-out background as "hidden but focusable" and fails every
 * overlay in the product. That conflict is recorded and is not masked here —
 * page-level states still run over the whole document.
 *
 * Theme is the signed-in user's own pref, restored afterwards, because the
 * suite shares one seeded account and runs serially.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { APP_KEY, APP_NEXT_VERSION, APP_VERSION, appBundle } from './appBundle.js';
import { signIn, serverDataDir } from './helpers.js';
import { textIn } from './localeText.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

interface Sweep {
  states: number;
  minor: number;
  failures: string[];
}

async function sweep(
  page: Page,
  label: string,
  tally: Sweep,
  testInfo: TestInfo,
  within?: string,
): Promise<void> {
  // Overlays fade in; axe reads computed colours, so a dialog measured
  // mid-transition reports backdrop-blended colours and fails contrast it
  // passes at rest.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();

  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(10);

  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) {
    testInfo.annotations.push({
      type: 'axe-lesser',
      description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}`,
    });
  }
  const report = blocking
    .map(
      (v) =>
        `${String(v.impact)}: ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}`)
          .join('\n'),
    )
    .join('\n');
  // Collected, not thrown: one run should name EVERY failing state.
  if (blocking.length > 0) tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
}

/**
 * The cached catalogue document, written where the store reads it.
 *
 * A refresh is a JOB that fetches adminium.dev, and no sweep is worth an
 * outbound call from CI — the file is the same one it would have written.
 */
function catalogueCacheFile(): string {
  return join(serverDataDir(), 'apps', '.catalog-cache.json');
}

async function withCatalogueOnline(page: Page): Promise<void> {
  mkdirSync(join(serverDataDir(), 'apps'), { recursive: true });
  writeFileSync(
    catalogueCacheFile(),
    `${JSON.stringify({
      fetchedAt: Date.now(),
      document: {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        apps: [
          {
            key: 'e2e-future',
            version: '2.0.0',
            integrity: 'sha512-Yy5rnBbCoEEyi5SFAhXCd3gWGpQaqBRjocnSlS0cOG0=',
            // The website's short locale codes, which is what the feed carries.
            name: { en: 'E2E Future' },
            tagline: { en: 'A release this server is too old for.' },
            categories: ['operations'],
            capabilities: [],
            publisher: 'Adminium',
            sides: ['staff'],
            // No Adminium has this, so the warn line is earned, not rigged.
            minAdminiumVersion: '99.0.0',
          },
        ],
      },
    })}\n`,
    { mode: 0o600 },
  );
  const reply = await page.request.put('/api/v1/apps/catalog', { data: { enabled: true } });
  expect(reply.ok(), await reply.text()).toBe(true);
}

/** Leaves the shared instance offline again, with no document to offer. */
async function catalogueOffline(page: Page): Promise<void> {
  await page.request.put('/api/v1/apps/catalog', { data: { enabled: false } }).catch(() => undefined);
  rmSync(catalogueCacheFile(), { force: true });
}

async function setPrefs(page: Page, theme: string | null, locale: string | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: { theme, locale } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

/** Drives the wizard to the bundle step with the given bundle picked. */
async function toBundleStep(page: Page, tx: Text, shape: 'reuse' | 'create'): Promise<void> {
  await page.getByRole('button', { name: tx('studio:hostedApps.installed.install') }).click();
  const bundle = appBundle(shape);
  await page.locator('input[type="file"]').setInputFiles({
    name: `${APP_KEY}-${APP_VERSION}.tgz`,
    mimeType: 'application/gzip',
    buffer: bundle.buffer,
  });
  await page.getByLabel(tx('studio:hostedApps.install.bundle.integrity')).fill(bundle.integrity);
}

type Text = ReturnType<typeof textIn>;

/**
 * Light and dark, in English and in Arabic (right to left) — AC16's "passes
 * axe and works in Arabic and dark mode" for P1's screens. The flow is one
 * function; every string it looks for comes from the locale files by key.
 */
const COMBOS = [
  { theme: 'light', locale: 'en-US', pref: null, dir: 'ltr' },
  { theme: 'dark', locale: 'en-US', pref: null, dir: 'ltr' },
  { theme: 'light', locale: 'ar-EG', pref: 'ar_EG', dir: 'rtl' },
  { theme: 'dark', locale: 'ar-EG', pref: 'ar_EG', dir: 'rtl' },
] as const;

test.describe.configure({ mode: 'serial' });

test.describe('/studio/apps under axe', () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    await page.request
      .delete(`/api/v1/apps/staged/${APP_KEY}/${APP_NEXT_VERSION}`)
      .catch(() => undefined);
    await catalogueOffline(page);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  // Theme and language are the shared account's own prefs: each test puts them
  // back, so the next sign-in (and the next spec) meets the English page it
  // expects even when a sweep fails half way.
  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });

  for (const combo of COMBOS) {
    const name = `${combo.theme}${combo.dir === 'rtl' ? ', Arabic (rtl)' : ''}`;
    test(`every state, ${name}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const tally: Sweep = { states: 0, minor: 0, failures: [] };
      const tx = textIn(combo.locale);
      const at = (label: string): string => `${name} · ${label}`;

      await signIn(page);
      await setPrefs(page, combo.theme, combo.pref);
      await page.goto('/studio/apps');
      await expect(page.getByRole('heading', { name: tx('studio:hostedApps.title') })).toBeVisible();

      /*
       * THE THEME AND THE DIRECTION ARE PROVEN, NOT ASSUMED — and the first
       * draft of this probe is why the check is written twice over.
       *
       * It read `[data-part="app-shell"], main`, and both themes came back
       * `rgba(0, 0, 0, 0)`: those elements are transparent, so the "dark" run
       * would have swept a light page and reported two green themes. So the
       * attribute the provider actually stamps is asserted, AND the colour is
       * read off an element with a background token on it.
       */
      const probe = await page.evaluate(() => {
        const card = document.querySelector('.bg-surface') ?? document.body;
        return {
          attribute: document.documentElement.getAttribute('data-theme'),
          dir: document.documentElement.getAttribute('dir') ?? 'ltr',
          painted: getComputedStyle(card).backgroundColor,
        };
      });
      expect(probe.attribute, 'the theme pref never reached the document').toBe(combo.theme);
      expect(probe.dir, 'the locale pref never reached the document').toBe(combo.dir);
      expect(probe.painted, 'the probe read an unpainted element').not.toBe('rgba(0, 0, 0, 0)');
      testInfo.annotations.push({
        type: 'theme-probe',
        description: `${name}: data-theme=${String(probe.attribute)} dir=${probe.dir} surface=${probe.painted}`,
      });

      await expect(page.getByText(tx('studio:hostedApps.installed.emptyTitle'))).toBeVisible();
      await sweep(page, at('page, nothing installed'), tally, testInfo);

      // ── the wizard ────────────────────────────────────────────────────
      await toBundleStep(page, tx, 'create');
      await sweep(page, at('wizard, bundle step'), tally, testInfo);

      await page.getByRole('button', { name: tx('studio:hostedApps.install.upload') }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.database.title'))).toBeVisible();
      await sweep(page, at('wizard, database step'), tally, testInfo);

      // Back to the bundle step, which now confirms the app the upload read
      // from its manifest instead of showing the file picker again.
      await page.getByRole('button', { name: tx('studio:hostedApps.install.back'), exact: true }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.chosen.title', { app: 'E2E Desk' }))).toBeVisible();
      await sweep(page, at('wizard, bundle step after the upload'), tally, testInfo);
      await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.database.title'))).toBeVisible();

      await page.getByRole('radio', { name: /northwind/i }).click();
      await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.check.title'))).toBeVisible();
      // The app ships sample data, so the check step offers it, unticked.
      await expect(page.getByTestId('install-sample-data')).toBeVisible();
      await sweep(page, at('wizard, check step'), tally, testInfo);

      await page.getByRole('button', { name: /e2e_app_probe/ }).click();
      await expect(page.getByText('CREATE TABLE e2e_app_probe')).toBeVisible();
      await sweep(page, at('wizard, check step with the create preview open'), tally, testInfo);

      /*
       * A table whose name is taken — the one state that paints the choices,
       * a disabled one among them, and a field. No seeded table lands in that
       * class reliably (a run's earlier installs record `shippers`), so the
       * server's real plan is fetched and only the probe table's class is
       * changed on its way to the page.
       */
      await page.route('**/api/v1/apps/plan', async (route) => {
        const reply = await route.fetch();
        const body = (await reply.json()) as { plan: { installable: boolean; tables: Record<string, unknown>[] } };
        body.plan.installable = false;
        body.plan.tables = body.plan.tables.map((table) => ({
          ...table,
          class: 'taken',
          action: 'undecided',
          offers: ['rename-existing', 'alt-prefix'],
          reuseRefusal: 'It requires "location_id", which this app never fills.',
        }));
        await route.fulfill({ response: reply, json: body });
      });
      await page.getByRole('button', { name: tx('studio:hostedApps.install.back'), exact: true }).click();
      await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
      await expect(
        page.getByText(tx('studio:hostedApps.install.check.pickFirst', { table: 'e2e_app_probe' })),
      ).toBeVisible();
      await page.getByRole('button', { name: /e2e_app_probe/ }).click();
      await page.getByRole('radio', { name: tx('studio:hostedApps.install.check.prefixTitle') }).click();
      await expect(page.getByLabel(tx('studio:hostedApps.install.check.prefixField'), { exact: true })).toBeVisible();
      await sweep(page, at('wizard, check step with a taken table'), tally, testInfo);
      await page.unroute('**/api/v1/apps/plan');

      // Cancel writes nothing — the staged bundle is all that is left, and the
      // install below replaces it.
      await page.getByRole('button', { name: tx('studio:hostedApps.install.cancel') }).click();

      // ── an install that stops part way, then finishes ─────────────────
      /*
       * The reuse bundle creates no table (it uses Northwind's own
       * `shippers`), so installing it through the wizard is as harmless as the
       * API install this used to make — and it reaches the Done step for real.
       * The FIRST attempt is answered with the server's own incomplete-install
       * reply, which is the one way to paint "stopped part way" without
       * breaking a database every spec shares; "Try again" is the real install.
       */
      await toBundleStep(page, tx, 'reuse');
      await page.getByRole('button', { name: tx('studio:hostedApps.install.upload') }).click();
      await page.getByRole('radio', { name: /northwind/i }).click();
      await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.check.title'))).toBeVisible();
      if (await page.getByText(tx('studio:hostedApps.install.check.pickFirst', { table: 'shippers' })).isVisible()) {
        const shippers = page.getByTestId('check-table-shippers');
        await shippers.getByRole('button', { name: /shippers/ }).click();
        await shippers.getByRole('radio', { name: tx('studio:hostedApps.install.check.keep') }).click();
      }
      let stopped = false;
      await page.route('**/api/v1/apps/install', async (route) => {
        if (stopped) return route.continue();
        stopped = true;
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'APP_INSTALL_INCOMPLETE',
              message: `Installing "${APP_KEY}" stopped at the pages step: the page store was busy.`,
              requestId: 'req_a11y',
              details: { stage: 'pages', table: null, created: [], pending: [], cause: 'the page store was busy' },
            },
          },
        });
      });
      await page.getByRole('button', { name: tx('studio:hostedApps.install.confirm'), exact: true }).click();
      await expect(page.getByTestId('install-stopped')).toBeVisible();
      await expect(page.getByText(tx('studio:hostedApps.install.stopped.title'))).toBeVisible();
      await sweep(page, at('wizard, install stopped part way'), tally, testInfo);
      await page.getByRole('button', { name: tx('studio:hostedApps.install.stopped.retry') }).click();
      await expect(page.getByText(tx('studio:hostedApps.install.done.titleApp', { app: 'E2E Desk' }))).toBeVisible({
        timeout: 60_000,
      });
      await page.unroute('**/api/v1/apps/install');
      await sweep(page, at('wizard, done'), tally, testInfo);
      await page.getByRole('button', { name: tx('studio:hostedApps.install.finish') }).click();

      // ── installed ─────────────────────────────────────────────────────
      await page.reload();
      await expect(page.getByText(`/apps/${APP_KEY}/staff/`).first()).toBeVisible();
      /*
       * The SHELF has a card by now — the package is on disk, so the catalogue
       * lists it — and this assertion is what stops the sweep below passing
       * over an empty shelf and reporting the card state as covered.
       */
      await expect(page.getByRole('article').filter({ hasText: 'E2E Desk' })).toBeVisible();
      await sweep(page, at('page, one app installed'), tally, testInfo);

      // ── an install from before prefixes: the banner and the rename dialog ──
      /*
       * The fixture app is not prefixed, so the list is answered with the one
       * field that says otherwise and the preview with a plan of the shape the
       * schema editor returns. Nothing is renamed: the dialog is closed.
       */
      await page.route('**/api/v1/apps', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const reply = await route.fetch();
        const body = (await reply.json()) as { apps: Record<string, unknown>[] };
        body.apps = body.apps.map((app) => (app['key'] === APP_KEY ? { ...app, oldTableNames: { prefix: 'e2e_', count: 1 } } : app));
        await route.fulfill({ response: reply, json: body });
      });
      await page.route(`**/api/v1/apps/${APP_KEY}/rename-tables/plan`, (route) =>
        route.fulfill({
          json: {
            prefix: 'e2e_',
            connectionId: 'conn_a11y',
            tables: [{ ref: 'shippers', from: 'shippers', to: 'e2e_shippers' }],
            plan: {
              steps: [
                {
                  id: 'rename-table-1',
                  kind: 'rename-table',
                  table: 'main.shippers',
                  column: null,
                  hazard: 'safe',
                  requiresSuperAdmin: false,
                  summary: 'Rename table shippers to e2e_shippers',
                  rationale: 'A rename keeps every row.',
                  consequences: [],
                  dependsOn: [],
                  outsideTransaction: false,
                  refusal: null,
                  sql: ['ALTER TABLE "shippers" RENAME TO "e2e_shippers"'],
                },
              ],
              refusals: [],
              ceilings: [],
              warnings: [],
              hazard: 'safe',
              requiresSuperAdmin: false,
              checksum: 'a'.repeat(64),
              unfinished: null,
            },
          },
        }),
      );
      await page.reload();
      await expect(page.locator('[data-part="old-table-names"]')).toBeVisible();
      await sweep(page, at('page, an install with the old table names'), tally, testInfo);
      await page.getByRole('button', { name: tx('studio:hostedApps.installed.renameTo', { prefix: 'e2e_' }) }).click();
      await expect(page.getByRole('dialog').getByText('e2e_shippers')).toBeVisible();
      await sweep(page, at('rename tables dialog'), tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.unroute('**/api/v1/apps');
      await page.unroute(`**/api/v1/apps/${APP_KEY}/rename-tables/plan`);

      // ── the app's own page, and the dialog that switches it off ───────
      await page.goto(`/studio/apps/${APP_KEY}`);
      await expect(page.getByRole('heading', { name: 'E2E Desk', level: 2 })).toBeVisible();
      await sweep(page, at("the app's own page"), tally, testInfo);
      await page.getByRole('button', { name: tx('studio:appSettings.disable') }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await sweep(page, at('disable dialog'), tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');

      // ── sample data: the Add dialog reads, and is cancelled ───────────
      await page.getByTestId('app-sample-data').getByRole('button', { name: tx('studio:sampleData.add') }).click();
      await expect(page.getByRole('dialog').getByRole('button', { name: tx('studio:sampleData.add') })).toBeEnabled();
      await sweep(page, at('add sample data dialog'), tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');

      /*
       * Loaded is ANSWERED, not made: adding would write into Northwind's own
       * `shippers`, which every spec shares. The Remove dialog and the page
       * banner render from these two replies, and nothing is removed.
       */
      await page.route(`**/api/v1/apps/${APP_KEY}/sample-data`, (route) =>
        route.fulfill({
          json: { offered: true, loaded: true, total: 1, addedAt: Date.now(), tables: [{ ref: 'shippers', count: 1 }], available: null },
        }),
      );
      await page.route(`**/api/v1/apps/${APP_KEY}/sample-data/remove-plan`, (route) =>
        route.fulfill({
          json: {
            tables: [{ ref: 'shippers', count: 1 }],
            kept: [{ ref: 'shippers', label: null, title: 'Sample Freight', usedBy: 2 }],
            changed: [{ ref: 'shippers', label: null, title: 'Sample Freight', columns: ['company_name'] }],
            total: 1,
          },
        }),
      );
      await page.reload();
      await page.getByTestId('app-sample-data').getByRole('button', { name: tx('studio:sampleData.remove') }).click();
      await expect(page.getByRole('dialog').getByText(tx('studio:sampleData.keepChanged'))).toBeVisible();
      await sweep(page, at('remove sample data dialog'), tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');

      // The app's own page says so too.
      await page.getByRole('link', { name: 'E2E Desk overview' }).first().click();
      await expect(page.getByTestId('app-sample-banner')).toBeVisible();
      await sweep(page, at('an app page with sample data loaded'), tally, testInfo);
      await page.unroute(`**/api/v1/apps/${APP_KEY}/sample-data`);
      await page.unroute(`**/api/v1/apps/${APP_KEY}/sample-data/remove-plan`);
      await page.goto('/studio/apps');
      await expect(page.getByRole('heading', { name: tx('studio:hostedApps.title') })).toBeVisible();

      // ── the shelf with the online catalogue on ───────────────────
      await withCatalogueOnline(page);
      await page.reload();
      const blocked = page.getByRole('article').filter({ hasText: 'E2E Future' });
      // Without this the sweep could pass over a shelf the switch never reached.
      await expect(blocked.getByText(tx('studio:hostedApps.browse.needsNewer', { version: '99.0.0' }))).toBeVisible();
      await sweep(page, at('page, catalogue rows on the shelf'), tally, testInfo);

      // ── the update consent dialog ──────────────────────────
      /*
       * A newer version on disk whose schema needs a table nothing has, so the
       * page asks before creating it (48 G8-D7). Staged, never applied: this
       * sweep cancels, and cancelling an update writes nothing, the same
       * discipline as the plan step above.
       */
      const next = appBundle('create', APP_NEXT_VERSION);
      const query = new URLSearchParams({
        key: APP_KEY,
        version: APP_NEXT_VERSION,
        expectedSha512: next.integrity,
      });
      const uploaded = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
        headers: { 'content-type': 'application/octet-stream' },
        data: next.buffer,
      });
      expect(uploaded.ok(), await uploaded.text()).toBe(true);
      await page.reload();
      await page.getByRole('button', { name: tx('studio:hostedApps.installed.update') }).click();
      await expect(
        page.getByText(tx('studio:hostedApps.update.title', { app: APP_KEY, version: APP_NEXT_VERSION })),
      ).toBeVisible({ timeout: 30_000 });
      // The update shows the same table check as the install; open the new
      // table's row so its create preview is part of the sweep.
      await page.getByRole('dialog').getByRole('button', { name: /e2e_app_probe/ }).click();
      await expect(page.getByText('CREATE TABLE e2e_app_probe')).toBeVisible();
      await sweep(page, at('update consent dialog'), tally, testInfo, '[role="dialog"]');
      await page.getByRole('button', { name: tx('studio:hostedApps.update.cancel') }).click();

      await page.request.delete(`/api/v1/apps/staged/${APP_KEY}/${APP_NEXT_VERSION}`);
      await catalogueOffline(page);
      await page.reload();

      await page.getByRole('button', { name: tx('studio:hostedApps.installed.uninstall') }).first().click();
      await expect(page.getByRole('dialog').getByText(tx('studio:uninstall.files'))).toBeVisible();
      await sweep(page, at('uninstall dialog'), tally, testInfo, '[role="dialog"]');

      await page.keyboard.press('Escape');
      await page.request.delete(`/api/v1/apps/${APP_KEY}`);

      testInfo.annotations.push({
        type: 'axe-summary',
        description: `${name}: ${String(tally.states)} states, ${String(tally.minor)} lesser`,
      });
      expect(tally.states, 'a state was skipped').toBeGreaterThanOrEqual(20);
      expect(tally.failures.join('\n\n')).toBe('');
    });
  }
});
