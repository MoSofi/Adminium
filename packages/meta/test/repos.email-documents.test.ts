// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailTemplatesRepo / emailBlocksRepo / emailRunsRepo — the 39-T01 verbs
 * (39-email-templates-and-campaigns.md §3.2, D1–D5, D11).
 *
 * The one assertion that carries the wave is the mirror one: the same ops
 * applied to three siblings of DIFFERENT lengths clamp per sibling and clone
 * ids, because a save under 39 D1 carries the session's structural edits to
 * every language variation in one transaction, and an index that is valid on
 * the English document may be past the end of the German one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EmailTemplateExistsError,
  applyEmailBlockOps,
  compareLocales,
  emailBlocksRepo,
  emailRunsRepo,
  emailTemplatesRepo,
  firstRun,
  liftLegacyFooter,
  usersRepo,
  type EmailTemplatesRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const heading = (id: string, text: string) => ({ block: 'email.heading', id, data: { text, level: 1 } });
const para = (id: string, text: string) => ({ block: 'email.text', id, data: { paras: [text] } });
const divider = (id: string) => ({ block: 'email.divider', id, data: { height: 24, line: true } });

describe('pure helpers', () => {
  it('liftLegacyFooter moves a trailing footer block onto the envelope, and only then', () => {
    const blocks = [heading('h', 'Hi'), { block: 'email.footer', id: 'f', data: { text: 'Bye' } }];
    expect(liftLegacyFooter(blocks, '')).toEqual({ blocks: [heading('h', 'Hi')], footer: 'Bye' });
    // A stored footer wins; the block stays for the renderer to render after it.
    expect(liftLegacyFooter(blocks, 'Stored')).toEqual({ blocks, footer: 'Stored' });
    // Not trailing: untouched.
    const middle = [{ block: 'email.footer', id: 'f', data: { text: 'Bye' } }, heading('h', 'Hi')];
    expect(liftLegacyFooter(middle, '')).toEqual({ blocks: middle, footer: '' });
    expect(liftLegacyFooter([], '')).toEqual({ blocks: [], footer: '' });
  });

  it('applyEmailBlockOps is the comp’s applyOp with clamped indices and cloned ids', () => {
    const three = [heading('a', 'A'), para('b', 'B'), divider('c')];
    const inserted = applyEmailBlockOps(three, [{ kind: 'insert', index: 1, block: divider('new') }], {
      cloneIds: true,
    });
    expect(inserted.map((b) => b['id'])).toHaveLength(4);
    expect(inserted[1]?.['block']).toBe('email.divider');
    expect(inserted[1]?.['id']).not.toBe('new');
    // Without cloning the block is inserted as given (the source document's own save).
    expect(
      applyEmailBlockOps(three, [{ kind: 'insert', index: 99, block: divider('new') }], { cloneIds: false })
        .at(-1)?.['id'],
    ).toBe('new');
    // The comp's move arithmetic: `from < to ? to - 1 : to`.
    expect(applyEmailBlockOps(three, [{ kind: 'move', from: 0, to: 3 }], { cloneIds: true }).map((b) => b['id'])).toEqual(['b', 'c', 'a']);
    expect(applyEmailBlockOps(three, [{ kind: 'move', from: 2, to: 0 }], { cloneIds: true }).map((b) => b['id'])).toEqual(['c', 'a', 'b']);
    // Out of range: a no-op, never a throw.
    expect(applyEmailBlockOps(three, [{ kind: 'delete', index: 7 }], { cloneIds: true })).toHaveLength(3);
    expect(applyEmailBlockOps(three, [{ kind: 'move', from: 7, to: 0 }], { cloneIds: true })).toEqual(three);
    expect(applyEmailBlockOps(three, [{ kind: 'delete', index: 1 }], { cloneIds: true }).map((b) => b['id'])).toEqual(['a', 'c']);
  });

  it('compareLocales puts en_US first, then ids, unless a registry order is given', () => {
    expect(['de_DE', 'ar_EG', 'en_US'].sort(compareLocales)).toEqual(['en_US', 'ar_EG', 'de_DE']);
    const order = ['en_US', 'de_DE', 'fr_FR', 'ar_EG'];
    expect(['ar_EG', 'fr_FR', 'xx_XX', 'de_DE'].sort((a, b) => compareLocales(a, b, order))).toEqual([
      'de_DE',
      'fr_FR',
      'ar_EG',
      'xx_XX',
    ]);
    // `en_US` leads even when the given order puts it elsewhere (the registry ties on sortOrder).
    expect(['ar_EG', 'en_US', 'cs_CZ'].sort((a, b) => compareLocales(a, b, ['ar_EG', 'cs_CZ', 'en_US']))).toEqual([
      'en_US',
      'ar_EG',
      'cs_CZ',
    ]);
  });
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`email document repos [${dialect.name}]`, () => {
    let t: TestDb;
    let repo: EmailTemplatesRepo;
    let userId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      repo = emailTemplatesRepo(t.meta);
      userId = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    async function family(): Promise<{ en: string; de: string; ar: string }> {
      const en = await repo.create(
        {
          kind: 'template',
          key: 'welcome-email',
          locale: 'en_US',
          name: 'Welcome email',
          subject: 'Welcome',
          blocks: [heading('h', 'Welcome'), para('p', 'Hello'), divider('d')],
          category: 'lifecycle',
          starter: 'welcome',
          footer: 'Questions? Reply to this email.',
          createdBy: userId,
        },
        T0,
      );
      const de = await repo.create(
        {
          kind: 'template',
          key: 'welcome-email',
          locale: 'de_DE',
          name: 'Willkommen',
          subject: 'Willkommen',
          blocks: [heading('h', 'Willkommen'), para('p', 'Hallo'), divider('d'), para('extra', 'Mehr')],
          needsTranslation: true,
        },
        T0 + 1,
      );
      const ar = await repo.create(
        {
          kind: 'template',
          key: 'welcome-email',
          locale: 'ar_EG',
          name: 'مرحبًا',
          subject: 'مرحبًا',
          blocks: [heading('h', 'مرحبًا')],
        },
        T0 + 2,
      );
      return { en: en.id, de: de.id, ar: ar.id };
    }

    it('create decodes the whole envelope and refuses a (key, locale) collision', async () => {
      const ids = await family();
      const en = await repo.findById(ids.en);
      expect(en).toMatchObject({
        kind: 'template',
        category: 'lifecycle',
        starter: 'welcome',
        needsTranslation: false,
        archivedAt: null,
        preheader: '',
        footer: 'Questions? Reply to this email.',
        brand: null,
        attachments: [],
        createdBy: userId,
        enabled: true,
        isBuiltinCopy: false,
      });
      await expect(
        repo.create({ kind: 'campaign', key: 'welcome-email', locale: 'en_US', name: 'x', subject: 'x', blocks: [] }),
      ).rejects.toBeInstanceOf(EmailTemplateExistsError);
      expect(await repo.keysLike('welcome-email')).toEqual(['welcome-email']);
      // `base-%` matches by design; the minting step keeps only numeric suffixes.
      expect(await repo.keysLike('welcome')).toEqual(['welcome-email']);
      expect(await repo.keysLike('wel')).toEqual([]);
    });

    it('siblings return in locale order — en_US first, or the registry order when given', async () => {
      await family();
      expect((await repo.siblings('welcome-email')).map((s) => s.locale)).toEqual(['en_US', 'ar_EG', 'de_DE']);
      expect(
        (await repo.siblings('welcome-email', { localeOrder: ['en_US', 'de_DE', 'ar_EG'] })).map((s) => s.locale),
      ).toEqual(['en_US', 'de_DE', 'ar_EG']);
      expect(await repo.siblings('nope')).toEqual([]);
    });

    it('mirror ops change every live sibling, clamp per length, clone ids, and skip the source', async () => {
      const ids = await family();
      const before = await repo.findById(ids.en);
      const changed = await repo.applyMirrorOps(
        ids.en,
        [
          { kind: 'insert', index: 3, block: divider('mirrored') },
          { kind: 'delete', index: 0 },
        ],
        { updatedBy: userId, at: T0 + 10 },
      );
      expect(changed.map((c) => c.locale).sort()).toEqual(['ar_EG', 'de_DE']);

      // The source is NOT touched by the mirror — its own save writes it.
      expect(await repo.findById(ids.en)).toEqual(before);

      // de: [h, p, d, extra] → insert at 3 → [h, p, d, NEW, extra] → delete 0 → [p, d, NEW, extra]
      const de = await repo.findById(ids.de);
      expect(de?.blocks.map((b) => b['block'])).toEqual(['email.text', 'email.divider', 'email.divider', 'email.text']);
      expect(de?.blocks[2]?.['id']).not.toBe('mirrored');
      expect(de?.isBuiltinCopy).toBe(false);
      expect(de?.updatedBy).toBe(userId);
      expect(de?.updatedAt).toBe(T0 + 10);

      // ar: [h] → insert at 3 clamps to the end → [h, NEW] → delete 0 → [NEW]
      const ar = await repo.findById(ids.ar);
      expect(ar?.blocks.map((b) => b['block'])).toEqual(['email.divider']);
      expect(ar?.blocks[0]?.['id']).not.toBe(de?.blocks[2]?.['id']);

      // No ops → nothing happens, nothing returned.
      expect(await repo.applyMirrorOps(ids.en, [])).toEqual([]);
      expect(await repo.applyMirrorOps('tpl_nope', [{ kind: 'delete', index: 0 }])).toEqual([]);
    });

    it('archive/restore round-trip, list splits live from archived, counts follow', async () => {
      const ids = await family();
      const campaign = await repo.create(
        { kind: 'campaign', key: 'weekly-digest', locale: 'en_US', name: 'Weekly digest', subject: 'Week', blocks: [] },
        T0 + 5,
      );

      expect((await repo.list()).map((r) => `${r.key}/${r.locale}`)).toEqual([
        'weekly-digest/en_US',
        'welcome-email/en_US',
        'welcome-email/ar_EG',
        'welcome-email/de_DE',
      ]);
      expect((await repo.list({ kind: 'campaign' })).map((r) => r.id)).toEqual([campaign.id]);
      expect(await repo.counts()).toEqual({ template: 3, campaign: 1, archived: 0 });

      const archived = await repo.archive(ids.de, T0 + 20);
      expect(archived?.archivedAt).toBe(T0 + 20);
      expect((await repo.list({ kind: 'template' })).map((r) => r.locale)).toEqual(['en_US', 'ar_EG']);
      expect((await repo.list({ archived: true })).map((r) => r.id)).toEqual([ids.de]);
      expect(await repo.counts()).toEqual({ template: 2, campaign: 1, archived: 1 });
      expect(await repo.counts(true)).toEqual({ template: 1, campaign: 0, archived: 1 });
      // Siblings still see the archived variant (the caller filters by archivedAt).
      expect((await repo.siblings('welcome-email')).map((s) => s.archivedAt !== null)).toEqual([false, false, true]);

      // A mirror op skips the archived sibling.
      await repo.applyMirrorOps(ids.en, [{ kind: 'delete', index: 0 }]);
      expect((await repo.findById(ids.de))?.blocks).toHaveLength(4);

      const restored = await repo.restore(ids.de, T0 + 30);
      expect(restored?.archivedAt).toBeNull();
      expect(restored?.updatedAt).toBe(T0 + 30);
      expect(await repo.counts()).toEqual({ template: 3, campaign: 1, archived: 0 });

      expect(await repo.archive('tpl_nope')).toBeNull();
      expect(await repo.restore('tpl_nope')).toBeNull();
    });

    it('list searches name, subject, category and key, case-insensitively', async () => {
      await family();
      expect((await repo.list({ q: 'WILLKOMMEN' })).map((r) => r.locale)).toEqual(['de_DE']);
      expect((await repo.list({ q: 'lifecycle' })).map((r) => r.locale)).toEqual(['en_US']);
      expect((await repo.list({ q: 'welcome-em' })).length).toBe(3);
      expect(await repo.list({ q: 'zzz' })).toEqual([]);
    });

    it('patch writes only what it is given, and clears the built-in flag when told to', async () => {
      const ids = await family();
      const seeded = await repo.upsert(
        'password-reset',
        'en_US',
        { name: 'Password reset', subject: 'Reset', blocks: [heading('h', 'Reset')], enabled: true, isBuiltinCopy: true, footer: 'Legacy' },
        T0,
      );
      expect(seeded.kind).toBe('template');
      expect(seeded.footer).toBe('Legacy');

      const patched = await repo.patch(
        seeded.id,
        {
          name: 'My reset',
          preheader: 'Preview',
          brand: { name: 'Acme', mark: 'zap', accent: '#0d9488', fromName: 'Acme', fromEmail: 'hi@acme.test' },
          attachments: [{ id: 'a1', kind: 'file', fileId: 'file_01ABC' }],
          needsTranslation: false,
          isBuiltinCopy: false,
          updatedBy: userId,
        },
        T0 + 40,
      );
      expect(patched).toMatchObject({
        name: 'My reset',
        subject: 'Reset',
        preheader: 'Preview',
        footer: 'Legacy',
        brand: { name: 'Acme', mark: 'zap', accent: '#0d9488', fromName: 'Acme', fromEmail: 'hi@acme.test' },
        attachments: [{ id: 'a1', kind: 'file', fileId: 'file_01ABC' }],
        isBuiltinCopy: false,
        updatedBy: userId,
        updatedAt: T0 + 40,
      });
      // Enabled flips alone (the Draft/Live pill), and a brand can be cleared back to defaults.
      expect((await repo.patch(seeded.id, { enabled: false }))?.enabled).toBe(false);
      expect((await repo.patch(seeded.id, { brand: null }))?.brand).toBeNull();
      expect(await repo.patch('tpl_nope', { name: 'x' })).toBeNull();
      expect(await repo.removeById(ids.ar)).toBe(true);
      expect(await repo.removeById(ids.ar)).toBe(false);
    });

    it('a legacy row written by the old seed decodes with its footer lifted', async () => {
      await repo.upsert(
        'notification',
        'en_US',
        {
          name: 'Notification',
          subject: '{{title}}',
          blocks: [heading('heading', '{{title}}'), { block: 'email.footer', id: 'footer', data: { text: 'Turn these off in your preferences.' } }],
          enabled: true,
          isBuiltinCopy: true,
        },
        T0,
      );
      const row = await repo.findByKeyLocale('notification', 'en_US');
      expect(row?.footer).toBe('Turn these off in your preferences.');
      expect(row?.blocks.map((b) => b['id'])).toEqual(['heading']);
    });

    it('saved blocks: create, list newest first, remove', async () => {
      const blocks = emailBlocksRepo(t.meta);
      const a = await blocks.create({ name: 'Signature', block: { id: 'x', block: 'email.text', data: { paras: ['— Us'] } }, createdBy: userId }, T0);
      const b = await blocks.create({ name: 'Legal', block: { id: 'y', block: 'email.legal', data: { text: 'Fine print' } } }, T0 + 1);
      expect((await blocks.list()).map((s) => s.id)).toEqual([b.id, a.id]);
      expect((await blocks.findById(a.id))?.createdBy).toBe(userId);
      await expect(blocks.create({ name: 'Bad', block: { data: {} } })).rejects.toThrow();
      expect(await blocks.remove(a.id)).toBe(true);
      expect(await blocks.remove(a.id)).toBe(false);
      expect(await blocks.findById(a.id)).toBeNull();
    });

    it('runs: create → update through the lifecycle, latest per campaign, active gate', async () => {
      const runs = emailRunsRepo(t.meta);
      const c1 = await repo.create({ kind: 'campaign', key: 'digest', locale: 'en_US', name: 'Digest', subject: 'D', blocks: [] }, T0);
      const c2 = await repo.create({ kind: 'campaign', key: 'launch', locale: 'en_US', name: 'Launch', subject: 'L', blocks: [] }, T0);

      const old = await runs.create({ templateId: c1.id, audience: { kind: 'users', roleIds: ['role_1'] }, scheduledAt: T0, createdBy: userId }, T0);
      await runs.update(old.id, { status: 'sent', startedAt: T0, finishedAt: T0 + 9, total: 5, sent: 4, failed: 1, skipped: 0, failures: [{ to: 'x@y.z', error: 'refused' }] }, T0 + 9);
      expect(await runs.active(c1.id)).toBeNull();

      const scheduled = await runs.create({ templateId: c1.id, audience: { kind: 'users' }, scheduledAt: T0 + 60_000, jobId: 'job_1' }, T0 + 10);
      expect(await runs.active(c1.id)).toMatchObject({ id: scheduled.id, jobId: 'job_1' });

      const latest = await runs.latestByTemplates([c1.id, c2.id]);
      expect(latest.get(c1.id)?.id).toBe(scheduled.id);
      expect(latest.has(c2.id)).toBe(false);
      expect(await runs.latestByTemplates([])).toEqual(new Map());

      const history = await runs.listByTemplate(c1.id);
      expect(history.map((r) => r.id)).toEqual([scheduled.id, old.id]);
      expect(history[1]).toMatchObject({ status: 'sent', total: 5, sent: 4, failed: 1, failures: [{ to: 'x@y.z', error: 'refused' }], createdBy: userId });

      expect((await runs.update(scheduled.id, { status: 'cancelled', jobId: null, finishedAt: T0 + 20 }))?.status).toBe('cancelled');
      expect(await runs.active(c1.id)).toBeNull();
      expect(await runs.update('erun_nope', { status: 'sent' })).toBeNull();
      await expect(runs.update(old.id, { status: 'bogus' as never })).rejects.toThrow();
    });
  });
}
