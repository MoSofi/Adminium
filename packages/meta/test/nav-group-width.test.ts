// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium_pages.nav_group` must hold the slugs the LLM layer is allowed to
 * propose (0032_nav_group_width.ts).
 *
 * THE BUG THIS PINS. The column was `str(12)` from 0004, and the enrichment
 * response's `NavGroupSuggestion.id` had no length bound at all. Any two-word
 * slug a model reasonably picks — `client-management` — was longer, and
 * PostgreSQL answered `value too long for type character varying(12)` from
 * inside the apply transaction, as an unhandled 500, on a screen that had just
 * promised "one transaction and can be undone".
 *
 * WHY NO EXISTING TEST SAW IT. `str(n)` is `varchar(n)` on PostgreSQL and MySQL
 * and plain `text` on SQLite (../src/columns.ts), because SQLite enforces no
 * length. Every unit suite and the default e2e leg run on SQLite, where a
 * 17-character slug fits a 12-character column perfectly well. So this asserts
 * on EVERY available dialect, and the two engines that can fail are the two it
 * matters on.
 */
import { describe, expect, it } from 'vitest';

import { applyMigrations, pagesRepo } from '../src/index.js';
import { NAV_GROUP_MAX } from '../src/migrations/0032_nav_group_width.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

// The two copies of the number are held equal in `apps/server`, which is the
// lowest layer that depends on BOTH packages — this one may not import
// `@adminium/llm` at all (the arrow runs the other way).

for (const dialect of TEST_DIALECTS.filter((d) => d.available)) {
  describe(`nav_group width [${dialect.name}]`, () => {
    it('stores a slug of the full permitted length', async () => {
      let db: TestDb | null = null;
      try {
        db = await dialect.make();
        await applyMigrations(db.meta.db, { dialect: db.meta.dialect });

        const slug = 'g'.repeat(NAV_GROUP_MAX);
        const page = await pagesRepo(db.meta).create({
          slug: 'nav-width-probe',
          type: 'crud',
          title: 'Probe',
          config: {},
          navGroup: slug,
          navOrder: 0,
        });
        expect(page.navGroup).toBe(slug);

        const read = await pagesRepo(db.meta).findById(page.id);
        expect(read?.navGroup).toBe(slug);
      } finally {
        await db?.destroy();
      }
    });
  });
}
