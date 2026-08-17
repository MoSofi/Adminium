// SPDX-License-Identifier: AGPL-3.0-only
/**
 * notificationsRepo / notificationPrefsRepo / scheduledReportsRepo /
 * emailTemplatesRepo (07-meta-store.md §3.20/§3.21/§3.24/§3.28) — M7
 * reports & notifications wave. Same dialect-parameterized harness as the
 * sibling repo suites (repos.files-exports-imports.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_CHANNELS,
  SYSTEM_ACTOR_LABEL,
  emailTemplatesRepo,
  firstRun,
  notificationPrefsRepo,
  notificationsRepo,
  pagesRepo,
  scheduledReportsRepo,
  usersRepo,
  type ReportSchedule,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const WEEKLY: ReportSchedule = {
  frequency: 'weekly',
  dayOfWeek: 1,
  time: '09:00',
  timezone: 'UTC',
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`notifications/reports/email repos [${dialect.name}]`, () => {
    let t: TestDb;
    let userId: string;
    let pageId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      userId = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
      pageId = (
        await pagesRepo(t.meta).create({
          slug: 'orders',
          type: 'page-crud',
          title: 'Orders',
          config: { v: 1 },
        })
      ).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('notifications: create → keyset list → unread count → read transitions', async () => {
      const repo = notificationsRepo(t.meta);
      const first = await repo.create(
        { userId, kind: 'report.ready', title: 'Report ready', entity: { pageId } },
        1_000,
      );
      const second = await repo.create(
        { userId, kind: 'desktop.backup.completed', title: 'Backup complete', body: '2 databases' },
        2_000,
      );
      expect(first.actorLabel).toBe(SYSTEM_ACTOR_LABEL);
      expect(first.entity).toEqual({ pageId });
      expect(first.readAt).toBeNull();

      // Newest first, keyset `before` pages past the newest row.
      const all = await repo.listForUser(userId);
      expect(all.map((n) => n.id)).toEqual([second.id, first.id]);
      const page2 = await repo.listForUser(userId, {
        before: { createdAt: second.createdAt, id: second.id },
      });
      expect(page2.map((n) => n.id)).toEqual([first.id]);

      expect(await repo.unreadCount(userId)).toBe(2);

      // Owner-scoped mark-read: a foreign user is a silent no-op.
      expect(await repo.markRead(first.id, 'usr_someone_else', 3_000)).toBe(false);
      expect(await repo.markRead(first.id, userId, 3_000)).toBe(true);
      expect(await repo.markRead(first.id, userId, 3_000)).toBe(false); // already read
      expect(await repo.unreadCount(userId)).toBe(1);
      expect((await repo.listForUser(userId, { unreadOnly: true })).map((n) => n.id)).toEqual([
        second.id,
      ]);

      expect(await repo.markAllRead(userId, 4_000)).toBe(1);
      expect(await repo.unreadCount(userId)).toBe(0);
    });

    it('notification prefs: defaults when missing, upsert stores deviations', async () => {
      const repo = notificationPrefsRepo(t.meta);
      expect(await repo.get(userId, 'report.ready')).toBeNull();
      expect(await repo.channelsFor(userId, 'report.ready')).toEqual(DEFAULT_NOTIFICATION_CHANNELS);

      const stored = await repo.upsert(
        userId,
        'report.ready',
        { inApp: true, email: false, push: true },
        1_000,
      );
      expect(stored.updatedAt).toBe(1_000);
      expect(await repo.channelsFor(userId, 'report.ready')).toEqual({
        inApp: true,
        email: false,
        push: true,
      });

      // Second upsert UPDATEs the same composite-PK row.
      await repo.upsert(userId, 'report.ready', { inApp: false, email: false, push: false }, 2_000);
      const listed = await repo.listForUser(userId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.channels).toEqual({ inApp: false, email: false, push: false });
      expect(listed[0]?.updatedAt).toBe(2_000);
    });

    it('scheduled reports: lifecycle create → update → recordRun → listDue', async () => {
      const repo = scheduledReportsRepo(t.meta);
      const report = await repo.create(
        {
          pageId,
          name: 'Weekly orders',
          schedule: WEEKLY,
          recipients: ['ava@adminium.test'],
          format: 'pdf',
          nextRunAt: 5_000,
          createdBy: userId,
        },
        1_000,
      );
      expect(report.enabled).toBe(true);
      expect(report.lastRunAt).toBeNull();
      expect(report.nextRunAt).toBe(5_000);
      expect(report.schedule).toEqual(WEEKLY);

      // Due only once next_run_at passes, and only while enabled.
      expect((await repo.listDue(4_999)).map((r) => r.id)).toEqual([]);
      expect((await repo.listDue(5_000)).map((r) => r.id)).toEqual([report.id]);
      const parked = await repo.update(report.id, { enabled: false, nextRunAt: null }, 2_000);
      expect(parked?.enabled).toBe(false);
      expect((await repo.listDue(9_000)).map((r) => r.id)).toEqual([]);

      const resumed = await repo.update(report.id, { enabled: true, nextRunAt: 6_000 }, 3_000);
      expect(resumed?.nextRunAt).toBe(6_000);

      expect(await repo.recordRun(report.id, { lastRunAt: 7_000, nextRunAt: 8_000 })).toBe(true);
      const ran = await repo.findById(report.id);
      expect(ran?.lastRunAt).toBe(7_000);
      expect(ran?.nextRunAt).toBe(8_000);

      // Mine-only list scope + delete.
      expect((await repo.list({ createdBy: userId })).map((r) => r.id)).toEqual([report.id]);
      expect((await repo.list({ createdBy: 'usr_other' })).map((r) => r.id)).toEqual([]);
      expect(await repo.remove(report.id)).toBe(true);
      expect(await repo.findById(report.id)).toBeNull();
    });

    it('email templates: (key, locale) upsert, editor writes clear is_builtin_copy', async () => {
      const repo = emailTemplatesRepo(t.meta);
      const seeded = await repo.upsert(
        'welcome',
        'en_US',
        {
          name: 'Welcome',
          subject: 'Welcome to {{workspace}}',
          blocks: [{ block: 'block-hero', data: { heading: 'Hi' } }],
          enabled: true,
          isBuiltinCopy: true,
        },
        1_000,
      );
      expect(seeded.isBuiltinCopy).toBe(true);
      expect(seeded.createdAt).toBe(1_000);

      // Editor write UPDATEs the same (key, locale) row and clears the flag.
      const edited = await repo.upsert(
        'welcome',
        'en_US',
        {
          name: 'Welcome v2',
          subject: 'Hello!',
          blocks: [{ block: 'block-hero' }, { block: 'block-footer' }],
          enabled: false,
          updatedBy: userId,
        },
        2_000,
      );
      expect(edited.id).toBe(seeded.id);
      expect(edited.isBuiltinCopy).toBe(false);
      expect(edited.enabled).toBe(false);
      expect(edited.updatedBy).toBe(userId);
      expect(edited.blocks).toHaveLength(2);
      expect(edited.createdAt).toBe(1_000);
      expect(edited.updatedAt).toBe(2_000);

      // A different locale is a separate row.
      await repo.upsert('welcome', 'de_DE', {
        name: 'Willkommen',
        subject: 'Hallo',
        blocks: [],
        enabled: true,
      });
      const listed = await repo.list();
      expect(listed.map((row) => `${row.key}/${row.locale}`)).toEqual([
        'welcome/de_DE',
        'welcome/en_US',
      ]);

      expect(await repo.findByKeyLocale('welcome', 'fr_FR')).toBeNull();
      expect(await repo.remove('welcome', 'de_DE')).toBe(true);
      expect(await repo.remove('welcome', 'de_DE')).toBe(false);
    });
  });
}
