// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `sampleData.people` and `.teams`, and the bundle word that names a sample
 * person (`{"@person": "<key>"}`): what the manifest and the bundle checks
 * accept, and what they refuse.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, sampleBundleIssues, sampleBundleSchema, sampleDirective, samplePeopleIn, validateManifest, type Manifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function crm(change: (sample: Record<string, any>, doc: Record<string, any>) => void = () => {}, floor = '0.3.27'): Record<string, any> {
  const doc: Record<string, any> = {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'amount', type: 'int', nullable: true }] },
        { ref: 'views', columns: [id, { ref: 'filters', type: 'json' }] },
      ],
    },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'page:@crm-deals:view'] }],
    sampleData: {
      file: 'seeds/crm.json',
      people: [
        { key: 'dana', name: 'Dana Whitlock', email: 'dana@meridian.example', role: 'rep' },
        { key: 'ivy', name: 'Ivy Sandoval' },
      ],
      teams: [{ name: 'Sales', lead: 'ivy', members: ['dana'] }],
    },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
  change(doc['sampleData'], doc);
  return doc;
}

const said = (doc: Record<string, unknown>): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

describe('sample people in the manifest', () => {
  it('are accepted, with a team and its lead', () => {
    expect(said(crm())).toBe('');
  });

  it('need the floor that first reads them, people and teams alike', () => {
    expect(installFloorWords(crm()).filter((found) => found.word === 'sampleData.people').map((found) => found.path)).toEqual(['sampleData.people', 'sampleData.teams']);
    expect(said(crm(() => {}, '0.3.26'))).toMatch(/0\.3\.27/);
  });

  it('are each listed once, with a role the app has', () => {
    expect(said(crm((sample) => sample['people'].push({ key: 'dana', name: 'Another Dana' })))).toMatch(/sampleData\.people\.2\.key: "dana" is listed twice/);
    expect(said(crm((sample) => (sample['people'][0].role = 'boss')))).toMatch(/"boss" is not one of this app's roles/);
    expect(said(crm((sample) => (sample['people'][0].key = 'Dana W')))).toMatch(/a short key/);
    expect(said(crm((sample) => (sample['people'][0].email = 'not an address')))).toMatch(/an email address/);
  });

  it('make teams of the people listed, each once', () => {
    expect(said(crm((sample) => sample['teams'][0].members.push('nobody')))).toMatch(/"nobody" is not one of sampleData\.people/);
    expect(said(crm((sample) => (sample['teams'][0].lead = 'nobody')))).toMatch(/"nobody" is not one of sampleData\.people/);
    expect(said(crm((sample) => sample['teams'][0].members.push('ivy')))).toMatch(/"ivy" is in "Sales" twice/);
    expect(said(crm((sample) => sample['teams'].push({ name: 'Sales', members: ['dana'] })))).toMatch(/"Sales" is listed twice/);
  });
});

describe('a sample row that names a person', () => {
  const manifest = () => validateManifestOk(crm());
  const bundle = (rows: Record<string, unknown>[], views: Record<string, unknown>[] = []) =>
    sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'crm', tables: [{ ref: 'deals', rows }, ...(views.length === 0 ? [] : [{ ref: 'views', rows: views }])] });
  const issues = (rows: Record<string, unknown>[], views: Record<string, unknown>[] = []) => sampleBundleIssues(bundle(rows, views), manifest()).map((issue) => issue.message);

  it('reads the word, alone and inside a json value', () => {
    expect(sampleDirective({ '@person': 'dana' })).toEqual({ kind: 'person', key: 'dana' });
    expect(samplePeopleIn({ rep: { '@person': 'sam' }, any: [{ '@person': 'dana' }, 'open'], on: { '@day': 1 } })).toEqual(['sam', 'dana']);
    expect(samplePeopleIn('dana')).toEqual([]);
  });

  it('is accepted in a staff column and inside a json value', () => {
    expect(issues([{ name: 'Desk rows', owner_id: { '@person': 'dana' } }], [{ filters: { rep: { '@person': 'ivy' }, over: 20000 } }])).toEqual([]);
  });

  it('names a person the manifest lists', () => {
    expect(issues([{ name: 'Desk rows', owner_id: { '@person': 'sam' } }]).join('\n')).toMatch(/"sam" is not one of the manifest's sample people/);
    expect(issues([{ name: 'x' }], [{ filters: { rep: { '@person': 'sam' } } }]).join('\n')).toMatch(/"sam" is not one of the manifest's sample people/);
  });

  it('goes in a text column', () => {
    expect(issues([{ name: 'Desk rows', amount: { '@person': 'dana' } }]).join('\n')).toMatch(/is not a text column, so it cannot hold a staff member/);
  });

  it('is malformed with anything beside it', () => {
    expect(issues([{ name: 'Desk rows', owner_id: { '@person': 'dana', extra: 1 } }]).join('\n')).toMatch(/holds a directive that is not well formed/);
  });
});

function validateManifestOk(doc: Record<string, unknown>): Manifest {
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
  return result.manifest;
}
