// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Strangers' views counted per day (wave 0096) and the visitors who said yes
 * to "Per visitor" with the pages they saw (wave 0097), on every available
 * dialect: a store from before the waves upgrades with nothing counted; an
 * add adds (two flushes into one day sum, at once from many callers too),
 * never writes a zero, keeps each install, kind, thing, place and day apart,
 * and counts past 32 bits; a day range reads back oldest first; the sweep
 * takes the days before its cutoff; a visitor's visits are written many at
 * once and only for visitors still there; a join finds them by the address
 * under every key version; a withdrawal, an erasure, going down and the sweep
 * delete visits with their visitor; and every bounded column takes its full
 * width, and refuses one character more.
 */
import type { KyselyPlugin, RootOperationNode } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  VIEW_INSTALL_WIDTH,
  VIEW_KIND_WIDTH,
  VIEW_PLACE_WIDTH,
  VIEW_THING_WIDTH,
  VISITOR_ADDRESS_HASH_WIDTH,
  VISITOR_HOST_WIDTH,
  VISITOR_ID_WIDTH,
  VISITOR_WORDING_WIDTH,
  SETTINGS_REGISTRY,
  settingsRepo,
  viewDaysRepo,
  visitorsRepo,
} from '../src/index.js';
import type { MetaMigration } from '../src/migrations/index.js';
import { indexExists } from '../src/migrations/probe.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const DAY = { installId: 'mf_forms', kind: 'form-page', thing: '41', place: '', day: '2026-11-18' };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`view counts per day [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('adds to the day\'s row, from two flushes and from many callers at once, and never writes a zero', async () => {
      const days = viewDaysRepo(meta());
      await days.add({ ...DAY, views: 3 });
      await days.add({ ...DAY, views: 4 });
      expect(await days.read({ installId: DAY.installId, kind: DAY.kind, things: ['41'], from: '2026-11-01', to: '2026-11-30' })).toEqual([{ ...DAY, views: 7 }]);
      // Ten processes flushing the same new day at once: one row, the sum.
      await Promise.all(Array.from({ length: 10 }, () => days.add({ ...DAY, day: '2026-11-19', views: 2 })));
      expect(await days.read({ installId: DAY.installId, kind: DAY.kind, things: ['41'], from: '2026-11-19', to: '2026-11-19' })).toEqual([{ ...DAY, day: '2026-11-19', views: 20 }]);
      // A zero, a negative or a fraction is never written.
      await expect(days.add({ ...DAY, views: 0 })).rejects.toThrow(/zero is never written/);
      await expect(days.add({ ...DAY, views: -1 })).rejects.toThrow(/zero is never written/);
      await expect(days.add({ ...DAY, views: 1.5 })).rejects.toThrow(/zero is never written/);
      expect(Number((await meta().db.selectFrom('adminium_view_days').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n)).toBe(2);
    });

    it('keeps each install, kind, thing, place and day apart, counts past 32 bits, and reads a range oldest first', async () => {
      const days = viewDaysRepo(meta());
      await days.add({ ...DAY, views: 1 });
      await days.add({ ...DAY, place: '7', views: 2 });
      await days.add({ ...DAY, kind: 'form-sent', views: 3 });
      await days.add({ ...DAY, installId: 'mf_other', views: 4 });
      await days.add({ ...DAY, thing: '42', views: 5 });
      await days.add({ ...DAY, day: '2026-11-17', views: 5_000_000_000 });
      const read = await days.read({ installId: DAY.installId, kind: DAY.kind, things: ['41', '42'], from: '2026-11-17', to: '2026-11-18' });
      expect(read).toEqual([
        { ...DAY, day: '2026-11-17', views: 5_000_000_000 },
        { ...DAY, views: 1 },
        { ...DAY, place: '7', views: 2 },
        { ...DAY, thing: '42', views: 5 },
      ]);
      expect(await days.read({ installId: DAY.installId, kind: DAY.kind, things: ['41'], from: '2026-11-18', to: '2026-11-18', place: '7' })).toEqual([{ ...DAY, place: '7', views: 2 }]);
      expect(await days.read({ installId: DAY.installId, kind: DAY.kind, things: [], from: '2026-11-18', to: '2026-11-18' })).toEqual([]);
    });

    it('sweeps the days before its cutoff and leaves the rest', async () => {
      const days = viewDaysRepo(meta());
      await days.add({ ...DAY, day: '2025-10-17', views: 1 });
      await days.add({ ...DAY, day: '2025-10-18', views: 1 });
      await days.add({ ...DAY, views: 1 });
      expect(await days.purgeBefore('2025-10-18')).toBe(1);
      expect((await days.read({ installId: DAY.installId, kind: DAY.kind, things: ['41'], from: '2000-01-01', to: '2099-12-31' })).map((row) => row.day)).toEqual(['2025-10-18', '2026-11-18']);
      await expect(days.purgeBefore('2025-1-1')).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('takes the full width of every bounded column, and refuses one more', async () => {
      const days = viewDaysRepo(meta());
      const wide = { installId: 'i'.repeat(VIEW_INSTALL_WIDTH), kind: 'k'.repeat(VIEW_KIND_WIDTH), thing: 't'.repeat(VIEW_THING_WIDTH), place: 'p'.repeat(VIEW_PLACE_WIDTH), day: '2026-12-31', views: Number.MAX_SAFE_INTEGER };
      await days.add(wide);
      expect(await days.read({ installId: wide.installId, kind: wide.kind, things: [wide.thing], from: wide.day, to: wide.day })).toEqual([wide]);
      await expect(days.add({ ...wide, installId: `${wide.installId}i` })).rejects.toThrow(/install id/);
      await expect(days.add({ ...wide, kind: `${wide.kind}k` })).rejects.toThrow(/kind/);
      await expect(days.add({ ...wide, thing: `${wide.thing}t` })).rejects.toThrow(/thing/);
      await expect(days.add({ ...wide, place: `${wide.place}p` })).rejects.toThrow(/place/);
      await expect(days.add({ ...wide, day: '2026-12-310' })).rejects.toThrow(/YYYY-MM-DD/);
      await expect(days.add({ ...wide, thing: '' })).rejects.toThrow(/thing/);
      if (dialect.name !== 'sqlite') {
        await expect(meta().db.insertInto('adminium_view_days').values({ ...wide, thing: `${wide.thing}t` }).execute()).rejects.toThrow();
      }
    });
  });

  describe.skipIf(!dialect.available)(`visitors and their visits [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    const A = 'a'.repeat(64);
    const B = 'b'.repeat(64);
    const visit = (visitorId: string, at: number, thing = '41') => ({ visitorId, installId: 'mf_forms', kind: 'form-page', thing, at });

    it('makes a visitor on a yes, writes visits only for visitors still there, and moves their last seen', async () => {
      const repo = visitorsRepo(meta());
      expect(await repo.create({ id: A, host: 'crm.meridian.example', saidYesAt: T0, wordingVersion: 'w1' })).toEqual({ id: A, host: 'crm.meridian.example', saidYesAt: T0, wordingVersion: 'w1', address: null, lastSeenAt: T0 });
      // 450 visits in a few inserts; B never said yes, so its one is dropped.
      const many = Array.from({ length: 450 }, (_, n) => visit(A, T0 + n + 1));
      expect(await repo.addVisits([...many, visit(B, T0 + 5)])).toBe(450);
      expect((await repo.find(A))?.lastSeenAt).toBe(T0 + 450);
      const { count, visits } = await repo.visitsOf([A, B], 3);
      expect(count).toBe(450);
      expect(visits.map((one) => one.at)).toEqual([T0 + 1, T0 + 2, T0 + 3]);
      expect(await repo.counts()).toEqual({ visitors: 1, visits: 450 });
      // A visit counted earlier than the last one seen leaves last seen as it is.
      await repo.addVisits([visit(A, T0)]);
      expect((await repo.find(A))?.lastSeenAt).toBe(T0 + 450);
    });

    it('joins an address, finds the visitor by it under every key version, and an erasure takes them with their visits', async () => {
      const repo = visitorsRepo(meta());
      await repo.create({ id: A, host: 'crm.meridian.example', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.create({ id: B, host: 'pages.meridian.example', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.addVisits([visit(A, T0 + 1), visit(A, T0 + 2), visit(B, T0 + 3)]);
      expect(await repo.join(A, { hash: 'h1', version: 1 })).toBe(true);
      expect(await repo.join(B, { hash: 'h2', version: 2 })).toBe(true);
      expect(await repo.join('c'.repeat(64), { hash: 'h1', version: 1 })).toBe(false);
      // The same address under two key versions: both visitors are theirs.
      const found = await repo.byAddress([{ hash: 'h1', version: 1 }, { hash: 'h2', version: 2 }]);
      expect(found.map((one) => [one.id, one.address])).toEqual([[A, { hash: 'h1', version: 1 }], [B, { hash: 'h2', version: 2 }]]);
      // A hash under the wrong version is somebody else.
      expect(await repo.byAddress([{ hash: 'h1', version: 2 }])).toEqual([]);
      expect(await repo.eraseByAddress([{ hash: 'h1', version: 1 }])).toEqual({ visitors: 1, visits: 2 });
      expect(await repo.counts()).toEqual({ visitors: 1, visits: 1 });
    });

    it('a withdrawal forgets one visitor; going down deletes every row at once', async () => {
      const repo = visitorsRepo(meta());
      await repo.create({ id: A, host: 'h', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.create({ id: B, host: 'h', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.addVisits([visit(A, T0 + 1), visit(B, T0 + 2), visit(B, T0 + 3)]);
      expect(await repo.forget(A)).toEqual({ visitors: 1, visits: 1 });
      expect(await repo.find(A)).toBeNull();
      expect(await repo.deleteAll()).toEqual({ visitors: 1, visits: 2 });
      expect(await repo.counts()).toEqual({ visitors: 0, visits: 0 });
    });

    it('sweeps visits past their months, then visitors with none left who were not seen since', async () => {
      const repo = visitorsRepo(meta());
      await repo.create({ id: A, host: 'h', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.create({ id: B, host: 'h', saidYesAt: T0, wordingVersion: 'w1' });
      await repo.addVisits([visit(A, T0 + 1), visit(B, T0 + 1), visit(B, T0 + 100)]);
      expect(await repo.sweep(T0 + 50)).toEqual({ visitors: 1, visits: 2 });
      expect(await repo.find(A)).toBeNull();
      expect(await repo.find(B)).not.toBeNull();
      expect(await repo.counts()).toEqual({ visitors: 1, visits: 1 });
    });

    it('takes the full width of every bounded column, and refuses one more', async () => {
      const repo = visitorsRepo(meta());
      const id = 'v'.repeat(VISITOR_ID_WIDTH);
      const host = 'h'.repeat(VISITOR_HOST_WIDTH);
      const wording = 'w'.repeat(VISITOR_WORDING_WIDTH);
      const hash = 'x'.repeat(VISITOR_ADDRESS_HASH_WIDTH);
      await repo.create({ id, host, saidYesAt: T0, wordingVersion: wording });
      expect(await repo.join(id, { hash, version: 2_000_000_000 })).toBe(true);
      const wideVisit = { visitorId: id, installId: 'i'.repeat(VIEW_INSTALL_WIDTH), kind: 'k'.repeat(VIEW_KIND_WIDTH), thing: 't'.repeat(VIEW_THING_WIDTH), at: Number.MAX_SAFE_INTEGER };
      expect(await repo.addVisits([wideVisit])).toBe(1);
      expect(await repo.find(id)).toEqual({ id, host, saidYesAt: T0, wordingVersion: wording, address: { hash, version: 2_000_000_000 }, lastSeenAt: Number.MAX_SAFE_INTEGER });
      expect((await repo.visitsOf([id], 10)).visits.map(({ id: _id, ...rest }) => rest)).toEqual([wideVisit]);
      await expect(repo.create({ id: `${id}v`, host: 'h', saidYesAt: T0, wordingVersion: 'w' })).rejects.toThrow(/visitor id/);
      await expect(repo.create({ id: 'x', host: `${host}h`, saidYesAt: T0, wordingVersion: 'w' })).rejects.toThrow(/host/);
      await expect(repo.create({ id: 'x', host: 'h', saidYesAt: T0, wordingVersion: `${wording}w` })).rejects.toThrow(/wording/);
      await expect(repo.join(id, { hash: `${hash}x`, version: 1 })).rejects.toThrow(/address hash/);
      await expect(repo.addVisits([{ ...wideVisit, installId: `${wideVisit.installId}i` }])).rejects.toThrow(/install id/);
      await expect(repo.addVisits([{ ...wideVisit, kind: `${wideVisit.kind}k` }])).rejects.toThrow(/kind/);
      await expect(repo.addVisits([{ ...wideVisit, thing: `${wideVisit.thing}t` }])).rejects.toThrow(/thing/);
      if (dialect.name !== 'sqlite') {
        await expect(meta().db.insertInto('adminium_visitors').values({ id: 'y', host: `${host}h`, saidYesAt: T0, wordingVersion: 'w', addressHash: null, keyVersion: null, lastSeenAt: T0 }).execute()).rejects.toThrow();
      }
    });
  });

  describe.skipIf(!dialect.available)(`the counting settings [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('counts only by default, keeps counts 13 months and visits 6, and takes only the offered months and banner words', async () => {
      const settings = settingsRepo(meta());
      expect(await settings.get('privacy.tracking')).toBe('counts');
      expect(await settings.get('privacy.countingSince')).toBeNull();
      expect(await settings.get('privacy.viewCountsMonths')).toBe(13);
      expect(await settings.get('privacy.visitsMonths')).toBe(6);
      expect(await settings.get('privacy.banner')).toBeNull();
      await settings.set('privacy.tracking', 'visitor');
      await settings.set('privacy.viewCountsMonths', 36);
      await settings.set('privacy.banner', { 'de-DE': { title: 'Dürfen wir uns an Ihren Besuch erinnern?', yes: 'Ja' } });
      expect(await settings.get('privacy.banner')).toEqual({ 'de-DE': { title: 'Dürfen wir uns an Ihren Besuch erinnern?', yes: 'Ja' } });
      await expect(settings.set('privacy.tracking', 'everything' as never)).rejects.toThrow(/privacy.tracking/);
      await expect(settings.set('privacy.visitsMonths', 7)).rejects.toThrow(/privacy.visitsMonths/);
      await expect(settings.set('privacy.banner', { 'xx-XX': { yes: 'Ja' } } as never)).rejects.toThrow(/privacy.banner/);
      await expect(settings.set('privacy.banner', { 'en-US': { yes: 'y'.repeat(31) } })).rejects.toThrow(/privacy.banner/);
      await expect(settings.set('privacy.banner', { 'en-US': { maybe: 'y' } } as never)).rejects.toThrow(/privacy.banner/);
      // The level, the months and the words are the owner's configuration; when counting started is this instance's.
      expect(['privacy.tracking', 'privacy.viewCountsMonths', 'privacy.visitsMonths', 'privacy.banner', 'privacy.countingSince'].map((key) => SETTINGS_REGISTRY[key as 'privacy.banner'].portable === true)).toEqual([true, true, true, true, false]);
    });
  });

  describe.skipIf(!dialect.available)(`0096_view_days + 0097_visitors upgrade [${dialect.name}]`, () => {
    it('a store from before the waves upgrades with nothing counted and no visitor', async () => {
      const t = await dialect.make();
      try {
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < '0096_view_days') });
        expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied.slice(0, 2)).toEqual(['0096_view_days', '0097_visitors']);
        expect(await viewDaysRepo(t.meta).read({ ...DAY, things: ['41'], from: '2000-01-01', to: '2099-12-31' })).toEqual([]);
        expect(await visitorsRepo(t.meta).counts()).toEqual({ visitors: 0, visits: 0 });
      } finally {
        await t.destroy();
      }
    });

    it('a run stopped between any two steps of either wave is finished by the next', async () => {
      // On MySQL every step before the stop stays (no transactional DDL); on Postgres and SQLite the wave rolls back whole.
      for (const wave of ['0096_view_days', '0097_visitors']) {
        const before = ALL_MIGRATIONS.filter((m) => m.name < wave);
        const own = ALL_MIGRATIONS.find((m) => m.name === wave)!;
        const counted = stoppedAt(own, Number.POSITIVE_INFINITY);
        const whole = await dialect.make();
        try {
          await applyMigrations(whole.meta.db, { dialect: whole.meta.dialect, migrations: [...before, counted.migration] });
        } finally {
          await whole.destroy();
        }
        const total = counted.steps();
        expect(total, wave).toBe(wave === '0096_view_days' ? 2 : 6);
        for (let at = 1; at < total; at += 1) {
          const t = await dialect.make();
          try {
            await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: before });
            const stop = stoppedAt(own, at);
            await expect(applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: [...before, stop.migration] }), `${wave} stop at ${String(at)}`).rejects.toThrow(`stopped before step ${String(at + 1)}`);
            // Run again, as the next start of the server does: the wave finishes, then the ones after it.
            const resumed = await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
            expect(resumed.applied[0], `${wave} stop at ${String(at)}`).toBe(wave);
            for (const [table, index] of INDEXES) expect(await indexExists(t.meta.db as never, t.meta.dialect, table, index), `${wave} stop at ${String(at)}: ${index}`).toBe(true);
            await viewDaysRepo(t.meta).add({ ...DAY, views: 1 });
            expect(await visitorsRepo(t.meta).counts()).toEqual({ visitors: 0, visits: 0 });
          } finally {
            await t.destroy();
          }
        }
      }
    }, 600_000);
  });
}

/** Every index the two waves make, by its table. */
const INDEXES = [
  ['adminium_view_days', 'ix_adminium_view_days_day'],
  ['adminium_visitors', 'ix_adminium_visitors_address'],
  ['adminium_visitors', 'ix_adminium_visitors_seen'],
  ['adminium_visits', 'ix_adminium_visits_visitor'],
  ['adminium_visits', 'ix_adminium_visits_at'],
] as const;

/** A statement that changes the schema: what a stop can fall between. The wave's own questions are reads. */
function isStep(node: RootOperationNode): boolean {
  if (node.kind === 'RawNode') return !node.sqlFragments.join('').trimStart().toLowerCase().startsWith('select');
  return ['AlterTableNode', 'CreateIndexNode', 'DropIndexNode', 'CreateTableNode', 'DropTableNode'].includes(node.kind);
}

/** A wave, stopped before its step `at + 1` (the database went away), counting the steps it got to. */
function stoppedAt(wave: MetaMigration, at: number) {
  let steps = 0;
  const plugin: KyselyPlugin = {
    transformQuery({ node }) {
      if (isStep(node)) {
        steps += 1;
        if (steps > at) throw new Error(`stopped before step ${String(steps)}`);
      }
      return node;
    },
    transformResult: async ({ result }) => result,
  };
  return {
    migration: { name: wave.name, up: (db: Parameters<MetaMigration['up']>[0], c: Parameters<MetaMigration['up']>[1]) => wave.up(db.withPlugin(plugin), c) },
    steps: () => steps,
  };
}
