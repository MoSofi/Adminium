// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar sync's store (wave 0102), on every available dialect: one state
 * and one event per account and row, a mark that a running job cannot clear
 * from under a newer write, a sealed channel secret, and a clash told once.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { calendarSyncRepo, connectedAccountsRepo, manifestsRepo, SERVER_SCOPE } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

const elin = { connectionId: 'con_1', tableName: 'team', rowKey: '7' };
const row = { connectionId: 'con_1', tableName: 'bookings', rowKey: '100' };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`calendarSyncRepo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let repo: ReturnType<typeof calendarSyncRepo>;
    let accountId: string;

    beforeEach(async () => {
      repo = calendarSyncRepo(meta(), crypto);
      const manifests = manifestsRepo(meta(), crypto);
      const install = await manifests.install({ manifestKey: 'calendar-google', version: '1.0.0', kind: 'add-on', source: 'marketplace', document: { kind: 'add-on', key: 'calendar-google', version: '1.0.0' }, scopeKey: SERVER_SCOPE });
      const accounts = connectedAccountsRepo(meta(), crypto);
      const link = await accounts.mintLink({ ...elin, providers: ['calendar-google'], purpose: 'connect', tokenHash: 'a'.repeat(64), createdBy: null, expiresAt: T0 + 1000 }, T0);
      const account = await accounts.connect(
        { manifestId: install.row.id, target: elin, subject: 'sub', address: 'elin@example.com', tokens: { accessToken: 'a', refreshToken: 'r' }, expiresAt: null, refreshExpiresAt: null, scopes: null, state: 'connected' },
        link.id,
        T0,
      );
      accountId = account!.id;
    });

    const ensure = () => repo.ensure({ accountId, connectionId: 'con_1', bookingTable: 'bookings', detail: 'first-name+initial', nextPollAt: T0 }, T0);

    it('keeps one state per account, and reads back what it was told', async () => {
      const first = await ensure();
      expect(first).toMatchObject({ accountId, countAllDay: false, detail: 'first-name+initial', readCalendars: null, calendarLostCount: 0 });
      await repo.patch(accountId, { countAllDay: true, readCalendars: ['primary', 'work'], detail: 'none', calendarId: 'cal', paused: 'calendar-removed' }, T0 + 1);
      const again = await ensure();
      expect(again).toMatchObject({ countAllDay: true, readCalendars: ['primary', 'work'], detail: 'none', calendarId: 'cal', paused: 'calendar-removed', updatedAt: T0 + 1 });
      await repo.patch(accountId, { readCalendars: null, countAllDay: false }, T0 + 2);
      expect(await repo.state(accountId)).toMatchObject({ readCalendars: null, countAllDay: false });
      expect((await repo.states([accountId])).length).toBe(1);
      expect(await repo.states([])).toEqual([]);
      expect(await repo.state('cac_none')).toBeNull();
    });

    it('finds who is due, and a notice only ever pulls a read forward', async () => {
      await ensure();
      await repo.patch(accountId, { nextPollAt: T0 + 10_000 }, T0);
      expect(await repo.due(T0, 10)).toEqual([]);
      await repo.pullForward(accountId, T0 + 5_000, T0 + 1);
      expect((await repo.state(accountId))!.nextPollAt).toBe(T0 + 5_000);
      await repo.pullForward(accountId, T0 + 9_000, T0 + 2);
      expect(await repo.state(accountId)).toMatchObject({ nextPollAt: T0 + 5_000, noticeAt: T0 + 2 });
      expect((await repo.due(T0 + 5_000, 10)).map((one) => one.accountId)).toEqual([accountId]);
      expect((await repo.page(null, 10)).length).toBe(1);
      expect(await repo.page(accountId, 10)).toEqual([]);
    });

    it('keeps one event per account and row, with no title', async () => {
      await ensure();
      const made = await repo.ensureEvent(accountId, row, T0);
      expect((await repo.ensureEvent(accountId, row, T0 + 1)).id).toBe(made.id);
      await repo.patchEvent(made.id, { remoteId: 'r1', etag: 'e1', appliedHash: 'h', startAt: T0, endAt: T0 + 100, detail: 'name', generation: 2 }, T0 + 2);
      const [held] = await repo.eventsOfRow(row);
      expect(held).toMatchObject({ remoteId: 'r1', etag: 'e1', generation: 2, detail: 'name', startAt: T0, endAt: T0 + 100 });
      expect((await repo.eventsOfAccount(accountId, null, 5)).length).toBe(1);
      expect(await repo.eventsOfAccount(accountId, made.id, 5)).toEqual([]);
      expect((await repo.namedBefore('con_1', 'bookings', T0 + 200, null, 5)).length).toBe(1);
      expect(await repo.namedBefore('con_1', 'bookings', T0 + 200, made.id, 5)).toEqual([]);
      expect((await repo.eventsFrom(accountId, T0 + 100, 5)).length).toBe(1);
      expect(await repo.eventsFrom(accountId, T0 + 101, 5)).toEqual([]);
      expect(await repo.namedBefore('con_1', 'bookings', T0 + 50, null, 5)).toEqual([]);
      expect((await repo.rowsFrom('con_1', 'bookings', T0, null, 5)).length).toBe(1);
      expect(await repo.rowsFrom('con_1', 'bookings', T0, made.id, 5)).toEqual([]);
      expect(await repo.rowsFrom('con_1', 'bookings', T0 + 101, null, 5)).toEqual([]);
      await repo.removeEvent(made.id);
      expect(await repo.eventsOfRow(row)).toEqual([]);
    });

    it('tells a row key from one differing only in case', async () => {
      await ensure();
      await repo.ensureEvent(accountId, { ...row, rowKey: 'SKU-a' }, T0);
      await repo.ensureEvent(accountId, { ...row, rowKey: 'SKU-A' }, T0);
      expect((await repo.eventsOfAccount(accountId, null, 5)).length).toBe(2);
      await repo.markDirty({ ...row, rowKey: 'SKU-a' }, T0);
      expect(await repo.dirty({ ...row, rowKey: 'SKU-A' })).toBeNull();
    });

    it('a job cannot clear a mark made while it ran', async () => {
      await repo.markDirty(row, T0);
      const read = (await repo.dirty(row))!;
      await repo.markDirty(row, T0 + 1);
      expect(await repo.clearDirty(read.id, read.mark)).toBe(false);
      const newer = (await repo.dirty(row))!;
      expect(newer.mark).toBe(read.mark + 1);
      expect((await repo.dirtyBefore(T0 + 1, 5)).length).toBe(1);
      expect(await repo.dirtyBefore(T0, 5)).toEqual([]);
      expect(await repo.clearDirty(newer.id, newer.mark)).toBe(true);
      expect(await repo.dirty(row)).toBeNull();
    });

    it('sends a row that keeps failing to the back of the line, leaving its mark', async () => {
      await repo.markDirty(row, T0);
      await repo.markDirty({ ...row, rowKey: '101' }, T0 + 1);
      const first = (await repo.dirty(row))!;
      await repo.touchDirty(first.id, T0 + 2);
      expect((await repo.dirtyBefore(T0 + 2, 1))[0]!.rowKey).toBe('101');
      expect((await repo.dirty(row))!.mark).toBe(first.mark);
    });

    it('gives the calendar to one job at a time, and a late holder frees nothing', async () => {
      await ensure();
      expect(await repo.takeCalendarLease(accountId, T0, T0 + 100)).toBe(true);
      expect(await repo.takeCalendarLease(accountId, T0 + 50, T0 + 150)).toBe(false);
      expect(await repo.takeCalendarLease(accountId, T0 + 100, T0 + 200)).toBe(true);
      await repo.releaseCalendarLease(accountId, T0 + 100);
      expect((await repo.state(accountId))!.calendarLeaseUntil).toBe(T0 + 200);
      await repo.releaseCalendarLease(accountId, T0 + 200);
      expect((await repo.state(accountId))!.calendarLeaseUntil).toBeNull();
    });

    it('ends a first read\'s hold once, and moves a state only from the one it was read in', async () => {
      await ensure();
      await repo.patch(accountId, { connectingSince: T0 }, T0);
      expect((await repo.connectingBefore(T0, 5)).length).toBe(1);
      expect(await repo.connectingBefore(T0 - 1, 5)).toEqual([]);
      expect(await repo.clearConnecting(accountId, T0 + 1, T0)).toBe(false);
      expect(await repo.clearConnecting(accountId, T0, T0)).toBe(true);
      expect(await repo.clearConnecting(accountId, T0, T0)).toBe(false);
      const accounts = connectedAccountsRepo(meta(), crypto);
      expect(await accounts.moveState(accountId, 'connecting', 'connected', T0)).toBe(false);
      expect(await accounts.moveState(accountId, 'connected', 'connecting', T0)).toBe(true);
      expect((await accounts.find(accountId))!.state).toBe('connecting');
      expect((await accounts.forTable('con_1', 'team')).map((one) => one.id)).toEqual([accountId]);
      expect(await accounts.forTable('con_1', 'other')).toEqual([]);
    });

    it('seals a channel\'s secret, and finds what is ending', async () => {
      await repo.putChannel({ id: 'chn_1', accountId, provider: 'calendar-google', target: 'busy', state: 'creating', secret: 'the-secret', remoteChannelId: null, resourceId: null, address: 'https://x.example/hook', expiresAt: T0 + 100 }, T0);
      const raw = await meta().db.selectFrom('adminium_calendar_channels').select('secretSealed').executeTakeFirstOrThrow();
      expect(raw.secretSealed).not.toContain('the-secret');
      expect(await repo.channel('chn_1')).toMatchObject({ secret: 'the-secret', state: 'creating', target: 'busy' });
      await repo.patchChannel('chn_1', { state: 'live', remoteChannelId: 'rc', resourceId: 'rs', expiresAt: T0 + 500, lastNoticeAt: T0 + 1 });
      expect((await repo.channelsOf(accountId))[0]).toMatchObject({ state: 'live', remoteChannelId: 'rc', resourceId: 'rs', lastNoticeAt: T0 + 1 });
      expect(await repo.channelsEndingBefore(T0 + 500, 5)).toEqual([]);
      expect((await repo.channelsEndingBefore(T0 + 501, 5)).length).toBe(1);
      await repo.removeChannel('chn_1');
      expect(await repo.channel('chn_1')).toBeNull();
    });

    it('tells a clash once, and keeps it on its overlap', async () => {
      const clash = await repo.ensureClash(row, T0, T0 + 10);
      expect((await repo.ensureClash(row, T0, T0 + 10)).id).toBe(clash.id);
      const other = await repo.ensureClash(row, T0, T0 + 20);
      expect(other.id).not.toBe(clash.id);
      expect(await repo.claimTold(clash.id, T0)).toBe(true);
      expect(await repo.claimTold(clash.id, T0 + 1)).toBe(false);
      await repo.keepClash(clash.id, 'usr_1', T0 + 2);
      const held = await repo.clashesOfTable('con_1', 'bookings');
      expect(held.find((one) => one.id === clash.id)).toMatchObject({ toldAt: T0, keptAt: T0 + 2, keptBy: 'usr_1' });
      await repo.removeClashes([clash.id, other.id]);
      await repo.removeClashes([]);
      expect(await repo.clashesOfTable('con_1', 'bookings')).toEqual([]);
    });

    it('goes with its account', async () => {
      await ensure();
      await repo.ensureEvent(accountId, row, T0);
      await repo.putChannel({ id: 'chn_2', accountId, provider: 'p', target: 'own', state: 'live', secret: 's', remoteChannelId: null, resourceId: null, address: 'https://x.example/h', expiresAt: T0 }, T0);
      await connectedAccountsRepo(meta(), crypto).remove(accountId);
      expect(await repo.state(accountId)).toBeNull();
      expect(await repo.eventsOfRow(row)).toEqual([]);
      expect(await repo.channel('chn_2')).toBeNull();
    });
  });
}
