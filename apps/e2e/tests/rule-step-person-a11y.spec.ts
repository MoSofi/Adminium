// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE'S STEP ABOUT A PERSON, in the rule editor: whose row it is (the
 * person the record's link names), a record list held to some rows and named
 * by a column of its own, a line under an input, and a choice whose options
 * each say what they mean, drawn as cards. Then under axe: light and dark,
 * English and Arabic (RTL), desktop and 390 wide. Every finding fails,
 * whatever its impact.
 *
 * WHAT IS REAL AND WHAT IS NOT. A small add-on is built here and installed
 * for real: a table of surveys (two live, one closed, one a draft), a table
 * of invitations, and a step "Send a survey" with a record input and a
 * choice. A rule on Northwind's orders uses that step, and its record list
 * is read from the survey table through the real data API. But a step's
 * person, its `by`/`where`, its help lines and the people a database holds
 * are words of Adminium 0.3.41, which this server (0.3.40) refuses to
 * install, and Northwind declares no people. So the editor's list of
 * sources is the server's own with those added (`page.route`), as
 * `consent-panel.spec.ts` does for a people table: Northwind's customers as
 * people, an order's customer as the person one link away, and the step's
 * inputs as the forms add-on declares them. What the run does with them is
 * the server's suite (`apps/server/test/forms-survey-step.test.ts`).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { seededConnectionId, signIn } from './helpers.js';

const KEY = 'e2e-surveys';
const VERSION = '1.0.0';
const RULE = 'E2E send a survey';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];

/** A word in every language, Arabic its own. */
const words = (en: string, ar: string): Record<string, string> => Object.fromEntries(LOCALES.map((locale) => [locale, locale === 'ar-EG' ? ar : en]));
const pk = { ref: 'id', type: 'int', role: 'pk' };

const MANIFEST = {
  kind: 'add-on',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Surveys',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'addon.e2e-surveys.line', fallback: 'Sends a survey from a rule.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.22' },
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    steps: [
      {
        key: 'send-survey',
        name: words('Send a survey', 'إرسال استبيان'),
        does: words('Invites a person to answer one of your surveys', 'يدعو شخصًا للإجابة عن أحد استبياناتك'),
        inputs: [
          { key: 'survey', label: words('Survey', 'الاستبيان'), kind: 'record', table: 'surveys', required: true },
          {
            key: 'class',
            label: words('Kind of mail', 'نوع البريد'),
            kind: 'choice',
            required: true,
            options: [
              { value: 'marketing', label: words('Marketing mail', 'بريد تسويقي') },
              { value: 'service', label: words('Service mail', 'بريد خدمة') },
            ],
          },
        ],
        writes: { table: 'invitations', values: { survey_id: { input: 'survey' }, class: { input: 'class' } } },
      },
    ],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'surveys',
        columns: [
          pk,
          { ref: 'slug', type: 'text', maxLength: 60, unique: true },
          { ref: 'title', type: 'text', maxLength: 120 },
          { ref: 'state', type: 'enum', enum: ['draft', 'live', 'closed'], default: 'draft' },
        ],
      },
      { ref: 'invitations', columns: [pk, { ref: 'survey_id', type: 'fk', references: 'surveys' }, { ref: 'class', type: 'text', maxLength: 20 }] },
    ],
  },
};

/** The 0.3.41 words of the step, as the forms add-on declares them (see the header). */
const SURVEY_HELP = words('Only live surveys are listed.', 'تُعرض الاستبيانات المنشورة فقط.');
const CLASS_HELPS: Record<string, Record<string, string>> = {
  marketing: words('Only to people who agreed to hear from you.', 'فقط لمن وافق على تلقي رسائلك.'),
  service: words('About work you did for them.', 'عن عمل قمت به لهم.'),
};
const PERSON = { key: 'to', label: words('To', 'إلى'), kind: 'person', required: true, help: words('Their address, name and language are read when the rule runs.', 'يُقرأ عنوانه واسمه ولغته عند تشغيل القاعدة.') };

async function bodyOf(res: APIResponse): Promise<string> {
  return `${String(res.status())} ${(await res.text()).slice(0, 600)}`;
}
async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), await bodyOf(res)).toBe(true);
  return (await res.json()) as T;
}

async function setPrefs(request: APIRequestContext, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

interface SourcesBody {
  connections: { id: string; tables: { id: string; label: string; columns: { name: string }[]; people?: true; personLinks?: { column: string; table: string }[] }[]; steps?: { addOn: string; key: string; table: string | null; inputs: Record<string, unknown>[] }[] }[];
}

/** The sources as a 0.3.41 server tells them for a CRM's people, and the forms add-on's step (see the header). */
async function withPersonWords(page: Page): Promise<void> {
  await page.route('**/api/v1/automations/sources', async (route) => {
    const answer = await route.fetch();
    const body = (await answer.json()) as SourcesBody;
    for (const connection of body.connections) {
      const customers = connection.tables.find((table) => table.id.endsWith('customers'));
      const orders = connection.tables.find((table) => table.id.endsWith('orders'));
      if (customers !== undefined) customers.people = true;
      if (orders !== undefined && customers !== undefined) orders.personLinks = [{ column: 'customer_id', table: customers.id }];
      for (const step of connection.steps ?? []) {
        if (step.addOn !== KEY) continue;
        step.inputs = step.inputs.flatMap((input) => {
          if (input['key'] === 'survey') return [{ ...input, by: 'slug', where: [{ column: 'state', eq: 'live' }], help: SURVEY_HELP }, PERSON];
          if (input['key'] === 'class') return [{ ...input, options: (input['options'] as { value: string }[]).map((option) => ({ ...option, help: CLASS_HELPS[option.value] })) }];
          return [input];
        });
      }
    }
    await route.fulfill({ response: answer, json: body });
  });
}

async function sweep(page: Page, label: string, failures: string[], within?: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  expect(results.passes.length, `${label}: axe examined nothing`).toBeGreaterThan(0);
  if (results.violations.length > 0) {
    failures.push(
      `${label}:\n` +
        results.violations
          .map((v) => `  ${String(v.impact)}: ${v.id} — ${v.help}\n${v.nodes.slice(0, 3).map((n) => `    ${n.target.join(' ')}  ${n.html.slice(0, 160)}`).join('\n')}`)
          .join('\n'),
    );
  }
}

let ruleId = '';

test.describe('a rule’s step about a person', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    const staff = page.request;
    const connectionId = await seededConnectionId(page);
    // What an earlier run left, out first.
    const rules = await ok<{ rules: { id: string; name: string }[] }>(await staff.get('/api/v1/automations'));
    for (const one of rules.rules) if (one.name === RULE) await staff.delete(`/api/v1/automations/${one.id}`);
    await staff.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);

    const bundle = bundleOf({ 'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${KEY}`, version: VERSION }), 'manifest.json': JSON.stringify(MANIFEST) });
    await ok(await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer }));
    await ok(await staff.post('/api/v1/add-ons', { data: { key: KEY, version: VERSION, attachTo: [], connectionId } }));

    // The surveys: two live, one closed, one a draft. Only the live ones may be picked.
    const sources = await ok<SourcesBody>(await staff.get('/api/v1/automations/sources'));
    const step = sources.connections.find((connection) => connection.id === connectionId)!.steps!.find((one) => one.addOn === KEY)!;
    const surveys = step.inputs.find((input) => input['key'] === 'survey')!['table'] as string;
    for (const [slug, title, state] of [
      ['fit-out', 'How did your fit-out go?', 'live'],
      ['showroom', 'Your showroom visit', 'live'],
      ['spring-2025', 'Spring 2025', 'closed'],
      ['autumn-draft', 'Autumn (draft)', 'draft'],
    ]) {
      await ok(await staff.post(`/api/v1/data/${connectionId}/${encodeURIComponent(surveys)}`, { data: { values: { slug, title, state } } }));
    }

    const orders = sources.connections.find((connection) => connection.id === connectionId)!.tables.find((table) => table.id.endsWith('orders'))!.id;
    const rule = await staff.post('/api/v1/automations', {
      data: {
        name: RULE,
        connectionId,
        enabled: false,
        trigger: { kind: 'record', event: 'created', connectionId, table: orders },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'An order is placed' },
            { id: 'send', kind: 'action', title: 'Send a survey', onError: false, action: { kind: 'add-on.step', addOn: KEY, step: 'send-survey', addOnName: 'E2E Surveys', inputs: {} } },
          ],
        },
      },
    });
    expect(rule.status(), await rule.text()).toBe(201);
    ruleId = ((await rule.json()) as { id: string }).id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await setPrefs(page.request, { theme: null, locale: null });
    if (ruleId !== '') await page.request.delete(`/api/v1/automations/${ruleId}`).catch(() => undefined);
    await page.request.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
    await page.close();
  });

  test('whose row it is, a list of live surveys named by their slug, and the kinds of mail as cards', async ({ page }) => {
    await setPrefs(page.request, { theme: null, locale: null });
    await withPersonWords(page);
    await page.goto(`/automations?rule=${ruleId}`);
    await page.getByTestId('flow-node-send').click();

    // The person: the order's customer, one link away.
    const to = page.getByTestId('add-on-input-to');
    await expect(to).toBeVisible();
    await expect(to.locator('option')).toHaveCount(2);
    await expect(to.locator('option[value="@link:customer_id"]')).toContainText('customer');
    await to.selectOption('@link:customer_id');
    await expect(to).toHaveValue('@link:customer_id');
    await expect(page.getByTestId('add-on-input-to-help')).toHaveText('Their address, name and language are read when the rule runs.');

    // The survey: only the live ones, kept by their slug.
    await expect(page.getByTestId('add-on-input-survey-help')).toHaveText('Only live surveys are listed.');
    const picker = page.getByTestId('add-on-input-survey');
    await picker.click();
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options).toContainText(['How did your fit-out go?', 'Your showroom visit']);
    await options.filter({ hasText: /fit-out go/ }).click();

    // The kind of mail: a card each, with what it means.
    const kind = page.getByTestId('add-on-input-class');
    await expect(kind.getByRole('radio')).toHaveCount(2);
    await expect(page.getByTestId('add-on-input-class-service')).toContainText('About work you did for them.');
    await kind.getByRole('radio', { name: /Service mail/ }).click();
    await expect(kind.getByRole('radio', { name: /Service mail/ })).toHaveAttribute('aria-checked', 'true');

    // What the rule would keep: the person's place, the survey's slug and the kind (a 0.3.40 server refuses to save them, see the header).
    // The step's settings are a sheet over the canvas: closed before Save.
    await page.keyboard.press('Escape');
    const put = page.waitForRequest((request) => request.url().endsWith(`/api/v1/automations/${ruleId}`) && request.method() === 'PATCH');
    await page.getByTestId('rule-save').click();
    const sent = (await put).postDataJSON() as { graph: { nodes: { id: string; action?: { inputs?: Record<string, string> } }[] } };
    expect(sent.graph.nodes.find((node) => node.id === 'send')!.action!.inputs).toEqual({ to: '@link:customer_id', survey: 'fit-out', class: 'service' });
  });

  test('the step’s settings under axe: light and dark, English and Arabic, desktop and 390 wide', async ({ page }) => {
    test.setTimeout(300_000);
    const failures: string[] = [];
    let states = 0;
    await withPersonWords(page);
    try {
      for (const [theme, locale, dir] of [
        ['light', 'en_US', 'ltr'],
        ['dark', 'en_US', 'ltr'],
        ['light', 'ar_EG', 'rtl'],
        ['dark', 'ar_EG', 'rtl'],
      ] as const) {
        await setPrefs(page.request, { theme, locale });
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          const at = `${theme}, ${locale}, ${String(viewport.width)}`;
          await page.goto(`/automations?rule=${ruleId}`);
          await expect(page.locator('html')).toHaveAttribute('dir', dir);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.getByTestId('flow-node-send').click();
          await expect(page.getByTestId('add-on-input-to')).toBeVisible();
          await expect(page.getByTestId('add-on-input-class').getByRole('radio')).toHaveCount(2);
          await expect(page.getByTestId('add-on-input-survey-help')).toHaveText(locale === 'ar_EG' ? 'تُعرض الاستبيانات المنشورة فقط.' : 'Only live surveys are listed.');
          await page.getByTestId('add-on-input-to').selectOption('@link:customer_id');
          await page.getByTestId('add-on-input-class').getByRole('radio').nth(1).click();
          await sweep(page, `${at}: the step's settings`, failures, '[role="dialog"]');
          states += 1;

          // The record list open: only the live surveys.
          await page.getByTestId('add-on-input-survey').click();
          await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2);
          await sweep(page, `${at}: the survey list`, failures, '[role="listbox"]');
          states += 1;
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await setPrefs(page.request, { theme: null, locale: null });
    }
    expect(states).toBe(4 * 2 * 2);
    expect(failures.join('\n\n')).toBe('');
  });
});
