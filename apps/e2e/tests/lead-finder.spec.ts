// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LEAD FINDER ADD-ON, END TO END, against a real server
 * (`leadFinderWorld.ts`): the real add-on's pages and fill sheet, its sources
 * answered by the server's demo seam (made-up companies and people only).
 *
 *  - Sources: the register's key is saved and checked on its card, and the
 *    register switched on;
 *  - Find companies: a search by what they do and where lists the demo's
 *    companies; one is added to Companies, written by the engine;
 *  - a company's page: "Fill in details" opens the add-on's real sheet; Look
 *    up asks the register, Fill in all writes the empty fields, and each says
 *    where it came from;
 *  - People: switched on once why they are kept is written; at a company
 *    with a website, Hunter's people are listed, one is kept, and the tell
 *    mail reaches the catcher with its Object link; the Object page erases
 *    them (no found row, no contact);
 *  - axe finds nothing at WCAG 2.1 AA on the Lead finder page and on the
 *    sheet, light and dark.
 *
 * Run alone, on its own ports, after `pnpm build` and with the add-ons
 * checkout built (`ADMINIUM_ADD_ONS_REPO`, or `ADD_ONS_REPO`):
 * `E2E_PORT=4924 pnpm --filter @adminium/e2e e2e:lead-finder`.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { PACKAGE, PACKAGE_BUILT, PUBLIC_ORIGIN, SERVER, startLeadWorld, type LeadWorld } from './leadFinderWorld.js';

/** WCAG 2.1 A/AA — the same rule set the Storybook sweep runs. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let world: LeadWorld;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.skip(!PACKAGE_BUILT, `Lead finder is not built at ${PACKAGE}: set ADMINIUM_ADD_ONS_REPO to the add-ons checkout and build packages/lead-finder`);
  world = await startLeadWorld();
});

test.afterAll(async () => {
  await world?.close();
});

async function signedIn(context: BrowserContext): Promise<void> {
  const [name, value] = world.cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: '127.0.0.1', path: '/' }]);
}

/**
 * What axe finds at WCAG 2.1 AA, screen by screen. Gathered as the steps go
 * and asserted by the last test, so a finding on one screen never stops the
 * steps after it (a failed test would start the world again, empty).
 */
const findings: string[] = [];
async function axe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const one of results.violations) findings.push(`${label} · ${one.id}: ${one.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

/** A source's card, by the start of its name ("Companies House (UK)"). */
const card = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });
const fields = (page: Page) => page.locator('[data-part="record-fields"]');
const noteUnder = (page: Page, column: string) => fields(page).locator(`[data-column="${column}"] [data-part="field-note"]`);

test('Sources: the register’s key is saved and checked on its card, which switches it on', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.sourcesUrl);
  const register = card(page, 'Companies House');
  await expect(register).toBeVisible();
  await expect(register.getByText('Key not set')).toBeVisible();
  await register.getByPlaceholder('Paste the key').fill('test-key-companies-1');
  await register.getByRole('button', { name: 'Check' }).click();
  await expect(register.getByText(/accepted the key/)).toBeVisible();
  await expect(register.getByText('Key saved')).toBeVisible();
  // A source is switched on once its key is saved; its switch turns it off and on again.
  const use = register.getByRole('switch');
  await expect(use).toBeChecked();
  await use.click();
  await expect(register.getByText('Not in use')).toBeVisible();
  await use.click();
  await expect(register.getByText('In use')).toBeVisible();
  // As the engine keeps it: saved (its last four only), accepted, on.
  const read = async () => ((await world.api('GET', '/api/v1/add-ons/lead-finder/sources'))['sources'] as { id: string; lastFour: string | null; verdict: string | null; on: boolean }[]).find((one) => one.id === 'companies-house');
  await expect.poll(read).toMatchObject({ lastFour: 'es-1', verdict: 'accepted', on: true });
});

test('Find companies: a search lists the register’s companies, and one is added to Companies', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.findUrl);
  const form = page.getByRole('search', { name: 'Find companies' });
  await form.getByRole('combobox').fill('Architectural');
  await page.getByRole('option', { name: /Architectural activities/ }).first().click();
  await form.getByLabel('Where').fill('Leeds');
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('3 companies found')).toBeVisible();
  await expect(page.getByText('Millbeck Drawing Office').first()).toBeVisible();
  await axe(page, 'the Lead finder page with results, light');
  await page.getByRole('checkbox', { name: 'Tick Kestrel Yard Architects' }).first().click();
  await page.getByRole('button', { name: 'Add 1 to Companies' }).click();
  await expect(page.getByText(/1 company added to Companies/)).toBeVisible();
  // Written by the engine, from what the register said.
  await expect.poll(() => world.companies().find((one) => one['name'] === 'Kestrel Yard Architects')?.['company_number']).toBe('98000412');
  expect(world.companies().find((one) => one['name'] === 'Kestrel Yard Architects')).toMatchObject({ website: 'https://kestrelyard.example', town: 'Leeds' });
});

test('a company’s page: “Fill in details” opens the add-on’s sheet; Look up, Fill in all, and each field says where it came from', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.recordUrl(7));
  const open = page.getByRole('button', { name: 'Fill in details' });
  await expect(open).toBeVisible();
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Fill in details' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Ouseburn Studio. Nothing changes until you press Fill in.');
  await axe(page, 'the sheet open, light');
  await sheet.getByRole('button', { name: 'Look up' }).click();
  await expect(sheet.getByText(/details? found/).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Fill in all' }).click();
  await expect(page.getByText(/details? filled in/)).toBeVisible();
  await expect.poll(() => world.companies().find((one) => one['id'] === 7)?.['company_number']).toBe('98002264');
  await page.goto(world.recordUrl(7));
  await expect(fields(page).locator('[data-column="company_number"]')).toContainText('98002264');
  await expect(noteUnder(page, 'company_number')).toContainText('From Companies House');
});

test('People: switched on once why they are kept is written', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.peopleUrl);
  const why = page.locator('#lf-why');
  await why.fill('To offer your studio drawing boards and plan chests.');
  await why.blur();
  await expect.poll(async () => JSON.stringify(await world.api('GET', '/api/v1/leads/lead-finder/tell-preview?locale=en-US'))).toContain('drawing boards');
  await page.getByRole('switch', { name: 'Store people, not just companies' }).click();
  await expect(page.getByText('Lead finder keeps people from now on.')).toBeVisible();
});

test('a person kept at a company is told at once, and the mail’s Object link erases them', async ({ page, context }) => {
  await signedIn(context);
  const kestrel = world.companies().find((one) => one['name'] === 'Kestrel Yard Architects')!;
  await page.goto(world.recordUrl(String(kestrel['id'])));
  await page.getByRole('button', { name: 'Fill in details' }).click();
  const sheet = page.getByRole('dialog', { name: 'Fill in details' });
  await expect(sheet.getByText('People at kestrelyard.example')).toBeVisible();
  await sheet.getByRole('button', { name: 'Find people' }).click();
  await expect(sheet.getByText('Robin Hale')).toBeVisible();
  await expect(sheet.getByText('Sam Ellery')).toBeVisible();
  // Robin only: Sam left unticked.
  await sheet.getByRole('checkbox', { name: 'Keep Robin Hale' }).check();
  await sheet.getByRole('checkbox', { name: 'Keep Sam Ellery' }).uncheck();
  await sheet.getByRole('button', { name: 'Keep ticked people (1)' }).click();
  await expect(page.getByText('1 person kept. Their mail is on the way.')).toBeVisible();
  await expect(sheet.getByText('Kept', { exact: true })).toBeVisible();

  // Kept: a contact, and a found person's row, at once.
  expect(world.contacts().map((one) => one['email'])).toContain('robin@kestrelyard.example');
  expect(world.foundPeople().map((one) => one['email'])).toContain('robin@kestrelyard.example');

  // The tell mail reaches the catcher, with the Object link on the public address.
  await expect.poll(() => world.mails.filter((one) => one.to.includes('robin@kestrelyard.example')).length, { timeout: 30_000 }).toBe(1);
  const mail = world.mails.find((one) => one.to.includes('robin@kestrelyard.example'))!;
  expect(mail.subject).toBe('Why we have your details');
  expect(mail.html).toContain('Meridian Workplace Ltd');
  const link = new RegExp(`${PUBLIC_ORIGIN.replaceAll('.', '\\.')}(/m/o/[A-Za-z0-9_~-]+)`).exec(mail.html);
  expect(link, 'the mail carries an Object link').not.toBeNull();
  await expect.poll(() => world.foundPeople().find((one) => one['email'] === 'robin@kestrelyard.example')?.['state']).toBe('told');

  // The Object page, as the person opens it (on this server): a GET changes nothing; Object erases them.
  const stranger = await page.context().browser()!.newContext();
  const object = await stranger.newPage();
  await object.goto(`${SERVER}${link![1]!}`);
  expect(world.foundPeople().some((one) => one['email'] === 'robin@kestrelyard.example')).toBe(true);
  await object.getByRole('button', { name: 'Object' }).click();
  await expect.poll(() => world.foundPeople().some((one) => one['email'] === 'robin@kestrelyard.example')).toBe(false);
  expect(world.contacts().map((one) => one['email'])).not.toContain('robin@kestrelyard.example');
  await stranger.close();
});

test('axe finds nothing at WCAG 2.1 AA on the Lead finder page and the sheet, light and dark', async ({ browser }) => {
  await world.prefs({ theme: 'dark' });
  const context = await browser.newContext({ colorScheme: 'dark' });
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(world.findUrl);
  await expect(page.getByRole('search', { name: 'Find companies' })).toBeVisible();
  await axe(page, 'the Lead finder page, dark');
  await page.goto(world.recordUrl(7));
  await page.getByRole('button', { name: 'Fill in details' }).click();
  await expect(page.getByRole('dialog', { name: 'Fill in details' })).toBeVisible();
  await axe(page, 'the sheet open, dark');
  await context.close();
  await world.prefs({ theme: null });
  // With the light screens the steps above checked.
  expect(findings).toEqual([]);
});
