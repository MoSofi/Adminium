// SPDX-License-Identifier: AGPL-3.0-only
/**
 * T15 golden e2e (06-llm-assist.md, acceptance #1/#3/#9): the FULL BYO
 * round-trip through the real UI against the seeded sqlite Northwind app.
 *
 * Connect wizard → "Enrich with AI" → BYO (copy-paste) path → read the
 * generated prompt → paste the seeded-schema golden response
 * (`fixtures/northwind-enrichment.json`) → validate in-process → review-diff →
 * accept the ≥ 0.8 set → apply. Then assert the write set really landed:
 * `adminium_llm_runs` shows the run `applied` with provider/model NULL (BYO is
 * telemetry-free, §9), the accepted overrides/pages committed, and the generated
 * app reflects them once the connection is (re)generated against those overrides.
 *
 * sqlite-only: the golden response is qualified for the sqlite snapshot's
 * `main.*` table ids (verified referentially clean against a live introspection
 * of the same fixture). postgres/mysql qualify tables differently, so this leg
 * is gated to the default sqlite matrix (the seeded engine the task targets).
 *
 * Role/label selectors + Playwright auto-waiting only — no arbitrary sleeps.
 *
 * The M7 page-template leg (second test) drives the same BYO round-trip with
 * the golden's `pageTemplates` block: `page-queue-inbox` (orders, composes —
 * every table emits a data-grid + count-KPI candidate), `page-directory`
 * (employees, composes — the `reports_to` self-FK earns `org-chart`), and
 * `page-board` (orders, deliberately CANNOT compose on Northwind: the kanban
 * candidate needs a status-workflow enum column and the seeded schema declares
 * none). The board leg pins the honest §8.3 outcome — the accepted suggestion
 * applies (page row written), the materialization pass parks it (disabled,
 * warned, retried every regeneration) and it never reaches the nav. The
 * fixture keeps orders/employees OUT of the accepted navGroups so the two
 * composable pages keep their archetype's fixed sidebar group (workspace /
 * people) instead of an §8.3 llm-group stamp the five-group tree cannot show.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { ENGINE, enrichWizardDsn } from './constants.js';
import { signIn } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_RESPONSE = readFileSync(
  join(here, '..', 'fixtures', 'northwind-enrichment.json'),
  'utf8',
);

test.describe('LLM enrichment — BYO round-trip (golden e2e)', () => {
  test.skip(
    ENGINE !== 'sqlite',
    'the golden BYO response is qualified for the sqlite Northwind snapshot (main.* table ids)',
  );

  test('(f) wizard → BYO enrich → validate → review → accept ≥0.8 → apply → app reflects', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/studio/connect');
    await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();

    // Step 1 — intent (default "full admin").
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 2 — source, DSN mode. A `sqlite:` scheme auto-syncs the engine picker;
    // the wizard points a NEW connection at the same seeded Northwind file.
    await page.getByLabel('Connection name').fill('northwind-enrich-e2e');
    await page.getByLabel('Connection string').fill(enrichWizardDsn());
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 3 — test + introspect auto-runs; the log ends in "Ready".
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 4 — table inclusion (defaults persist on Continue).
    await expect(page.getByRole('heading', { name: 'Choose your tables' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 5 — meta placement: a writable sqlite file → same-db card is enabled.
    await page.getByRole('radio', { name: /Same database/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 6 — Enrich with AI → the BYO copy-paste path.
    await expect(page.getByRole('heading', { name: 'Enrich with AI' })).toBeVisible();
    await page.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }).click();

    // Request de_DE alongside the locked en_US so the run's locale set matches the
    // golden response (every localized bundle carries exactly en_US + de_DE — an
    // unrequested locale key would drop the suggestion in validation).
    await page.locator('#enrich-locale-de_DE').click();

    await page.getByRole('button', { name: 'Generate prompt' }).click();

    // The generated prompt is presented (read it): copy/download controls appear.
    await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download .md' })).toBeVisible();

    // Paste the seeded-schema golden response and validate it in-process (§9:
    // this POST runs entirely on the server — no outbound network).
    await page.getByLabel('Paste the JSON response').fill(GOLDEN_RESPONSE);
    await page.getByRole('button', { name: 'Validate' }).click();
    // "Response validated" renders twice by design in the single-chunk flow
    // (status chip + ready card) — the ready card's CTA is the unambiguous
    // "validated AND merged" signal, and it is what the next step clicks.
    await expect(page.getByRole('button', { name: 'Continue to review' })).toBeVisible({ timeout: 30_000 });

    // Continue to the review-diff screen (both AI paths land here).
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByRole('heading', { name: 'Review AI suggestions' })).toBeVisible({
      timeout: 30_000,
    });

    // The run id is in the URL (/studio/llm-runs/:runId/review) — used below for
    // the authoritative API-level "rows exist" assertions.
    const runId = new URL(page.url()).pathname.split('/').at(-2);
    expect(runId, 'run id in the review URL').toBeTruthy();

    // Accept the ≥ 0.8 set (the default threshold) and apply it.
    await page.getByRole('button', { name: /Accept all/ }).click();
    const applyButton = page.getByRole('button', { name: /Apply \d+ accepted suggestions/ });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await page.getByRole('button', { name: 'Apply changes' }).click();

    // Applied: the transactional apply committed and the screen is read-only.
    await expect(page.getByText('This run has been applied')).toBeVisible({ timeout: 30_000 });

    // ── rows exist (adminium_llm_runs / _schema_overrides / _pages), via the API.
    // `page.request` shares the browser's session cookie.
    const runRes = await page.request.get(`/api/v1/llm/runs/${runId ?? ''}`);
    expect(runRes.ok(), `GET run ${String(runId)} → ${runRes.status()}`).toBeTruthy();
    const run = (await runRes.json()) as {
      status: string;
      mode: string;
      provider: string | null;
      model: string | null;
      connectionId: string;
      review: { accepted: string[]; rejected: string[] } | null;
    };
    expect(['applied', 'partially_applied']).toContain(run.status);
    expect(run.mode).toBe('byo');
    // §9 telemetry-free: a BYO run never records a provider/model (no metering).
    expect(run.provider).toBeNull();
    expect(run.model).toBeNull();
    expect((run.review?.accepted ?? []).length).toBeGreaterThan(0);

    // The applied diff contains the label/nav/dashboard suggestions we accepted.
    const diffRes = await page.request.get(`/api/v1/llm/runs/${runId ?? ''}/diff`);
    expect(diffRes.ok()).toBeTruthy();
    const { diff } = (await diffRes.json()) as { diff: { id: string; category: string }[] };
    expect(diff.length).toBeGreaterThan(0);

    // ── the generated app reflects them: generate the connection (the generator
    // reads the just-applied `origin: 'llm'` overrides, provenance user>llm>heuristic),
    // then the primary nav renders the enriched pages + nav groups.
    const genRes = await page.request.post(`/api/v1/connections/${run.connectionId}/generate`);
    expect(genRes.ok(), `generate → ${genRes.status()}`).toBeTruthy();

    await page.goto('/');
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav).toBeVisible();
    // Assert a label that ONLY the applied LLM override can produce, so the check
    // actually proves the enriched write set landed (not a coincidence of naming):
    // the golden response renames `order_details` → "Order lines", whereas the
    // heuristic humanization of that table is "Order Details". A plain /Orders/
    // link would pass vacuously — it matches both the heuristic 'Orders' label and
    // the pre-seeded northwind connection's nav — so we target the enriched rename.
    await expect(primaryNav.getByRole('link', { name: 'Order lines' }).first()).toBeVisible();
  });

  // M7 page-template leg: the golden's `pageTemplates` suggestions ride the
  // same wizard → BYO → validate → review → accept-all → apply round-trip on
  // a fresh connection, and the applied pages surface end to end — queue and
  // directory materialize into the bootstrap nav and mount their REAL
  // renderers over the seeded rows; board (uncomposable on this schema — no
  // workflow enum) applies but parks: warned on every regeneration, absent
  // from the nav. Slug-scoped `href` locators, not labels: "Employees
  // Directory" also names the heuristic archetype page of every Northwind
  // connection, and slugs repeat across connections.
  test('(f) BYO round-trip applies queue/board/directory template pages (M7)', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/studio/connect');
    await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();

    // Wizard steps 1–5, as in the first leg (a second fresh connection onto
    // the same seeded Northwind file).
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Connection name').fill('northwind-m7-e2e');
    await page.getByLabel('Connection string').fill(enrichWizardDsn());
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose your tables' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('radio', { name: /Same database/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // BYO path with the same locale set the golden carries.
    await expect(page.getByRole('heading', { name: 'Enrich with AI' })).toBeVisible();
    await page.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }).click();
    await page.locator('#enrich-locale-de_DE').click();
    await page.getByRole('button', { name: 'Generate prompt' }).click();
    await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeVisible();

    await page.getByLabel('Paste the JSON response').fill(GOLDEN_RESPONSE);
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByRole('button', { name: 'Continue to review' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByRole('heading', { name: 'Review AI suggestions' })).toBeVisible({
      timeout: 30_000,
    });
    const runId = new URL(page.url()).pathname.split('/').at(-2);
    expect(runId, 'run id in the review URL').toBeTruthy();

    // Accept the ≥ 0.8 set — all three template suggestions qualify (0.9/0.85/0.9).
    await page.getByRole('button', { name: /Accept all/ }).click();
    const applyButton = page.getByRole('button', { name: /Apply \d+ accepted suggestions/ });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect(page.getByText('This run has been applied')).toBeVisible({ timeout: 30_000 });

    const runRes = await page.request.get(`/api/v1/llm/runs/${runId ?? ''}`);
    expect(runRes.ok(), `GET run ${String(runId)} → ${runRes.status()}`).toBeTruthy();
    const run = (await runRes.json()) as { status: string; connectionId: string };
    expect(['applied', 'partially_applied']).toContain(run.status);

    // Regenerate. The post-apply hook already materialized the composable
    // seeds; this second run is idempotent for them but re-warns for every
    // still-parked seed — which is exactly the board's honest state on this
    // schema (its kanban slot has no candidate without a workflow enum).
    const genRes = await page.request.post(`/api/v1/connections/${run.connectionId}/generate`);
    expect(genRes.ok(), `generate → ${genRes.status()}`).toBeTruthy();
    const gen = (await genRes.json()) as { warnings: string[] };
    expect(gen.warnings.join('\n')).toMatch(/main-orders-page-board\) not materialized/);

    // The nav shows the two composable template pages under their archetype's
    // fixed groups (queue → workspace, directory → people) and never the
    // parked board.
    await page.goto('/');
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav).toBeVisible();
    const queueLink = primaryNav.locator('a[href="/p/main-orders-page-queue-inbox"]').first();
    const directoryLink = primaryNav.locator('a[href="/p/main-employees-page-directory"]').first();
    await expect(queueLink).toBeVisible();
    await expect(queueLink).toHaveText(/Orders Queue/);
    await expect(directoryLink).toBeVisible();
    await expect(directoryLink).toHaveText(/Employees Directory/);
    await expect(primaryNav.locator('a[href="/p/main-orders-page-board"]')).toHaveCount(0);

    // The queue page mounts the REAL page-queue-inbox renderer over the
    // seeded orders: KPI row + queue list with rows (no status enum → the
    // grid-flavoured queue, no segmented status filter required).
    await queueLink.click();
    await expect(page).toHaveURL(/\/p\/main-orders-page-queue-inbox/);
    await expect(page.getByText('Unknown page template')).toHaveCount(0);
    await expect(page.locator('[data-part="page-queue-inbox"]')).toBeVisible();
    await expect(page.locator('[data-part="queue-kpi-row"]')).toBeVisible();
    await expect(page.locator('[data-part="queue-rows"] > li').first()).toBeVisible();

    // The directory page mounts page-directory with the org-chart hero (the
    // employees `reports_to` self-FK), exactly like the seeded archetype page
    // template-pages.spec.ts pins.
    await directoryLink.click();
    await expect(page).toHaveURL(/\/p\/main-employees-page-directory/);
    await expect(page.getByText('Unknown page template')).toHaveCount(0);
    await expect(page.locator('[data-part="page-directory"]')).toBeVisible();
    await expect(page.getByRole('tree')).toBeVisible();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
  });
});
