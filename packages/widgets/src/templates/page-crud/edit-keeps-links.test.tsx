// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * An edit keeps the links a record has.
 *
 * The form takes the record's links once, as it opens, and a save replaces
 * each link field's set with what the form holds. The links are read when Edit
 * is pressed, so a dialog that opened before they arrived held none, and a
 * save that never touched the field unlinked everything. A relation whose
 * read failed was the same empty set. Both pages that edit a row are pinned
 * here: the list and the record page.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import type { FormRelationFact } from '../../page-config/index.js';
import { PageRecord } from '../page-record/PageRecord.js';
import { PageCrud } from './PageCrud.js';
import type { CrudApi } from './crud-api.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const ROW = { id: 1, name: 'Acme' };

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', nullable: false, isDisplay: true, maxLength: 120 }),
];

const RELATIONS: FormRelationFact[] = [
  { relationId: 'm2m:tags', label: 'Tags', targetTable: 'public.tags', targetKey: 'id', targetName: 'name' },
  { relationId: 'm2m:owners', label: 'Owners', targetTable: 'public.people', targetKey: 'id', targetName: 'name' },
];

/** A read the test answers when it chooses: the links arrive after the click. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeApi() {
  const tags = deferred<{ key: string; name: string }[]>();
  const owners = deferred<{ key: string; name: string }[]>();
  const api = {
    list: vi.fn(async () => ({ data: [ROW], cursor: { next: null } })),
    get: vi.fn(async () => ({ data: ROW, inboundCounts: [] })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
    links: vi.fn((_recordId: string, relationId: string) => (relationId === 'm2m:tags' ? tags.promise : owners.promise)),
  };
  return { api, tags, owners };
}

/** What the save asked each link field to end up as. */
function savedLinks(api: ReturnType<typeof makeApi>['api']): Record<string, string[]> | undefined {
  return (api.update.mock.calls[0] as unknown[] | undefined)?.[2] as Record<string, string[]> | undefined;
}

async function save(user: ReturnType<typeof userEvent.setup>, api: ReturnType<typeof makeApi>['api']) {
  const dialog = await screen.findByRole('dialog', { name: /edit/i });
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
}

describe('an edit on the list keeps the record’s links', () => {
  const openEdit = async (api: ReturnType<typeof makeApi>['api']) => {
    const user = userEvent.setup();
    render(
      <PageCrud
        api={api as unknown as CrudApi}
        columns={columns}
        formRelations={RELATIONS}
        source={{ connectionId: 'conn_1', table: 'public.projects' }}
      />,
    );
    await user.click((await screen.findAllByRole('button', { name: 'Peek' }))[0]!);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    return user;
  };

  it('sends the links the record has when the field was not touched', async () => {
    const { api, tags, owners } = makeApi();
    const user = await openEdit(api);
    tags.resolve([{ key: '5', name: 'Urgent' }]);
    owners.resolve([{ key: '9', name: 'Ava' }]);
    await save(user, api);
    expect(savedLinks(api)).toEqual({ 'm2m:tags': ['5'], 'm2m:owners': ['9'] });
  });

  it('sends no replace for a relation it could not read', async () => {
    const { api, tags, owners } = makeApi();
    const user = await openEdit(api);
    tags.resolve([{ key: '5', name: 'Urgent' }]);
    owners.reject(new Error('forbidden'));
    await save(user, api);
    expect(savedLinks(api)).toEqual({ 'm2m:tags': ['5'] });
  });
});

describe('an edit on the record page keeps the record’s links', () => {
  const openEdit = async (api: ReturnType<typeof makeApi>['api']) => {
    const user = userEvent.setup();
    render(
      <PageRecord
        api={api as unknown as CrudApi}
        columns={columns}
        relations={RELATIONS}
        source={{ connectionId: 'conn_1', table: 'public.projects' }}
        recordId="1"
        keyField="name"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    return user;
  };

  it('sends the links the record has, though Edit was pressed before they arrived', async () => {
    const { api, tags, owners } = makeApi();
    const user = await openEdit(api);
    tags.resolve([{ key: '5', name: 'Urgent' }]);
    owners.resolve([{ key: '9', name: 'Ava' }]);
    await save(user, api);
    expect(savedLinks(api)).toEqual({ 'm2m:tags': ['5'], 'm2m:owners': ['9'] });
  });

  it('sends no replace for a relation it could not read', async () => {
    const { api, tags, owners } = makeApi();
    const user = await openEdit(api);
    tags.resolve([{ key: '5', name: 'Urgent' }]);
    owners.reject(new Error('forbidden'));
    await save(user, api);
    expect(savedLinks(api)).toEqual({ 'm2m:tags': ['5'] });
  });
});
