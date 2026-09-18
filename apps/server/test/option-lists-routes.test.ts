// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/option-lists` — the named answers a column accepts.
 *
 * Three things are worth a test here and nothing else is: who may write one,
 * that the built-ins are served but not editable, and that a list a rule points
 * at cannot be deleted out from under it.
 *
 * ─── Why the locale assertion is on a COUNTRY ──────────────────────────────
 *
 * A country's name is `Intl.DisplayNames`'s answer in the reader's own
 * language, which is the entire reason the list is not a table of English
 * strings. A German reader asking for `builtin:countries` has to read
 * "Deutschland" — and the VALUE has to stay `DE`, because the value is what
 * lands in the row and a row must mean the same thing to every reader.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overridesRepo, userPrefsRepo } from '@adminium/meta';

import { optionListsRoutes } from '../src/routes/option-lists/index.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';

describe('option lists', () => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        await api.register(optionListsRoutes({ meta: ctx.meta }));
      },
    });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (path: string, user = t.users.admin) =>
    t.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: asUser(user) });

  const send = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown>, user = t.users.admin) =>
    t.app.inject({
      method,
      url: `/api/v1${path}`,
      headers: asUser(user),
      ...(body === undefined ? {} : { payload: body }),
    });

  it('serves the three built-ins to anyone with a session, and marks them uneditable', async () => {
    const res = await get('/option-lists', t.users.viewer);
    expect(res.statusCode).toBe(200);
    const lists = res.json<{ lists: { key: string; items: unknown[]; editable: boolean }[] }>().lists;
    const keys = lists.map((list) => list.key);
    expect(keys).toEqual(expect.arrayContaining(['builtin:countries', 'builtin:us-states', 'builtin:gender']));
    // A viewer who can add a row has to be able to see the answers it offers.
    const countries = lists.find((list) => list.key === 'builtin:countries');
    expect(countries?.items).toHaveLength(249);
    expect(countries?.editable).toBe(false);
    expect(lists.find((list) => list.key === 'builtin:us-states')?.items).toHaveLength(51);
  });

  it('names a country in the READER\'s language, and still answers with the code', async () => {
    const prefs = userPrefsRepo(t.meta);
    await prefs.set(t.users.viewer.id, { locale: 'de' });
    const res = await get('/option-lists/builtin:countries', t.users.viewer);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { value: string; label?: string }[] }>().items;
    const germany = items.find((item) => item.value === 'DE');
    expect(germany?.label).toBe('Deutschland');
    await prefs.set(t.users.viewer.id, { locale: 'en' });
  });

  it('refuses a write from someone without the remap grant', async () => {
    const res = await send('POST', '/option-lists', { key: 'stages', name: 'Stages', items: [{ value: 'new' }] }, t.users.viewer);
    expect(res.statusCode).toBe(403);
  });

  it('creates, edits and re-reads a custom list', async () => {
    const created = await send('POST', '/option-lists', {
      key: 'departments',
      name: 'Departments',
      items: [{ value: 'support', label: 'Support' }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ editable: boolean }>().editable).toBe(true);

    const patched = await send('PATCH', '/option-lists/departments', {
      items: [{ value: 'support', label: 'Support' }, { value: 'ops', label: 'Operations' }],
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ items: unknown[] }>().items).toHaveLength(2);

    const read = await get('/option-lists/departments');
    expect(read.json<{ name: string }>().name).toBe('Departments');
  });

  it('will not let a built-in be taken over, edited or deleted', async () => {
    const stolen = await send('POST', '/option-lists', {
      key: 'builtin-countries',
      name: 'Mine',
      items: [{ value: 'x' }],
    });
    // A slug cannot contain a colon, so the only way to collide is a lookalike —
    // which is allowed, because it is a different key.
    expect(stolen.statusCode).toBe(201);

    expect((await send('PATCH', '/option-lists/builtin:gender', { name: 'Gender' })).statusCode).toBe(422);
    expect((await send('DELETE', '/option-lists/builtin:gender')).statusCode).toBe(422);
  });

  it('lets a RULE name a list the workspace has, and refuses one it has not', async () => {
    /*
     * The rule and the list are two stores, and the rule is written through the
     * remap route. Until phase F that route knew only the built-ins, so a rule
     * naming a workspace list was refused with "There is no list called…" — the
     * defect the browser pass found.
     */
    await send('POST', '/option-lists', { key: 'tiers', name: 'Tiers', items: [{ value: 'gold' }] });
    const rule = (list: string) => ({
      overrides: [
        { op: 'column.options', tableName: 'main.invoices', columnName: 'number', value: { list } },
      ],
    });
    const accepted = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: rule('tiers'),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const refused = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: rule('nowhere'),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/no list called/);
  });

  it('answers 409 and names the columns when the list is in use', async () => {
    const overrides = overridesRepo(t.meta);
    await send('POST', '/option-lists', { key: 'stages', name: 'Stages', items: [{ value: 'new' }] });
    await overrides.create({
      connectionId: connId,
      op: 'column.options',
      tableName: 'public.deals',
      columnName: 'stage',
      value: { list: 'stages' },
    });

    const refused = await send('DELETE', '/option-lists/stages');
    expect(refused.statusCode).toBe(409);
    // The operator is told WHERE to go, rather than left to search for it.
    expect(refused.json<{ error: { details?: { usedBy?: string[] } } }>().error.details?.usedBy).toEqual([
      'public.deals.stage',
    ]);

    // A list nothing points at goes.
    expect((await send('DELETE', '/option-lists/departments')).statusCode).toBe(200);
    expect((await get('/option-lists/departments')).statusCode).toBe(404);
  });
});
