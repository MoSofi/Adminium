// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FORMS & SURVEYS, WALKED IN A BROWSER, as the people it is for.
 *
 * The add-on as it is built in the add-ons repository, packed, uploaded and
 * attached to a small CRM (`formsWorld.ts`).
 *
 *  1. The manager (never the admin) lands on Forms, not on its off-rail
 *     settings page. A new form gets a question of every kind; its answers
 *     become the CRM's enquiries with a fixed source; it saves by itself and
 *     is published under a readable link name. The Share tab shows its link
 *     on the public address, a QR code drawn under the dashboard's own
 *     content policy, its PNG download, and "Send by e-mail" is not theirs
 *     (a marketer may not send campaigns): one who may starts a campaign
 *     with the link in it. Adminium is asked its forms status once for the
 *     whole page.
 *  2. A stranger opens the link in a context of their own and answers it,
 *     a file among the answers.
 *  3. The manager finds the answer in Answers, is told of it by the bell
 *     (the form tells its managers) and opens its sheet from the notice
 *     (`?answer=`), downloads the file and the CSV; the enquiry it became is
 *     in the CRM with the form's source.
 *  4. A survey: built, published, sent by a rule with the add-on's step
 *     (opened on the rule page by its link, the person read "Jobs → Main
 *     contact"), answered from the mailed link; its Results and Invitations.
 *  5. The reader: the same answers, no Delete and no pick boxes.
 *
 * Needs the add-ons checkout built (`ADMINIUM_ADD_ONS_REPO`) and the add-on
 * trusted (`ADMINIUM_ADD_ON_DEV_TRUST=forms`); skips saying which is missing.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { BASE_URL, SINK_URL, type SinkMessage } from './constants.js';
import { PDF_BYTES } from './formsFiles.js';
import { as, needsForms, PUBLIC_ORIGIN, setUp, strangerPath, tearDown, type FormsWorld } from './formsWorld.js';

let world: FormsWorld | undefined;
let formSlug = '';
let answerId = '';

const EVERY_KIND = ['Short text', 'Short text', 'Long text', 'One choice', 'Several choices', 'Date', 'Number', 'Score 0–10', 'Stars', 'File', 'Agreement tick', 'Hidden field'];

/** Adds questions from the rail, each by its kind's name. */
async function addQuestions(page: Page, kinds: readonly string[]): Promise<void> {
  const rail = page.getByRole('navigation', { name: 'Add a question' });
  for (const kind of kinds) await rail.getByRole('button', { name: kind, exact: true }).click();
}

/** Opens one section of the settings column by its head. */
async function openSettings(page: Page, title: string): Promise<void> {
  const head = page.getByRole('complementary', { name: /settings/ }).getByRole('button', { name: new RegExp(title) });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

async function saved(page: Page): Promise<void> {
  await expect(page.getByText('All changes saved').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('Forms, as its manager and its reader', () => {
  needsForms();
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    world = await setUp(browser);
  });
  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);
    await tearDown(browser, world);
  });

  test('the manager lands on Forms, builds a form of every kind, publishes it and shares it', async ({ browser }) => {
    test.setTimeout(300_000);
    const { page, close } = await as(browser, world!, 'manager');
    const statusReads: string[] = [];
    const policy: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/forms/status')) statusReads.push(request.url());
    });
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) policy.push(message.text());
    });
    try {
      // Off-rail pages are never where somebody lands.
      await page.goto('/');
      await expect(page).toHaveURL(/\/add-ons\/forms\/forms$/, { timeout: 30_000 });

      await page.getByRole('button', { name: 'New form' }).first().click();
      await expect(page).toHaveURL(/\/add-ons\/forms\/forms\/form-[a-z2-9]{6}$/, { timeout: 30_000 });
      await page.getByLabel('Title', { exact: true }).fill('Book a showroom visit');
      // The second short text, picked as it is added, asks for an e-mail address: the agreement tick confirms by e-mail.
      await addQuestions(page, EVERY_KIND.slice(0, 1));
      await page.getByLabel('It asks for').selectOption({ label: 'Their name' });
      await addQuestions(page, EVERY_KIND.slice(1, 2));
      await page.getByLabel('Allowed answers').selectOption({ label: 'An e-mail address' });
      await addQuestions(page, EVERY_KIND.slice(2));

      await openSettings(page, 'Each answer becomes');
      await page.getByRole('radio', { name: /A new row in/ }).click();
      await page.getByLabel('Table', { exact: true }).selectOption({ label: 'Enquiries — Forms CRM' });
      await page.getByLabel('The question that fills Person').selectOption({ index: 1 });
      await page.getByLabel('Every new row gets this value.').fill('Showroom page');
      // Its managers are told of each answer: a bell and a mail.
      await openSettings(page, 'Tell');
      await page.getByRole('button', { name: 'Add a person or role' }).click();
      await page.getByRole('combobox', { name: 'Add a person or role' }).fill('Forms manager');
      await page.getByRole('option', { name: /Forms manager/ }).click();
      await saved(page);

      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText(/Form published\./).first()).toBeVisible({ timeout: 30_000 });
      // The first publish gives the form a readable link name, kept for good after.
      await expect(page).toHaveURL(/\/add-ons\/forms\/forms\/book-a-showroom-visit$/, { timeout: 30_000 });
      formSlug = 'book-a-showroom-visit';
      await expect(page.getByRole('button', { name: 'Publish changes' })).toHaveCount(0);

      await page.getByRole('tab', { name: 'Share' }).click();
      const link = page.getByRole('textbox', { name: 'Link to the form' });
      await expect(link).toHaveValue(`${PUBLIC_ORIGIN}/x/forms/${formSlug}`);
      await expect(page.getByRole('img', { name: /QR code for/ })).toBeVisible();
      const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()]);
      expect(png.suggestedFilename()).toMatch(/\.png$/);
      expect(readFileSync((await png.path())!).subarray(1, 4).toString('latin1')).toBe('PNG');
      // The manager holds no campaign grant: the e-mail card says whom to ask.
      await expect(page.getByText("Campaigns are sent by people who may change Adminium's settings. Ask one of them.")).toBeVisible();
      // One status read for the builder and the Share tab together.
      expect(statusReads).toHaveLength(1);
      expect(policy, policy.join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('one who may send campaigns starts one from the Share tab, the link in it', async ({ page }) => {
    await page.goto(`/add-ons/forms/forms/${formSlug}/share`);
    await page.getByRole('button', { name: 'Send by e-mail' }).click();
    const dialog = page.getByRole('dialog', { name: 'New campaign' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.locator('[data-testid="email-starter"][data-starter=""]').click();
    await page.waitForURL(/\/email-templates\/[^/?#]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    try {
      await expect(page.getByTestId('email-block').last()).toContainText(`${PUBLIC_ORIGIN}/x/forms/${formSlug}`);
    } finally {
      await page.request.delete(`/api/v1/email-templates/${id}`);
    }
  });

  test('a stranger opens the link and answers it, a file among the answers', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto(strangerPath(`${PUBLIC_ORIGIN}/x/forms/${formSlug}`));
      await expect(page.getByRole('heading', { name: 'Book a showroom visit' })).toBeVisible({ timeout: 30_000 });
      const textboxes = page.getByRole('textbox');
      await textboxes.nth(0).fill('Marta Kovac');
      await textboxes.nth(1).fill('marta@cobalt.dev');
      await page.locator('input[type="file"]').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
      await expect(page.getByText('plan.pdf').first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Send/ }).click();
      await expect(page.getByText('Thank you. We have your answers.', { exact: true })).toBeVisible({ timeout: 60_000 });
    } finally {
      await context.close();
    }
  });

  test('the manager finds the answer, opens it from a link, downloads its file and the CSV', async ({ browser, page: admin }) => {
    test.setTimeout(180_000);
    const { page, close } = await as(browser, world!, 'manager');
    try {
      await page.goto(`/add-ons/forms/forms/${formSlug}/answers`);
      const row = page.getByRole('row').filter({ hasText: 'Marta Kovac' });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await page.getByRole('searchbox', { name: 'Search answers' }).fill('marta@');
      await expect(row).toBeVisible();
      const answers = (await (await page.request.get(`/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables['answers']!)}`)).json()) as { data: { id: string }[] };
      answerId = answers.data[0]!.id;
      // The sheet, straight from the bell: the notice's link opens the answer.
      await page.goto('/add-ons/forms/forms');
      await page.getByRole('button', { name: 'Notifications' }).click();
      await page.getByText(/Book a showroom visit/).last().click();
      await expect(page).toHaveURL(new RegExp(`/add-ons/forms/forms/${formSlug}/answers\\?answer=${answerId}`), { timeout: 30_000 });
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await expect(sheet).toContainText('marta@cobalt.dev');
      const [file] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('link', { name: /plan\.pdf/ }).click()]);
      expect(file.suggestedFilename()).toBe('plan.pdf');
      expect(readFileSync((await file.path())!).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      await page.keyboard.press('Escape');
      const [csv] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Download CSV' }).first().click()]);
      expect(readFileSync((await csv.path())!, 'utf8')).toContain('marta@cobalt.dev');
      // The enquiry it became, with the form's fixed source (the admin reads the CRM; the manager reads Forms only).
      const enquiries = (await (await admin.request.get(`/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables['enquiries']!)}`)).json()) as { data: Record<string, unknown>[] };
      expect(enquiries.data).toEqual([expect.objectContaining({ person: 'Marta Kovac', source: 'Showroom page', state: 'open' })]);
    } finally {
      await close();
    }
  });

  test('a survey sent by a rule with the add-on\'s step, answered from its mailed link', async ({ browser, page: admin }) => {
    test.setTimeout(300_000);
    const { page, close } = await as(browser, world!, 'manager');
    try {
      await page.goto('/add-ons/forms/forms/surveys');
      await page.getByRole('button', { name: 'New survey' }).first().click();
      await expect(page).toHaveURL(/\/forms\/surveys\/survey-[a-z2-9]{6}$/, { timeout: 30_000 });
      await page.getByLabel('Title', { exact: true }).fill('How did your job go');
      await addQuestions(page, ['Stars', 'Long text']);
      // A survey's settings are all open at once.
      await page.getByRole('radio', { name: /A new row in/ }).click();
      await page.getByLabel('Table', { exact: true }).selectOption({ label: 'Customer feedback — Forms CRM' });
      await page.getByLabel('The question that fills Score').selectOption({ index: 1 });
      await page.getByLabel('The question that fills Text').selectOption({ index: 1 });
      await saved(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText(/Survey published\./).first()).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/forms\/surveys\/how-did-your-job-go$/, { timeout: 30_000 });
    } finally {
      await close();
    }

    // The rule, saved by the admin, then opened on the rule page by its link.
    await admin.goto('/');
    await admin.request.delete(`${SINK_URL}/messages`);
    const graph = {
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'A job changes' },
        { id: 'n2', kind: 'action', title: 'Send a survey', sub: '', onError: false, action: { kind: 'add-on.step', addOn: 'forms', step: 'send-survey', addOnName: 'Forms & surveys', inputs: { survey: 'how-did-your-job-go', to: '@link:contact_id', class: 'service' } } },
      ],
    };
    const trigger = { kind: 'record', connectionId: world!.connectionId, table: world!.tables['jobs'], event: 'updated', watch: false, when: [] };
    const ruleSaved = await admin.request.post('/api/v1/automations', { data: { name: 'Survey after a job', connectionId: world!.connectionId, trigger, graph, enabled: true } });
    expect(ruleSaved.status(), await ruleSaved.text()).toBe(201);
    const rule = (await ruleSaved.json()) as { id?: string; data?: { id: string } };
    const ruleId = rule.id ?? rule.data!.id;
    try {
      await admin.goto(`/automations?rule=${ruleId}`);
      await admin.getByTestId('flow-node-n2').click({ timeout: 30_000 });
      await expect(admin.getByTestId('add-on-input-to')).toBeVisible({ timeout: 30_000 });
      await expect(admin.getByTestId('add-on-input-to').locator('option:checked')).toHaveText('Jobs → Main contact');

      // A job changes: the rule sends the survey to its main contact.
      const jobs = (await (await admin.request.get(`/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables['jobs']!)}`)).json()) as { data: { id: number }[] };
      const job = jobs.data[0]!.id;
      expect((await admin.request.patch(`/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables['jobs']!)}/${String(job)}`, { data: { values: { title: 'Kitchen fit-out, signed off' } } })).ok()).toBe(true);
      let mail: SinkMessage | undefined;
      await expect
        .poll(
          async () => {
            const messages = (await (await admin.request.get(`${SINK_URL}/messages`)).json()) as SinkMessage[];
            mail = messages.find((message) => message.to.some((to) => to.includes('ann@linden-studio.dev')));
            return mail !== undefined;
          },
          { timeout: 120_000, intervals: [1000] },
        )
        .toBe(true);
      const link = new RegExp(`${PUBLIC_ORIGIN.replace(/[.]/g, '\\.')}/x/forms/how-did-your-job-go\\?t=[A-Za-z0-9_-]+`).exec(mail!.html + mail!.text);
      expect(link, mail!.text).not.toBeNull();

      const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
      const stranger = await context.newPage();
      await stranger.goto(strangerPath(link![0]));
      await expect(stranger.getByRole('heading', { name: 'How did your job go' })).toBeVisible({ timeout: 30_000 });
      await stranger.getByRole('radio', { name: /4/ }).first().click();
      await stranger.getByRole('textbox').first().fill('Tidy work, on time.');
      await stranger.getByRole('button', { name: /Send/ }).click();
      await expect(stranger.getByText('Thank you. Your answers help us.', { exact: true })).toBeVisible({ timeout: 60_000 });
      await context.close();

      const feedback = (await (await admin.request.get(`/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables['feedback']!)}`)).json()) as { data: Record<string, unknown>[] };
      expect(feedback.data).toEqual([expect.objectContaining({ job_id: job, score: 4, text: 'Tidy work, on time.' })]);
    } finally {
      await admin.request.delete(`/api/v1/automations/${ruleId}`);
    }

    const again = await as(browser, world!, 'manager');
    try {
      await again.page.goto('/add-ons/forms/forms/surveys/how-did-your-job-go/results');
      await expect(again.page.getByText('Tidy work, on time.').first()).toBeVisible({ timeout: 30_000 });
      await again.page.getByRole('tab', { name: 'Invitations' }).click();
      await expect(again.page.getByText('Ann Lee').first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await again.close();
    }
  });

  test('the reader reads the answers, with no Delete and no pick boxes', async ({ browser }) => {
    const { page, close } = await as(browser, world!, 'reader');
    try {
      await page.goto(`/add-ons/forms/forms/${formSlug}/answers`);
      await expect(page.getByRole('row').filter({ hasText: 'Marta Kovac' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
      await page.goto(`/add-ons/forms/forms/${formSlug}/answers?answer=${answerId}`);
      await expect(page.getByRole('dialog')).toContainText('marta@cobalt.dev', { timeout: 30_000 });
      await expect(page.getByRole('dialog').getByRole('button', { name: /Delete/ })).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
