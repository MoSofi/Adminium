// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A Postgres `text[]` column in the form. The generator marks it `list` and
 * the form edits it as chips, sending a JSON array. It used to be a plain text
 * input holding `red,blue`, which Postgres refused as an array literal.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { buildColumnDef } from '../../generate/crud-body.js';
import { RecordForm } from './RecordForm.js';
import { controlForColumn } from './field-mapping.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const PLAIN = { column: '', semantic: 'plain', format: null, secret: false, pii: null, maskedByDefault: false, pair: null } as const;

describe('a text[] column', () => {
  it('is generated as a list, and a list is chips', () => {
    const def = buildColumnDef({ name: 'tags', logicalType: 'text', isArray: true }, { ...PLAIN, column: 'tags' });
    expect(def.list).toBe(true);
    expect(controlForColumn(spec(def))).toBe('chips');
    // An array of anything but text stays what it was; a plain text column too.
    expect(buildColumnDef({ name: 'scores', logicalType: 'integer', isArray: true }, { ...PLAIN, column: 'scores' }).list).toBeUndefined();
    expect(buildColumnDef({ name: 'title', logicalType: 'text' }, { ...PLAIN, column: 'title' }).list).toBeUndefined();
  });

  it('is edited as chips and sent as an array', async () => {
    const onSubmit = vi.fn();
    render(
      <RecordForm
        columns={[
          spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
          spec({ name: 'tags', label: 'Tags', logicalType: 'text', list: true }),
        ]}
        mode="edit"
        initialValues={{ id: 1, tags: ['red'] }}
        onSubmit={onSubmit}
        footer={<button type="submit">Save</button>}
      />,
    );
    expect(screen.getByText('red')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Tags/), 'blue{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ tags: ['red', 'blue'] });

    await userEvent.click(screen.getByRole('button', { name: 'Remove red' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ tags: ['blue'] });
  });
});
