// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The "Filters" card.
 *
 * Three properties the toolbar depends on: an untouched card reports NOTHING
 * (so a page that never defined filters does not gain a frozen copy of today's
 * suggestion), every list it does report must survive the shipped parser, and
 * a column may only be offered a control it can actually answer.
 */
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCrudFilters, type CrudFilterField } from '@adminium/engine/config';

import type { FormColumnFactReply } from '../../api/pages.js';
import { FiltersCard } from './FiltersCard.js';

afterEach(cleanup);

const columns: FormColumnFactReply[] = [
  {
    spec: { name: 'invoice_id', logicalType: 'integer', primaryKey: true },
    ordinal: 1,
    filledBy: 'database',
    required: false,
    writable: false,
  },
  {
    spec: { name: 'customer', logicalType: 'varchar' },
    ordinal: 2,
    filledBy: null,
    required: true,
    writable: true,
  },
  {
    spec: { name: 'status', logicalType: 'enum', enumValues: ['draft', 'sent', 'paid'] },
    ordinal: 3,
    filledBy: null,
    required: true,
    writable: true,
  },
  {
    spec: { name: 'paid', logicalType: 'boolean' },
    ordinal: 4,
    filledBy: null,
    required: false,
    writable: true,
  },
];

/** The screen's half: the draft the card reports, held exactly as it holds it. */
function Harness({ stored }: { stored: CrudFilterField[] | null }) {
  const [draft, setDraft] = useState<CrudFilterField[] | null | undefined>(undefined);
  return (
    <>
      <FiltersCard stored={stored} columns={columns} onChange={setDraft} />
      <output data-testid="draft">{draft === undefined ? 'untouched' : JSON.stringify(draft)}</output>
    </>
  );
}

describe('the filters card', () => {
  it('opens on the filters the page already shows, and reports nothing', async () => {
    render(<Harness stored={null} />);
    // The derivation, not an empty canvas: this page IS filtered by status
    // today, and a card that opened empty would say otherwise.
    expect(screen.getByTestId('filters-control-status')).toBeTruthy();
    expect(screen.getByTestId('draft').textContent).toBe('untouched');
  });

  it('offers a column only the controls it can answer', () => {
    render(<Harness stored={[{ column: 'status', control: 'one-of' }]} />);
    const options = [...screen.getByTestId<HTMLSelectElement>('filters-control-status').options].map(
      (option) => option.value,
    );
    // A choice column can be "one of" or "any of" and nothing else — a date
    // range over an enum is a menu that opens onto nothing.
    expect(options).toEqual(['one-of', 'any-of']);
  });

  it('adds a filter, and what it reports survives the shipped parser', async () => {
    const user = userEvent.setup();
    render(<Harness stored={[{ column: 'paid', control: 'yes-no' }]} />);

    await user.selectOptions(screen.getByTestId('filters-add'), 'status');
    const draft = JSON.parse(screen.getByTestId('draft').textContent ?? 'null') as unknown;
    expect(draft).toEqual([
      { column: 'paid', control: 'yes-no' },
      { column: 'status', control: 'one-of' },
    ]);
    // The card cannot report a list the save would 422 on.
    expect(parseCrudFilters({ filters: draft })).toEqual(draft);
  });

  it('reports nothing again when the list says what the suggestion says', async () => {
    const user = userEvent.setup();
    render(<Harness stored={[{ column: 'status', control: 'one-of' }]} />);

    await user.selectOptions(screen.getByTestId('filters-add'), 'paid');
    // `null` DELETES the block rather than storing a copy of the suggestion —
    // which is what keeps the toolbar following the table.
    expect(screen.getByTestId('draft').textContent).toBe('null');
  });

  it('names a filter for the page without touching the column', async () => {
    const user = userEvent.setup();
    render(<Harness stored={[{ column: 'status', control: 'one-of' }]} />);

    await user.type(screen.getByTestId('filters-name-status'), 'Stage');
    expect(JSON.parse(screen.getByTestId('draft').textContent ?? 'null')).toEqual([
      { column: 'status', control: 'one-of', label: 'Stage' },
    ]);
  });
});
