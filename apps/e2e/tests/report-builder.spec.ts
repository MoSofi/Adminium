// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/report-builder` surface against the BUILT stack: the manager, the New
 * modal's twelve starters, the editor's canvas + inspector, the block
 * palette, the reorder paths, the report-from-template flow and the list
 * layout.
 *
 * The dashboard suite mounts these through the real router with a fetch stub;
 * the server suite covers the routes in process. What ONLY this file sees:
 * the two lazy chunks mount from the built bundle, a starter minted by the
 * server arrives through a real socket with the blocks Appendix C says it
 * should have, and a save → reload round trip survives the database.
 *
 * ORDER IS THE FIXTURE. `describe.configure({ mode: 'serial' })` plus the
 * suite's one worker: the empty states are asserted on a cleared workspace,
 * every later test builds on the template the second one creates, and the
 * last test removes what is left. Everything is torn down through the API in
 * `afterAll` so a re-run starts from the same empty install.
 *
 * TWO INSPECTORS ARE MOUNTED AT ONCE (Editor.tsx: the `lg:hidden` drawer
 * under the canvas and the `hidden lg:flex` aside). Every panel test id
 * therefore matches twice — `inspector()` scopes to the aside, `drawer()` to
 * the other, and no bare `getByTestId` may address a panel (trap 9).
 *
 * DRAG IS NOT DRIVEN HERE. The comp's reorder is HTML5 `draggable` (306, 626)
 * and Playwright's `dragTo` drives it unreliably in CI; the KEYBOARD path
 * (D17) is exercised instead, and the mouse path is walked by hand (the same
 * split 34 took).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

/** The comp's twelve starters (475-493) in modal order: key, name, category label. */
const STARTERS: readonly (readonly [string, string, string])[] = [
  ['exec', 'Executive summary', 'Leadership'],
  ['weekly', 'Weekly digest', 'Operations'],
  ['mbr', 'Monthly business review', 'Leadership'],
  ['sales', 'Sales report', 'Revenue'],
  ['marketing', 'Marketing report', 'Growth'],
  ['finance', 'Financial statement', 'Finance'],
  ['product', 'Product analytics', 'Product'],
  ['health', 'Customer health', 'Success'],
  ['campaign', 'Campaign recap', 'Growth'],
  ['board', 'Board deck', 'Leadership'],
  ['incident', 'Incident postmortem', 'Engineering'],
  ['scorecard', 'KPI scorecard', 'Operations'],
];

/** The palette's order (comp `palDefs`, 608). */
const KINDS = [
  'heading', 'text', 'kpi', 'bar', 'line', 'table', 'signature', 'terms', 'attachments', 'approval',
  'qr', 'latefees', 'poterms', 'multicurrency', 'recurring', 'discount', 'taxbreak', 'payhistory',
  'legal', 'refund', 'contact', 'loyalty', 'delivery', 'image', 'divider',
] as const;

/** The desktop-inspector aside — the drawer under the canvas carries the same ids. */
function inspector(page: Page): Locator {
  return page.locator('[data-testid="report-inspector"][data-variant="aside"]');
}
function drawer(page: Page): Locator {
  return page.locator('[data-testid="report-inspector"][data-variant="drawer"]');
}
function blocks(page: Page): Locator {
  return page.locator('[data-testid="report-block"]');
}
function blockOf(page: Page, kind: string): Locator {
  return page.locator(`[data-testid="report-block"][data-kind="${kind}"]`);
}

/**
 * Select a block by clicking its CARD, not its centre. A text-shaped block's
 * centre is its inline textarea, and the comp stops that click from reaching
 * the card (316 `onClick="{{ stop }}"`) so typing in a block never re-selects
 * it — faithful behaviour, and the reason a plain `.click()` here would land
 * in the editor instead of the selector.
 */
async function selectBlock(target: Locator): Promise<void> {
  await target.click({ position: { x: 6, y: 6 } });
}

/** The shell's toast stack sits bottom-end and pauses on hover; clear it before clicking near it. */
async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.locator('button[aria-label="Dismiss"]');
  for (let guard = 0; guard < 6; guard += 1) {
    if ((await dismiss.count()) === 0) return;
    await dismiss.first().click({ timeout: 2_000 }).catch(() => undefined);
  }
}

interface Row {
  id: string;
  kind: string;
  name: string;
}

async function listDocuments(page: Page): Promise<Row[]> {
  const reply = await page.request.get('/api/v1/report-documents');
  expect(reply.ok(), `GET /api/v1/report-documents → ${String(reply.status())}`).toBe(true);
  return ((await reply.json()) as { items: Row[] }).items;
}

/** A fresh install: no report documents at all (the empty states' precondition). */
async function clearDocuments(page: Page): Promise<void> {
  for (const row of await listDocuments(page)) {
    await page.request.delete(`/api/v1/report-documents/${row.id}`);
  }
}

function idFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(id, `no document id in ${page.url()}`).not.toBe('');
  return id;
}

test.describe('the /report-builder surface', () => {
  test.describe.configure({ mode: 'serial' });

  /** The Executive-summary template every later test edits; set by the second test. */
  let templateId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearDocuments(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearDocuments(page);
    await page.close();
  });

  test('the manager mounts from the built bundle with both empty states', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/report-builder');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(page.getByText('Reusable report layouts & the reports you build from them.')).toBeVisible();
    await expect(page.getByTestId('report-new')).toHaveText('New template');

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([/^Templates/, /^Reports/]);
    await expect(page.getByTestId('tab-count')).toHaveText(['0', '0']);

    const empty = page.getByTestId('report-empty');
    await expect(empty.getByRole('heading', { name: 'No templates yet' })).toBeVisible();
    await expect(empty.getByText('Create a reusable report layout your team can build from.')).toBeVisible();
    await testInfo.attach('manager-empty-templates', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByTestId('report-new')).toHaveText('New report');
    await expect(empty.getByRole('heading', { name: 'No reports yet' })).toBeVisible();
    await expect(empty.getByText('Build your first report from a template or a blank canvas.')).toBeVisible();
    await testInfo.attach('manager-empty-reports', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('New template → Blank + twelve starters → Executive summary opens the editor', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/report-builder');
    await page.getByTestId('report-new').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Start from a blank canvas or a ready-made report layout.')).toBeVisible();
    // The dashed Blank tile plus the twelve starters (comp 64-96).
    await expect(page.getByTestId('report-starter')).toHaveCount(13);
    await expect(page.locator('[data-testid="report-starter"][data-starter=""]')).toContainText('Blank report');
    for (const [key, name, category] of STARTERS) {
      const tile = page.locator(`[data-testid="report-starter"][data-starter="${key}"]`);
      await expect(tile, `starter ${key}`).toContainText(name);
      await expect(tile, `starter ${key} category`).toContainText(category);
    }
    await testInfo.attach('new-modal', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.locator('[data-testid="report-starter"][data-starter="exec"]').click();
    await page.waitForURL(/\/report-builder\/rpt_/);
    templateId = idFromUrl(page);

    // Appendix C row 1: the header and the four blocks, in order.
    await expect(page.getByTestId('report-kicker')).toHaveValue('Quarterly report');
    await expect(page.getByTestId('report-title')).toHaveValue('Q3 2026 Executive Summary');
    await expect(page.getByTestId('report-subtitle')).toHaveValue('For the leadership team · Jul 1 – Sep 30');
    await expect(blocks(page)).toHaveCount(4);
    await expect
      .poll(() => blocks(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind'))))
      .toEqual(['text', 'kpi', 'bar', 'table']);
    await expect(blockOf(page, 'kpi')).toContainText('$482k');
    await expect(blockOf(page, 'table')).toContainText('Northwind');
    // Appendix D at the source: the comp's "Team tier" never reaches the sheet.
    await expect(blockOf(page, 'text')).toContainText('expansion in larger accounts');
    await expect(page.getByTestId('report-save-chip')).toHaveText('All changes saved');
    await expect(page.getByTestId('report-save')).toHaveText('Save template');
    await testInfo.attach('editor-exec', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('the palette adds any of the 25 kinds, selects it, and the inspector follows', async ({ page }) => {
    await signIn(page);
    await page.goto(`/report-builder/${templateId}`);
    await expect(page.getByTestId('report-palette-item')).toHaveCount(25);

    await page.locator('[data-testid="report-palette-item"][data-kind="loyalty"]').click();
    await expect(blocks(page)).toHaveCount(5);
    // The four kinds the comp's `kindMeta` returns backwards print LABELS (D13).
    await expect(inspector(page).getByTestId('report-inspector-title')).toHaveText('Loyalty points');
    // …and the seed is Appendix D's *Level*, never the comp's Tier.
    await expect(inspector(page).getByRole('textbox', { name: 'Level' })).toHaveValue('Gold');
    await expect(inspector(page)).not.toContainText('Tier');
    await expect(page.getByTestId('report-save-chip')).toHaveText('Unsaved changes');
  });

  test('an edit saves, and a reload reproduces it', async ({ page }) => {
    await signIn(page);
    await page.goto(`/report-builder/${templateId}`);
    await page.getByTestId('report-title').fill('Q3 2026 — final');
    await inspector(page).getByRole('textbox', { name: 'Kicker' }).fill('Board pack');
    await expect(page.getByTestId('report-save-chip')).toHaveText('Unsaved changes');
    await page.getByTestId('report-save').click();
    await expect(page.getByTestId('report-save-chip')).toHaveText('All changes saved');

    await page.reload();
    await expect(page.getByTestId('report-title')).toHaveValue('Q3 2026 — final');
    await expect(page.getByTestId('report-kicker')).toHaveValue('Board pack');
    await expect(blocks(page)).toHaveCount(4);
  });

  test('the chevrons swap, the grip reorders from the keyboard, and delete falls back to the header', async ({ page }) => {
    await signIn(page);
    await page.goto(`/report-builder/${templateId}`);
    // `evaluateAll` does not retry, so the order is read through `expect.poll`.
    const kinds = () => blocks(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
    await expect.poll(kinds).toEqual(['text', 'kpi', 'bar', 'table']);

    // The chevrons SWAP with the neighbour (537).
    await blocks(page).nth(1).getByRole('button', { name: 'Move up' }).click();
    await expect.poll(kinds).toEqual(['kpi', 'text', 'bar', 'table']);

    // The grip is a real button, so ArrowDown reorders without a mouse (D17).
    await blocks(page).nth(0).getByTestId('report-block-grip').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(kinds).toEqual(['text', 'kpi', 'bar', 'table']);

    await selectBlock(blocks(page).nth(3));
    await expect(inspector(page).getByTestId('report-inspector-title')).toHaveText('Table');
    await blocks(page).nth(3).getByRole('button', { name: 'Delete block' }).click();
    await expect.poll(kinds).toEqual(['text', 'kpi', 'bar']);
    await expect(inspector(page).getByTestId('report-inspector-title')).toHaveText('Report header');
  });

  test('Half width lays two blocks side by side; Show off dims one and keeps it in place', async ({ page }) => {
    await signIn(page);
    await page.goto(`/report-builder/${templateId}`);
    await selectBlock(blocks(page).nth(0));
    await inspector(page).locator('[data-testid="report-width-option"][data-value="half"]').click();
    await expect(page.locator('[data-testid="report-block-wrap"]').nth(0)).toHaveAttribute('data-width', 'half');

    await inspector(page).getByTestId('report-show-toggle').click();
    await expect(inspector(page).getByTestId('report-show-toggle')).toHaveAttribute('aria-checked', 'false');
    // Dimmed, and STILL FIRST — `show: false` never removes or re-orders (trap
    // 2). Four blocks, because the previous test's delete was never saved: that
    // is the point — nothing writes the row until the primary does (D4).
    await expect(blocks(page).nth(0)).toHaveAttribute('data-hidden', '');
    await expect(blocks(page).nth(0)).toHaveAttribute('data-kind', 'text');
    await expect(blocks(page)).toHaveCount(4);

    await page.getByTestId('report-save').click();
    await expect(page.getByTestId('report-save-chip')).toHaveText('All changes saved');
    await page.reload();
    await expect(blocks(page).nth(0)).toHaveAttribute('data-hidden', '');
  });

  test('the manager renames in place, duplicates after the source and shows the list layout', async ({ page }) => {
    await signIn(page);
    await page.goto('/report-builder');
    await expect(page.getByTestId('report-card')).toHaveCount(1);
    await expect(page.getByTestId('report-card-name')).toHaveText('Executive summary');
    // The card's meta is "N blocks" on the Templates tab (585).
    await expect(page.getByTestId('report-card-meta')).toHaveText('4 blocks');

    const card = page.getByTestId('report-card').first();
    await card.hover();
    await card.getByRole('button', { name: 'Rename' }).click();
    await page.getByTestId('report-rename').fill('Board layout');
    await page.getByTestId('report-rename').press('Enter');
    await expect(page.getByTestId('report-card-name')).toHaveText('Board layout');

    await card.hover();
    await card.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByTestId('report-card-name')).toHaveText(['Board layout', 'Board layout (copy)']);
    await dismissToasts(page);

    await page.getByRole('radio', { name: 'List' }).click();
    const table = page.getByTestId('report-list');
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Status', 'Updated', 'Actions']);
    // The row's sub is "{reportTitle} · N blocks" on BOTH tabs (585).
    await expect(page.getByTestId('report-row-sub').first()).toHaveText('Q3 2026 — final · 4 blocks');
    await page.getByRole('radio', { name: 'Gallery' }).click();
  });

  test('a report from a template copies the body, records its origin and survives the template’s deletion (D6)', async ({ page }) => {
    await signIn(page);
    await page.goto('/report-builder?kind=report');
    await page.getByTestId('report-new').click();
    const section = page.getByTestId('report-your-templates');
    await expect(section.getByTestId('report-from-template')).toHaveCount(2);
    await section.getByTestId('report-from-template').first().click();
    await page.waitForURL(/\/report-builder\/rpt_/);
    const reportId = idFromUrl(page);
    expect(reportId).not.toBe(templateId);

    // The template's body, verbatim; a report's primary is *Publish* (D5).
    await expect(page.getByTestId('report-title')).toHaveValue('Q3 2026 — final');
    await expect(blocks(page)).toHaveCount(4);
    await expect(page.getByTestId('report-save')).toHaveText('Publish');

    const detail = await (await page.request.get(`/api/v1/report-documents/${reportId}`)).json();
    expect((detail as { originId: string | null }).originId).not.toBeNull();

    await page.getByTestId('report-save').click();
    await expect(page.getByTestId('report-save-chip')).toHaveText('All changes saved');
    await page.goto('/report-builder?kind=report');
    await expect(page.getByTestId('report-status').first()).toHaveText('Published');

    // Deleting the template leaves the report untouched.
    await page.request.delete(`/api/v1/report-documents/${templateId}`);
    await page.goto(`/report-builder/${reportId}`);
    await expect(page.getByTestId('report-title')).toHaveValue('Q3 2026 — final');
  });

  test('the side columns run the full height, and no panel scrolls sideways', async ({ page }) => {
    // Both regressions this asserts were real and shipped: the columns painted
    // their surface on a `max-h` sticky box, so the sidebar ended part-way down
    // a long document; and every repeater panel overflowed horizontally because
    // its fixed-width inputs were built with a template literal instead of
    // `cn()`, leaving `w-full` from FIELD to win on CSS source order.
    await signIn(page);
    // Its own document: an earlier test in this serial run deletes `templateId`.
    const made = await page.request.post('/api/v1/report-documents', { data: { kind: 'template', starter: 'exec', name: 'Layout probe' } });
    expect(made.status(), await made.text()).toBe(201);
    const probeId = ((await made.json()) as { id: string }).id;
    await page.goto(`/report-builder/${probeId}`);
    await expect(page.getByTestId('report-paper')).toBeVisible();

    // Every kind, seeded through the palette so each panel draws its real rows —
    // a block posted bare through the API has EMPTY repeaters and hides this.
    for (const kind of KINDS) await page.locator(`[data-testid="report-palette-item"][data-kind="${kind}"]`).click();

    const columnsFillTheRow = await page.evaluate(() => {
      const aside = document.querySelector('[data-testid="report-inspector"][data-variant="aside"]');
      const palette = document.querySelector('[data-testid="report-palette"]');
      const row = aside?.parentElement;
      if (aside === null || palette === null || row === undefined || row === null) return null;
      const rowH = Math.round(row.getBoundingClientRect().height);
      return { rowH, asideH: Math.round(aside.getBoundingClientRect().height), paletteH: Math.round(palette.getBoundingClientRect().height) };
    });
    expect(columnsFillTheRow).not.toBeNull();
    expect(columnsFillTheRow?.asideH, 'the inspector column stops short of the editor').toBe(columnsFillTheRow?.rowH);
    expect(columnsFillTheRow?.paletteH, 'the palette column stops short of the editor').toBe(columnsFillTheRow?.rowH);

    const overflowing: string[] = [];
    for (const kind of KINDS) {
      await page.locator(`[data-testid="report-block"][data-kind="${kind}"]`).last().click({ position: { x: 6, y: 6 } });
      await expect(inspector(page).locator(`[data-testid="report-block-panel"][data-kind="${kind}"]`)).toBeVisible();
      // GEOMETRY, not `scrollWidth`. The panel sets `overflow-x: hidden`, so a row
      // that is too wide is CLIPPED rather than scrollable and `scrollWidth`
      // equals `clientWidth` — the first version of this guard measured exactly
      // that and passed while the bug was live. Compare each control's right
      // edge with the panel's content box instead: that catches the fault
      // whether the overflow scrolls, is hidden, or escapes the box.
      const over = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="report-inspector"][data-variant="aside"] [data-testid="report-block-panel"]');
        if (panel === null) return 0;
        const box = panel.getBoundingClientRect();
        let worst = 0;
        for (const el of panel.querySelectorAll('input, button, textarea, img')) {
          worst = Math.max(worst, Math.round(el.getBoundingClientRect().right - box.right));
        }
        return worst;
      });
      if (over > 0) overflowing.push(`${kind} (+${String(over)}px past the panel)`);
    }
    expect(overflowing, `panels that scroll sideways: ${overflowing.join(', ')}`).toEqual([]);
    await page.request.delete(`/api/v1/report-documents/${probeId}`);
  });

  test('the sheet stops squeezing at its floor, and the list keeps its actions reachable', async ({ page }) => {
    /*
     * Both ruled 2026-09-10, after the owner found the sidebar faults and asked
     * for a sweep of the rest of the surface.
     *
     * THE SHEET. The comp's rule is `max-width: 760px` with no minimum (692),
     * so the sheet takes whatever the canvas column has — and at the `lg`
     * breakpoint the shell rail (256) plus the palette (216) and the inspector
     * (288) leave 208 px, which cut block content off inside the paper's
     * `overflow: hidden`. It now floors at 560 and the COLUMN scrolls (D18).
     *
     * THE LIST. The comp's four fixed tracks need 450 px inside the card (M11);
     * at 390 px all three row actions fell outside the card's `overflow:
     * hidden` and could not be clicked. Below `sm` the two middle columns
     * collapse away.
     */
    // `signIn` waits for the primary nav, which the shell collapses on a phone
    // — sign in wide, then narrow.
    await signIn(page);
    const made = await page.request.post('/api/v1/report-documents', { data: { kind: 'template', starter: 'exec', name: 'Width probe' } });
    expect(made.status(), await made.text()).toBe(201);
    const probeId = ((await made.json()) as { id: string }).id;

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/report-builder/${probeId}`);
    await expect(page.getByTestId('report-paper')).toBeVisible();
    for (const kind of KINDS) await page.locator(`[data-testid="report-palette-item"][data-kind="${kind}"]`).click();

    const sheet = await page.evaluate(() => {
      const paper = document.querySelector('[data-testid="report-paper"]');
      const column = paper?.parentElement;
      if (paper === null || column === undefined || column === null) return null;
      const box = paper.getBoundingClientRect();
      const clipped = [...paper.querySelectorAll('span, div, input, textarea, img')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && Math.round(r.right - box.right) > 1;
      }).length;
      return {
        width: Math.round(box.width),
        columnScrolls: column.scrollWidth > column.clientWidth,
        clipped,
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    expect(sheet?.width, 'the sheet collapsed past its floor').toBeGreaterThanOrEqual(560);
    expect(sheet?.clipped, 'block content is cut off inside the sheet').toBe(0);
    expect(sheet?.columnScrolls, 'the canvas column must scroll rather than squeeze the sheet').toBe(true);
    expect(sheet?.pageScrollsX, 'the shell itself scrolls sideways').toBe(false);

    // The list on a phone: two columns, and every action still clickable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/report-builder');
    await expect(page.getByTestId('report-card').first()).toBeVisible();
    await page.getByTestId('report-layout').getByRole('radio').nth(1).click();
    await expect(page.getByTestId('report-list')).toBeVisible();
    const list = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="report-list"]');
      const actions = document.querySelector('[data-testid="report-row-actions"]');
      if (table === null || actions === null) return null;
      const box = table.getBoundingClientRect();
      const buttons = [...actions.querySelectorAll('button')];
      return {
        columns: [...table.querySelectorAll('[role="columnheader"]')].filter((c) => c.getBoundingClientRect().width > 0).length,
        cutOff: buttons.filter((b) => Math.round(b.getBoundingClientRect().right - box.right) > 1).length,
        buttons: buttons.length,
      };
    });
    expect(list?.columns, 'the two middle columns should collapse below `sm`').toBe(2);
    expect(list?.buttons).toBe(3);
    expect(list?.cutOff, 'row actions are cut off and cannot be clicked').toBe(0);

    await page.setViewportSize({ width: 1440, height: 940 });
    await page.request.delete(`/api/v1/report-documents/${probeId}`);
  });

  test('below `lg` the inspector is a drawer and the palette is a button (D18)', async ({ page }, testInfo) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/report-builder?kind=report');
    await page.getByTestId('report-card').first().click();
    await page.waitForURL(/\/report-builder\/rpt_/);

    await expect(inspector(page)).toBeHidden();
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByTestId('report-palette')).toBeHidden();
    await page.getByTestId('report-add-block').click();
    await expect(page.getByTestId('report-palette-sheet').getByTestId('report-palette-item')).toHaveCount(25);
    await page.locator('[data-testid="report-palette-sheet"] [data-testid="report-palette-item"][data-kind="divider"]').click();
    await expect(blocks(page)).toHaveCount(5);

    // The shell never scrolls sideways; the canvas column does (D18).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow, 'the page scrolls horizontally at 390 px').toBe(true);
    await testInfo.attach('editor-390', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.setViewportSize({ width: 1440, height: 940 });
  });

  test('delete from the editor asks first and returns to the manager', async ({ page }) => {
    await signIn(page);
    await page.goto('/report-builder?kind=report');
    await page.getByTestId('report-card').first().click();
    await page.waitForURL(/\/report-builder\/rpt_/);
    await page.getByTestId('report-delete').click();
    await expect(page.getByTestId('report-delete-body')).toHaveText('This can’t be undone. The report will be permanently removed.');
    await page.getByTestId('report-delete-confirm').click();
    await page.waitForURL(/\/report-builder(\?|$)/);
    await expect(page.getByTestId('report-empty').getByRole('heading', { name: 'No reports yet' })).toBeVisible();
  });
});
