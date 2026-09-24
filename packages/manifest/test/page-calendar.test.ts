// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A calendar page's `config.calendar`: the columns it plots by, checked
 * against the app's own tables. A manifest that names them right validates;
 * each test breaks one name and reads the sentence that points at it.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(calendar: unknown, template = 'page-calendar') {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'clinic',
    name: 'Clinic',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A clinic.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'patients', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'visit_types', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'appointments',
          columns: [
            id,
            { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
            { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
            { ref: 'new_born_on', type: 'date', nullable: true },
            { ref: 'starts_at', type: 'timestamptz' },
            { ref: 'ends_at', type: 'timestamptz', nullable: true },
            { ref: 'reason', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'clinic-appointments',
        template,
        title: { key: 'a', fallback: 'Appointments' },
        nav: { group: 'records', icon: 'calendar', order: 1 },
        bindings: { rows: 'appointments' },
        config: { calendar },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const issuesOf = (calendar: unknown, template?: string) => {
  const result = validateManifest(manifest(calendar, template));
  return result.ok ? [] : result.issues;
};

describe('a calendar page names its columns', () => {
  it('validates a start, an end, a title through a key and a category', () => {
    expect(issuesOf({ start: 'starts_at', end: 'ends_at', title: 'patient_id.name', category: 'visit_type_id' })).toEqual([]);
    expect(issuesOf({ start: 'starts_at', title: 'reason' })).toEqual([]);
  });

  it('refuses a start that is not a date, or no column at all', () => {
    expect(issuesOf({ start: 'reason' })).toEqual([
      { path: 'pages.0.config.calendar.start', message: '"appointments.reason" is not a date or a timestamptz' },
    ]);
    expect(issuesOf({ start: 'starts_on' })).toEqual([{ path: 'pages.0.config.calendar.start', message: '"appointments" has no column "starts_on"' }]);
    expect(issuesOf({ title: 'reason' }).map((issue) => issue.path)).toEqual(['pages.0.config.calendar.start']);
  });

  it('refuses a title through a column that is no key, or to a column its table lacks', () => {
    expect(issuesOf({ start: 'starts_at', title: 'reason.name' })).toEqual([
      { path: 'pages.0.config.calendar.title', message: '"appointments.reason" is not a foreign key' },
    ]);
    expect(issuesOf({ start: 'starts_at', title: 'patient_id.nickname' })).toEqual([
      { path: 'pages.0.config.calendar.title', message: '"patients" has no column "nickname"' },
    ]);
  });

  it('refuses a category it does not have, an unknown key, and a calendar on another template', () => {
    expect(issuesOf({ start: 'starts_at', category: 'colour' })).toEqual([
      { path: 'pages.0.config.calendar.category', message: '"appointments" has no column "colour"' },
    ]);
    expect(issuesOf({ start: 'starts_at', colour: 'red' }).map((issue) => issue.path)).toEqual(['pages.0.config.calendar']);
    expect(issuesOf({ start: 'starts_at' }, 'page-crud')).toEqual([
      { path: 'pages.0.config.calendar', message: 'only a page-calendar plots by named columns, not a page-crud' },
    ]);
  });
});
