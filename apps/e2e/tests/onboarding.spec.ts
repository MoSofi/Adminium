// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six-step first-run wizard, walked end to end and swept with axe as it
 * goes.
 *
 * WHY IT HAS ITS OWN SERVER. The shared e2e instance seeds a super admin before
 * it listens, and the route guard bounces `/setup` to `/login` the moment
 * `setup.state.required` is false — so this wizard is unreachable there by
 * construction. `E2E_FIRST_RUN=1` boots the same script with everything after
 * the migrations skipped (`scripts/e2e-server.mjs`), on `FIRST_RUN_PORT`, with
 * no storage state: creating the account is the thing under test.
 *
 * ONE TEST, NOT TWO. The walk CONSUMES the state it needs — after step 3 there
 * is an admin and the instance is no longer first-run — so the accessibility
 * sweep cannot be a second test that starts again from step 1. It runs as the
 * walk goes: every step, in light and in dark, through the wizard's own theme
 * toggle (there is no signed-in preference to set at this point).
 *
 * SMTP IS DELIBERATELY UNCONFIGURED, which is what a fresh install is. That is
 * why the team step asserts the one-time invitation LINK rather than a sent
 * mail: `emailSent: false` is the honest first-run path, and it is the one that
 * would strand someone if the link were ever dropped.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { enrichWizardDsn } from './constants.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

const ACCOUNT = {
  email: 'owner@adminium.local',
  password: 'first-run-password',
};
const TEAMMATE = 'mate@adminium.local';
/** Parses, points at nothing: port 1 on loopback answers no one. */
const UNREACHABLE_DSN = 'postgres://nobody@127.0.0.1:1/nothing';

interface Sweep {
  states: number;
  minor: number;
  /** One entry per state that failed; asserted once at the end. */
  failures: string[];
}

async function analyse(page: Page, label: string, tally: Sweep, testInfo: TestInfo): Promise<void> {
  // Steps fade in (`nb-fade`); axe reads computed colours, and a screen measured
  // mid-transition reports blended ones and fails contrast it passes at rest.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // Not a spinner, whose animation never finishes.
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
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
  if (blocking.length > 0) {
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
    tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
  }
}

/** Sweep the step in both themes, ending on the one it started in. */
async function sweepBothThemes(page: Page, label: string, tally: Sweep, testInfo: TestInfo): Promise<void> {
  await analyse(page, `${label} (light)`, tally, testInfo);
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await analyse(page, `${label} (dark)`, tally, testInfo);
  await page.getByRole('button', { name: 'Light mode' }).click();
}

test.describe('first run', () => {
  test('walks the six steps, and passes axe on every one of them', async ({ page }, testInfo) => {
    const state = await page.request.get('/api/v1/setup/state');
    expect(state.ok(), await state.text()).toBe(true);
    const required = ((await state.json()) as { data: { required: boolean } }).data.required;
    test.skip(
      !required,
      'this first-run server has already been walked — restart it (it is never reused)',
    );

    const tally: Sweep = { states: 0, minor: 0, failures: [] };

    // The setup-only probe, on a database Adminium has never touched:
    // open while setup is, honest about finding nothing, and it writes nothing —
    // the walk below relocates into this same database and would fail if the
    // probe had migrated it.
    const clean = await page.request.post('/api/v1/setup/probe', {
      data: { dsn: enrichWizardDsn() },
    });
    expect(clean.status(), await clean.text()).toBe(200);
    expect(((await clean.json()) as { data: { occupied: string[] } }).data.occupied).toEqual([]);

    // ── 1. what will you build first ────────────────────────────────────────
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'What will you build first?' })).toBeVisible();
    await expect(page.getByText('Step 1 of 6')).toBeVisible();
    // Blank canvas is the default — the low-friction path is one Continue.
    await expect(page.getByRole('radio', { name: /Blank canvas/ })).toHaveAttribute('aria-checked', 'true');
    await sweepBothThemes(page, 'start', tally, testInfo);
    await page.getByRole('radio', { name: /CRUD tables/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    // ── 2. connect ──────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Connect your database' })).toBeVisible();
    await expect(page.getByText(/Nothing leaves this browser until your account exists/)).toBeVisible();
    // A well-formed DSN that will not answer. The walk goes through the failure
    // path FIRST because that is the state the R1 ordering has to make
    // recoverable: the account is created, the database is not reached, and the
    // wizard must let you fix the string without asking for the account again.
    await page.getByLabel('Connection string').fill(UNREACHABLE_DSN);
    await sweepBothThemes(page, 'connect', tally, testInfo);
    await page.getByRole('button', { name: /Continue/ }).click();

    // ── 3. the account — the hinge ──────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
    await page.getByLabel(/^Email/).fill(ACCOUNT.email);
    await page.getByLabel(/^Password/).fill(ACCOUNT.password);
    await page.getByLabel(/^Confirm password/).fill(ACCOUNT.password);
    await sweepBothThemes(page, 'account', tally, testInfo);
    await page.getByRole('button', { name: /Create account/ }).click();

    // ── the failure path, and back out of it ────────────────────────────────
    // The account was created; the database was not reached. Both facts are on
    // screen, and the way forward is to fix the string — not to answer for the
    // account a second time, which would 409 against the admin just created.
    await expect(page.getByRole('heading', { name: 'Connect your database' })).toBeVisible({
      timeout: 30_000,
    });
    const recovery = page.getByRole('alert');
    await expect(recovery).toContainText('signed in');
    await sweepBothThemes(page, 'connect-failed', tally, testInfo);

    await page.getByLabel('Connection string').fill(enrichWizardDsn());
    await page.getByRole('button', { name: /Continue/ }).click();

    // ── 4. where Adminium keeps its own data ────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeVisible({
      timeout: 30_000,
    });
    // The file is the default, and the connected database is now offerable —
    // the account exists, so the probe behind that card has run.
    await expect(page.getByRole('radio', { name: /In a file on this machine/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await sweepBothThemes(page, 'storage', tally, testInfo);
    await page.getByRole('button', { name: /Continue/ }).click();

    // ── 5. the team ─────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Bring your team' })).toBeVisible();
    await page.getByLabel(/Teammate/).fill(TEAMMATE);
    await page.getByRole('button', { name: 'Invite' }).click();
    // No SMTP on a fresh install: the link is the only copy that will exist.
    await expect(page.getByText(TEAMMATE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByText(/\/reset\//)).toBeVisible();
    await sweepBothThemes(page, 'team', tally, testInfo);
    await page.getByRole('button', { name: /Continue/ }).click();

    // ── 6. all set ──────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /You’re all set/ })).toBeVisible();
    await expect(page.getByText(/tables? found|reading your schema/)).toBeVisible();
    await expect(page.getByText(/keeps its own data in a file on this machine/)).toBeVisible();
    await expect(page.getByText(/1 invitation created/)).toBeVisible();
    // Opt-in, never pre-checked.
    const telemetry = page.getByRole('switch', { name: /Share anonymous usage data/ });
    await expect(telemetry).toHaveAttribute('aria-checked', 'false');
    await sweepBothThemes(page, 'done', tally, testInfo);

    // ── the hand-off ────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Go to dashboard/ }).click();
    // A non-blank intent with a connection goes to the Studio wizard, RESUMED at
    // the tables step — the wizard state the last screen seeded (45 R4).
    await expect(page).toHaveURL(/\/studio\/connect$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Choose your tables' })).toBeVisible({ timeout: 30_000 });

    testInfo.annotations.push({
      type: 'axe-summary',
      description: `${String(tally.states)} states swept, ${String(tally.minor)} lesser violation(s)`,
    });
    expect(tally.failures.join('\n\n'), `${String(tally.states)} states swept`).toBe('');
  });

  test('setup cannot be re-opened once it is done', async ({ page }) => {
    // The instance now has an admin, so the guard sends `/setup` to `/login`.
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the setup-only database routes close with the window', async ({ page }) => {
    // The whole safety argument for asking a database question before there is
    // a session: the window shuts on the first account and never re-opens. An
    // un-bootstrapped instance is briefly usable to ask about a DSN; a running
    // one is not, to anyone.
    const probe = await page.request.post('/api/v1/setup/probe', { data: { dsn: enrichWizardDsn() } });
    expect(probe.status(), await probe.text()).toBe(409);

    // `/setup/adopt` is not even MOUNTED here, and that is its own guarantee:
    // it is registered only where something can carry out the restart it ends
    // in (`compose.ts` passes `onMetaRelocated` only from the CLI's relocation
    // host). This harness composes the server directly, so adopting — which
    // would repoint the instance and then have no way to come back — cannot be
    // reached at all. The shared gate is proven by the probe above; both routes
    // call it.
    const adopt = await page.request.post('/api/v1/setup/adopt', { data: { dsn: enrichWizardDsn() } });
    expect(adopt.status(), await adopt.text()).toBe(404);
  });
});
