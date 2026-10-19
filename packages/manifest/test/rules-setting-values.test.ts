// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A value a rule's step writes read from the app's settings row, and a day so
 * many days on, as the manifest check reads them: an aftercare call made when
 * a job is signed off, owned by the person the settings row names, due the
 * number of days the settings row holds after the sign-off.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });

type Values = Record<string, unknown>;

/** A firm whose rule writes `values` into a follow-up when a job is signed off. */
function firm(values: Values, trigger: Record<string, unknown> = { kind: 'record', event: 'updated', table: 'jobs', changedColumn: 'state' }): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'firm',
    name: 'Firm',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.firm.desc', fallback: 'A firm.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'settings',
          columns: [
            id,
            { ref: 'aftercare_days', type: 'int', nullable: true },
            { ref: 'aftercare_owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'greeting', type: 'text', maxLength: 80, nullable: true },
            { ref: 'pin', type: 'text', maxLength: 12, nullable: true, rules: { secret: true } },
            { ref: 'owner_phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          ],
        },
        { ref: 'diary', private: true, belongs: [{ column: 'owner_id' }], columns: [id, { ref: 'owner_id', type: 'text', maxLength: 36, rules: { staff: true } }, { ref: 'days', type: 'int', default: 1 }] },
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'enum', enum: ['open', 'signed-off'], default: 'open' },
            { ref: 'signed_on', type: 'date', nullable: true },
            { ref: 'signed_at', type: 'timestamptz', nullable: true },
            { ref: 'born_on', type: 'date', nullable: true, rules: { personal: true } },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          ],
        },
        {
          ref: 'follow_ups',
          columns: [
            id,
            { ref: 'job_id', type: 'fk', references: 'jobs' },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'due_at', type: 'timestamptz', nullable: true },
            { ref: 'due_on', type: 'date', nullable: true },
            { ref: 'text', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    roles: [{ key: 'office', name: 'Office', permissions: ['table:@jobs:read', 'page:@firm-jobs:view'] }],
    pages: [{ ref: 'firm-jobs', template: 'page-crud', title: { key: 't.jobs', fallback: 'Jobs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
    automations: [
      {
        key: 'aftercare',
        name: en('A job signed off: an aftercare call'),
        enabled: true,
        trigger,
        graph: flow({ id: 'call', kind: 'action', title: 'Book the call', action: { kind: 'record.create', table: 'follow_ups', values: { job_id: '{{record.id}}', ...values } } }),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const RULE_16: Values = {
  owner_id: { setting: { table: 'settings', column: 'aftercare_owner_id' } },
  due_at: { daysAfter: { column: 'signed_at', days: 28, setting: { table: 'settings', column: 'aftercare_days' }, at: '09:00' } },
  due_on: { daysAfter: { column: 'signed_on', days: 28, setting: { table: 'settings', column: 'aftercare_days' } } },
  text: 'Aftercare call for {{record.name}}',
};

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};
const said = (values: Values, trigger?: Record<string, unknown>): string => issuesOf(firm(values, trigger)).join('\n');

describe('a value read from the settings row, and a day so many days on', () => {
  it('validates, is kept as written, and asks for the release that runs it', () => {
    expect(issuesOf(firm(RULE_16))).toEqual([]);
    const result = validateManifest(firm(RULE_16));
    if (!result.ok) throw new Error('expected a manifest');
    const step = result.manifest.automations![0]!.graph.nodes[1] as { action: { values: Values } };
    expect(step.action.values['due_at']).toEqual(RULE_16['due_at']);
    const words = installFloorWords(firm(RULE_16)).map((found) => `${found.word} ${found.path}`);
    expect(words).toContain('automations.settingValue automations.0.graph.nodes.1.action.values.owner_id');
    expect(words).toContain('automations.daysAfter automations.0.graph.nodes.1.action.values.due_at');
    expect(WORD_FLOORS['automations.settingValue']).toBe('0.3.28');
    expect(WORD_FLOORS['automations.daysAfter']).toBe('0.3.28');
    const older = firm(RULE_16);
    (older['compatibility'] as Record<string, unknown>)['minAdminiumVersion'] = '0.3.27';
    expect(issuesOf(older).join('\n')).toMatch(/automations\.settingValue|automations\.daysAfter/);
    // Days after now, with no setting: a rule by the clock has no record, but "now" needs none.
    expect(said({ due_on: { daysAfter: { now: true, days: 3 } } })).toBe('');
  });

  it('reads a setting only of the manifest’s own tables, never a secret, a personal column or a private table', () => {
    expect(said({ text: { setting: { table: 'nope', column: 'greeting' } } })).toContain('"nope" is not one of this manifest\'s tables');
    expect(said({ text: { setting: { table: 'settings', column: 'nope' } } })).toContain('"settings" has no column "nope"');
    expect(said({ text: { setting: { table: 'settings', column: 'pin' } } })).toContain('"settings.pin" is a secret column');
    expect(said({ text: { setting: { table: 'settings', column: 'owner_phone' } } })).toContain('"settings.owner_phone" is a personal column');
    expect(said({ owner_id: { setting: { table: 'diary', column: 'owner_id' } } })).toContain('"diary" is private');
    expect(said({ due_on: { daysAfter: { now: true, days: 1, setting: { table: 'diary', column: 'days' } } } })).toContain('"diary" is private');
  });

  it('fills a staff column from a staff column, and any other from a column of its own kind', () => {
    expect(said({ owner_id: { setting: { table: 'settings', column: 'greeting' } } })).toContain('"follow_ups.owner_id" holds a staff member, and "settings.greeting" is not a staff column');
    expect(said({ due_on: { setting: { table: 'settings', column: 'aftercare_days' } } })).toContain('"settings.aftercare_days" is int and "follow_ups.due_on" is date');
    expect(said({ text: { setting: { table: 'settings', column: 'greeting' } } })).toBe('');
  });

  it('gives a staff column, when the setting names nobody, the person a staff column of the record names (else, 0.3.29)', () => {
    const withElse = (path: string): Values => ({ owner_id: { setting: { table: 'settings', column: 'aftercare_owner_id' }, else: { staff: path } } });
    const doc = firm(withElse('owner_id'));
    (doc['compatibility'] as Record<string, unknown>)['minAdminiumVersion'] = '0.3.29';
    expect(issuesOf(doc)).toEqual([]);
    expect(installFloorWords(doc).map((found) => `${found.word} ${found.path}`)).toContain('automations.settingElse automations.0.graph.nodes.1.action.values.owner_id');
    expect(WORD_FLOORS['automations.settingElse']).toBe('0.3.29');
    // At 0.3.28 the release that reads it is named.
    expect(said(withElse('owner_id'))).toMatch(/automations\.settingElse/);
    const at29 = (values: Values): string => {
      const one = firm(values);
      (one['compatibility'] as Record<string, unknown>)['minAdminiumVersion'] = '0.3.29';
      return issuesOf(one).join('\n');
    };
    expect(at29(withElse('name'))).toContain('"jobs.name"');
    expect(at29(withElse('nope'))).toContain('"jobs" has no column "nope"');
    expect(at29({ text: { setting: { table: 'settings', column: 'greeting' }, else: { staff: 'owner_id' } } })).toContain('"follow_ups.text" holds no staff member');
  });

  it('counts days from a date of the record, into a date, by a whole-number setting', () => {
    expect(said({ text: { daysAfter: { now: true, days: 1 } } })).toContain('"follow_ups.text" is text: a day so many days on is written into a date column');
    expect(said({ due_on: { daysAfter: { column: 'name', days: 1 } } })).toContain('"jobs.name" is text: days are counted from a date');
    expect(said({ due_on: { daysAfter: { column: 'nope', days: 1 } } })).toContain('"jobs" has no column "nope"');
    expect(said({ due_on: { daysAfter: { column: 'born_on', days: 1 } } })).toContain('"jobs.born_on" is a protected column: a day counted from it would tell it');
    expect(said({ due_on: { daysAfter: { column: 'signed_on', days: 1, setting: { table: 'settings', column: 'greeting' } } } })).toContain('"settings.greeting" is not a whole-number column');
    expect(said({ due_on: { daysAfter: { column: 'signed_on', days: 1, at: '09:00' } } })).toContain('"follow_ups.due_on" holds a day, which has no time of day');
    expect(said({ due_on: { daysAfter: { column: 'signed_on', now: true, days: 1 } } })).toContain('one of the two');
    expect(said({ due_on: { daysAfter: { days: 1 } } })).toContain('one of the two');
    expect(said({ due_on: { daysAfter: { now: true, days: 3651 } } })).not.toBe('');
    // A clock with no rows to visit has no record to count from.
    expect(said({ due_on: { daysAfter: { column: 'signed_on', days: 1 } } }, { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' } })).toContain('no date of it to count from');
  });
});
