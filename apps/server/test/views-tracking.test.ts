// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The counting level and its keeping (`views/tracking.ts`), on all three
 * engines: counting starts on boot when it never has, and again each time it
 * goes up from Off; Per visitor is refused while the privacy notice is not
 * set; going down from Per visitor deletes every visitor and visit, and to
 * Off keeps the counts; the daily sweep takes view days and visits past
 * their months, and visitors with nothing left.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { settingsRepo, viewDaysRepo, visitorsRepo } from '@adminium/meta';

import { changeCounting, monthsBefore, PerVisitorNeedsNotice, startCounting, sweepCounting } from '../src/views/tracking.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the counting level and its keeping [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeEach(async () => {
      handle = await engine.make();
    });
    afterEach(async () => {
      await handle.destroy();
    });

    it('starts counting on boot once, and again only when going up from Off', async () => {
      const settings = settingsRepo(handle.meta);
      await startCounting(handle.meta, NOW);
      expect(await settings.get('privacy.countingSince')).toBe(NOW);
      await startCounting(handle.meta, NOW + 1);
      expect(await settings.get('privacy.countingSince')).toBe(NOW);
      expect(await changeCounting(handle.meta, { level: 'off' }, { by: null, at: NOW + 2 })).toEqual({ before: 'counts', after: 'off', deleted: null, countingSince: null });
      expect(await settings.get('privacy.countingSince')).toBe(NOW);
      expect((await changeCounting(handle.meta, { level: 'counts' }, { by: null, at: NOW + 3 })).countingSince).toBe(NOW + 3);
      expect(await settings.get('privacy.countingSince')).toBe(NOW + 3);
      // Off from the start: nothing has started.
      await settings.set('privacy.countingSince', null);
      await settings.set('privacy.tracking', 'off');
      await startCounting(handle.meta, NOW + 4);
      expect(await settings.get('privacy.countingSince')).toBeNull();
    });

    it('refuses Per visitor while the notice is not set, and going down deletes every visitor and visit', async () => {
      await expect(changeCounting(handle.meta, { level: 'visitor' }, { by: null, at: NOW })).rejects.toBeInstanceOf(PerVisitorNeedsNotice);
      expect(await settingsRepo(handle.meta).get('privacy.tracking')).toBe('counts');
      await settingsRepo(handle.meta).set('privacy.businessName', 'Meridian Workplace Ltd');
      await settingsRepo(handle.meta).set('privacy.noticeUrl', 'https://www.meridian.example/privacy');
      expect((await changeCounting(handle.meta, { level: 'visitor', banner: { 'de-DE': { yes: 'Gern' } } }, { by: null, at: NOW })).after).toBe('visitor');
      expect(await settingsRepo(handle.meta).get('privacy.banner')).toEqual({ 'de-DE': { yes: 'Gern' } });
      const visitors = visitorsRepo(handle.meta);
      await visitors.create({ id: 'a'.repeat(64), host: 'h', saidYesAt: NOW, wordingVersion: 'w' });
      await visitors.addVisits([{ visitorId: 'a'.repeat(64), installId: 'mf', kind: 'page', thing: '7', at: NOW }]);
      await viewDaysRepo(handle.meta).add({ installId: 'mf', kind: 'page', thing: '7', place: '', day: '2026-11-18', views: 3 });
      const down = await changeCounting(handle.meta, { level: 'off' }, { by: null, at: NOW + 1 });
      expect(down.deleted).toEqual({ visitors: 1, visits: 1 });
      expect(await visitors.counts()).toEqual({ visitors: 0, visits: 0 });
      // The counts stay until their sweep.
      expect(await viewDaysRepo(handle.meta).read({ installId: 'mf', kind: 'page', things: ['7'], from: '2026-11-18', to: '2026-11-18' })).toHaveLength(1);
    });

    it('sweeps view days and visits past their months, and visitors with nothing left', async () => {
      const days = viewDaysRepo(handle.meta);
      expect(monthsBefore(NOW, 13)).toBe('2025-10-18');
      await days.add({ installId: 'mf', kind: 'page', thing: '7', place: '', day: '2025-10-17', views: 1 });
      await days.add({ installId: 'mf', kind: 'page', thing: '7', place: '', day: '2025-10-18', views: 1 });
      const visitors = visitorsRepo(handle.meta);
      await visitors.create({ id: 'a'.repeat(64), host: 'h', saidYesAt: Date.UTC(2026, 3, 1), wordingVersion: 'w' });
      await visitors.create({ id: 'b'.repeat(64), host: 'h', saidYesAt: Date.UTC(2026, 3, 1), wordingVersion: 'w' });
      await visitors.addVisits([
        { visitorId: 'a'.repeat(64), installId: 'mf', kind: 'page', thing: '7', at: Date.UTC(2026, 4, 17) },
        { visitorId: 'b'.repeat(64), installId: 'mf', kind: 'page', thing: '7', at: Date.UTC(2026, 4, 17) },
        { visitorId: 'b'.repeat(64), installId: 'mf', kind: 'page', thing: '7', at: Date.UTC(2026, 4, 19) },
      ]);
      expect(await sweepCounting(handle.meta, NOW)).toEqual({ viewDays: 1, visits: 2, visitors: 1 });
      expect(await visitors.find('b'.repeat(64))).not.toBeNull();
      // Kept for longer: nothing more goes.
      await settingsRepo(handle.meta).set('privacy.viewCountsMonths', 36);
      expect(await sweepCounting(handle.meta, NOW)).toEqual({ viewDays: 0, visits: 0, visitors: 0 });
    });
  });
}
