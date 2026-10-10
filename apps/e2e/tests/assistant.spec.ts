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
 * The assistant's panel — every handle below is scoped to it.
 *
 * It is a panel beside the page (a dialog only where it lies over the page),
 * so it is found by its own handle and not by a role.
 */
const modal = (page: Page) => page.getByTestId('assistant-dock');

/**
 * Open the assistant from whatever page is on screen, on a conversation of
 * this test's own: the conversation is the PERSON'S and outlives a test, so
 * whatever an earlier one left is ended first.
 */
async function openAssistant(page: Page): Promise<void> {
  if (!(await modal(page).isVisible())) await page.getByTestId('ask-assistant').click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByTestId('assistant-looking-at')).not.toHaveText(/…$/, { timeout: 20_000 });
  const fresh = modal(page).getByTestId('assistant-new');
  if (await fresh.isEnabled()) await fresh.click();
  await expect(modal(page).getByTestId('assistant-steps')).toHaveCount(0);
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
  // The comp's frame, and clear of the width at which the panel changes from beside the page to over it.
  test.use({ viewport: { width: 1440, height: 940 } });

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

    // What writes is the workspace's to allow, in Settings: there is no lock in the panel to lift.
    // (This server is seeded as a workspace that was in use: saving drafts is on.)
    await expect(modal(page).getByTestId('assistant-readonly')).toHaveCount(0);
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

  test('(f) the panel stands beside the page when there is room, and as a sheet on a phone', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.goto('/email-templates');
    await openAssistant(page);

    // 1440 with the rail open is the comp's frame: the page gives up the panel's width and
    // nothing is covered.
    await expect(modal(page)).toHaveAttribute('data-layout', 'docked');
    const docked = await modal(page).boundingBox();
    expect(Math.round(docked?.width ?? 0)).toBe(400);
    expect(Math.round(docked?.height ?? 0)).toBe(940);
    const manager = await page.getByTestId('email-manager').boundingBox();
    expect((manager?.x ?? 0) + (manager?.width ?? 0), 'the page ends where the panel begins').toBeLessThanOrEqual((docked?.x ?? 0) + 1);

    // Narrower, it lies over the page's end, in front of the top bar.
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(modal(page)).toHaveAttribute('data-layout', 'over');
    await expect(modal(page).getByTestId('assistant-close')).toBeVisible();

    // 390 px: a sheet. A group held on one line made the whole SHELL scroll sideways once
    // before, on another surface — invisible until somebody opens the product on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(modal(page)).toHaveAttribute('data-layout', 'sheet');
    await expect(page.getByTestId('assistant-thread')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.doc, 'the document scrolls sideways at 390px').toBeLessThanOrEqual(0);
    expect(overflow.body, 'the body scrolls sideways at 390px').toBeLessThanOrEqual(0);
    // Escape closes a panel that lies over the page, and the bubble is back.
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect(page.getByTestId('assistant-bubble')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 940 });
  });

  test('(f) one conversation across pages: asked on a page of rows, carried to a settings screen, there after a reload', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 940 });
    // Nothing of the panel is fetched before the first press.
    const panelChunks: string[] = [];
    page.on('request', (request) => {
      if (/\/assets\/AssistantDock-[^/]+\.js$/.test(request.url())) panelChunks.push(request.url());
    });
    await page.goto('/p/customers');
    await expect(page.getByTestId('ask-assistant')).toBeVisible();
    await expect(page.getByTestId('assistant-bubble')).toBeVisible();
    expect(panelChunks, 'the panel was fetched before it was opened').toEqual([]);

    // The page's own Ask button, drawn by the shell: this page of rows said what it is.
    await openAssistant(page);
    expect(panelChunks.length).toBeGreaterThan(0);
    await expect(modal(page).getByTestId('assistant-looking-at')).toContainText('Customers');
    await modal(page).getByTestId('assistant-chip').first().click();
    await expect(modal(page).getByText(/You can read \d+ tables here\./)).toBeVisible({ timeout: 30_000 });
    await expect(modal(page).getByTestId('assistant-asked-on').last()).toContainText('Customers');

    // Walk to a screen with no page of its own for the assistant: the same conversation, now the
    // general assistant, which says where things are done with a link it was given.
    await page.goto('/settings/team');
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByText(/You can read \d+ tables here\./)).toBeVisible({ timeout: 20_000 });
    await modal(page).getByTestId('assistant-input').fill('Where do I invite a colleague?');
    await modal(page).getByTestId('assistant-send').click();
    await expect(modal(page).getByText(/Team|do not have access/).last()).toBeVisible({ timeout: 30_000 });
    await expect(modal(page).getByTestId('assistant-asked-on')).toHaveCount(2);

    // A reload finds the panel as it was left, and the conversation in it.
    await page.reload();
    await expect(modal(page)).toBeVisible({ timeout: 20_000 });
    await expect(modal(page).getByTestId('assistant-asked-on')).toHaveCount(2, { timeout: 20_000 });
    await expect(modal(page).getByText(/You can read \d+ tables here\./)).toBeVisible();
  });

  test('(f) a change: asked on a page of rows, shown before anything is written, confirmed, in the audit log, undone', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 940 });
    const settings = async (abilities: Record<string, boolean>) => {
      const res = await page.request.put('/api/v1/assistant/settings', { data: { abilities } });
      expect(res.ok(), `the assistant's switches → ${String(res.status())}`).toBeTruthy();
    };
    const connections = (await (await page.request.get('/api/v1/connections')).json()) as { data?: { id: string }[]; connections?: { id: string }[] };
    const connectionId = (connections.data ?? connections.connections ?? [])[0]?.id ?? '';
    // The table's id is the engine's own (`main.customers`, `public.customers`, `<database>.customers`).
    const schema = (await (await page.request.get(`/api/v1/connections/${connectionId}/schema`)).json()) as { model: { tables: { id: string; name: string }[] } };
    const customers = schema.model.tables.find((table) => table.name === 'customers')?.id ?? '';
    expect(customers, 'the customers table').not.toBe('');
    const cityOf = async (): Promise<unknown> => {
      const row = (await (await page.request.get(`/api/v1/data/${connectionId}/${customers}/ALFKI`)).json()) as { data: { city: unknown } };
      return row.data.city;
    };
    const before = await cityOf();

    try {
      // Off: asked to change a row, it is not offered the move at all, and says so.
      await settings({ create: true, change: false, send: false, delete: false });
      await page.goto('/p/customers');
      await openAssistant(page);
      await modal(page).getByTestId('assistant-input').fill('Move ALFKI to Hamburg');
      await modal(page).getByTestId('assistant-send').click();
      await expect(modal(page).getByText('I cannot change anything here.')).toBeVisible({ timeout: 30_000 });
      await expect(modal(page).getByTestId('assistant-proposal')).toHaveCount(0);

      // On: the same words now end in a card, checked as this person before it is shown.
      await settings({ create: true, change: true, send: false, delete: false });
      await modal(page).getByTestId('assistant-input').fill('Move ALFKI to Hamburg');
      await modal(page).getByTestId('assistant-send').click();
      const card = modal(page).getByTestId('assistant-proposal');
      await expect(card.getByTestId('assistant-proposal-title')).toHaveText('Change 1 row', { timeout: 30_000 });
      await expect(card.getByTestId('assistant-proposal-row')).toContainText('ALFKI');
      await expect(card.getByTestId('assistant-proposal-row')).toContainText('Hamburg');
      // Nothing is written by being shown.
      expect(await cityOf()).toEqual(before);
      // The title has focus, not the confirm: Enter does nothing.
      await page.keyboard.press('Enter');
      expect(await cityOf()).toEqual(before);

      await card.getByTestId('assistant-proposal-confirm').click();
      const result = modal(page).getByTestId('assistant-proposal-result');
      await expect(result).toContainText('Changed 1 row.', { timeout: 30_000 });
      expect(await cityOf()).toBe('Hamburg');

      // The audit log says who, and that it came through the assistant.
      const audit = (await (await page.request.get('/api/v1/audit?category=data&limit=5')).json()) as { data?: { action: string; changes: { via?: unknown } | null }[]; entries?: { action: string; changes: { via?: unknown } | null }[] };
      const entry = (audit.data ?? audit.entries ?? []).find((row) => row.action === 'record.update');
      expect(entry?.changes?.via, 'the mark on the audit entry').toBeTruthy();

      // The page's own undo, for its minute.
      await result.getByTestId('assistant-proposal-undo').click();
      await expect(modal(page).getByText('Undone. Everything is as it was.')).toBeVisible({ timeout: 20_000 });
      expect(await cityOf()).toEqual(before);

      // After a reload the card is the stored outcome; a confirmed proposal cannot be confirmed again.
      await page.reload();
      await expect(modal(page).getByTestId('assistant-proposal-result')).toContainText('Changed 1 row.', { timeout: 20_000 });
      await expect(modal(page).getByTestId('assistant-proposal-confirm')).toHaveCount(0);

      // The audit page draws the mark.
      await page.goto('/audit');
      await expect(page.getByTestId('audit-via-assistant').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await settings({ create: true, change: false, send: false, delete: false });
    }
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
