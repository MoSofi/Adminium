// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which column a choice's CHECK is about, read off each engine's own text.
 *
 * A table whose states include `change_asked` gains a column `change_asked`:
 * the state column's CHECK names `change_asked` as a VALUE, and the column of
 * that name is not the one the rule is about. Read as it was, the longest
 * name in the text won, the rule was put on the new number column, and the
 * update failed on Postgres and MySQL.
 */
import { describe, expect, it } from 'vitest';

import { enumCheckColumn, parseEnumCheck } from '../src/ddl/edit.js';

const COLUMNS = ['id', 'state', 'change_asked', 'answered_at'];

describe("a choice's CHECK, named by its column", () => {
  it('is the state column on every engine, though a value is spelled like another column', () => {
    const postgres = `((state)::text = ANY ((ARRAY['sent'::character varying, 'approved'::character varying, 'change_asked'::character varying])::text[]))`;
    const mysql = "(`state` in (_utf8mb4'sent',_utf8mb4'approved',_utf8mb4'change_asked'))";
    const sqlite = "state in ('sent','approved','change_asked')";
    const authored = 'state in ("sent", "approved", "change_asked")';
    for (const text of [postgres, mysql, sqlite, authored]) {
      expect(enumCheckColumn(text, COLUMNS), text).toBe('state');
      expect(parseEnumCheck(text, COLUMNS), text).toEqual({ column: 'state', values: ['sent', 'approved', 'change_asked'] });
    }
  });

  it('still prefers the longer of two names it finds outside the values', () => {
    expect(enumCheckColumn("((status_id)::text = ANY ((ARRAY['a'::text])))", ['status', 'status_id'])).toBe('status_id');
    expect(enumCheckColumn("note in ('it''s state')", ['note', 'state'])).toBe('note');
  });
});
