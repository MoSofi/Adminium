// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project folder, end to end: `adminium new` → `adminium dev` → the folder's
 * files and code in a browser → `adminium start` as a server → `pull --from` →
 * a redeploy with a conflict.
 *
 * One project for the whole file, run in order: every step builds on the state
 * the one before left, as it would on a developer's machine. The folder, its
 * databases and its server come from `projectHarness.ts`; the shared Northwind
 * server the other specs use is not involved.
 *
 * Each test's title says what it proves. The rules underneath (the sync
 * table, the write service, the build) have unit tests; this file proves they
 * are wired to what a person sees.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { gridRows, recordPage } from './helpers.js';
import {
  ProjectHarness,
  projectStatePath,
  PROJECT_OWNER,
  PROJECT_URL,
  PUBLIC_ORIGIN,
} from './projectHarness.js';

const BLOCKED = 'Blocked companies cannot be saved.';
/** The company column's label once the folder has renamed it (the second test). */
const COMPANY = 'Company (from the folder)';
const GERMAN = 'German customers stay on file.';

const HOOK = `import { defineHook } from '@adminiumjs/adminium';

export default defineHook({
  table: 'customers',
  beforeCreate({ values, reject }) {
    if (String(values.company_name ?? '').startsWith('Blocked')) reject(${JSON.stringify(BLOCKED)});
  },
  beforeUpdate({ values, reject }) {
    if (String(values.company_name ?? '').startsWith('Blocked')) reject(${JSON.stringify(BLOCKED)});
  },
  beforeDelete({ record, reject }) {
    if (record.country === 'Germany') reject(${JSON.stringify(GERMAN)});
  },
});
`;

const ACTION = `import { defineAction } from '@adminiumjs/adminium';

export default defineAction({
  table: 'customers',
  label: 'Mark as VIP',
  icon: 'star',
  confirm: 'Mark this customer as VIP?',
  bulk: true,
  async run({ records, db }) {
    for (const record of records) {
      await db.table('customers').update(record.customer_id, { contact_title: 'VIP' });
    }
    return { message: \`Marked \${String(records.length)} customer(s) as VIP.\` };
  },
});
`;

const revenuePage = (description: string): string => `import { useState } from 'react';
import { Button, Card, DataTable, Page, definePage, useRecords } from '@adminiumjs/adminium/ui';

export default definePage({
  title: 'Revenue',
  icon: 'chart-line',
  nav: { group: 'workspace' },
  component: function Revenue() {
    const [clicks, setClicks] = useState(0);
    const customers = useRecords('main', 'customers', { limit: 5, orderBy: 'customer_id' });
    return (
      <Page description=${JSON.stringify(description)}>
        <Card title="First customers" padded={false}>
          <DataTable
            loading={customers.isLoading}
            rows={customers.data}
            columns={[{ key: 'company_name', label: 'Company' }]}
          />
        </Card>
        <Button onClick={() => setClicks((count) => count + 1)}>Clicked {clicks} times</Button>
      </Page>
    );
  },
});
`;

const FLAG_CELL = `import { defineWidget } from '@adminiumjs/adminium/ui';

export default defineWidget({
  kind: 'cell',
  component: ({ value }) => <strong data-project-flag="">{value == null ? '—' : String(value)}</strong>,
});
`;

// The build reads a widget's settings without a browser, so this loads there
// and fails only in the dashboard.
const BROKEN_CELL = `import { defineWidget } from '@adminiumjs/adminium/ui';

if (typeof window !== 'undefined') throw new Error('This cell is broken on purpose.');

export default defineWidget({
  kind: 'cell',
  component: ({ value }) => <em>{String(value)}</em>,
});
`;

interface PageFile {
  title: { fallback: string };
  source: { database: string; table: string };
  config: { columns: { name: string; label: string; widget?: string }[] };
}

const column = (doc: Record<string, unknown>, name: string): Record<string, unknown> => {
  const found = (doc as unknown as PageFile).config.columns.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`the page file has no column ${name}`);
  return found as unknown as Record<string, unknown>;
};

/** One field of the open record page, label and value. */
const recordField = (page: Page, name: string) =>
  recordPage(page).locator(`[data-part="record-fields"] [data-column="${name}"]`);

const retitle = (title: string) => (doc: Record<string, unknown>) => {
  (doc as unknown as PageFile).title.fallback = title;
};

const anonymous = { cookies: [], origins: [] };

/** A teammate with the built-in Viewer role. */
const VIEWER = { email: 'viewer@project.local', name: 'Project Viewer', password: 'adminium-viewer-password' };

let project: ProjectHarness;
/** The customers table as this engine names it (`main.customers`, `public.customers`, …). */
let customersTable: string;
let connectionId: string;

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), `${response.url()} answered ${String(response.status())}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function pageIdOf(request: APIRequestContext, slug: string): Promise<string> {
  const pages = await json<{ data: { id: string; slug: string }[] }>(await request.get('/api/v1/pages'));
  const found = pages.data.find((candidate) => candidate.slug === slug);
  if (found === undefined) throw new Error(`no page at /p/${slug}`);
  return found.id;
}

async function pageRow(request: APIRequestContext, slug: string): Promise<{ id: string; origin: string; title: string } | undefined> {
  const pages = await json<{ data: { id: string; slug: string; origin: string; title: string }[] }>(
    await request.get('/api/v1/pages'),
  );
  return pages.data.find((candidate) => candidate.slug === slug);
}

/** A new API key with a built-in role. */
async function apiKeyFor(page: Page, role: string): Promise<string> {
  const roleId = await roleIdOf(page.request, role);
  const created = await json<{ key: string }>(
    await page.request.post('/api/v1/api-keys', { data: { name: `${role} key`, roleId } }),
  );
  return created.key;
}

async function roleIdOf(request: APIRequestContext, slug: string): Promise<string> {
  const roles = await json<{ roles: { id: string; slug: string }[] }>(await request.get('/api/v1/roles'));
  const found = roles.roles.find((candidate) => candidate.slug === slug);
  if (found === undefined) throw new Error(`no ${slug} role`);
  return found.id;
}

/** Rename a page in Studio's page editor, as a person would. */
async function renameInStudio(page: Page, slug: string, title: string): Promise<void> {
  await page.goto(`/studio/pages/${await pageIdOf(page.request, slug)}`);
  const field = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(field).toBeVisible();
  await field.fill(title);
  await page.getByTestId('studio-pages-save').click();
  await expect.poll(async () => (await pageRow(page.request, slug))?.title).toBe(title);
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: PROJECT_URL, storageState: projectStatePath() });

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({
    'hooks/customers.ts': HOOK,
    'actions/mark-vip.ts': ACTION,
    'pages/revenue.tsx': revenuePage('Written in the project folder'),
    'widgets/flag-cell.tsx': FLAG_CELL,
    'widgets/broken-cell.tsx': BROKEN_CELL,
  });
  await project.dev();

  // The project's first person, through the first-run route the wizard uses.
  const request = await playwright.request.newContext({ baseURL: PROJECT_URL, storageState: anonymous });
  const owner = await request.post('/api/v1/setup/super-admin', { data: PROJECT_OWNER });
  expect(owner.status(), await owner.text()).toBe(201);
  await request.storageState({ path: projectStatePath() });
  const connections = await json<{ connections: { id: string; name: string }[] }>(await request.get('/api/v1/connections'));
  connectionId = connections.connections.find((candidate) => candidate.name === 'main')?.id ?? '';
  await request.dispose();

  customersTable = project.readJson<PageFile>('pages/customers.json').source.table;
});

test.afterAll(async () => {
  await project?.close();
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('project server output', { body: project.output(), contentType: 'text/plain' });
  }
});

test('new makes a project pinned to this Adminium, and dev writes its pages as files', async ({ page }) => {
  const serverPackage = new URL('../../server/package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(serverPackage, 'utf8')) as { version: string };
  const pkg = project.readJson<{ dependencies: Record<string, string>; scripts: Record<string, string> }>('package.json');
  expect(pkg.dependencies['@adminiumjs/adminium']).toBe(version);
  expect(pkg.scripts).toMatchObject({ dev: 'adminium dev', start: 'adminium start', pull: 'adminium pull' });
  expect(project.read('Dockerfile')).toContain(`FROM ghcr.io/mosofi/adminium:${version}`);
  expect(project.read('.env')).toMatch(/^ADMINIUM_SECRET=[0-9a-f]{64}$/m);
  expect(project.read('.env')).toContain(`DATABASE_URL=${project.sourceUrl}`);

  const customers = project.readJson<PageFile & { source: Record<string, unknown> }>('pages/customers.json');
  expect(customers.source.database).toBe('main');
  expect(customers.source).not.toHaveProperty('connectionId');
  expect(project.exists('schema/main.json')).toBe(true);
  await expect.poll(() => project.output()).toContain('Project code: 1 hook and 1 action loaded.');

  // `check` is what CI runs on the folder: offline, with the code built.
  const checked = project.cli(['check']);
  expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
  expect(checked.stdout).toContain('1 hook(s) and 1 action(s) load');
  expect(checked.stdout).toContain('1 page(s) and 2 widget(s) build');

  await page.goto('/p/customers');
  await expect(gridRows(page).filter({ hasText: 'Alfreds Futterkiste' })).toBeVisible();
});

test('a page file saved in the folder shows in the open dashboard within two seconds, with no restart', async ({
  page,
}, testInfo) => {
  await page.goto('/p/customers');
  await expect(page.getByRole('button', { name: 'Sort by Company Name' })).toBeVisible();
  const boots = project.boots();

  project.editJson('pages/customers.json', (doc) => {
    column(doc, 'company_name')['label'] = COMPANY;
  });
  const savedAt = Date.now();
  await expect(page.getByRole('button', { name: `Sort by ${COMPANY}` })).toBeVisible({ timeout: 2_000 });
  testInfo.annotations.push({ type: 'shown after', description: `${String(Date.now() - savedAt)} ms` });
  expect(project.output()).toContain('Applied pages/customers.json.');
  expect(project.boots()).toBe(boots);
});

test('a Studio edit in dev lands in its page file, changing only the lines it touched', async ({ page }) => {
  const before = project.read('pages/categories.json').split('\n');
  await renameInStudio(page, 'categories', 'Product categories');
  await expect.poll(() => project.readJson<PageFile>('pages/categories.json').title.fallback).toBe('Product categories');

  const after = project.read('pages/categories.json').split('\n');
  expect(after).toHaveLength(before.length);
  const changed = after.filter((line, index) => line !== before[index]);
  // The title, and the generated hash: a generated page edited by hand keeps
  // a hash that no longer matches, so regeneration leaves it alone.
  expect(changed).toEqual(['    "fallback": "Product categories",', expect.stringMatching(/^ {4}"hash": "[0-9a-f]{64}"$/)]);
  const hashLine = after.findIndex((line, index) => line !== before[index] && line.includes('"hash"'));
  expect(after[hashLine - 1]).toBe('  "generated": {');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Product categories' })).toBeVisible();
});

test('an option list written in Studio becomes a file, and a file edited in the folder is enforced', async ({
  page,
}) => {
  /*
   * A `column.options` rule names a list by key and travels in
   * `schema/<database>.json`. The list has to travel with it, or the rule means
   * nothing in the next install — so this proves the round trip both ways.
   */
  await page.goto('/studio/lists');
  await page.getByTestId('studio-lists-new').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('option-list-name').fill('Stages');
  await dialog.getByTestId('option-list-key').fill('stages');
  await dialog.getByLabel('Value 1').fill('new');
  await dialog.getByLabel('Label 1').fill('New');
  await dialog.getByTestId('option-list-add-value').click();
  await dialog.getByLabel('Value 2').fill('won');
  await dialog.getByTestId('option-list-save').click();
  await expect(dialog).toBeHidden();

  // The folder has it, under its key, with no id and no timestamps in sight.
  await expect.poll(() => project.exists('lists/stages.json')).toBe(true);
  expect(project.readJson('lists/stages.json')).toEqual({
    $schema: '../node_modules/@adminiumjs/adminium/schemas/list.json',
    name: 'Stages',
    items: [{ value: 'new', label: 'New' }, { value: 'won' }],
  });

  // …and an edit in the folder is the one in force, without a restart.
  project.editJson('lists/stages.json', (doc) => {
    (doc['items'] as unknown[]).push({ value: 'lost', label: 'Lost' });
  });
  await expect
    .poll(async () => {
      const reply = await page.request.get('/api/v1/option-lists/stages');
      const body = (await reply.json()) as { items: { value: string }[] };
      return body.items.map((item) => item.value);
    })
    .toEqual(['new', 'won', 'lost']);

  // A rule naming a list the project does not carry is what `check` is for.
  project.editJson('schema/main.json', (doc) => {
    (doc['overrides'] as unknown[]).push({
      table: 'public.customers',
      column: 'country',
      op: 'column.options',
      value: { list: 'nowhere' },
    });
  });
  const checked = project.cli(['check']);
  expect(checked.status).toBe(2);
  expect(checked.stderr).toContain('uses the list "nowhere", and there is no lists/nowhere.json');
  project.editJson('schema/main.json', (doc) => {
    doc['overrides'] = (doc['overrides'] as { op: string }[]).filter((row) => row.op !== 'column.options');
  });
});

test('an action runs from the record page, the row menu and the bulk bar, and is audited', async ({ page }) => {
  await page.goto('/p/customers/r/ALFKI');
  const record = recordPage(page);
  await record.getByRole('button', { name: 'Mark as VIP' }).click();
  const question = page.getByRole('dialog', { name: 'Mark as VIP' });
  await expect(question).toContainText('Mark this customer as VIP?');
  await question.getByTestId('project-action-confirm').click();
  await expect(page.getByText('Marked 1 customer(s) as VIP.')).toBeVisible();
  await expect(recordField(page, 'contact_title')).toContainText('VIP');

  await page.goto('/p/customers');
  const anaTrujillo = gridRows(page).filter({ hasText: 'Ana Trujillo' });
  await anaTrujillo.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as VIP' }).click();
  await page.getByRole('dialog', { name: 'Mark as VIP' }).getByTestId('project-action-confirm').click();
  await expect(page.getByText('Marked 1 customer(s) as VIP.')).toBeVisible();
  await expect(anaTrujillo).toContainText('VIP');

  for (const company of ['Antonio Moreno', 'Around the Horn']) {
    await gridRows(page).filter({ hasText: company }).getByRole('checkbox', { name: 'Select row' }).check();
  }
  await page.getByRole('button', { name: 'Mark as VIP' }).click();
  const bulk = page.getByRole('dialog', { name: 'Mark as VIP' });
  await expect(bulk).toContainText('2 records');
  await bulk.getByTestId('project-action-confirm').click();
  await expect(page.getByText('Marked 2 customer(s) as VIP.')).toBeVisible();
  await expect(gridRows(page).filter({ hasText: 'Around the Horn' })).toContainText('VIP');

  const audit = await json<{ entries: { action: string; actorLabel: string; changes: { after: Record<string, unknown> } }[] }>(
    await page.request.get('/api/v1/audit?resource=project.action&limit=10'),
  );
  expect(audit.entries.map((entry) => entry.changes.after)).toEqual([
    expect.objectContaining({ action: 'mark-vip', ids: ['ANTON', 'AROUT'], outcome: 'succeeded' }),
    expect.objectContaining({ action: 'mark-vip', ids: ['ANATR'], outcome: 'succeeded' }),
    expect.objectContaining({ action: 'mark-vip', ids: ['ALFKI'], outcome: 'succeeded' }),
  ]);
  expect(new Set(audit.entries.map((entry) => entry.actorLabel))).toEqual(new Set([PROJECT_OWNER.name]));
});

test('an action is offered to, and runs for, only the people its permission allows', async ({
  page,
  browser,
  playwright,
}) => {
  // Viewers may read the customers page and its table, as an admin would set in
  // Team → Roles; they may not change a customer.
  const viewerRole = await roleIdOf(page.request, 'viewer');
  await json(
    await page.request.put(`/api/v1/roles/${viewerRole}/permissions`, {
      data: {
        grants: [`page:${await pageIdOf(page.request, 'customers')}:view`, `table:${connectionId}:${customersTable}:read`],
      },
    }),
  );
  // A viewer, invited and signed in the way a teammate would be.
  const invited = await json<{ invite: { token: string } }>(
    await page.request.post('/api/v1/users', {
      data: { email: VIEWER.email, name: VIEWER.name, roleIds: [viewerRole] },
    }),
  );
  const viewer = await playwright.request.newContext({ baseURL: PROJECT_URL, storageState: anonymous });
  try {
    await json(await viewer.post('/api/v1/auth/password/reset', { data: { token: invited.invite.token, newPassword: VIEWER.password } }));
    await json(await viewer.post('/api/v1/auth/login', { data: { email: VIEWER.email, password: VIEWER.password } }));

    expect((await json<{ data: unknown[] }>(await viewer.get('/api/v1/project/actions'))).data).toEqual([]);
    const refused = await viewer.post('/api/v1/project/actions/mark-vip', {
      data: { database: 'main', table: customersTable, ids: ['BERGS'] },
    });
    expect(refused.status(), await refused.text()).toBe(403);

    const context = await browser.newContext({ baseURL: PROJECT_URL, storageState: await viewer.storageState() });
    try {
      const viewerPage = await context.newPage();
      await viewerPage.goto('/p/customers/r/BERGS');
      await expect(recordPage(viewerPage).getByRole('heading', { name: 'Berglunds snabbköp' })).toBeVisible();
      await expect(recordPage(viewerPage).getByRole('button', { name: 'Edit' })).toHaveCount(0);
      await expect(recordPage(viewerPage).getByRole('button', { name: 'Mark as VIP' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await viewer.dispose();
  }

  await page.goto('/p/customers/r/BERGS');
  await expect(recordPage(page).getByRole('button', { name: 'Mark as VIP' })).toBeVisible();
  await expect(recordField(page, 'contact_title')).toContainText('Order Administrator');
});

test("a hook's message shows on an edit, a new record and a bulk delete", async ({ page }) => {
  await page.goto('/p/customers/r/BERGS');
  await recordPage(page).getByRole('button', { name: 'Edit' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(COMPANY).fill('Blocked Foods');
  await drawer.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(BLOCKED)).toBeVisible();
  await page.reload();
  await expect(recordPage(page).getByRole('heading', { name: 'Berglunds snabbköp' })).toBeVisible();

  await page.goto('/p/customers');
  await page.getByRole('button', { name: 'New row' }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Customer Id').fill('BLOCK');
  await create.getByLabel(COMPANY).fill('Blocked Imports');
  // The dialog's own word for the action.
  await create.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByText(BLOCKED)).toBeVisible();

  await page.goto('/p/customers');
  for (const company of ['Alfreds Futterkiste', 'Blauer See Delikatessen']) {
    await gridRows(page).filter({ hasText: company }).getByRole('checkbox', { name: 'Select row' }).check();
  }
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete 2 rows' });
  await confirm.getByRole('textbox').fill('2');
  await confirm.getByRole('button', { name: 'Delete rows' }).click();
  await expect(page.getByText(GERMAN)).toBeVisible();
  await page.reload();
  await expect(gridRows(page).filter({ hasText: 'Blauer See Delikatessen' })).toBeVisible();
});

test("a hook's message comes back from a bulk update and the public API", async ({ page, playwright }) => {
  const bulk = await page.request.post(`/api/v1/data/${connectionId}/${encodeURIComponent(customersTable)}/bulk`, {
    data: { action: 'update', ids: ['BERGS', 'BLONP'], values: { company_name: 'Blocked in bulk' } },
  });
  expect(bulk.status(), await bulk.text()).toBe(422);
  expect(((await bulk.json()) as { error: { message: string } }).error.message).toBe(BLOCKED);

  await json(await page.request.put('/api/v1/public-api', { data: { enabled: true } }));
  const created = await json<{ scopes: { id: string }[] }>(
    await page.request.post('/api/v1/public-scopes', {
      data: {
        connectionId,
        side: 'customer',
        name: 'Shop',
        document: JSON.stringify({
          version: 1,
          side: 'customer',
          timezone: 'UTC',
          resources: [
            {
              ref: 'customers',
              table: customersTable,
              actions: ['read', 'create'],
              expose: ['customer_id', 'company_name'],
              writable: ['customer_id', 'company_name'],
            },
          ],
        }),
      },
    }),
  );
  const { token } = await json<{ token: string }>(
    await page.request.post('/api/v1/public-keys', { data: { name: 'Shop site', scopeId: created.scopes[0]?.id } }),
  );
  const visitor = await playwright.request.newContext({ baseURL: PROJECT_URL, storageState: anonymous });
  try {
    const post = (companyName: string, customerId: string) =>
      visitor.post('/api/v1/public/records/customers', {
        headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN },
        data: { values: { customer_id: customerId, company_name: companyName } },
      });
    const refused = await post('Blocked Online', 'BLKON');
    expect(refused.status(), await refused.text()).toBe(400);
    expect(((await refused.json()) as { error: unknown }).error).toMatchObject({
      code: 'PUBLIC_WRITE_REJECTED',
      message: BLOCKED,
    });
    const accepted = await post('Web Shop Ltd', 'WEBSH');
    expect(accepted.status(), await accepted.text()).toBe(201);
  } finally {
    await visitor.dispose();
  }
});

test("a hook's message is in the skipped-rows report of a CSV import", async ({ page }) => {
  await page.goto('/imports');
  await page.getByRole('combobox', { name: 'Target table' }).selectOption({ label: 'Customers' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('customer_id,company_name\nIMPRT,Imported Goods\nBLKCS,Blocked Traders\n'),
  });
  await page.getByTestId('wizard-validate').click();
  await expect(page.getByTestId('validation-summary')).toContainText('2 of 2 rows ready to import');
  await page.getByTestId('wizard-run').click();

  const review = page.getByTestId('import-review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  // allInnerTexts() reads once and answers [] when nothing matches, so it
  // cannot tell "no figures" from "no panel right now" — and the panel is
  // conditional on the polled job carrying stats, so it can be gone again in
  // the frame after it was visible. toHaveText retries until the four figures
  // are there. The one-shot read won on sqlite and postgres and lost on the
  // slower mysql leg, twice.
  await expect(review.locator('.font-mono')).toHaveText(['2', '1', '0', '1'], {
    timeout: 30_000,
  });
  const downloading = page.waitForEvent('download');
  await review.getByRole('link', { name: 'Download the skipped-rows report (CSV)' }).click();
  const report = readFileSync(await (await downloading).path(), 'utf8');
  expect(report).toContain('REJECTED');
  expect(report).toContain(BLOCKED);
  expect(report).toContain('BLKCS,Blocked Traders');
});

test('a page and a cell written in the project render with the dashboard\'s React; a broken cell leaves its table usable', async ({
  page,
}) => {
  project.editJson('pages/customers.json', (doc) => {
    column(doc, 'contact_name')['widget'] = 'project.flag-cell';
  });
  project.editJson('pages/suppliers.json', (doc) => {
    column(doc, 'company_name')['widget'] = 'project.broken-cell';
  });
  await expect.poll(() => project.output()).toContain('Applied pages/suppliers.json.');

  await page.goto('/p/revenue');
  await expect(page.getByRole('heading', { name: 'Revenue', level: 1 })).toBeVisible();
  await expect(page.getByText('Written in the project folder')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Alfreds Futterkiste' })).toBeVisible();
  // State lives in the dashboard's React: a second copy would throw on the first hook.
  await page.getByRole('button', { name: 'Clicked 0 times' }).click();
  await expect(page.getByRole('button', { name: 'Clicked 1 times' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Revenue' })).toBeVisible();

  await page.goto('/p/customers');
  const flagged = page.locator('[data-project-flag]');
  await expect(flagged.first()).toBeVisible();
  expect(await flagged.count()).toBeGreaterThan(5);
  await expect(gridRows(page).filter({ hasText: 'Maria Anders' }).locator('[data-project-flag]')).toHaveText('Maria Anders');

  await page.goto('/p/suppliers');
  const exotic = gridRows(page).filter({ hasText: 'Exotic Liquids' });
  await expect(exotic.getByRole('img', { name: 'This cell is broken on purpose.' })).toBeVisible();
  await page.getByRole('searchbox', { name: /suppliers/ }).fill('Tokyo');
  await expect(gridRows(page)).toHaveCount(1);
  await expect(gridRows(page).first()).toContainText('Tokyo Traders');
});

test('a saved page of code is rebuilt and shown again without a reload', async ({ page }) => {
  await page.goto('/p/revenue');
  await expect(page.getByText('Written in the project folder')).toBeVisible();
  const boots = project.boots();
  // A marker a reload would lose: the page is not loaded again, only its code.
  await page.evaluate(() => {
    (window as unknown as { __stillHere?: boolean }).__stillHere = true;
  });
  project.write('pages/revenue.tsx', revenuePage('Rebuilt while it was open'));
  await expect(page.getByText('Rebuilt while it was open')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
  expect(project.boots()).toBe(boots);
});

test('eject turns a generated page into code at the same address', async ({ page }) => {
  const before = await pageRow(page.request, 'shippers');
  const ejected = project.cli(['eject', 'shippers']);
  expect(ejected.status, `${ejected.stdout}${ejected.stderr}`).toBe(0);
  expect(project.exists('pages/shippers.tsx')).toBe(true);
  expect(project.exists('pages/shippers.json')).toBe(false);

  await expect.poll(async () => (await pageRow(page.request, 'shippers'))?.origin, { timeout: 30_000 }).toBe('project');
  expect((await pageRow(page.request, 'shippers'))?.id).toBe(before?.id);
  await page.goto('/p/shippers');
  /*
   * The `origin` poll above says the SERVER now calls this page code. It says
   * nothing about the BUILD, and until the dashboard has rebuilt the project
   * the address renders "This page is not in the running build" instead of the
   * grid — which is what the mysql leg showed twice, with the placeholder in
   * the page snapshot and `pages/shippers.tsx` named under it.
   *
   * So this waits a rebuild's worth, the way the test above waits 20s for a
   * saved page to come back. The slow leg is mysql, which the CSV-import test
   * in this file records for itself in the same words.
   */
  await expect(gridRows(page).filter({ hasText: 'Speedy Express' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'New row' })).toBeVisible();
});

test('pull --from writes a Studio edit on a server into the folder, and the next deploy clears the flag', async ({
  page,
}) => {
  await project.serve();
  expect(project.output()).toContain(`Project: ${project.root}`);

  await renameInStudio(page, 'orders', 'Orders on the server');
  await page.goto('/studio/pages');
  const changed = page.getByTestId('studio-pages-project-changed');
  await expect(changed).toContainText('1 page was changed on this server');
  await expect(changed.getByTestId('studio-pages-pull-command')).toHaveText(`npm run pull -- --from ${PROJECT_URL}`);
  const studioOrders = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Orders on the server' });
  await expect(studioOrders.getByTestId('studio-pages-project-flag')).toHaveText('Changed on server');
  // A server never writes the folder.
  expect(project.readJson<PageFile>('pages/orders.json').title.fallback).toBe('Orders');

  const pulled = project.cli(['pull', '--from', PROJECT_URL], { ADMINIUM_API_KEY: await apiKeyFor(page, 'admin') });
  expect(pulled.status, `${pulled.stdout}${pulled.stderr}`).toBe(0);
  expect(pulled.stdout).toContain('Wrote pages/orders.json (changed on the server)');
  expect(project.readJson<PageFile>('pages/orders.json').title.fallback).toBe('Orders on the server');

  await project.serve();
  await page.goto('/studio/pages');
  await expect(page.getByRole('heading', { name: 'Pages', level: 2 })).toBeVisible();
  await expect(page.getByTestId('studio-pages-project-changed')).toHaveCount(0);
  await expect(page.getByTestId('studio-pages-project-flag')).toHaveCount(0);
});

test('a page changed on both sides is a conflict after a redeploy, until one copy is chosen', async ({ page }) => {
  await renameInStudio(page, 'products', 'Products on the server');
  await renameInStudio(page, 'suppliers', 'Suppliers on the server');
  project.editJson('pages/products.json', retitle('Products in the project'));
  project.editJson('pages/suppliers.json', retitle('Suppliers in the project'));
  await project.serve();

  await page.goto('/studio/pages');
  const conflicts = page.getByTestId('studio-pages-project-conflicts');
  await expect(conflicts).toContainText('2 pages were changed here and in the project');
  // The server kept its own copies through the redeploy.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Products on the server' })).toBeVisible();

  await conflicts.getByRole('listitem').filter({ hasText: 'pages/products.json' }).getByRole('button', { name: 'Use project copy' }).click();
  await expect(conflicts).toContainText('1 page was changed here and in the project');
  await expect(nav.getByRole('link', { name: 'Products in the project' })).toBeVisible();

  await conflicts.getByRole('listitem').filter({ hasText: 'pages/suppliers.json' }).getByRole('button', { name: 'Keep server copy' }).click();
  await expect(page.getByTestId('studio-pages-project-conflicts')).toHaveCount(0);
  await expect(page.getByTestId('studio-pages-project-changed')).toContainText('1 page was changed on this server');
  await expect(nav.getByRole('link', { name: 'Suppliers on the server' })).toBeVisible();
  expect(project.readJson<PageFile>('pages/suppliers.json').title.fallback).toBe('Suppliers in the project');
});
