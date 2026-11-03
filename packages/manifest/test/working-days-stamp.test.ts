// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addWorkingDays` as the manifest can see it: a print job's ready-by, so
 * many working days after it comes in, its week and cut-off the app's own
 * settings, its closures a table of the app. Each test breaks one thing.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const CLOSURES = { table: 'closures', from: 'starts_on', to: 'ends_on', active: 'active' };

function working(): Doc {
  return { from: 'received_at', days: 'service', map: { standard: 3, express: 1 }, weekdays: 'working_days', cutoff: 'cutoff', closures: { ...CLOSURES } };
}

function manifest(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'works',
    name: 'Works',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A print works' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.43' },
    settings: [
      { key: 'working_days', type: 'string', default: 'mon,tue,wed,thu,fri' },
      { key: 'cutoff', type: 'string', default: '14:00' },
      { key: 'rush_days', type: 'number', default: 1 },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'closures', columns: [id, { ref: 'name', type: 'text', maxLength: 60 }, { ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date' }, { ref: 'active', type: 'bool', default: true }] },
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'received_at', type: 'timestamptz', nullable: true },
            { ref: 'note', type: 'text', maxLength: 40, nullable: true },
            { ref: 'pages', type: 'int', nullable: true },
            { ref: 'service', type: 'enum', enum: ['standard', 'express'], default: 'standard' },
            { ref: 'ready_by', type: 'date', nullable: true, rules: { stamp: { set: { addWorkingDays: working() }, on: { columns: ['received_at', 'service'] } } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'jobs', template: 'page-crud', title: { key: 't', fallback: 'Jobs' }, nav: { group: 'works', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

const jobs = (m: Doc) => ((m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'jobs')!['columns'] as Doc[]);
const readyBy = (m: Doc) => jobs(m).find((c) => c['ref'] === 'ready_by')!;
const rule = (m: Doc) => ((readyBy(m)['rules'] as { stamp: { set: { addWorkingDays: Doc } } }).stamp.set.addWorkingDays);
const issues = (m: Doc) => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const text = (m: Doc) => issues(m).join('\n');

describe('addWorkingDays', () => {
  it('takes a ready-by from the time a job comes in, its week and cut-off settings, and its closures', () => {
    expect(issues(manifest())).toEqual([]);
    // A week and a cut-off stated in the rule; counted from now; a plain number of days.
    const m = manifest();
    Object.assign(rule(m), { from: 'now', days: 3, weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], cutoff: '17:00' });
    delete rule(m)['map'];
    expect(issues(m)).toEqual([]);
  });

  it('writes a date column', () => {
    const m = manifest();
    readyBy(m)['type'] = 'timestamptz';
    expect(text(m)).toContain('a date so many working days on needs a date column');
  });

  it('counts from now or a date or moment of the row', () => {
    let m = manifest();
    rule(m)['from'] = 'note';
    expect(text(m)).toContain('"jobs.note" is neither a date nor a moment');
    m = manifest();
    rule(m)['from'] = 'nope';
    expect(text(m)).toContain('"jobs" has no column "nope"');
    m = manifest();
    rule(m)['from'] = 'ready_by';
    expect(text(m)).toContain('working days are counted from another column');
  });

  it('counts a number of days 0–3650, a whole-number column, or a choice with each value mapped', () => {
    let m = manifest();
    rule(m)['days'] = 3651;
    expect(issues(m).length).toBeGreaterThan(0);
    m = manifest();
    rule(m)['days'] = -1;
    expect(issues(m).length).toBeGreaterThan(0);
    m = manifest();
    rule(m)['map'] = { standard: 3 };
    expect(text(m)).toContain('each value of "jobs.service" needs its days (express)');
    m = manifest();
    rule(m)['days'] = 'note';
    delete rule(m)['map'];
    expect(text(m)).toContain('each value of "jobs.note" needs its days');
    m = manifest();
    rule(m)['days'] = 'pages';
    delete rule(m)['map'];
    expect(issues(m)).toEqual([]);
  });

  it('names known days, each once, and never an empty week', () => {
    let m = manifest();
    rule(m)['weekdays'] = ['mon', 'mon'];
    expect(text(m)).toContain('a working week names each day once');
    m = manifest();
    rule(m)['weekdays'] = ['monday'];
    expect(issues(m).length).toBeGreaterThan(0);
    m = manifest();
    rule(m)['weekdays'] = [];
    expect(issues(m).length).toBeGreaterThan(0);
  });

  it('reads a cut-off as HH:MM on a 24-hour clock', () => {
    for (const bad of ['24:00', '9:30', '14:60', '2pm']) {
      const m = manifest();
      rule(m)['cutoff'] = bad;
      expect(issues(m).length, bad).toBeGreaterThan(0);
    }
  });

  it('names only a string setting the app declares', () => {
    let m = manifest();
    rule(m)['weekdays'] = 'week';
    expect(text(m)).toContain('the app declares no setting "week"');
    m = manifest();
    rule(m)['cutoff'] = 'rush_days';
    expect(text(m)).toContain('the setting "rush_days" is a number: a working week or a cut-off is kept in a string setting');
  });

  it('reads closures from a table of the app with two dates and a yes/no', () => {
    let m = manifest();
    (rule(m)['closures'] as Doc)['table'] = 'nope';
    expect(text(m)).toContain('"nope" is not a table of this app');
    m = manifest();
    (rule(m)['closures'] as Doc)['from'] = 'name';
    expect(text(m)).toContain('"closures.name" is not a date');
    m = manifest();
    (rule(m)['closures'] as Doc)['to'] = 'nope';
    expect(text(m)).toContain('"closures" has no column "nope"');
    m = manifest();
    (rule(m)['closures'] as Doc)['active'] = 'name';
    expect(text(m)).toContain('"closures.name" is not a yes/no');
    m = manifest();
    delete (rule(m)['closures'] as Doc)['active'];
    expect(issues(m)).toEqual([]);
  });
});
