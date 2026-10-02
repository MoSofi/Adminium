// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A designed form follows a column that became a yes/no.
 *
 * A form's document freezes a control per field the day it is designed. On
 * SQLite a yes/no is a whole number until it is marked, so a form designed
 * before the mark held `number` for it and asked for `1`. A number control on
 * a yes/no column gives way to the column's own; any other choice stands.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCrudForm } from '../../page-config/index.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';

afterEach(cleanup);

const COLUMNS = [
  gridColumnSpecSchema.parse({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  gridColumnSpecSchema.parse({ name: 'active', label: 'Active', logicalType: 'boolean' }),
  gridColumnSpecSchema.parse({ name: 'featured', label: 'Featured', logicalType: 'boolean' }),
  gridColumnSpecSchema.parse({ name: 'stock', label: 'Stock', logicalType: 'integer' }),
];

const DOCUMENT = parseCrudForm({
  form: {
    v: 2,
    sections: [
      {
        id: 'main',
        fields: [
          { column: 'active', control: 'number' },
          { column: 'featured', control: 'check-row' },
          { column: 'stock', control: 'number' },
        ],
      },
    ],
  },
})!;

describe('a designed form and a column that became a yes/no', () => {
  it('draws the yes/no as one, and leaves every other choice alone', () => {
    render(
      <RecordForm
        columns={COLUMNS}
        document={DOCUMENT}
        initialValues={{}}
        mode="create"
        lookup={vi.fn().mockResolvedValue([]) as never}
        onSubmit={vi.fn()}
        formId="yes-no-form"
      />,
    );
    // The stale number box is a switch; the checkbox somebody chose stays a checkbox.
    expect(screen.getByRole('switch', { name: 'Active' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Featured' })).toBeTruthy();
    // A whole number keeps its number box, and it is the only one.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });
});
