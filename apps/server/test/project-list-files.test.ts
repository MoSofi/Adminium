// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `lists/<key>.json` — an option list as a project file (plan 50 D20).
 *
 * The list has to travel because the RULE that names it travels: a
 * `column.options` row in `schema/<database>.json` says `{"list":"stages"}`,
 * and in the next install that means nothing unless the list came too. The
 * three things this proves are the three ways that goes wrong: the file does
 * not match what the database writes, the key moves, or a rule names a list
 * nobody shipped.
 */
import { optionListsRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { missingListFindings } from '../src/cli/commands/check.js';
import { memoryFileStore } from '../src/project/file-store.js';
import { readListFile, toListFile } from '../src/project/list-files.js';
import { parseJsonText, stableStringify } from '../src/project/json.js';
import { checkProjectFile, offlineRefs, type FolderFile } from '../src/project/project-files.js';
import { reconcileProject } from '../src/project/reconcile.js';
import { makeInstall, type Install } from './project-fixtures.js';

const offline = offlineRefs(['main']);

describe('reading a list file', () => {
  it('takes a list with labels, tones and descriptions', () => {
    const result = readListFile(
      {
        name: 'Stages',
        items: [
          { value: 'new', label: 'New' },
          { value: 'won', label: 'Won', tone: 'success', description: 'Signed and countersigned' },
        ],
      },
      'stages',
    );
    expect(result).toEqual({
      ok: true,
      doc: {
        key: 'stages',
        name: 'Stages',
        origin: 'custom',
        items: [
          { value: 'new', label: 'New' },
          { value: 'won', label: 'Won', tone: 'success', description: 'Signed and countersigned' },
        ],
      },
    });
  });

  it('says what is wrong rather than storing it', () => {
    const problems = (value: unknown): string[] => {
      const result = readListFile(value, 'stages');
      return result.ok ? [] : result.problems;
    };
    expect(problems({ items: [{ value: 'a' }] })).toEqual(['name: must be what this list is called']);
    expect(problems({ name: 'Stages', items: [] })).toEqual(['items: a list with no values is not a list']);
    expect(problems({ name: 'Stages', items: [{ value: 'a' }, { value: 'a' }] })).toEqual([
      'items[1]: "a" is listed twice',
    ]);
    expect(problems({ name: 'Stages', items: [{ value: 'a', colour: 'red' }] })).toEqual([
      'items[0].colour: is not a known key',
    ]);
    expect(problems({ name: 'Stages', key: 'stages', items: [{ value: 'a' }] })).toEqual(['key: is not a known key']);
  });
});

describe('a list between the folder and the database', () => {
  let install: Install;
  let store: ReturnType<typeof memoryFileStore>;

  beforeEach(async () => {
    install = await makeInstall();
    store = memoryFileStore();
  });
  afterEach(async () => {
    await install.close();
  });

  it('writes a list Studio made, and reads the same file back as the same list', async () => {
    const lists = optionListsRepo(install.meta);
    await lists.create({
      key: 'stages',
      name: 'Stages',
      items: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won', tone: 'success' }],
      origin: 'copy:builtin:gender',
    });

    const written = await reconcileProject({ meta: install.meta, store, mode: 'dev' });
    expect(written.written).toContain('lists/stages.json');
    const text = store.files.get('lists/stages.json') ?? '';
    // The id and the timestamps are this install's; the key is the file name.
    expect(JSON.parse(text)).toEqual({
      $schema: '../node_modules/@adminiumjs/adminium/schemas/list.json',
      name: 'Stages',
      origin: 'copy:builtin:gender',
      items: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won', tone: 'success' }],
    });

    // Nothing moved, so a second pass has nothing to do.
    expect(await reconcileProject({ meta: install.meta, store, mode: 'dev' })).toMatchObject({
      written: [],
      applied: [],
      warnings: [],
    });
  });

  it('applies an edited file onto the same list, keeping its id', async () => {
    const lists = optionListsRepo(install.meta);
    await lists.create({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] });
    await reconcileProject({ meta: install.meta, store, mode: 'dev' });
    const before = await lists.findByKey('stages');

    const parsed = parseJsonText(store.files.get('lists/stages.json') ?? '');
    if (!parsed.ok) throw new Error(parsed.message);
    const value = parsed.value as Record<string, unknown>;
    value['items'] = [{ value: 'new' }, { value: 'won', label: 'Won' }];
    store.files.set('lists/stages.json', stableStringify(value));

    const report = await reconcileProject({ meta: install.meta, store, mode: 'dev' });
    expect(report.applied).toEqual(['lists/stages.json']);
    const after = await lists.findByKey('stages');
    expect(after?.items).toEqual([{ value: 'new' }, { value: 'won', label: 'Won' }]);
    // The same list, not a new one: rules, and other installs, name the key.
    expect(after?.id).toBe(before?.id);
  });

  it('removes the list a deleted file no longer describes', async () => {
    const lists = optionListsRepo(install.meta);
    await lists.create({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] });
    await reconcileProject({ meta: install.meta, store, mode: 'dev' });
    store.files.delete('lists/stages.json');

    const report = await reconcileProject({ meta: install.meta, store, mode: 'dev' });
    expect(report.removed).toEqual(['lists/stages.json']);
    expect(await lists.findByKey('stages')).toBeNull();
  });
});

describe('check', () => {
  const schemaFile = (list: string): FolderFile =>
    checkProjectFile(
      'schema/main.json',
      JSON.stringify({
        overrides: [{ table: 'public.deals', column: 'stage', op: 'column.options', value: { list } }],
      }),
      offline,
    );

  it('refuses a rule whose list is neither a file nor a built-in', () => {
    expect(missingListFindings([schemaFile('stages')])).toEqual([
      {
        level: 'error',
        text: 'schema/main.json: overrides[0] uses the list "stages", and there is no lists/stages.json.',
      },
    ]);
  });

  it('accepts one the project carries, and one that is code', () => {
    const list = checkProjectFile('lists/stages.json', '{"name":"Stages","items":[{"value":"new"}]}', offline);
    expect(missingListFindings([schemaFile('stages'), list])).toEqual([]);
    // The built-ins ship with Adminium, so a project that uses them carries
    // nothing at all.
    expect(missingListFindings([schemaFile('builtin:countries')])).toEqual([]);
  });
});
