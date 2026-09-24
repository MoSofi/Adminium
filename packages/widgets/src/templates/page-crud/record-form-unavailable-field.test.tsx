// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A designed relation field the page reply does not offer is SAID, not dropped.
 *
 * A clinician form declared "Visit types they do" as chips over a link table
 * the server could not write through, and the form rendered without it — no
 * sign anywhere that a field had been designed there. It now renders a notice
 * in the field's place, and the save goes through without it: the notice
 * writes nothing and sends no link.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCrudForm } from '../../page-config/index.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';

afterEach(cleanup);

const COLUMNS = [
  gridColumnSpecSchema.parse({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  gridColumnSpecSchema.parse({ name: 'name', label: 'Name', logicalType: 'varchar', nullable: false }),
];

const DOCUMENT = parseCrudForm({
  form: {
    v: 2,
    sections: [
      { id: 's1', fields: [{ column: 'name' }] },
      { id: 's2', fields: [{ relation: 'm2m:visit_types', control: 'reference-chips', label: 'Visit types they do' }] },
      { id: 's3', fields: [{ relation: 'fk:hours', control: 'child-rows', label: 'Hours' }] },
    ],
  },
})!;

function renderForm(props: { relations?: readonly never[]; childFacts?: Record<string, never> }) {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={COLUMNS}
      document={DOCUMENT}
      {...props}
      initialValues={{ name: 'Dr Tess Tester' }}
      mode="create"
      lookup={vi.fn().mockResolvedValue([]) as never}
      onSubmit={onSubmit}
      formId="unavailable-form"
      footer={<button type="submit">Save</button>}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('a designed relation field with nothing behind it', () => {
  it('shows a notice in its place, for a link and for line items alike', () => {
    renderForm({ relations: [], childFacts: {} });
    const notices = screen.getAllByTestId('form-field-unavailable');
    expect(notices).toHaveLength(2);
    expect(notices[0]!.getAttribute('role')).toBe('alert');
    expect(notices[0]!.textContent).toContain('Visit types they do');
    expect(notices[0]!.textContent).toContain('can’t be shown');
    expect(notices[1]!.textContent).toContain('Hours');
  });

  it('saves the rest, sending no link and no child rows for it', async () => {
    const { onSubmit, user } = renderForm({ relations: [], childFacts: {} });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]).toEqual([{ name: 'Dr Tess Tester' }]);
  });

  it('says nothing when the reply carries no relations at all (an older server)', () => {
    renderForm({});
    expect(screen.queryByTestId('form-field-unavailable')).toBeNull();
  });
});
