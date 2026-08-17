// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A real CRUD round-trip through the embedded stack, driven from the
 * authenticated renderer (11-electron.md §6/§9, 11-T20).
 *
 * WHY THROUGH THE API AND NOT THE GENERATED FORM. The demo domain's tables carry
 * many NOT NULL columns (employees: full_name, job_title, email, department,
 * presence, hired_on, …), so a UI "create" would depend on the exact shape of a
 * generated form this suite cannot introspect ahead of a real run. An UPDATE of
 * one plain text column of an EXISTING row needs none of that and is
 * deterministic — and it exercises the whole path the acceptance criteria care
 * about: renderer → loopback HTTP → Fastify → adapter → SQLite.
 *
 * The fetches run in the page, so they carry the SPA's own session cookie
 * (SameSite=Lax, same-origin; the API takes no CSRF token — see
 * apps/dashboard/src/app/api.ts). This is the same door the generated app's grid
 * uses to save an edit.
 */

import type { Page } from '@playwright/test';

export interface EditedRecord {
  connectionId: string;
  table: string;
  recordId: string;
  marker: string;
}

/**
 * Set a unique marker on `employees.job_title` of the first demo employee and
 * return enough to read it back. The marker makes the value both unique (so a
 * later read is unambiguous) and searchable.
 */
export async function editEmployeeTitle(page: Page, marker: string): Promise<EditedRecord> {
  const result = await page.evaluate(async (value) => {
    const readJson = async (response: Response): Promise<unknown> => {
      if (!response.ok) throw new Error(`${response.url} → ${response.status} ${await response.text()}`);
      return response.json();
    };

    const connections = (await readJson(
      await fetch('/api/v1/connections', { credentials: 'same-origin' }),
    )) as { connections: Array<{ id: string }> };
    const connectionId = connections.connections[0]?.id;
    if (connectionId === undefined) throw new Error('no connection found for the demo database');

    const table = 'employees';
    const list = (await readJson(
      await fetch(`/api/v1/data/${connectionId}/${table}?limit=1`, { credentials: 'same-origin' }),
    )) as { data: Array<Record<string, unknown>> };
    const row = list.data[0];
    if (row === undefined) throw new Error('the demo employees table has no rows to edit');
    const recordId = String(row['id']);

    await readJson(
      await fetch(`/api/v1/data/${connectionId}/${table}/${recordId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { job_title: value } }),
      }),
    );

    return { connectionId, table, recordId };
  }, marker);

  return { ...result, marker };
}

/** Read `employees.job_title` back for {@link EditedRecord} — the durability check. */
export async function readEmployeeTitle(page: Page, record: EditedRecord): Promise<string> {
  return page.evaluate(async (target) => {
    const response = await fetch(`/api/v1/data/${target.connectionId}/${target.table}/${target.recordId}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`${response.url} → ${response.status}`);
    const body = (await response.json()) as { data: Record<string, unknown> };
    return String(body.data['job_title']);
  }, record);
}
