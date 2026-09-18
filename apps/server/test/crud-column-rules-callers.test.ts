// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule an admin wrote in Studio, enforced through the DOORS — not through
 * the function that enforces it (plan 50, 50-T19).
 *
 * ─── Why this file exists beside the unit tests ────────────────────────────
 *
 * `checkRow` refusing a bad value proves nothing about the product: the whole
 * defect class this plan exists for is a correct function nobody calls. Four
 * separate callers write rows — the dashboard's dialog through
 * `POST /data/:conn/:table`, a PATCH, the undo route, and the CSV import,
 * which has a fast path that skips the hooks entirely — and a rule that any of
 * them can walk around is not a rule.
 *
 * So the rules here are stored the way Studio stores them (override rows on
 * the connection), and every assertion is a request.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overridesRepo } from '@adminium/meta';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

interface Refusal {
  error: { code: string; details?: { fields?: Record<string, { code: string; n?: number }> } };
}

let dir: string | null = null;
let t: DataTestContext;
let connId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-rules-'));
  const file = join(dir, 'crm.db');
  const db = new BetterSqlite3(file);
  // Nothing here is constrained by the DATABASE: every refusal below is a rule
  // an admin wrote, which is the point.
  db.exec(`CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email VARCHAR(120),
    stage VARCHAR(20),
    score INTEGER
  )`);
  db.close();

  t = await buildDataTestApp();
  connId = await createConnectionViaApi(t, `sqlite:${file}`, 'crm', 'sqlite');
  await introspectViaApi(t, connId);
  await t.grantTable(t.roles.admin, connId, '*', {
    read: true,
    create: true,
    update: true,
    delete: true,
  });

  // …exactly the rows Studio's PUT writes — keyed by the QUALIFIED table id,
  // which is what `applyOverrides` looks tables up by (`main.leads` on sqlite).
  await overridesRepo(t.meta).replaceForConnection(connId, [
    { op: 'column.required', tableName: 'main.leads', columnName: 'email', value: { required: true } },
    {
      op: 'column.validation',
      tableName: 'main.leads',
      columnName: 'email',
      value: { format: 'email', maxLength: 40 },
    },
    {
      op: 'column.options',
      tableName: 'main.leads',
      columnName: 'stage',
      value: { values: [{ value: 'new' }, { value: 'won' }] },
    },
    { op: 'column.validation', tableName: 'main.leads', columnName: 'score', value: { min: 0, max: 100 } },
  ] as never);
});

afterAll(async () => {
  await t.app.close();
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
});

const url = () => `/api/v1/data/${connId}/leads`;

const create = async (values: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: url(), headers: asUser(t.users.admin), payload: { values } });

describe('the dialog’s door — POST /data', () => {
  it('names the field and the reason, and never 500s', async () => {
    const missing = await create({ stage: 'new' });
    expect(missing.statusCode, missing.body).toBe(422);
    expect((missing.json() as Refusal).error.details?.fields).toEqual({
      email: { code: 'required' },
    });

    const shape = await create({ email: 'not-an-email' });
    expect(shape.statusCode).toBe(422);
    expect((shape.json() as Refusal).error.details?.fields?.['email']?.code).toBe('format');

    const long = await create({ email: `${'a'.repeat(40)}@example.com` });
    expect((long.json() as Refusal).error.details?.fields?.['email']).toEqual({
      code: 'too-long',
      n: 40,
    });

    const outside = await create({ email: 'ada@example.com', stage: 'maybe' });
    expect((outside.json() as Refusal).error.details?.fields?.['stage']?.code).toBe('not-allowed');

    const tooBig = await create({ email: 'ada@example.com', score: 101 });
    expect((tooBig.json() as Refusal).error.details?.fields?.['score']).toEqual({
      code: 'too-large',
      n: 100,
    });
  });

  it('takes the row once it answers every rule', async () => {
    const ok = await create({ email: 'ada@example.com', stage: 'won', score: 99 });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe('a PATCH is judged as an update, not as a create', () => {
  it('refuses a value that breaks a rule, and ignores columns it does not mention', async () => {
    const created = (await create({ email: 'grace@example.com', stage: 'new' })).json() as {
      data: Record<string, unknown>;
    };
    const id = String(created.data['id']);

    const bad = await t.app.inject({
      method: 'PATCH',
      url: `${url()}/${id}`,
      headers: asUser(t.users.admin),
      payload: { values: { stage: 'nope' } },
    });
    expect(bad.statusCode).toBe(422);
    expect((bad.json() as Refusal).error.details?.fields?.['stage']?.code).toBe('not-allowed');

    // `email` is required and is not part of this change — which is not the
    // same as being emptied. Reading it as empty would make every partial
    // update of this table fail.
    const fine = await t.app.inject({
      method: 'PATCH',
      url: `${url()}/${id}`,
      headers: asUser(t.users.admin),
      payload: { values: { score: 12 } },
    });
    expect(fine.statusCode, fine.body).toBe(200);

    // …and emptying it explicitly IS refused.
    const emptied = await t.app.inject({
      method: 'PATCH',
      url: `${url()}/${id}`,
      headers: asUser(t.users.admin),
      payload: { values: { email: '' } },
    });
    expect(emptied.statusCode).toBe(422);
    expect((emptied.json() as Refusal).error.details?.fields?.['email']?.code).toBe('required');
  });
});

describe('the rule survives the round trip through Studio', () => {
  it('is in force on the next request after it is written, with no restart', async () => {
    // The view is rebuilt on a stamp of the override set, so a rule added in
    // Studio takes effect on the very next write rather than at the next boot.
    await overridesRepo(t.meta).replaceForConnection(connId, [
      {
        op: 'column.options',
        tableName: 'main.leads',
        columnName: 'stage',
        value: { values: [{ value: 'new' }, { value: 'won' }, { value: 'lost' }] },
      },
    ] as never);

    const widened = await create({ email: 'lost@example.com', stage: 'lost' });
    expect(widened.statusCode, widened.body).toBe(201);

    // …and the rules that were removed from the document are no longer applied:
    // the PUT replaces the whole set, so `email` is no longer required.
    const noEmail = await create({ stage: 'new' });
    expect(noEmail.statusCode, noEmail.body).toBe(201);
  });
});
