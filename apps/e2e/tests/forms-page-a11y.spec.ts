// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page a stranger sees for a form (`/x/forms/<slug>`) through axe: the
 * form, its marks after Send, a survey, every ending, Arabic, a phone's width
 * and dark — in the BUILT bundle (`apps/dashboard/dist/x/`), with its real
 * stylesheet, which contrast needs.
 *
 * No server: the page and its files are read from the build, and its API is
 * answered here, so every state is reached on purpose, including the ones a
 * real server reaches only by waiting (too many sends) or by a form being
 * closed. What the server says is pinned in its own suite
 * (`apps/server/test/forms-door*.test.ts`).
 *
 * Every finding fails, whatever its impact: the page is new, and starts clean.
 */
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'dist');
const ORIGIN = 'https://forms.meridian.example';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const BUSINESS = { name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false };

const w = (en: string, ar: string) => ({ 'en-US': en, 'ar-EG': ar });

const FORM = {
  v: 1,
  kind: 'form',
  languages: ['en-US', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: w('Book a showroom visit', 'احجز زيارة لصالة العرض'),
  intro: w("See the new booths and desks in our Leeds showroom. We'll confirm your time within one working day.", 'شاهد الكبائن والمكاتب الجديدة في صالة العرض في ليدز.'),
  sections: [{ id: 'sfiles', title: w('Your space', 'مساحتك') }],
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, maxLength: 200, label: w('Your name', 'اسمك') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, maxLength: 200, label: w('Work e-mail', 'البريد الإلكتروني للعمل') },
    { id: 'qcompany', kind: 'short', role: 'company', required: false, maxLength: 200, label: w('Company', 'الشركة') },
    { id: 'qday', kind: 'date', from: 'tomorrow', required: false, label: w('Which day suits you?', 'أي يوم يناسبك؟') },
    { id: 'qcount', kind: 'number', min: 1, max: 20, whole: true, required: false, label: w('How many of you?', 'كم عددكم؟') },
    {
      id: 'qsee',
      kind: 'several',
      required: false,
      label: w('What would you like to see?', 'ماذا تودّ أن ترى؟'),
      choices: [
        { id: 'booths', label: w('Acoustic booths', 'الكبائن العازلة للصوت') },
        { id: 'desks', label: w('Desks', 'المكاتب') },
        { id: 'seating', label: w('Seating', 'المقاعد') },
        { id: 'storage', label: w('Storage', 'وحدات التخزين') },
      ],
    },
    { id: 'qseats', kind: 'number', required: false, label: w('Roughly how many seats?', 'كم مقعدًا تقريبًا؟'), showIf: { question: 'qsee', includes: 'seating' } },
    {
      id: 'qtopic',
      kind: 'one',
      required: false,
      label: w('Is it for an office or a home?', 'هل هو لمكتب أم لمنزل؟'),
      choices: [
        { id: 'office', label: w('An office', 'مكتب') },
        { id: 'home', label: w('A home', 'منزل') },
      ],
    },
    { id: 'qnote', kind: 'long', required: false, maxLength: 2000, label: w('Anything else?', 'أي شيء آخر؟'), help: w('A line or two is plenty.', 'سطر أو سطران يكفيان.') },
    { id: 'qfrom', kind: 'hidden', param: 'from', required: false, label: w('Source', 'المصدر') },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 2, wordingChangedAt: '2026-10-01', confirm: true, required: false, label: w("Send me Meridian's newsletter, about once a month. You can unsubscribe at any time.", 'أرسلوا لي النشرة الإخبارية من Meridian، مرة في الشهر تقريبًا.') },
    { id: 'qfiles', kind: 'file', section: 'sfiles', maxMb: 10, kinds: ['pdf', 'jpg', 'png'], many: true, required: false, label: w('Drawings of your space', 'رسومات مساحتك') },
  ],
  ending: { kind: 'words', words: w("We'll confirm your visit within one working day.", 'سنؤكد زيارتك خلال يوم عمل واحد.') },
};

const SURVEY = {
  v: 1,
  kind: 'survey',
  languages: ['en-US', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: w('How did your fit-out go?', 'كيف كان تجهيز مكتبك؟'),
  questions: [
    { id: 'qnps', kind: 'score', recommend: true, required: true, label: w('How likely are you to recommend Meridian to a colleague?', 'ما مدى احتمال أن توصي بـ Meridian لزميل؟') },
    { id: 'qday', kind: 'stars', required: false, label: w('How was the install day?', 'كيف كان يوم التركيب؟') },
    { id: 'qdiff', kind: 'long', required: false, maxLength: 2000, label: w('Anything we should do differently?', 'هل هناك ما يجب أن نفعله بشكل مختلف؟') },
  ],
  ending: { kind: 'words', words: w('We read every answer.', 'نقرأ كل إجابة.') },
};

/** The definition in one language, as the server sends it. */
function inOne(definition: typeof FORM | typeof SURVEY, tag: 'en-US' | 'ar-EG'): unknown {
  const pick = (words: Record<string, string>) => ({ [tag]: words[tag] });
  const json = JSON.parse(JSON.stringify(definition)) as Record<string, unknown> & { questions: Record<string, unknown>[]; sections?: Record<string, unknown>[] };
  const out: Record<string, unknown> = { ...json, languages: [tag], defaultLanguage: tag, title: pick(json['title'] as Record<string, string>), ending: { kind: 'words', words: pick((json['ending'] as { words: Record<string, string> }).words) } };
  if (json['intro'] !== undefined) out['intro'] = pick(json['intro'] as Record<string, string>);
  if (json.sections !== undefined) out['sections'] = json.sections.map((section) => ({ ...section, title: pick(section['title'] as Record<string, string>) }));
  out['questions'] = json.questions.map((question) => ({
    ...question,
    label: pick(question['label'] as Record<string, string>),
    ...(question['help'] === undefined ? {} : { help: pick(question['help'] as Record<string, string>) }),
    ...(question['choices'] === undefined ? {} : { choices: (question['choices'] as { id: string; label: Record<string, string> }[]).map((choice) => ({ ...choice, label: pick(choice.label) })) }),
  }));
  return out;
}

interface Pretend {
  /** What `/x/forms/api/<slug>` answers, by slug. */
  pages: Record<string, { status: number; body: unknown }>;
  /** What sending answers. */
  answer: { status: number; body: unknown };
}

function livePage(definition: typeof FORM | typeof SURVEY, lang: string | null, anonymous = false): { status: number; body: unknown } {
  const tag = lang === 'ar-EG' ? 'ar-EG' : 'en-US';
  return {
    status: 200,
    body: { state: 'live', business: BUSINESS, accent: 'teal', today: '2026-11-01', form: { kind: definition.kind, language: tag, languages: definition.languages, definition: inOne(definition, tag), anonymous } },
  };
}

/** Serves the built page and its files, and answers its API as `pretend` says. */
async function serve(page: Page, pretend: Pretend): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.startsWith('/x/assets/')) {
      const file = join(DIST, path);
      return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    }
    if (path.endsWith('/challenge')) return route.fulfill({ status: 200, json: { id: 'eyJ2IjoxfQ~sig', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 } });
    if (path.endsWith('/answers')) return route.fulfill({ status: pretend.answer.status, json: pretend.answer.body });
    if (path.startsWith('/x/forms/api/')) {
      const slug = path.slice('/x/forms/api/'.length);
      const lang = url.searchParams.get('lang');
      const found = pretend.pages[slug];
      if (slug === 'showroom-visit') return route.fulfill({ status: 200, json: livePage(FORM, lang).body });
      if (slug === 'fit-out') return route.fulfill({ status: 200, json: livePage(SURVEY, lang, true).body });
      return route.fulfill({ status: found?.status ?? 404, json: found?.body ?? { state: 'unavailable', business: BUSINESS, accent: 'teal' } });
    }
    if (path.startsWith('/x/')) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(DIST, 'x', 'index.html'), 'utf8') });
    return route.fulfill({ status: 404, body: '' });
  });
}

async function sweep(page: Page, label: string, failures: string[]): Promise<void> {
  // Settled: no transition mid-way, the fonts in.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
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

const SHOTS = process.env['E2E_SHOTS'] ?? '';

test.describe('a stranger’s form page, through axe', () => {
  test('the form, its marks after Send, a survey and every ending: light and dark, desktop and phone, English and Arabic', async ({ browser }) => {
    test.slow();
    const failures: string[] = [];
    let states = 0;
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
        for (const lang of ['en-US', 'ar-EG'] as const) {
          const context = await browser.newContext({ viewport, colorScheme, locale: lang });
          const page = await context.newPage();
          const pretend: Pretend = { pages: { 'old-offer': { status: 200, body: { state: 'closed', business: BUSINESS, accent: 'teal' } } }, answer: { status: 200, body: { state: 'sent' } } };
          await serve(page, pretend);
          const at = `${colorScheme}, ${String(viewport.width)}, ${lang}`;
          const shot = async (name: string) => {
            if (SHOTS !== '') await page.screenshot({ path: join(SHOTS, `${name} ${at}.png`.replace(/[ ,]+/g, '-')), fullPage: true });
          };

          // The form, as it opens.
          await page.goto(`${ORIGIN}/x/forms/showroom-visit?lang=${lang}`);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${at}: no sideways scroll`).toBe(true);
          await sweep(page, `${at}: the form`, failures);
          states += 1;
          await shot('form');

          // Seating ticked: its question shows. Then Send with nothing: the marks and the summary.
          await page.getByRole('checkbox').nth(2).check();
          await page.getByRole('button', { name: lang === 'ar-EG' ? 'إرسال' : 'Send', exact: true }).click();
          await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
          await sweep(page, `${at}: the form's marks`, failures);
          states += 1;
          await shot('form-marks');

          // Too many sends: the warning over Send, the answers kept.
          pretend.answer = { status: 429, body: { state: 'too-many', retryAfter: 3600 } };
          await page.locator('#x-q-qname').fill('Marta Kovac');
          await page.locator('#x-q-qemail').fill('marta.kovac@cobaltlegal.example');
          await page.locator('#x-q-qnews').check();
          await page.getByRole('button', { name: lang === 'ar-EG' ? 'إرسال' : 'Send', exact: true }).click();
          await expect(page.getByRole('alert')).toBeVisible();
          await sweep(page, `${at}: too many sends`, failures);
          states += 1;

          // Sent, with the newsletter step.
          pretend.answer = { status: 200, body: { state: 'sent' } };
          await page.getByRole('button', { name: lang === 'ar-EG' ? 'إرسال' : 'Send', exact: true }).click();
          await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
          await sweep(page, `${at}: sent`, failures);
          states += 1;
          await shot('sent');

          // The survey, its score and stars picked.
          await page.goto(`${ORIGIN}/x/forms/fit-out?lang=${lang}`);
          await expect(page.getByRole('radiogroup').first()).toBeVisible();
          await page.getByRole('radiogroup').first().getByRole('radio').nth(8).click();
          await page.getByRole('radiogroup').nth(1).getByRole('radio').nth(3).click();
          await sweep(page, `${at}: the survey`, failures);
          states += 1;
          await shot('survey');
          await page.getByRole('button', { name: lang === 'ar-EG' ? 'إرسال الإجابات' : 'Send answers' }).click();
          await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
          await sweep(page, `${at}: the survey sent`, failures);
          states += 1;

          // Closed, not available, a link that does not work, and the language menu open.
          for (const [name, address] of [
            ['closed', `/x/forms/old-offer?lang=${lang}`],
            ['not available', `/x/forms/no-such-form?lang=${lang}`],
            ['a link that does not work', `/x/forms/fit-out?t=abc&lang=${lang}`],
          ] as const) {
            await page.goto(`${ORIGIN}${address}`);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await sweep(page, `${at}: ${name}`, failures);
            states += 1;
            await shot(name);
          }
          await page.goto(`${ORIGIN}/x/forms/fit-out?lang=${lang}`);
          await page.getByRole('button', { name: /Language|اللغة/ }).click();
          await expect(page.getByRole('menu')).toBeVisible();
          await sweep(page, `${at}: the language menu`, failures);
          states += 1;
          await context.close();
        }
      }
    }
    expect(states).toBe(2 * 2 * 2 * 10);
    expect(failures.join('\n\n')).toBe('');
  });

  test('in a website’s frame: the form with no header or footer', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await serve(page, { pages: {}, answer: { status: 200, body: { state: 'sent' } } });
    await page.goto(`${ORIGIN}/x/forms/showroom-visit?frame=1&lang=en-US`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(0);
    const failures: string[] = [];
    await sweep(page, 'the form in a frame', failures);
    expect(failures.join('\n\n')).toBe('');
    await context.close();
  });
});
