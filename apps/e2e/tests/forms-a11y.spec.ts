// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FORMS & SURVEYS UNDER AXE.
 *
 * The add-on as it is built, attached to a small CRM (`formsWorld.ts`), seen
 * by its manager: the list (cards, as a list, and empty), the builder (each
 * settings section open, the language popover, Preview, and the blocked
 * cards while the server has no public address and no privacy notice), the
 * Share tab (a website checked that is listed and one that is not), Answers
 * and an answer's sheet, a survey's Results and Invitations; and the add-on
 * step's settings on the rule page, seen by the admin who writes rules.
 * Light and dark, English and Arabic (right to left), 1024 and 390 wide.
 *
 * EVERY SWEEP ASSERTS ITS OWN `passes`: an axe run that analysed nothing
 * reports zero violations too. Every critical or serious finding fails.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { BASE_URL, SINK_URL, type SinkMessage } from './constants.js';
import { PDF_BYTES } from './formsFiles.js';
import { as, needsForms, PUBLIC_ORIGIN, setUp, strangerPath, tearDown, words, type FormsWorld } from './formsWorld.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const LISTED = 'https://www.meridian-e2e.dev';

interface Sweep {
  states: number;
  minor: number;
  failures: string[];
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo): Promise<void> {
  // Overlays fade in: wait for every finite animation, so colours are read at rest.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.passes.length, `${label}: axe examined nothing`).toBeGreaterThan(0);
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) testInfo.annotations.push({ type: 'axe-lesser', description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}` });
  if (blocking.length > 0) {
    const report = blocking.map((v) => `${String(v.impact)}: ${v.id} — ${v.help}\n${v.nodes.slice(0, 4).map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}`).join('\n')}`).join('\n');
    tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
  }
}

type Combo = { theme: 'light' | 'dark'; locale: 'en_US' | 'ar_EG'; width: 1024 | 390 };
const COMBOS: Combo[] = (['light', 'dark'] as const).flatMap((theme) => (['en_US', 'ar_EG'] as const).flatMap((locale) => ([1024, 390] as const).map((width) => ({ theme, locale, width }))));
const tagOf = (combo: Combo) => `${combo.theme} · ${combo.locale} · ${String(combo.width)}`;

async function prefs(page: Page, combo: Combo | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: combo === null ? { theme: null, locale: null } : { theme: combo.theme, locale: combo.locale } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
  if (combo !== null) await page.setViewportSize({ width: combo.width, height: 900 });
}

/** Opens a settings section of the builder by its head, in the language shown. */
async function openSection(page: Page, title: string): Promise<void> {
  const head = page.locator('aside button[aria-expanded]').filter({ hasText: title }).first();
  await expect(head).toBeVisible({ timeout: 30_000 });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

let world: FormsWorld | undefined;

test.describe('Forms under axe', () => {
  needsForms();

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    world = await setUp(browser);
  });
  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, close } = await as(browser, world!, 'manager');
    await prefs(page, null).catch(() => undefined);
    await close();
    await tearDown(browser, world);
  });

  test('the add-on\'s screens are clean in light and dark, English and Arabic, 1024 and 390 wide', async ({ browser, page: admin }, testInfo) => {
    test.setTimeout(1_800_000);
    const tally: Sweep = { states: 0, minor: 0, failures: [] };
    const { page, close } = await as(browser, world!, 'manager');
    const data = (ref: string, key?: string) => `/api/v1/data/${world!.connectionId}/${encodeURIComponent(world!.tables[ref]!)}${key === undefined ? '' : `/${encodeURIComponent(key)}`}`;
    try {
      // ── the empty list, before anything is made ──────────────────────────
      for (const combo of COMBOS) {
        await prefs(page, combo);
        const w = words(combo.locale);
        await page.goto('/add-ons/forms/forms');
        await expect(page.getByRole('button', { name: w('list.newForm') }).first()).toBeVisible({ timeout: 30_000 });
        await sweep(page, `${tagOf(combo)} · no forms yet`, tally, testInfo);
      }

      // ── a form, answered by a stranger; a survey, sent by a rule and answered ──
      await prefs(page, { theme: 'light', locale: 'en_US', width: 1024 });
      const form = { v: 1, kind: 'form', languages: ['en-US', 'ar-EG'], defaultLanguage: 'en-US', title: { 'en-US': 'Book a showroom visit', 'ar-EG': 'احجز زيارة' }, questions: [{ id: 'qname', kind: 'short', role: 'name', required: true, label: { 'en-US': 'Your name', 'ar-EG': 'اسمك' } }, { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: { 'en-US': 'E-mail', 'ar-EG': 'البريد' } }, { id: 'qplan', kind: 'file', kinds: ['pdf'], maxMb: 5, label: { 'en-US': 'Plans', 'ar-EG': 'المخططات' } }, { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 1, wordingChangedAt: '2026-11-01', label: { 'en-US': 'Send me the newsletter.', 'ar-EG': 'أرسل لي النشرة.' } }], ending: { kind: 'words', words: { 'en-US': 'Thanks.', 'ar-EG': 'شكرًا.' } } };
      const formSettings = { becomes: { table: world!.tables['enquiries'], map: { qname: 'person', qemail: 'email' }, source: { column: 'source', value: 'Showroom page' } }, tell: [], limits: { perHour: 200, harder: false } };
      const survey = { v: 1, kind: 'survey', languages: ['en-US', 'ar-EG'], defaultLanguage: 'en-US', title: { 'en-US': 'How did your job go', 'ar-EG': 'كيف كان عملنا' }, questions: [{ id: 'qnps', kind: 'score', recommend: true, label: { 'en-US': 'Would you recommend us?', 'ar-EG': 'هل تنصح بنا؟' } }, { id: 'qstars', kind: 'stars', label: { 'en-US': 'The work', 'ar-EG': 'العمل' } }, { id: 'qlong', kind: 'long', label: { 'en-US': 'Anything else?', 'ar-EG': 'شيء آخر؟' } }], ending: { kind: 'words', words: { 'en-US': 'Thank you.', 'ar-EG': 'شكرًا لك.' } } };
      const surveySettings = { becomes: { table: world!.tables['feedback'], map: { qstars: 'score', qlong: 'text' } }, tell: [], limits: { perHour: 200, harder: false }, survey: { mode: 'named', linkNames: true, stopAfterDays: 30 } };
      for (const [slug, name, kind, definition, settings] of [['book-a-showroom-visit', 'Book a showroom visit', 'form', form, formSettings], ['how-did-your-job-go', 'How did your job go', 'survey', survey, surveySettings]] as const) {
        const id = crypto.randomUUID();
        expect((await page.request.post(data('forms'), { data: { values: { id, name, slug, kind, state: 'draft', definition, settings } } })).ok()).toBe(true);
        const live = await page.request.patch(data('forms', id), { data: { values: { state: 'live', published: { definition, settings }, published_at: new Date().toISOString() }, from: 'draft' } });
        expect(live.ok(), await live.text()).toBe(true);
      }
      const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
      const stranger = await context.newPage();
      await stranger.goto(strangerPath(`${PUBLIC_ORIGIN}/x/forms/book-a-showroom-visit`));
      await expect(stranger.getByRole('heading', { name: 'Book a showroom visit' })).toBeVisible({ timeout: 30_000 });
      await stranger.getByRole('textbox').nth(0).fill('Marta Kovac');
      await stranger.getByRole('textbox').nth(1).fill('marta@cobalt.dev');
      await stranger.locator('input[type="file"]').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
      await expect(stranger.getByText('plan.pdf').first()).toBeVisible({ timeout: 30_000 });
      await stranger.getByRole('button', { name: /Send/ }).click();
      await expect(stranger.getByText('Thanks.', { exact: true })).toBeVisible({ timeout: 60_000 });
      const answerId = ((await (await page.request.get(data('answers'))).json()) as { data: { id: string }[] }).data[0]!.id;

      // The survey, sent by a rule with the add-on's step and answered from the mail.
      await admin.goto('/');
      await admin.request.delete(`${SINK_URL}/messages`);
      const graph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'A job changes' }, { id: 'n2', kind: 'action', title: 'Send a survey', sub: '', onError: false, action: { kind: 'add-on.step', addOn: 'forms', step: 'send-survey', addOnName: 'Forms & surveys', inputs: { survey: 'how-did-your-job-go', to: '@link:contact_id', class: 'service' } } }] };
      const trigger = { kind: 'record', connectionId: world!.connectionId, table: world!.tables['jobs'], event: 'updated', watch: false, when: [] };
      const saved = await admin.request.post('/api/v1/automations', { data: { name: 'Survey after a job', connectionId: world!.connectionId, trigger, graph, enabled: true } });
      expect(saved.status(), await saved.text()).toBe(201);
      const rule = (await saved.json()) as { id?: string; data?: { id: string } };
      const ruleId = rule.id ?? rule.data!.id;
      try {
        const jobs = ((await (await admin.request.get(data('jobs'))).json()) as { data: { id: number }[] }).data;
        expect((await admin.request.patch(data('jobs', String(jobs[0]!.id)), { data: { values: { title: 'Kitchen fit-out, signed off' } } })).ok()).toBe(true);
        let mail: SinkMessage | undefined;
        await expect
          .poll(async () => {
            mail = ((await (await admin.request.get(`${SINK_URL}/messages`)).json()) as SinkMessage[]).find((message) => message.to.some((to) => to.includes('ann@linden-studio.dev')));
            return mail !== undefined;
          }, { timeout: 120_000, intervals: [1000] })
          .toBe(true);
        const link = /https:\/\/[^\s"<]+\/x\/forms\/how-did-your-job-go\?t=[A-Za-z0-9_-]+/.exec(mail!.html + mail!.text)![0];
        await stranger.goto(strangerPath(link));
        await expect(stranger.getByRole('heading', { name: 'How did your job go' })).toBeVisible({ timeout: 30_000 });
        await stranger.getByRole('textbox').first().fill('Tidy work.');
        await stranger.getByRole('button', { name: /Send/ }).click();
        await expect(stranger.getByText('Thank you.', { exact: true })).toBeVisible({ timeout: 60_000 });
        await context.close();

        // ── the step's settings on the rule page, as the admin writing rules ──
        for (const combo of COMBOS) {
          await prefs(admin, combo);
          await admin.goto(`/automations?rule=${ruleId}`);
          await admin.getByTestId('flow-node-n2').click({ timeout: 30_000 });
          await expect(admin.getByTestId('add-on-input-to')).toBeVisible({ timeout: 30_000 });
          await sweep(admin, `${tagOf(combo)} · the step's settings`, tally, testInfo);
        }
        await prefs(admin, null);
      } finally {
        await admin.request.delete(`/api/v1/automations/${ruleId}`);
      }
      await admin.request.post('/api/v1/privacy/websites/remove', { data: { origin: LISTED } });
      const listedNow = await admin.request.post('/api/v1/privacy/websites', { data: { lines: [LISTED] } });
      expect(listedNow.ok(), `${String(listedNow.status())} ${await listedNow.text()}`).toBe(true);

      // ── every screen, in every look ──────────────────────────────────────
      const form1 = '/add-ons/forms/forms/book-a-showroom-visit';
      const survey1 = '/add-ons/forms/forms/surveys/how-did-your-job-go';
      for (const combo of COMBOS) {
        await prefs(page, combo);
        const w = words(combo.locale);
        const at = async (label: string, path: string, ready: () => Promise<void>, before?: () => Promise<void>) => {
          await page.goto(path);
          await ready();
          if (before !== undefined) await before();
          await page.waitForLoadState('networkidle');
          await sweep(page, `${tagOf(combo)} · ${label}`, tally, testInfo);
        };
        const listed = () => expect(page.getByText(/Book a showroom visit|احجز زيارة/).first()).toBeVisible({ timeout: 30_000 });
        await at('the list, as cards', '/add-ons/forms/forms', listed);
        await at('the list, as a list', '/add-ons/forms/forms', listed, async () => {
          const asList = page.getByRole('radio', { name: w('list.view.list') });
          await asList.click();
          await expect(asList).toBeChecked();
        });
        await at('the surveys', '/add-ons/forms/forms/surveys', () => expect(page.getByText(/How did your job go|كيف كان عملنا/).first()).toBeVisible({ timeout: 30_000 }));
        const builder = () => expect(page.getByRole('navigation', { name: w('builder.addQuestion') })).toBeVisible({ timeout: 30_000 });
        await at('the builder', form1, builder);
        for (const section of ['becomes', 'tick', 'after', 'tell', 'limits', 'files'] as const) {
          await at(`the builder, ${section} open`, form1, builder, () => openSection(page, w(`builder.s.${section}`)));
        }
        await at('the language popover', form1, builder, async () => {
          await page.getByRole('button', { name: w('builder.languages') }).click();
          await expect(page.getByRole('dialog').first()).toBeVisible();
        });
        await at('Preview', form1, builder, async () => {
          await page.getByRole('button', { name: w('builder.preview') }).click();
          await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 });
        });
        const share = () => expect(page.getByRole('textbox', { name: w('share.link.label') })).toBeVisible({ timeout: 30_000 });
        await at('Share, a listed website checked', `${form1}/share`, share, async () => {
          await page.getByLabel(w('share.check.label')).fill(LISTED);
          await expect(page.getByText(/www\.meridian-e2e\.dev/).nth(1)).toBeVisible();
        });
        await at('Share, a website not listed checked', `${form1}/share`, share, async () => {
          await page.getByLabel(w('share.check.label')).fill('https://elsewhere-e2e.dev');
          await expect(page.getByText(/elsewhere-e2e\.dev/).first()).toBeVisible();
        });
        const answers = () => expect(page.getByRole('button', { name: 'Marta Kovac' }).first()).toBeVisible({ timeout: 30_000 });
        await at('Answers', `${form1}/answers`, answers);
        await at('an answer\'s sheet', `${form1}/answers?answer=${answerId}`, () => expect(page.getByRole('dialog')).toContainText('marta@cobalt.dev', { timeout: 30_000 }));
        await at('Results', `${survey1}/results`, () => expect(page.getByText('Tidy work.').first()).toBeVisible({ timeout: 30_000 }));
        await at('Invitations', `${survey1}/invitations`, () => expect(page.getByText('Ann Lee').first()).toBeVisible({ timeout: 30_000 }));
      }

      // ── the blocked cards: no public address, no privacy notice ──────────
      await admin.goto('/');
      expect((await admin.request.put('/api/v1/settings/email', { data: { publicOrigin: null } })).ok()).toBe(true);
      expect((await admin.request.put('/api/v1/privacy/notice', { data: { businessName: null, noticeUrl: null } })).ok()).toBe(true);
      try {
        for (const combo of COMBOS) {
          await prefs(page, combo);
          const w = words(combo.locale);
          await page.goto(form1);
          await expect(page.getByText(w('builder.block.noAddress')).first()).toBeVisible({ timeout: 30_000 });
          await page.waitForLoadState('networkidle');
          await sweep(page, `${tagOf(combo)} · the builder's blocked cards`, tally, testInfo);
        }
      } finally {
        await admin.request.put('/api/v1/settings/email', { data: { publicOrigin: PUBLIC_ORIGIN } });
        await admin.request.put('/api/v1/privacy/notice', { data: { businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' } });
        await admin.request.post('/api/v1/privacy/websites/remove', { data: { origin: LISTED } });
      }
    } finally {
      await close();
    }
    testInfo.annotations.push({ type: 'axe', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
    expect(tally.failures, tally.failures.join('\n\n')).toEqual([]);
    // Per look: the empty list, the step's settings, eighteen screens, the blocked cards.
    expect(tally.states).toBe(COMBOS.length * 21);
  });
});
