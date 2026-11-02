// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a stranger's answer to a form is counted by (wave 0073), on every
 * available dialect: a mark counts from its moment, by subject and purpose;
 * a mark taken back counts no more; the oldest mark in a window says when it
 * opens again; the sweep takes what is older; and every bounded column takes
 * its full width, and refuses one character more.
 */
import { describe, expect, it } from 'vitest';

import { FORM_MARK_PURPOSE_WIDTH, FORM_MARK_SUBJECT_WIDTH, formMarksRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`what a form's answers are counted by [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('counts by subject and purpose from a moment, takes marks back, and says when a window opens', async () => {
      const marks = formMarksRepo(meta());
      const first = await marks.mark({ subject: 'form:a', purpose: 'answer' }, 1_000);
      await marks.mark({ subject: 'form:a', purpose: 'answer' }, 2_000);
      await marks.mark({ subject: 'form:a', purpose: 'alert' }, 2_500);
      await marks.mark({ subject: 'form:b', purpose: 'answer' }, 3_000);
      expect(first.startsWith('fmk_')).toBe(true);
      expect(await marks.sentSince('form:a', 0, 'answer')).toBe(2);
      expect(await marks.sentSince('form:a', 1_500, 'answer')).toBe(1);
      expect(await marks.sentSince('form:a', 0)).toBe(3);
      expect(await marks.oldestSince('form:a', 0, 'answer')).toBe(1_000);
      expect(await marks.oldestSince('form:a', 1_500, 'answer')).toBe(2_000);
      expect(await marks.oldestSince('form:c', 0, 'answer')).toBeNull();
      await marks.unmark([first]);
      expect(await marks.sentSince('form:a', 0, 'answer')).toBe(1);
      expect(await marks.prune(2_600)).toBe(2);
      expect(await marks.sentSince('form:b', 0, 'answer')).toBe(1);
    });

    it('takes the full width of every bounded column, and refuses one more', async () => {
      const marks = formMarksRepo(meta());
      const subject = 's'.repeat(FORM_MARK_SUBJECT_WIDTH);
      const purpose = 'p'.repeat(FORM_MARK_PURPOSE_WIDTH);
      await marks.mark({ subject, purpose }, 5_000);
      expect(await marks.sentSince(subject, 0, purpose)).toBe(1);
      const row = await meta().db.selectFrom('adminium_form_marks').selectAll().where('subject', '=', subject).executeTakeFirstOrThrow();
      expect([row.subject, row.purpose]).toEqual([subject, purpose]);
      await expect(marks.mark({ subject: `${subject}s`, purpose: 'answer' })).rejects.toThrow();
      await expect(marks.mark({ subject: 'form:a', purpose: `${purpose}p` })).rejects.toThrow();
    });
  });
}
