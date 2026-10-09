// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant may propose, on every engine, as the people who use it.
 *
 * - A kind is offered only when the workspace has switched it on AND the
 *   person holds that right on the page's own table. What is not offered is
 *   in neither the prompt nor the reply contract.
 * - A proposal is stored exactly as the model wrote it and marked unchecked:
 *   the job has nobody's session to check it with.
 * - A proposal that arrives where none is offered is an unreadable reply.
 */
import { ASSISTANT_SCHEMA_VERSION } from '@adminium/llm';
import { assistantSessionsRepo, pagesRepo, settingsRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeAssistantTurn } from '../src/jobs/assistant-turn.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { legs, person, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';
import { makeScriptedClient } from './llm-fixtures.js';

const OFF = { create: false, change: false, send: false, delete: false };

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`what the assistant may propose — ${dialect}`, () => {
    let s: Stack;
    let pageId: string;
    let night: { cookie: string; id: string };
    let all: { cookie: string; id: string };
    let reader: { cookie: string; id: string };

    const switches = (abilities: Partial<typeof OFF>) => settingsRepo(s.meta).set('assistant.abilities', { ...OFF, ...abilities });
    const on = (userId: string, context: 'data' | 'general' = 'data') => turnAs(s, userId, context, context === 'data' ? { pageId } : {});
    const reply = (extra: Record<string, unknown>) => ({ text: JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say: 'Here is what I would do.', ...extra }) });

    /** One whole turn through the job, with the model's replies scripted. */
    const turn = async (userId: string, replies: { text: string }[]) => {
      const repo = assistantSessionsRepo(s.meta);
      const session = await repo.create({ context: 'data', host: { connectionIds: [s.connectionId], pageId }, createdBy: userId });
      const created = await repo.createTurn({ sessionId: session.id, askText: 'Move Ana to in house.' });
      await repo.setTurnStatus(created.id, 'queued', { jobId: 'job_test' });
      const scripted = makeScriptedClient(replies);
      await executeAssistantTurn(
        { turnId: created.id, userId },
        { jobId: 'job_test', kind: 'assistant.turn', attempt: 1, maxAttempts: 3, signal: new AbortController().signal, progress: () => undefined, log: () => undefined },
        {
          meta: s.meta,
          manager: s.manager,
          resolveClient: () => Promise.resolve({ client: scripted.client, provider: 'anthropic', model: 'm', baseUrl: null }),
          can: async (who, permission) => (who === null ? false : permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: who, label: who }), permission)),
          now: () => 1_800_000_000_000,
        },
      );
      return { stored: (await repo.findTurn(created.id))!, scripted };
    };

    beforeAll(async () => {
      s = await stack(dialect);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (1, '2026-11-01', '2026-12-01', 'Ana', 100, 'booked')`);
      pageId = (await pagesRepo(s.meta).listAll()).find((row) => row.title === 'Stays')!.id;
      // Reads and changes stays; may neither add nor delete one.
      night = await person(s, 'planner@lodge.dev', ['planner']);
      const table = `table:${s.connectionId}:${s.table.stays}`;
      all = await person(s, 'all@lodge.dev', ['planner'], [`${table}:create`, `${table}:delete`]);
      // Views the page and reads its table, and holds no right to write.
      reader = await person(s, 'reader@lodge.dev', [], [`${table}:read`, `page:${pageId}:view`]);
    }, 180_000);
    afterAll(async () => s?.close());

    it('offers nothing while every switch is off, whatever the person holds', async () => {
      await switches({});
      const setup = await on(all.id);
      expect(setup.proposable).toEqual([]);
      expect(setup.system).toContain('== What you may propose ==\nYou cannot change anything here; say so if asked.');
      expect(setup.system).not.toContain('"propose"');
    });

    it('offers a kind only where its switch is on and the person holds the right', async () => {
      await switches({ create: true, change: true, delete: true });
      expect((await on(all.id)).proposable).toEqual(['row.create', 'row.change', 'row.delete']);
      // The planner changes stays and nothing else.
      const desk = await on(night.id);
      expect(desk.proposable).toEqual(['row.change']);
      expect(desk.system).toContain('- row.change: change columns of ONE row you have read.');
      expect(desk.system).not.toContain('- row.create:');
      expect(desk.system).toContain(`Rows can be proposed on this page's own table only: connectionId ${JSON.stringify(s.connectionId)}, table ${JSON.stringify(s.table.stays)}.`);
      expect(desk.system).toMatch(/Not possible from here, so say so if asked: adding rows, deleting rows/);
      // Someone who only reads is offered nothing.
      expect((await on(reader.id)).proposable).toEqual([]);

      await switches({ create: true });
      expect((await on(all.id)).proposable).toEqual(['row.create']);
      expect((await on(night.id)).proposable).toEqual([]);
    });

    it('offers nothing away from a page that shows a table, and nothing to nobody', async () => {
      await switches({ create: true, change: true, delete: true });
      expect((await on(all.id, 'general')).proposable).toEqual([]);
      expect((await turnAs(s, all.id, 'data', { pageId: 'page_does_not_exist' })).proposable).toEqual([]);
    });

    it('says the workspace`s own number of actions', async () => {
      await switches({ change: true });
      await settingsRepo(s.meta).set('assistant.maxRows', 7);
      expect((await on(night.id)).system).toContain('At most 7 actions in one proposal.');
      await settingsRepo(s.meta).set('assistant.maxRows', 50);
    });

    it('stores a proposal as the model wrote it, unchecked, and changes no row', async () => {
      await switches({ change: true });
      const action = { do: 'row.change', connectionId: s.connectionId, table: s.table.stays, id: '1', values: { status: 'in_house' } };
      const { stored } = await turn(night.id, [reply({ propose: { title: 'Check Ana in', actions: [{ ...action, seen: { status: 'x' } }] } })]);
      expect(stored.status, JSON.stringify(stored.error)).toBe('done');
      expect(stored.result).toBeNull();
      expect((stored.answer as { proposal: unknown }).proposal).toEqual({ state: 'unchecked', title: 'Check Ana in', actions: [action], madeAt: 1_800_000_000_000 });
      const handle = await s.manager.data(s.connectionId);
      const rows = await sql<{ status: string }>`SELECT status FROM lodge_stays WHERE guest_name = 'Ana'`.execute(handle.db);
      expect(rows.rows[0]?.status).toBe('booked');
    });

    it('asks again for a proposal of a kind that is not offered, and fails the turn when it comes back', async () => {
      await switches({ change: true });
      const remove = { do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '1' };
      const { stored, scripted } = await turn(night.id, [
        reply({ propose: { title: 'Remove Ana', actions: [remove] } }),
        reply({ say: 'I cannot delete rows from here.' }),
      ]);
      expect(stored.status).toBe('done');
      expect(stored.say).toBe('I cannot delete rows from here.');
      expect(stored.answer).not.toHaveProperty('proposal');
      expect(JSON.stringify(scripted.calls[1])).toContain('\\"row.delete\\" cannot be proposed here');
    });

    it('treats a proposal as unreadable where nothing is offered', async () => {
      await switches({});
      const action = { do: 'row.change', connectionId: s.connectionId, table: s.table.stays, id: '1', values: { status: 'in_house' } };
      const { stored } = await turn(night.id, [
        reply({ propose: { title: 'x', actions: [action] } }),
        reply({ propose: { title: 'x', actions: [action] } }),
        reply({ propose: { title: 'x', actions: [action] } }),
        reply({ propose: { title: 'x', actions: [action] } }),
      ]);
      expect(stored.status).toBe('failed');
      expect(stored.answer ?? {}).not.toHaveProperty('proposal');
    });
  });
}
