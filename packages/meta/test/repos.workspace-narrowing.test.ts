// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A list narrowed to a workspace's databases is narrowed IN ITS QUERY, before
 * the page is cut: a page of one workspace is full of that workspace's rows,
 * and its cursor leads to the next of them. Cut after, the newest rows of
 * another database would fill the page and leave it short or empty, with a
 * cursor to a next page all the same.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  automationRunsRepo,
  automationsRepo,
  connectionsRepo,
  exportsRepo,
  filesRepo,
  importsRepo,
  usersRepo,
  type AutomationTriggerEvent,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const plain: DsnCrypto = { encrypt: (v) => v, decrypt: (v) => v };

const EVENT: AutomationTriggerEvent = {
  event: 'record.created',
  origin: 'dashboard',
  hops: 0,
  record: { connectionId: 'cnx_1', table: 'orders', pk: { id: 7 }, label: 'Order 7' },
  snapshot: { id: 7 },
  occurredAt: T0,
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`lists narrowed to a workspace in the query [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let kiln: string;
    let fernhill: string;
    let userId: string;

    beforeEach(async () => {
      const connections = connectionsRepo(meta(), plain);
      kiln = (await connections.create({ name: 'kiln', engine: 'postgres', introspectDsn: 'postgres://ro@db/kiln' })).id;
      fernhill = (await connections.create({ name: 'fernhill', engine: 'postgres', introspectDsn: 'postgres://ro@db/fernhill' })).id;
      userId = (await usersRepo(meta()).create({ email: 'owner@adminium.test', name: 'Owner' })).id;
    });

    it('pages files of the workspace only, the cursor included', async () => {
      const files = filesRepo(meta());
      // Two kiln files, oldest first, then five newer fernhill ones: cut after the page, kiln's first page is empty.
      const make = (connectionId: string, n: number) =>
        files.create({ filename: `f${String(n)}.pdf`, mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'stranger', uploadedBy: null, entityConnectionId: connectionId });
      for (let n = 0; n < 2; n += 1) await make(kiln, n);
      for (let n = 2; n < 7; n += 1) await make(fernhill, n);

      const first = await files.search({ state: 'unattached', entityConnectionIds: [kiln], limit: 1 });
      expect(first.rows.map((row) => row.entityConnectionId)).toEqual([kiln]);
      expect(first.nextCursor).not.toBeNull();
      const second = await files.search({ state: 'unattached', entityConnectionIds: [kiln], limit: 1, cursor: first.nextCursor! });
      expect(second.rows.map((row) => row.entityConnectionId)).toEqual([kiln]);
      expect(second.nextCursor).toBeNull();
      expect((await files.search({ state: 'unattached', entityConnectionIds: [kiln, fernhill], limit: 10 })).rows).toHaveLength(7);
      expect(await files.search({ state: 'unattached', entityConnectionIds: [] })).toEqual({ rows: [], nextCursor: null });
    });

    it('pages runs by their rule\'s database, and counts them the same way', async () => {
      const rules = automationsRepo(meta());
      const runs = automationRunsRepo(meta());
      const rule = (connectionId: string) => rules.create({ connectionId, name: 'Notify', trigger: { kind: 'record', event: 'created', connectionId, table: 'orders', watch: true }, graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When an order comes' }] } }, T0);
      const kilnRule = await rule(kiln);
      const fernhillRule = await rule(fernhill);
      for (let n = 0; n < 2; n += 1) await runs.begin({ automationId: kilnRule.id, dedupeKey: null, origin: 'dashboard', triggerEvent: EVENT }, T0 + n);
      for (let n = 2; n < 7; n += 1) await runs.begin({ automationId: fernhillRule.id, dedupeKey: null, origin: 'dashboard', triggerEvent: EVENT }, T0 + n);

      const page = await runs.list({ since: T0, connectionIds: [kiln], limit: 2 });
      expect(page.map((run) => run.automationId)).toEqual([kilnRule.id, kilnRule.id]);
      expect((await runs.list({ since: T0, connectionIds: [fernhill], limit: 50 }))).toHaveLength(5);
      expect(await runs.list({ since: T0, connectionIds: [] })).toEqual([]);
      expect((await runs.counts({ since: T0, connectionIds: [kiln] })).all).toBe(2);
      expect((await runs.counts({ since: T0 })).all).toBe(7);
      expect((await runs.counts({ since: T0, connectionIds: [] })).all).toBe(0);
    });

    it('takes the newest exports and imports of the workspace, not the newest of all', async () => {
      const exports = exportsRepo(meta());
      for (let n = 0; n < 2; n += 1) await exports.create({ connectionId: kiln, requestedBy: userId, source: { kind: 'table', table: 'a' }, format: 'csv' }, T0 + n);
      for (let n = 2; n < 7; n += 1) await exports.create({ connectionId: fernhill, requestedBy: userId, source: { kind: 'table', table: 'a' }, format: 'csv' }, T0 + n);
      expect((await exports.list({ connectionIds: [kiln], limit: 2 })).map((row) => row.connectionId)).toEqual([kiln, kiln]);
      expect(await exports.list({ connectionIds: [] })).toEqual([]);

      const imports = importsRepo(meta());
      const upload = await filesRepo(meta()).create({ filename: 'in.csv', mime: 'text/csv', sizeBytes: 1, sha256: 'b'.repeat(64), kind: 'import', uploadedBy: userId });
      const add = (connectionId: string, at: number) =>
        imports.create({ connectionId, tableName: 'orders', requestedBy: userId, fileId: upload.id, mapping: { columns: [{ from: 'A', to: 'a' }] }, options: { mode: 'insert', skipInvalid: true } }, at);
      for (let n = 0; n < 2; n += 1) await add(kiln, T0 + n);
      for (let n = 2; n < 7; n += 1) await add(fernhill, T0 + n);
      expect((await imports.list({ connectionIds: [kiln], limit: 2 })).map((row) => row.connectionId)).toEqual([kiln, kiln]);
      expect(await imports.list({ connectionIds: [] })).toEqual([]);
    });
  });
}
