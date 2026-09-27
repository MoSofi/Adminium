// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row a move moves too (a stay checked in turns its room occupied) is
 * told as a change of its own whoever made the move, on every engine: a
 * rule's step — audited as the rule's, and carrying the rule and its depth so
 * the rule never runs again on its own write — and project code, as the
 * code's own write.
 */
import type { FastifyInstance } from 'fastify';
import { auditRepo, type Automation } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { runUpdateAction } from '../src/automations/actions/record-write.js';
import type { ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createProjectDb } from '../src/project/code/db.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

describe.each(LEGS)('rows a move moved too, told — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let n = 0;
  const events: RecordWriteEvent[] = [];
  let app: FastifyInstance;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ timed: false }));
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    // What the fan-out reaches with no server around it: the audit store and the rules' ear.
    app = {
      hasDecorator: (name: string) => name === 'automations',
      automations: { onRecordEvent: async (event: RecordWriteEvent) => void events.push(event) },
      rbac: { meta: h.meta },
    } as unknown as FastifyInstance;
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  async function stayInRoom() {
    n += 1;
    const room = await w.create('rooms', { number: `E${String(n)}` });
    const stay = await w.create('stays', { room_id: room['id'], arrive: '2026-08-10' });
    return { room, stay };
  }
  const roomEvents = (room: Record<string, unknown>) =>
    events.filter((e) => e.table.id === w.targetOf('rooms').table.id && JSON.stringify(e.entity.pk) === JSON.stringify({ id: room['id'] }));

  // A rule refuses every table whose name carries `adminium_`, and this MySQL leg's database is named so.
  it.runIf(available && dialect !== 'mysql')("tells a rule's move of the room as the rule's own write, so the rule never hears it", async () => {
    const { room, stay } = await stayInRoom();
    const target = w.targetOf('stays');
    const rule = { id: 'aut_checkin', name: 'Check in on arrival' } as Automation;
    const ctx: ActionContext = {
      meta: h.meta,
      manager: h.manager,
      app,
      writes: createWriteService(writeStores(h.meta)),
      rule,
      runId: 'run_1',
      hops: 0,
      now: Date.now(),
      source: {
        connectionId: h.connectionId,
        view: target.view,
        db: target.db,
        dialect: target.dialect,
        table: target.table,
        record: { connectionId: h.connectionId, table: target.table.id, pk: { id: stay['id'] }, label: String(stay['id']) },
        row: stay,
      },
      tokens: {},
      text: TRACE_EN,
      secret: '',
    };
    await runUpdateAction({ kind: 'record.update', values: { status: 'in_house' } } as never, ctx);
    const [told] = roomEvents(room);
    expect(told).toMatchObject({ origin: 'automation', ruleId: 'aut_checkin', hops: 1 });
    const audit = await auditRepo(h.meta).list({ limit: 200 });
    const entry = audit.find((e) => e.action === 'record.update' && e.entity?.table === w.targetOf('rooms').table.id && JSON.stringify(e.entity?.pk) === JSON.stringify({ id: room['id'] }));
    expect(entry).toMatchObject({ category: 'automation', actorKind: 'automation', actorId: 'aut_checkin' });
  });

  it.runIf(available)("tells project code's move of the room as the code's own write", async () => {
    const { room, stay } = await stayInRoom();
    await h.meta.db.updateTable('adminium_connections').set({ projectKey: 'venue' } as never).where('id', '=', h.connectionId).execute();
    const { db } = await h.manager.data(h.connectionId);
    const code = createProjectDb(
      { app, meta: h.meta, manager: h.manager, writes: () => createWriteService(writeStores(h.meta)) },
      { database: 'venue', raw: db, dialect, context: { origin: 'hook', hops: 1, actor: { kind: 'user', id: 'usr_1', label: 'Ada' }, request: null } },
    );
    await code.table(w.targetOf('stays').table.id).update(stay['id'] as number, { status: 'in_house' });
    const [told] = roomEvents(room);
    expect(told).toMatchObject({ origin: 'hook', hops: 1 });
    const audit = await auditRepo(h.meta).list({ limit: 200 });
    const entry = audit.find((e) => e.action === 'record.update' && e.entity?.table === w.targetOf('rooms').table.id && JSON.stringify(e.entity?.pk) === JSON.stringify({ id: room['id'] }));
    expect(entry).toMatchObject({ actorKind: 'user', actorLabel: 'Ada' });
  });
});
