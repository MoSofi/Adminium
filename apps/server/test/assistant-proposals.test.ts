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
 * - The check runs in the person's own request, through the routes their
 *   screen calls: what a route refuses is the refusal, what they are shown
 *   is what they may read, and nothing is written.
 * - A proposal is let go when the conversation moves on or its time passes.
 */
import { ASSISTANT_SCHEMA_VERSION } from '@adminium/llm';
import { assistantSessionsRepo, auditRepo, automationsRepo, emailTemplatesRepo, pagesRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOOR_HEADER, DOOR_ROUTES, doorPath, DoorRefusedError, isSafeSegment } from '../src/assistant/door.js';
import { endInterruptedProposals, storedProposalOf } from '../src/assistant/proposals.js';
import { documentColumns, normalizeDocument } from '../src/email/document.js';
import { executeAssistantTurn } from '../src/jobs/assistant-turn.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { legs, person, signIn, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';
import { makeScriptedClient } from './llm-fixtures.js';

const OFF = { create: false, change: false, send: false, delete: false };

/** Every address the door may build, written out: a route added to it is added here on purpose. */
const ALLOWED_DOOR_URLS = [
  '/api/v1/data/:connectionId/:table',
  '/api/v1/data/:connectionId/:table/dry-run',
  '/api/v1/data/:connectionId/:table/:recordId',
  '/api/v1/data/:connectionId/:table/:recordId/dry-run',
  '/api/v1/email-templates/:id',
  '/api/v1/report-documents/:id',
  '/api/v1/automations/:id',
  '/api/v1/email-templates/:id/audience/preview',
  '/api/v1/email-templates/:id/send',
];

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
    const turn = async (userId: string, replies: { text: string }[], at = Date.now(), inSession?: string, context: 'data' | 'general' | 'email' | 'report' | 'automation' = 'data', documentId?: string) => {
      const repo = assistantSessionsRepo(s.meta);
      const session = inSession === undefined ? await repo.create({ context, host: { connectionIds: [s.connectionId], ...(context === 'data' ? { pageId } : {}), ...(documentId === undefined ? {} : { documentId }) }, createdBy: userId }) : (await repo.findSession(inSession))!;
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
          now: () => at,
        },
      );
      return { stored: (await repo.findTurn(created.id))!, scripted, sessionId: session.id, repo };
    };

    beforeAll(async () => {
      s = await stack(dialect);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (1, '2026-11-01', '2026-12-01', 'Ana', 100, 'booked')`);
      pageId = (await pagesRepo(s.meta).listAll()).find((row) => row.title === 'Stays')!.id;
      // Reads and changes stays; may neither add nor delete one.
      night = await person(s, 'planner@lodge.dev', ['planner']);
      const table = `table:${s.connectionId}:${s.table.stays}`;
      // Reads every column of a stay, and adds, changes and deletes them.
      all = await person(s, 'all@lodge.dev', [], [`${table}:read`, `${table}:update`, `${table}:create`, `${table}:delete`, `page:${pageId}:view`]);
      // Views the page and reads its table, and holds no right to write.
      reader = await person(s, 'reader@lodge.dev', [], [`${table}:read`, `page:${pageId}:view`, 'system:assistant:use']);
      for (const who of [night, all]) {
        const role = await rolesRepo(s.meta).create({ slug: `milo-${who.id.slice(-8)}`, name: 'Uses the assistant' });
        for (const row of matrixRowsFromGrants(['system:assistant:use']).rows) await permissionsRepo(s.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
        await rolesRepo(s.meta).assignToUser(who.id, role.id);
      }
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

    it('offers nothing on a data page that is not there; away from any page the switches alone decide', async () => {
      await switches({ create: true, change: true, delete: true });
      expect((await turnAs(s, all.id, 'data', { pageId: 'page_does_not_exist' })).proposable).toEqual([]);
      const home = await on(all.id, 'general');
      expect(home.proposable).toEqual(['row.create', 'row.change', 'row.delete']);
      expect(home.system).toContain('Rows can be proposed on a table you have read with describe_schema');
      await switches({ delete: true });
      expect((await on(all.id, 'general')).proposable).toEqual(['row.delete']);
      await switches({});
      expect((await on(all.id, 'general')).proposable).toEqual([]);
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
      const { stored } = await turn(night.id, [reply({ propose: { title: 'Check Ana in', actions: [{ ...action, seen: { status: 'x' } }] } })], 1_800_000_000_000);
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

    // ── the check, in the person's own request ───────────────────────────────

    type Checked = { state: string; title?: string; hash?: string; expiresAt?: number; count?: number; refusal?: { code: string; count?: number; cap?: number }; actions?: { do: string; id?: string; seen?: Record<string, unknown>; preview?: Record<string, unknown>; refused?: { code: string; message: string } }[] };
    const proposed = async (who: { id: string }, actions: Record<string, unknown>[], at = Date.now()) => {
      const made = await turn(who.id, [reply({ propose: { title: 'A change', actions } })], at);
      expect(made.stored.status, JSON.stringify(made.stored.error)).toBe('done');
      return made;
    };
    const check = async (who: { cookie: string }, made: { sessionId: string; stored: { id: string } }) => {
      const res = await s.app.inject({ method: 'POST', url: `/api/v1/assistant/sessions/${made.sessionId}/turns/${made.stored.id}/actions`, headers: { cookie: who.cookie }, payload: { action: 'check' } });
      return { status: res.statusCode, proposal: (res.statusCode === 200 ? (res.json() as { proposal: Checked }).proposal : null) as Checked, body: res.body };
    };
    const stay = (id: string, values: Record<string, unknown>) => ({ do: 'row.change', connectionId: s.connectionId, table: s.table.stays, id, values });
    const statusOf = async (guest: string) => {
      const handle = await s.manager.data(s.connectionId);
      return (await sql<{ status: string }>`SELECT status FROM lodge_stays WHERE guest_name = ${guest}`.execute(handle.db)).rows[0]?.status;
    };

    it('tells a reader nothing of a proposal before its check, then shows the change as they read the row, and writes nothing', async () => {
      await switches({ create: true, change: true, delete: true });
      const made = await proposed(night, [stay('1', { status: 'in_house' })]);
      const before = await s.app.inject({ method: 'GET', url: `/api/v1/assistant/sessions/${made.sessionId}/turns/${made.stored.id}`, headers: { cookie: night.cookie } });
      expect(before.statusCode, before.body).toBe(200);
      expect(before.body).not.toContain('in_house');
      expect(before.body).toContain('"state":"unchecked"');

      const res = await check(night, made);
      expect(res.status, res.body).toBe(200);
      expect(res.proposal).toMatchObject({ state: 'open', title: 'A change' });
      expect(res.proposal.hash).toMatch(/^[0-9a-f]{64}$/);
      const [action] = res.proposal.actions!;
      expect(action).toMatchObject({ do: 'row.change', id: '1', seen: { status: 'booked' }, preview: { kind: 'change', before: { status: 'booked' }, after: { status: 'in_house' } } });
      // The planner reads four columns of a stay: nothing else of the row is in what they are shown.
      expect(res.body).not.toContain('Ana');
      expect(await statusOf('Ana')).toBe('booked');

      // Asked again, it is answered as it was stored: the same hash, no second run.
      const again = await check(night, made);
      expect(again.proposal.hash).toBe(res.proposal.hash);
      // And the turn now carries it for a reload.
      const after = await s.app.inject({ method: 'GET', url: `/api/v1/assistant/sessions/${made.sessionId}/turns/${made.stored.id}`, headers: { cookie: night.cookie } });
      expect(after.body).toContain(res.proposal.hash!);
    });

    it('refuses in the route`s own words what the screen would refuse, one action at a time', async () => {
      await switches({ create: true, change: true, delete: true });
      const made = await proposed(night, [
        stay('1', { guest_name: 'Someone else' }), // a column the planner does not read
        stay('1', { status: 'departed' }), // a move the table does not allow
        stay('999', { status: 'in_house' }), // no such row
        stay('1', { depart: '2026-12-01' }), // already so
        stay('1', { late_until: '14:00' }),
      ]);
      const { proposal, status, body } = await check(night, made);
      expect(status, body).toBe(200);
      expect(proposal.state).toBe('open');
      const codes = proposal.actions!.map((action) => action.refused?.code ?? 'ok');
      expect(codes.slice(2)).toEqual(['NOT_FOUND', 'NO_CHANGE', 'ok']);
      expect(codes[0]).not.toBe('ok');
      expect(codes[1]).not.toBe('ok');
      expect(proposal.actions![0]!.refused!.message).not.toBe('');
      expect(proposal.actions![4]).toMatchObject({ preview: { kind: 'change', after: { late_until: '14:00' } } });
      expect(body).not.toContain('Ana');
    });

    it('holds every action to the page`s own table and never sends a hostile id anywhere', async () => {
      await switches({ create: true, change: true, delete: true });
      const made = await proposed(all, [
        { do: 'row.change', connectionId: s.connectionId, table: s.table.rooms, id: '1', values: { number: '999' } },
        { do: 'row.delete', connectionId: '..', table: 'roles', id: 'abc' },
        { do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '../../roles' },
        { do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '..' },
        { do: 'row.change', connectionId: s.connectionId, table: s.table.stays, id: '1?confirm=true', values: { status: 'in_house' } },
      ]);
      const { proposal, body } = await check(all, made);
      expect(proposal.actions!.map((action) => action.refused?.code), body).toEqual(['NOT_THIS_TABLE', 'NOT_THIS_TABLE', 'UNSAFE_KEY', 'UNSAFE_KEY', 'UNSAFE_KEY']);
    });

    it('tries a new row and a delete as the person, and keeps neither', async () => {
      await switches({ create: true, change: true, delete: true });
      const made = await proposed(all, [
        { do: 'row.create', connectionId: s.connectionId, table: s.table.stays, values: { room_id: 1, arrive: '2026-12-01', depart: '2026-12-03', guest_name: 'Bo', status: 'booked' } },
        { do: 'row.create', connectionId: s.connectionId, table: s.table.stays, values: { arrive: 'not a date' } },
        { do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '1' },
      ]);
      const { proposal, body } = await check(all, made);
      expect(proposal.actions![0], body).toMatchObject({ preview: { kind: 'create', after: { arrive: '2026-12-01', status: 'booked' } } });
      expect(proposal.actions![1]!.refused, body).toBeDefined();
      expect(proposal.actions![2]).toMatchObject({ preview: { kind: 'delete', row: { status: 'booked' }, references: [] } });
      expect(await statusOf('Bo')).toBeUndefined();
      expect(await statusOf('Ana')).toBe('booked');
      // A new row is not theirs to propose for someone who may only change.
      const mine = await proposed(all, [{ do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '1' }]);
      const asPlanner = await check(night, mine);
      expect(asPlanner.status).toBe(404);
    });

    it('holds the switches and the cap as they are when it is checked', async () => {
      await switches({ change: true });
      const made = await proposed(night, [stay('1', { late_until: '15:00' })]);
      await switches({});
      expect((await check(night, made)).proposal.actions![0]!.refused).toMatchObject({ code: 'SWITCHED_OFF' });

      await switches({ change: true });
      const many = await proposed(night, [stay('1', { late_until: '15:00' }), stay('1', { late_until: '16:00' }), stay('1', { late_until: '17:00' })]);
      await settingsRepo(s.meta).set('assistant.maxRows', 2);
      const over = await check(night, many);
      await settingsRepo(s.meta).set('assistant.maxRows', 50);
      expect(over.proposal).toMatchObject({ state: 'refused', refusal: { code: 'OVER_CAP', count: 3, cap: 2 } });
      expect(over.proposal.actions!.every((action) => action.preview === undefined)).toBe(true);
    });

    it('lets a proposal go when the person asks anything else, and when its half hour has passed', async () => {
      await switches({ change: true });
      const made = await proposed(night, [stay('1', { late_until: '15:00' })]);
      const open = await check(night, made);
      expect(open.proposal.state).toBe('open');
      await made.repo.createTurn({ sessionId: made.sessionId, askText: 'Never mind. How many stays are booked?' });
      const moved = await check(night, made);
      expect(moved.proposal).toEqual({ state: 'superseded', title: 'A change', madeAt: expect.any(Number) as number, count: 1 });
      expect(moved.body).not.toContain('15:00');

      const old = await proposed(night, [stay('1', { late_until: '15:00' })], Date.now() - 31 * 60_000);
      const late = await check(night, old);
      expect(late.proposal).toMatchObject({ state: 'expired', count: 1 });
      expect(late.body).not.toContain('15:00');
    });

    it('answers a turn that proposed nothing, and someone else`s turn, as it should', async () => {
      await switches({ change: true });
      const plain = await turn(night.id, [reply({})]);
      expect((await check(night, plain)).status).toBe(422);
      const made = await proposed(night, [stay('1', { late_until: '15:00' })]);
      expect((await check(all, made)).status).toBe(404);
    });


    // ── the confirm ──────────────────────────────────────────────────────────

    type Applied = { status: number; body: string; proposal: Checked & { picked?: number[]; outcome?: { done: { index: number; id: string | null }[]; failed: { index: number; code: string }[]; notTried: number[]; unsure?: number[] } }; undo: { index: number; token: string }[]; reason?: string };
    const apply = async (who: { cookie: string }, made: { sessionId: string; stored: { id: string } }, hash: string | undefined, pick?: number[]): Promise<Applied> => {
      const res = await s.app.inject({
        method: 'POST',
        url: `/api/v1/assistant/sessions/${made.sessionId}/turns/${made.stored.id}/actions`,
        headers: { cookie: who.cookie, 'user-agent': 'Panel/1.0' },
        remoteAddress: '10.9.8.7',
        payload: { action: 'apply', ...(hash === undefined ? {} : { hash }), ...(pick === undefined ? {} : { pick }) },
      });
      const json = res.json() as { proposal?: Applied['proposal']; undo?: Applied['undo']; error?: { details?: { reason?: string; proposal?: Applied['proposal'] } } };
      return { status: res.statusCode, body: res.body, proposal: (json.proposal ?? json.error?.details?.proposal) as Applied['proposal'], undo: json.undo ?? [], ...(json.error?.details?.reason === undefined ? {} : { reason: json.error.details.reason }) };
    };
    const lateOf = async (id: number) => {
      const handle = await s.manager.data(s.connectionId);
      return (await sql<{ late: string | null }>`SELECT late_until AS late FROM lodge_stays WHERE id = ${id}`.execute(handle.db)).rows[0]?.late ?? null;
    };
    const setLate = (id: number, value: string | null) => s.run(`UPDATE lodge_stays SET late_until = ${value === null ? 'NULL' : `'${value}'`} WHERE id = ${String(id)}`);

    it('writes what was confirmed as the person, once, and the audit says it came through the assistant', async () => {
      await switches({ create: true, change: true });
      await setLate(1, null);
      const made = await proposed(night, [stay('1', { late_until: '14:00' })]);
      // Not before its check.
      expect((await apply(night, made, 'a'.repeat(64))).status).toBe(422);
      const shown = await check(night, made);
      // Not with another hash, and not without one.
      const wrong = await apply(night, made, 'b'.repeat(64));
      expect(wrong).toMatchObject({ status: 409, reason: 'proposal-changed' });
      expect((await apply(night, made, undefined)).status).toBe(422);
      expect(await lateOf(1)).toBeNull();

      const done = await apply(night, made, shown.proposal.hash);
      expect(done.status, done.body).toBe(200);
      expect(done.proposal).toMatchObject({ state: 'applied', picked: [0], outcome: { done: [{ index: 0, id: '1' }], failed: [], notTried: [] } });
      expect(await lateOf(1)).toBe('14:00');

      const [entry] = await auditRepo(s.meta).list({ actorId: night.id, category: 'data' });
      expect(entry).toMatchObject({ action: 'record.update', actorKind: 'user', actorId: night.id, ip: '10.9.8.7', userAgent: 'Panel/1.0' });
      expect((entry!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: made.sessionId, turnId: made.stored.id } });

      // A second confirm finds it spent and writes nothing more.
      await setLate(1, '09:00');
      const again = await apply(night, made, shown.proposal.hash);
      expect(again).toMatchObject({ status: 409, reason: 'proposal-spent', proposal: { state: 'applied' } });
      expect(await lateOf(1)).toBe('09:00');

      // What the turn keeps: the outcome, and neither a preview nor a token.
      const kept = await s.app.inject({ method: 'GET', url: `/api/v1/assistant/sessions/${made.sessionId}/turns/${made.stored.id}`, headers: { cookie: night.cookie } });
      expect(kept.body).toContain('"state":"applied"');
      expect(kept.body).not.toContain('preview');
      for (const { token } of done.undo) expect(kept.body).not.toContain(token);

      // The person's own save on the screen carries no such mark.
      const own = await s.app.inject({ method: 'PATCH', url: `/api/v1/data/${s.connectionId}/${s.table.stays}/1`, headers: { cookie: night.cookie }, payload: { values: { late_until: '10:00' } } });
      expect(own.statusCode, own.body).toBe(200);
      const [plain] = await auditRepo(s.meta).list({ actorId: night.id, category: 'data' });
      expect(plain!.changes).not.toHaveProperty('via');
    });

    it('lets one of two confirms sent at once through', async () => {
      await switches({ change: true });
      await setLate(1, null);
      const made = await proposed(night, [stay('1', { late_until: '15:00' })]);
      const { proposal } = await check(night, made);
      const both = await Promise.all([apply(night, made, proposal.hash), apply(night, made, proposal.hash)]);
      expect(both.map((one) => one.status).sort()).toEqual([200, 409]);
      const writes = (await auditRepo(s.meta).list({ actorId: night.id, category: 'data' })).filter((row) => (row.changes as { via?: { assistant?: { turnId?: string } } } | null)?.via?.assistant?.turnId === made.stored.id);
      expect(writes).toHaveLength(1);
    });

    it('shows the difference and asks again when a row moved since the check, a switch was turned off, or the cap was lowered', async () => {
      await switches({ change: true });
      await setLate(1, null);
      const made = await proposed(night, [stay('1', { late_until: '16:00' })]);
      const shown = await check(night, made);
      expect(shown.proposal.actions![0]!.preview).toMatchObject({ before: { late_until: null } });
      // Someone else changed the row.
      await setLate(1, '11:00');
      const moved = await apply(night, made, shown.proposal.hash);
      expect(moved).toMatchObject({ status: 409, reason: 'proposal-changed', proposal: { state: 'open' } });
      expect(moved.proposal.hash).not.toBe(shown.proposal.hash);
      expect(moved.proposal.actions![0]).toMatchObject({ seen: { late_until: '11:00' }, preview: { before: { late_until: '11:00' }, after: { late_until: '16:00' } } });
      expect(await lateOf(1)).toBe('11:00');

      // Switched off meanwhile: nothing is written, and the card says why.
      await switches({});
      const off = await apply(night, made, moved.proposal.hash);
      expect(off).toMatchObject({ status: 409, reason: 'proposal-changed' });
      expect(off.proposal.actions![0]!.refused).toMatchObject({ code: 'SWITCHED_OFF' });
      expect(await lateOf(1)).toBe('11:00');

      await switches({ change: true });
      const two = await proposed(night, [stay('1', { late_until: '17:00' }), stay('1', { depart: '2026-12-05' })]);
      const both = await check(night, two);
      const one = await proposed(night, [stay('1', { late_until: '17:00' }), stay('1', { depart: '2026-12-05' })]);
      const oneShown = await check(night, one);
      await settingsRepo(s.meta).set('assistant.maxRows', 1);
      const over = await apply(night, two, both.proposal.hash);
      // One of the two, ticked, is within the number.
      const picked = await apply(night, one, oneShown.proposal.hash, [1]);
      await settingsRepo(s.meta).set('assistant.maxRows', 50);
      expect(over).toMatchObject({ status: 409, proposal: { state: 'refused', refusal: { code: 'OVER_CAP', count: 2, cap: 1 } } });
      expect(picked.status, picked.body).toBe(200);
      expect(picked.proposal).toMatchObject({ picked: [1], outcome: { done: [{ index: 1 }] } });
      expect(await lateOf(1)).toBe('11:00');
    });

    it('refuses a pick of something that cannot be done, and reports a row the route refuses at the write', async () => {
      await switches({ change: true });
      await setLate(1, null);
      const made = await proposed(night, [stay('1', { late_until: '18:00' }), stay('999', { late_until: '18:00' })]);
      const shown = await check(night, made);
      expect((await apply(night, made, shown.proposal.hash, [1])).status).toBe(422);
      expect((await apply(night, made, shown.proposal.hash, [0, 7])).status).toBe(422);
      // Left out, the pick is every action that can be done.
      const done = await apply(night, made, shown.proposal.hash);
      expect(done.proposal).toMatchObject({ state: 'applied', picked: [0], outcome: { done: [{ index: 0 }] } });
    });

    it('adds a row as the person and names it', async () => {
      await switches({ create: true });
      const made = await proposed(all, [{ do: 'row.create', connectionId: s.connectionId, table: s.table.stays, values: { room_id: 1, arrive: '2027-01-01', depart: '2027-01-03', guest_name: 'Cleo', status: 'booked' } }]);
      const shown = await check(all, made);
      const done = await apply(all, made, shown.proposal.hash);
      expect(done.status, done.body).toBe(200);
      const id = done.proposal.outcome!.done[0]!.id;
      expect(id).toMatch(/^\d+$/);
      expect(await statusOf('Cleo')).toBe('booked');
      const [entry] = await auditRepo(s.meta).list({ actorId: all.id, category: 'data' });
      expect(entry).toMatchObject({ action: 'record.create' });
      expect((entry!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: made.sessionId, turnId: made.stored.id } });
      await s.run(`DELETE FROM lodge_stays WHERE guest_name = 'Cleo'`);
    });

    it('ends a confirm that died with its process: what was written is kept, the row in flight is not known, the rest was not tried', async () => {
      await switches({ change: true });
      const made = await proposed(night, [stay('1', { late_until: '19:00' }), stay('1', { depart: '2026-12-06' }), stay('1', { arrive: '2026-11-02' })]);
      await check(night, made);
      const repo = assistantSessionsRepo(s.meta);
      const turnRow = (await repo.findTurn(made.stored.id))!;
      const open = storedProposalOf(turnRow.answer)!;
      expect(await repo.claimProposal(made.stored.id, Date.now())).toBe(true);
      expect(await repo.claimProposal(made.stored.id, Date.now())).toBe(false);
      await repo.recordAnswer(made.stored.id, { ...turnRow.answer, proposal: { ...open, state: 'applying', picked: [0, 1, 2], outcome: { done: [{ index: 0, id: '1' }], failed: [], notTried: [] } } });
      expect(await endInterruptedProposals(repo, Date.now())).toBeGreaterThanOrEqual(1);
      const ended = storedProposalOf((await repo.findTurn(made.stored.id))!.answer)!;
      expect(ended).toMatchObject({ state: 'interrupted', outcome: { done: [{ index: 0 }], unsure: [1], notTried: [2] } });
      // Ended once: a second start finds nothing left of it.
      expect((await repo.listUnfinishedProposals()).some((row) => row.id === made.stored.id)).toBe(false);
      // And it cannot be confirmed again.
      expect((await apply(night, made, open.hash)).status).toBe(409);
    });

    it('tells the model what became of its proposal, and never what the person was shown', async () => {
      await switches({ change: true });
      await setLate(1, null);
      const made = await proposed(night, [stay('1', { late_until: '20:00' }), stay('999', { late_until: '20:00' })]);
      const shown = await check(night, made);
      // Asked something else before confirming: it was not confirmed.
      const other = await proposed(night, [stay('1', { late_until: '21:00' })]);
      await check(night, other);
      const after = await turn(night.id, [reply({})], Date.now(), other.sessionId);
      const told = JSON.stringify(after.scripted.calls[0]!.messages);
      expect(told).toContain('proposal_outcome');
      expect(told).toContain('\\"confirmed\\":false');
      expect(told).not.toContain('preview');

      await apply(night, made, shown.proposal.hash);
      const next = await turn(night.id, [reply({})], Date.now(), made.sessionId);
      const heard = JSON.stringify(next.scripted.calls[0]!.messages);
      expect(heard).toContain('\\"confirmed\\":true');
      expect(heard).toContain('\\"done\\":[{\\"action\\":0,\\"id\\":\\"1\\"}]');
      expect(heard).not.toContain('preview');
      expect(heard).not.toContain('undoToken');
    });

    it('marks what a rule writes because of a confirmed change, and leaves a rule fired by a plain save unmarked', async () => {
      await switches({ change: true });
      const owner = await signIn(s.app, 'owner@lodge.dev');
      const rule = await s.app.inject({
        method: 'POST',
        url: '/api/v1/automations',
        headers: { cookie: owner },
        payload: {
          name: 'Note a late leaving',
          connectionId: s.connectionId,
          trigger: { kind: 'record', connectionId: s.connectionId, table: s.table.stays, event: 'updated', when: [] },
          graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Note it', onError: false, action: { kind: 'record.update', values: { note: 'late leaving asked' } } }] },
          enabled: true,
        },
      });
      expect(rule.statusCode, rule.body).toBe(201);
      // A run started by a person's write waits out the undo minute; the test does not.
      const dueNow = async () => {
        await s.meta.db.updateTable('adminium_jobs').set({ runAt: 0 }).where('status', '=', 'pending').execute();
        await s.meta.db.updateTable('adminium_automation_runs').set({ wakeAt: 0 }).where('status', '=', 'pending').execute();
      };
      const ruleId = (rule.json() as { data?: { id: string }; id?: string }).data?.id ?? (rule.json() as { id: string }).id;
      try {
        await setLate(1, null);
        await s.run(`UPDATE lodge_stays SET note = NULL WHERE id = 1`);
        const made = await proposed(night, [stay('1', { late_until: '22:00' })]);
        const shown = await check(night, made);
        expect((await apply(night, made, shown.proposal.hash)).status).toBe(200);
        await dueNow();
        await s.runJobs();
        const byRule = (await auditRepo(s.meta).list({ category: 'automation' })).filter((row) => row.action === 'record.update' && row.actorKind === 'automation');
        expect(byRule.length, 'the rule wrote').toBeGreaterThanOrEqual(1);
        expect((byRule[0]!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: made.sessionId, turnId: made.stored.id } });

        // The person's own save starts the same rule, and that run's write carries no mark.
        await s.run(`UPDATE lodge_stays SET note = NULL WHERE id = 1`);
        const own = await s.app.inject({ method: 'PATCH', url: `/api/v1/data/${s.connectionId}/${s.table.stays}/1`, headers: { cookie: night.cookie }, payload: { values: { late_until: '23:00' } } });
        expect(own.statusCode, own.body).toBe(200);
        await dueNow();
        await s.runJobs();
        const [latest] = (await auditRepo(s.meta).list({ category: 'automation' })).filter((row) => row.action === 'record.update' && row.actorKind === 'automation');
        expect(latest!.changes).not.toHaveProperty('via');
      } finally {
        await s.app.inject({ method: 'DELETE', url: `/api/v1/automations/${ruleId}`, headers: { cookie: owner } });
      }
    });

    it('offers no undo where the table`s own save offers none (a table that keeps states)', async () => {
      await switches({ change: true });
      await setLate(1, '08:00');
      const made = await proposed(all, [stay('1', { late_until: '12:30' })]);
      const shown = await check(all, made);
      const done = await apply(all, made, shown.proposal.hash);
      expect(done.status, done.body).toBe(200);
      // The same answer the screen's own save gets for this table: no token, so no button.
      const own = await s.app.inject({ method: 'PATCH', url: `/api/v1/data/${s.connectionId}/${s.table.stays}/1`, headers: { cookie: all.cookie }, payload: { values: { late_until: '12:45' } } });
      expect((own.json() as { undoToken: string | null }).undoToken).toBeNull();
      expect(done.undo).toEqual([]);
    });

    // ── deletes, and the assistant away from any page ────────────────────────

    const proposedAtHome = async (who: { id: string }, actions: Record<string, unknown>[]) => {
      const made = await turn(who.id, [reply({ propose: { title: 'A change', actions } })], Date.now(), undefined, 'general');
      expect(made.stored.status, JSON.stringify(made.stored.error)).toBe('done');
      return made;
    };
    const room = (doing: 'row.change' | 'row.delete', id: string, values?: Record<string, unknown>) => ({ do: doing, connectionId: s.connectionId, table: s.table.rooms, id, ...(values === undefined ? {} : { values }) });
    const roomId = async (number: string) => {
      const handle = await s.manager.data(s.connectionId);
      const found = (await sql<{ id: number }>`SELECT id FROM lodge_rooms WHERE number = ${number}`.execute(handle.db)).rows[0];
      return found === undefined ? null : String(found.id);
    };

    it('deletes a row as the person on the page`s table, and hands the screen`s own undo when there is one', async () => {
      await switches({ delete: true });
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (1, '2027-02-01', '2027-02-02', 'Dov', 10, 'booked')`);
      const handle = await s.manager.data(s.connectionId);
      const id = String((await sql<{ id: number }>`SELECT id FROM lodge_stays WHERE guest_name = 'Dov'`.execute(handle.db)).rows[0]!.id);
      const made = await proposed(all, [{ do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id }]);
      const shown = await check(all, made);
      expect(shown.proposal.actions![0]).toMatchObject({ preview: { kind: 'delete', row: { guest_name: 'Dov' }, references: [] } });
      expect(await statusOf('Dov')).toBe('booked');
      const done = await apply(all, made, shown.proposal.hash);
      expect(done.proposal, done.body).toMatchObject({ state: 'applied', outcome: { done: [{ index: 0, id }], failed: [] } });
      expect(await statusOf('Dov')).toBeUndefined();
      const [entry] = await auditRepo(s.meta).list({ actorId: all.id, category: 'data' });
      expect(entry).toMatchObject({ action: 'record.delete' });
      expect((entry!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: made.sessionId, turnId: made.stored.id } });
      // Someone who may not delete is refused by the route, at the check.
      await switches({ change: true, delete: true });
      // Someone who may not delete is not offered it: the reply is unreadable there.
      const no = await turn(night.id, [reply({ propose: { title: 'x', actions: [{ do: 'row.delete', connectionId: s.connectionId, table: s.table.stays, id: '1' }] } })]);
      expect(no.stored.status).toBe('failed');
    });

    it('away from any page: writes a table the person may write, by the view`s own ids, and its undo is theirs alone', async () => {
      await switches({ create: true, change: true, delete: true });
      const rooms = `table:${s.connectionId}:${s.table.rooms}`;
      const keeper = await person(s, 'keeper@lodge.dev', [], [`${rooms}:read`, `${rooms}:update`, `${rooms}:delete`, 'system:assistant:use']);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('501')`);
      const id = (await roomId('501'))!;
      const made = await proposedAtHome(keeper, [room('row.change', id, { number: '502' })]);
      const shown = await check(keeper, made);
      expect(shown.proposal.actions![0], shown.body).toMatchObject({ table: s.table.rooms, preview: { kind: 'change', before: { number: '501' }, after: { number: '502' } } });
      const done = await apply(keeper, made, shown.proposal.hash);
      expect(done.status, done.body).toBe(200);
      expect(await roomId('502')).toBe(id);
      expect(done.undo).toHaveLength(1);
      const undone = await s.app.inject({ method: 'POST', url: `/api/v1/data/undo/${done.undo[0]!.token}`, headers: { cookie: keeper.cookie } });
      expect(undone.statusCode, undone.body).toBe(200);
      expect(await roomId('501')).toBe(id);
      // Another person holding the token of a second change gets nothing from it.
      const second = await proposedAtHome(keeper, [room('row.change', id, { number: '503' })]);
      const again = await apply(keeper, second, (await check(keeper, second)).proposal.hash);
      const stolen = await s.app.inject({ method: 'POST', url: `/api/v1/data/undo/${again.undo[0]!.token}`, headers: { cookie: all.cookie } });
      expect(stolen.statusCode).not.toBe(200);
      expect(await roomId('503')).toBe(id);

      // A table they do not read, one that is not there, Adminium's own, and a connection that is not theirs.
      const hostile = await proposedAtHome(keeper, [
        { do: 'row.change', connectionId: s.connectionId, table: s.table.stays, id: '1', values: { late_until: '01:00' } },
        { do: 'row.delete', connectionId: s.connectionId, table: 'no_such_table', id: '1' },
        { do: 'row.delete', connectionId: s.connectionId, table: 'adminium_users', id: '1' },
        { do: 'row.delete', connectionId: '..', table: 'roles', id: 'abc' },
        { do: 'row.delete', connectionId: 'conn_someone_elses', table: s.table.rooms, id: '1' },
      ]);
      const refused = await check(keeper, hostile);
      expect(refused.proposal.actions!.map((action) => action.refused?.code), refused.body).toEqual(['NOT_A_DATA_TABLE', 'NOT_A_DATA_TABLE', 'NOT_A_DATA_TABLE', 'NOT_A_DATA_TABLE', 'NOT_A_DATA_TABLE']);
    });

    it('shows what a delete would take with it, and asks again when that changed before the confirm', async () => {
      await switches({ delete: true });
      const rooms = `table:${s.connectionId}:${s.table.rooms}`;
      const keeper = await person(s, 'keeper2@lodge.dev', [], [`${rooms}:read`, `${rooms}:update`, `${rooms}:delete`, 'system:assistant:use']);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('601')`);
      const id = (await roomId('601'))!;
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (${id}, '2027-03-01', '2027-03-02', 'Eve', 10, 'booked')`);
      const made = await proposedAtHome(keeper, [room('row.delete', id)]);
      const shown = await check(keeper, made);
      const preview = shown.proposal.actions![0]!.preview as { kind: string; references: { table: string; count: number }[] };
      expect(preview.kind, shown.body).toBe('delete');
      expect(preview.references.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
      // Another stay arrives in that room: what was shown is no longer what would go.
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (${id}, '2027-03-03', '2027-03-04', 'Fay', 10, 'booked')`);
      const moved = await apply(keeper, made, shown.proposal.hash);
      expect(moved).toMatchObject({ status: 409, reason: 'proposal-changed' });
      expect((moved.proposal.actions![0]!.preview as typeof preview).references.reduce((sum, entry) => sum + entry.count, 0)).toBe(2);
      expect(await roomId('601')).toBe(id);
      // Confirmed as now shown, it is sent as the screen sends it: with what refers to it acknowledged.
      const done = await apply(keeper, made, moved.proposal.hash);
      expect(done.status, done.body).toBe(200);
      const direct = done.proposal.outcome!;
      expect(direct.done.length + direct.failed.length).toBe(1);
      if (direct.done.length === 1) expect(await roomId('601')).toBeNull();
      await s.run(`DELETE FROM lodge_stays WHERE guest_name IN ('Eve', 'Fay')`);
    });

    // ── a workspace document, through its own page's route ───────────────────

    it('saves a draft over the open template and deletes one, as the person, by the pages` own routes, marked in the audit', async () => {
      await switches({ create: true, change: true, delete: true });
      const ownerCookie = await signIn(s.app, 'owner@lodge.dev');
      const owner = { cookie: ownerCookie, id: (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id };
      const templates = emailTemplatesRepo(s.meta);
      const make = (name: string) =>
        templates.create({ kind: 'template', key: `p64-${name.toLowerCase()}-${dialect}`, locale: 'en_US', name, category: 'lifecycle', starter: null, enabled: true, createdBy: owner.id, ...documentColumns(normalizeDocument({ subject: 'Old subject', blocks: [] } as never)) });
      const open = await make('Open');
      const gone = await make('Goes');
      const draft = { title: 'Welcome', meta: '', artefact: { kind: 'template', name: 'Renamed by the model', locale: 'en_US', document: { subject: 'New subject', blocks: [{ block: 'email.heading', data: { text: 'Hi' } }] } } };

      const change = await turn(owner.id, [reply({ result: draft, propose: { title: 'Save over it', actions: [{ do: 'doc.change' }] } })], Date.now(), undefined, 'email', open.id);
      expect(change.stored.status, JSON.stringify(change.stored.error)).toBe('done');
      const shown = await check(owner, change);
      expect(shown.proposal.actions![0], shown.body).toMatchObject({ preview: { kind: 'doc.change', what: 'email', id: open.id, name: 'Open' } });
      const done = await apply(owner, change, shown.proposal.hash);
      expect(done.proposal.outcome, done.body).toMatchObject({ done: [{ index: 0, id: open.id }], failed: [] });
      // The draft's content; the document's own name and whether it is live are kept.
      expect(await templates.findById(open.id)).toMatchObject({ subject: 'New subject', name: 'Open', enabled: true });
      const [saved] = await auditRepo(s.meta).list({ actorId: owner.id, category: 'settings', limit: 1 });
      expect((saved!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: change.sessionId, turnId: change.stored.id } });

      const remove = await turn(owner.id, [reply({ propose: { title: 'Tidy up', actions: [{ do: 'doc.delete', kind: 'email', id: gone.id }] } })], Date.now(), undefined, 'email');
      const asked = await check(owner, remove);
      expect(asked.proposal.actions![0], asked.body).toMatchObject({ preview: { kind: 'doc.delete', what: 'email', id: gone.id, name: 'Goes' } });
      expect(await templates.findById(gone.id)).not.toBeNull();
      const removed = await apply(owner, remove, asked.proposal.hash);
      expect(removed.proposal.outcome, removed.body).toMatchObject({ done: [{ index: 0, id: gone.id }], failed: [] });
      expect(await templates.findById(gone.id)).toBeNull();
      const [deleted] = await auditRepo(s.meta).list({ actorId: owner.id, category: 'settings', limit: 1 });
      expect(deleted).toMatchObject({ action: 'email-template.delete' });
      expect((deleted!.changes as { via?: unknown }).via).toEqual({ assistant: { sessionId: remove.sessionId, turnId: remove.stored.id } });

      // Deleted between the check and the confirm: the confirm shows that, and writes nothing.
      const late = await turn(owner.id, [reply({ propose: { title: 'Tidy up', actions: [{ do: 'doc.delete', kind: 'email', id: open.id }] } })], Date.now(), undefined, 'email');
      const lateShown = await check(owner, late);
      await templates.removeById(open.id);
      const missed = await apply(owner, late, lateShown.proposal.hash);
      expect(missed).toMatchObject({ status: 409, reason: 'proposal-changed' });
      expect(missed.proposal.actions![0]!.refused).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('sends a campaign only as the page`s own route would: to roles the server finds, counted first, refused in the route`s words', async () => {
      await switches({ send: true });
      const ownerCookie = await signIn(s.app, 'owner@lodge.dev');
      const owner = { cookie: ownerCookie, id: (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id };
      const templates = emailTemplatesRepo(s.meta);
      const make = (name: string, kind: 'campaign' | 'template') =>
        templates.create({ kind, key: `p64-${name.toLowerCase()}-${dialect}`, locale: 'en_US', name, category: 'lifecycle', starter: null, enabled: true, createdBy: owner.id, ...documentColumns(normalizeDocument({ subject: 'Winter hours', blocks: [] } as never)) });
      const campaign = await make('News', 'campaign');
      const plain = await make('Receipt', 'template');
      const send = (templateId: string, roles: string[]) => ({ do: 'send.template', templateId, roles });

      const made = await turn(owner.id, [reply({ propose: { title: 'Send the news', actions: [send(campaign.id, ['planner', 'Planner']), send(plain.id, ['Planner']), send(campaign.id, ['Nobody at all']), send('tpl_nothing', ['Planner'])] } })], Date.now(), undefined, 'email');
      expect(made.stored.status, JSON.stringify(made.stored.error)).toBe('done');
      expect(made.scripted.calls[0]!.system).toContain('"send.template" takes the id of a CAMPAIGN');
      const shown = await check(owner, made);
      const [first, second, third, fourth] = shown.proposal.actions!;
      expect(first, shown.body).toMatchObject({ preview: { kind: 'send.template', id: campaign.id, name: 'News', subject: 'Winter hours', roles: [{ name: 'Planner' }] } });
      expect((first!.preview as { total: number }).total).toBeGreaterThanOrEqual(1);
      expect([second!.refused?.code, third!.refused?.code, fourth!.refused?.code]).toEqual(['NOT_A_CAMPAIGN', 'UNKNOWN_ROLE', 'NOT_FOUND']);

      // No mail server is set up on this workspace: the page's own route says so, and nothing is queued.
      const done = await apply(owner, made, shown.proposal.hash);
      expect(done.status, done.body).toBe(200);
      expect(done.proposal.outcome!.done).toEqual([]);
      expect(done.proposal.outcome!.failed[0]).toMatchObject({ index: 0, code: 'CONFLICT' });
      expect(done.body).toContain('SMTP');

      // Switched off, it is not a move at all.
      await switches({ create: true, change: true, delete: true });
      const off = await turn(owner.id, [reply({ propose: { title: 'Send the news', actions: [send(campaign.id, ['Planner'])] } })], Date.now(), undefined, 'email');
      expect(off.scripted.calls[0]!.system).not.toContain('- send.template:');
      expect(off.stored.status).toBe('failed');
    });

    it('saves over an open report, and saves a rule that is on switched off, saying so first', async () => {
      await switches({ create: true, change: true, delete: true });
      const ownerCookie = await signIn(s.app, 'owner@lodge.dev');
      const owner = { cookie: ownerCookie, id: (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id };

      // A report, made by its own page.
      const report = await s.app.inject({ method: 'POST', url: '/api/v1/report-documents', headers: { cookie: ownerCookie }, payload: { kind: 'template', name: 'Weekly' } });
      expect(report.statusCode, report.body).toBeLessThan(300);
      const reportId = ((report.json() as { id?: string; document?: { id: string } }).id ?? (report.json() as { document: { id: string } }).document.id);
      const body = { blocks: [{ kind: 'heading', title: 'Section', text: 'Occupancy' }] };
      const made = await turn(owner.id, [reply({ result: { title: 'Weekly', meta: '', artefact: { name: 'Another name', body } }, propose: { title: 'Save over it', actions: [{ do: 'doc.change' }] } })], Date.now(), undefined, 'report', reportId);
      expect(made.stored.status, JSON.stringify(made.stored.error)).toBe('done');
      const shown = await check(owner, made);
      expect(shown.proposal.actions![0], shown.body).toMatchObject({ preview: { kind: 'doc.change', what: 'report', id: reportId, name: 'Weekly' } });
      const done = await apply(owner, made, shown.proposal.hash);
      expect(done.proposal.outcome, done.body).toMatchObject({ done: [{ index: 0, id: reportId }], failed: [] });
      const kept = await s.app.inject({ method: 'GET', url: `/api/v1/report-documents/${reportId}`, headers: { cookie: ownerCookie } });
      expect(kept.body).toContain('Occupancy');
      expect(kept.body).toContain('Weekly');

      // A rule that is running.
      const trigger = { kind: 'record', connectionId: s.connectionId, table: s.table.stays, event: 'updated', when: [] };
      const graph = (note: string) => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Note it', onError: false, action: { kind: 'record.update', values: { note } } }] });
      const rule = await s.app.inject({ method: 'POST', url: '/api/v1/automations', headers: { cookie: ownerCookie }, payload: { name: 'Note it', connectionId: s.connectionId, trigger, graph: graph('old'), enabled: true } });
      expect(rule.statusCode, rule.body).toBe(201);
      const ruleId = (rule.json() as { data?: { id: string }; id?: string }).data?.id ?? (rule.json() as { id: string }).id;
      try {
        const changed = await turn(owner.id, [reply({ result: { title: 'Note it', meta: '', artefact: { name: 'Note it', trigger, graph: graph('new') } }, propose: { title: 'Save over it', actions: [{ do: 'doc.change' }] } })], Date.now(), undefined, 'automation', ruleId);
        expect(changed.stored.status, JSON.stringify(changed.stored.error)).toBe('done');
        const asked = await check(owner, changed);
        expect(asked.proposal.actions![0], asked.body).toMatchObject({ preview: { kind: 'doc.change', what: 'rule', id: ruleId, name: 'Note it', switchesOff: true } });
        const saved = await apply(owner, changed, asked.proposal.hash);
        expect(saved.proposal.outcome, saved.body).toMatchObject({ done: [{ index: 0, id: ruleId }], failed: [] });
        const now = await automationsRepo(s.meta).findById(ruleId);
        expect(now?.enabled).toBe(false);
        expect(JSON.stringify(now?.graph)).toContain('"new"');

        const remove = await turn(owner.id, [reply({ propose: { title: 'Remove it', actions: [{ do: 'doc.delete', kind: 'rule', id: ruleId }] } })], Date.now(), undefined, 'automation');
        const last = await check(owner, remove);
        expect(last.proposal.actions![0], last.body).toMatchObject({ preview: { kind: 'doc.delete', what: 'rule', id: ruleId, name: 'Note it' } });
        expect((await apply(owner, remove, last.proposal.hash)).proposal.outcome).toMatchObject({ done: [{ index: 0, id: ruleId }] });
        expect(await automationsRepo(s.meta).findById(ruleId)).toBeNull();
      } finally {
        await s.app.inject({ method: 'DELETE', url: `/api/v1/automations/${ruleId}`, headers: { cookie: ownerCookie } });
      }
    });

    // ── the door ─────────────────────────────────────────────────────────────

    it('refuses the door`s header from outside, whatever it carries', async () => {
      for (const value of ['made-up', '']) {
        const res = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${s.table.stays}/1`, headers: { cookie: all.cookie, [DOOR_HEADER]: value } });
        expect(res.statusCode, res.body).toBe(403);
      }
      // Without it the same request is the person's own.
      const plain = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${s.table.stays}/1`, headers: { cookie: all.cookie } });
      expect(plain.statusCode).toBe(200);
    });

    it('reaches only routes this server has, and none that hands out rights, keys or settings', () => {
      const never = ['roles', 'users', 'permissions', 'api-keys', 'settings', 'llm', 'assistant', 'connections', 'schema', 'apps', 'add-ons', 'project', 'designer', 'auth', 'setup', 'system'];
      for (const [key, route] of Object.entries(DOOR_ROUTES)) {
        expect(s.app.hasRoute({ method: route.method, url: route.url }), key).toBe(true);
        // A row of the person's data, one of the three kinds of workspace document by its id, or a campaign's send. Nothing else.
        expect(ALLOWED_DOOR_URLS, `${key}: ${route.url}`).toContain(route.url);
        for (const prefix of never) expect(route.url.startsWith(`/api/v1/${prefix}`), `${key} under ${prefix}`).toBe(false);
      }
    });
  });
}

describe('the door`s addresses', () => {
  it('builds a path from the listed pattern and encodes what it is given', () => {
    expect(doorPath('row.read', { connectionId: 'c 1', table: 'main.stays', recordId: 'a&b=c' })).toBe('/api/v1/data/c%201/main.stays/a%26b%3Dc');
    expect(doorPath('row.delete.try', { connectionId: 'c1', table: 't', recordId: '7' })).toBe('/api/v1/data/c1/t/7?dryRun=true');
  });

  it('refuses a segment that could change the path, and a missing one', () => {
    for (const hostile of ['', '.', '..', 'a/b', 'a\\b', 'a?b', 'a#b', '%2e%2e', 'a\u0000b', 'a\nb', 'x'.repeat(513)]) {
      expect(isSafeSegment(hostile), JSON.stringify(hostile)).toBe(false);
      expect(() => doorPath('row.read', { connectionId: 'c1', table: 't', recordId: hostile })).toThrow(DoorRefusedError);
      expect(() => doorPath('row.read', { connectionId: hostile, table: 't', recordId: '1' })).toThrow(DoorRefusedError);
    }
    expect(() => doorPath('row.read', { connectionId: 'c1', table: 't' })).toThrow(DoorRefusedError);
    for (const fine of ['1', 'ab-12_x', '2026-11-01', 'Ünïcode', 'a b', 'a,b', 'a:b', 'a.b']) expect(isSafeSegment(fine), fine).toBe(true);
  });
});
