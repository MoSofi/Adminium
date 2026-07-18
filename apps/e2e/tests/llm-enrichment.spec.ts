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
 * The M7 page-template legs (queue/board/directory as per-item template pages)
 * are intentionally NOT exercised. The 14 M7 template RENDERERS are registered
 * (apps/dashboard/src/pages/templates.tsx; template-pages.spec.ts pins them),
 * but the LLM-recommendable vocabulary is not: `pageTemplateDefinitions`
 * (packages/widgets/src/registry/page-templates.ts) — the source of
 * `LLM_ALLOWED_TEMPLATES` — still admits only `page-crud` + `page-dashboard`,
 * so a golden `pageTemplates` block would be referentially dropped
 * (`LLM_UNKNOWN_TEMPLATE`). See the `test.fixme` below.
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

  // M7 page-template legs (queue/board/directory as per-item template pages).
  // HALF the gate has lifted: the M7 wave-2 assembly registered all 14
  // template renderers (apps/dashboard/src/pages/templates.tsx), and the
  // seeded archetype pages are pinned end-to-end by template-pages.spec.ts.
  // What still blocks THIS leg is the LLM template VOCABULARY, not the
  // renderers and not merely the fixture: `pageTemplateDefinitions`
  // (packages/widgets/src/registry/page-templates.ts) — the derivation source
  // of `LLM_ALLOWED_TEMPLATES` in the built allow-list the server loads —
  // still lists only `page-crud` + `page-dashboard`, so ANY `pageTemplates`
  // entry added to `fixtures/northwind-enrichment.json` today is referentially
  // dropped as `LLM_UNKNOWN_TEMPLATE` at validate and the apply produces no
  // template page. Unskip once (1) the M7 templates are admitted to that
  // registry (`recommendable: true` + Studio descriptionKey + prompt/allowlist
  // test updates — a vocabulary decision, not a test edit), and (2) the golden
  // gains a matching `pageTemplates` block for this body to drive through
  // validate → review → apply.
  test.fixme(
    'BYO round-trip applies queue/board/directory template pages (M7)',
    async () => {
      // Intentionally empty until LLM_ALLOWED_TEMPLATES admits the M7 templates.
    },
  );
});
