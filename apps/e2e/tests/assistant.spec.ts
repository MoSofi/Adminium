// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page assistant against the BUILT stack, driven by the scripted provider
 * (`scripts/fake-llm.mjs`).
 *
 * WHAT ONLY THIS FILE SEES. The dashboard suite mounts the modal with a fetch
 * stub and the server suite runs the turn in process; neither runs a WHOLE
 * turn. Here a chip goes to the server, a job runs, steps arrive over a real
 * socket, a draft comes back through the page's own validator, and a save
 * writes a row the manager then shows. The chain is the point: every link is
 * covered elsewhere, and the joins are not.
 *
 * THE PROVIDER IS THIS SPEC'S OWN. `llm.enabled` is bootstrap state for the
 * whole instance, the suite shares one server, and a spec that left a provider
 * configured would change what every spec after it renders — so it is
 * configured in `beforeAll` and cleared in `afterAll`, whatever happened in
 * between.
 *
 * ORDER IS THE FIXTURE. Serial, one worker: each test leaves the rows it made
 * for the next to find, and `afterAll` removes them through the API so a
 * re-run starts from the same install.
 */
import { expect, test, type Page } from '@playwright/test';

import { SINK_URL, type SinkMessage } from './constants.js';
import { clearProvider, configureFakeProvider, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/**
 * The assistant's dialog — every handle below is scoped to it.
 *
 * Scoped to the DIALOG, not to its body: the header and the read-only bar are
 * siblings of the body inside Radix's content element, and `Modal`'s own
 * props land on Radix's Root, which renders no DOM node. The body's handle is
 * what identifies WHICH dialog, since the confirm is a second one.
 */
const modal = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.getByTestId('assistant-thread') });

/** Open the assistant from whatever page is on screen. */
async function openAssistant(page: Page): Promise<void> {
  await page.getByTestId('ask-assistant').click();
  await expect(modal(page)).toBeVisible();
}

/** Ask by clicking the chip whose label matches, and wait for the turn to settle. */
async function askByChip(page: Page, label: RegExp): Promise<void> {
  await modal(page).getByTestId('assistant-chip').filter({ hasText: label }).first().click();
  // A turn is a job: queued, then running, then done. The steps card shows
  // `working` until the last tool answers.
  await expect(modal(page).getByTestId('assistant-steps')).toHaveAttribute('data-state', /done|failed/, {
    timeout: 30_000,
  });
}

const action = (page: Page, id: string) => modal(page).getByTestId('assistant-action').filter({ has: page.locator(`[data-action="${id}"]`) }).or(modal(page).locator(`[data-testid="assistant-action"][data-action="${id}"]`)).first();

async function sinkMessages(page: Page): Promise<SinkMessage[]> {
  const reply = await page.request.get(`${SINK_URL}/messages`);
  expect(reply.ok(), `sink → ${String(reply.status())}`).toBeTruthy();
  return (await reply.json()) as SinkMessage[];
}

/** Ids this spec created, removed in `afterAll` whatever happened. */
const made = { email: [] as string[], reports: [] as string[] };

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await configureFakeProvider(page);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  for (const id of made.email) await page.request.delete(`/api/v1/email-templates/${id}`);
  for (const id of made.reports) await page.request.delete(`/api/v1/report-documents/${id}`);
  await clearProvider(page);
  await page.close();
});

test.describe('the page assistant', () => {
  test('(f) email manager → chip → steps → result → test send → save → the row is there', async ({ page }) => {
    await signIn(page);
    await page.request.delete(`${SINK_URL}/messages`);
    await page.goto('/email-templates');
    await expect(page.getByTestId('email-manager')).toBeVisible();

    await openAssistant(page);
    // The greeting and the page's own chips — this is the email page, not a
    // generic assistant that could be anywhere.
    await expect(modal(page).getByTestId('assistant-chip')).toHaveCount(3);
    await askByChip(page, /reminder for an unpaid invoice/i);

    // The first step is the page it read — worded by this page's own copy from
    // the facts the server sent, and true by construction: `pageFacts` is what
    // built the prompt.
    await expect(modal(page).getByTestId('assistant-steps')).toContainText('Read this page');
    await expect(modal(page).getByTestId('assistant-steps')).toContainText(/Email templates ·/);

    const result = modal(page).getByTestId('assistant-result');
    await expect(result).toBeVisible();
    // All three tabs, and the sheet is the EMAIL page's own renderer.
    await expect(result.getByTestId('assistant-tab')).toHaveCount(3);
    await expect(result.getByTestId('email-mail-shell')).toBeVisible();
    await result.locator('[data-testid="assistant-tab"][data-tab="details"]').click();
    await expect(result.getByText('Sources read')).toBeVisible();

    // Locked until somebody turns actions on — for this open, not for ever.
    await expect(modal(page).getByTestId('assistant-readonly')).toBeVisible();
    await expect(action(page, 'save')).toBeDisabled();
    await modal(page).getByTestId('assistant-enable').click();
    await expect(action(page, 'save')).toBeEnabled();

    // A test send goes to the operator's own address and nowhere else.
    await action(page, 'test-send').click();
    await expect(modal(page).getByTestId('assistant-echo')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await sinkMessages(page)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The save asks once more, then writes a DRAFT.
    await action(page, 'save').click();
    await expect(page.getByTestId('assistant-confirm')).toBeVisible();
    await page.getByTestId('assistant-confirm-go').click();

    await expect.poll(async () => {
      const reply = await page.request.get('/api/v1/email-templates?kind=template');
      const body = (await reply.json()) as { items: { id: string; name: string; enabled: boolean }[] };
      const row = body.items.find((item) => item.name === 'Payment reminder');
      if (row !== undefined && !made.email.includes(row.id)) made.email.push(row.id);
      return row?.enabled;
    }, { timeout: 20_000 }).toBe(false);
  });

  test('(f) report manager → chip → aggregate → result → save → run full preview re-runs it', async ({ page }) => {
    await signIn(page);
    await page.goto('/report-builder');
    await expect(page.getByTestId('report-toolbar')).toBeVisible();

    await openAssistant(page);
    await askByChip(page, /take the most support time/i);

    const result = modal(page).getByTestId('assistant-result');
    await expect(result).toBeVisible();
    // The sheet is the report page's own paper, and it names what it read.
    await expect(result.getByTestId('report-paper')).toBeVisible();
    await result.locator('[data-testid="assistant-tab"][data-tab="details"]').click();
    await expect(result.getByText('Sources read')).toBeVisible();

    // *Run full preview* writes nothing and needs no grant: it re-runs the
    // descriptors the draft recorded and redraws with today's answers.
    await expect(modal(page).getByTestId('assistant-steps')).toContainText('Read this page');
    await modal(page).getByTestId('assistant-enable').click();
    await action(page, 'sample').click();
    await expect(modal(page).getByTestId('assistant-echo')).toContainText(/Re-ran the sources/i, { timeout: 30_000 });

    await action(page, 'save').click();
    await page.getByTestId('assistant-confirm-go').click();
    await expect.poll(async () => {
      // A saved report lands as a TEMPLATE with status `draft` — this page's
      // `report` kind is a run of one, and publishing is the person's act.
      const reply = await page.request.get('/api/v1/report-documents?kind=template');
      const body = (await reply.json()) as { items: { id: string; name: string; status: string }[] };
      const row = body.items.find((item) => item.name === 'Rows by group');
      if (row !== undefined && !made.reports.includes(row.id)) made.reports.push(row.id);
      return row?.status;
    }, { timeout: 20_000 }).toBe('draft');
  });

  test('(f) the window fits both viewports the fidelity walk uses', async ({ page }) => {
    await signIn(page);
    await page.goto('/email-templates');
    await openAssistant(page);

    // 1440 × 940 is the comp's frame. The panel is `max-h-[88vh]`, and a
    // modal taller than its own cap scrolls the PAGE behind it instead of
    // itself — the failure a walk sees as "the background moved".
    await page.setViewportSize({ width: 1440, height: 940 });
    const panel = page.getByRole('dialog').filter({ has: page.getByTestId('assistant-thread') });
    await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeLessThanOrEqual(940 * 0.88 + 1);

    // 390 px is where a header full of chips wraps. A group held on one line
    // made the whole SHELL scroll sideways once before, on another surface —
    // it is invisible until somebody opens the product on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('assistant-thread')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.doc, 'the document scrolls sideways at 390px').toBeLessThanOrEqual(0);
    expect(overflow.body, 'the body scrolls sideways at 390px').toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 940 });
  });

  test('(f) with no provider the window explains itself instead of failing', async ({ page }) => {
    await signIn(page);
    await clearProvider(page);
    try {
      await page.goto('/email-templates');
      await openAssistant(page);
      const bar = modal(page).getByTestId('assistant-unavailable');
      await expect(bar).toBeVisible({ timeout: 20_000 });
      await expect(bar).toHaveAttribute('data-reason', 'no-provider');
      // A super admin can fix it, and is offered the way.
      await expect(bar.getByRole('button')).toBeVisible();
      // Nothing to type into: the composer is blocked, not merely empty.
      await expect(modal(page).getByTestId('assistant-input')).toBeDisabled();
    } finally {
      await configureFakeProvider(page);
    }
  });
});
