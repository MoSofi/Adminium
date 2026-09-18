// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE SPLIT PANE, AND THE CALENDAR IN IT.
 *
 * What the arrangement decides: that the first section is the left pane and
 * everything else is the right. What the CONTROL decides is harder and matters
 * more — a booking calendar that strikes out the wrong day, or strikes out
 * nothing while looking as though it checked, is the difference between a
 * feature and a liability. So the claims here are about the availability read:
 * that it is not made without a rule, that a day is only "fully booked" when
 * every one of its slots is, and that a capped reply strikes out NOTHING.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  gridColumnSpecSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
} from '../../../families/tables/column-spec.js';
import { RecordForm } from '../RecordForm.js';
import type { CrudFormConfig } from '../../../page-config/index.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'starts_at', label: 'Starts at', logicalType: 'timestamp', nullable: false }),
  spec({ name: 'room', label: 'Room', logicalType: 'enum', enumValues: ['A', 'B'] }),
  spec({ name: 'who', label: 'Who', logicalType: 'varchar' }),
];

/** 09:00–11:00 every 30 minutes: four slots, so "all of them" is reachable. */
const SLOTS = { start: '09:00', end: '11:00', minutes: 30 as const };

function document(field: Record<string, unknown>): CrudFormConfig {
  return {
    v: 2,
    preset: 'split-pane',
    sections: [
      { id: 'when', label: 'When', columns: 1, fields: [{ column: 'starts_at', control: 'calendar', ...field }] },
      { id: 'who', label: 'Who', columns: 1, fields: [{ column: 'room' }, { column: 'who' }] },
    ],
  } as CrudFormConfig;
}

function renderForm(doc: CrudFormConfig, over: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={COLUMNS}
      document={doc}
      mode="create"
      locale="de-DE"
      initialValues={{ starts_at: '2026-09-17T09:30' }}
      onSubmit={onSubmit}
      formId="split-form"
      footer={<button type="submit">Save</button>}
      {...over}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('the split pane', () => {
  it('puts the first section beside the rest', () => {
    renderForm(document({ slots: SLOTS }));
    const layout = screen.getByTestId('form-split-layout');
    expect(layout.children).toHaveLength(2);
    // The calendar is in the left pane; the ordinary fields are in the right.
    expect(layout.children[0]?.contains(screen.getByTestId('calendar-control'))).toBe(true);
    expect(layout.children[1]?.contains(screen.getByLabelText(/^Who/))).toBe(true);
  });
});

describe('the calendar control', () => {
  it('asks nothing when no availability rule is declared', async () => {
    const availability = vi.fn();
    renderForm(document({ slots: SLOTS }), { availability });
    await screen.findByTestId('calendar-control');
    // A calendar that reads the table without being told to is a calendar
    // making a claim nobody configured.
    expect(availability).not.toHaveBeenCalled();
    expect(screen.getByTestId('slot-09:00').getAttribute('disabled')).toBeNull();
  });

  it('asks for the visible month, half-open, and strikes out a taken slot', async () => {
    const availability = vi.fn().mockResolvedValue({ taken: ['2026-09-17T10:00'], capped: false });
    renderForm(document({ slots: SLOTS, availability: {} }), { availability });

    await waitFor(() => expect(availability).toHaveBeenCalled());
    expect(availability.mock.calls[0]?.[0]).toMatchObject({
      column: 'starts_at',
      from: '2026-09-01T00:00',
      // EXCLUSIVE: a month that asked through the 1st of the next would strike
      // out a day in the wrong grid.
      to: '2026-10-01T00:00',
    });
    await waitFor(() =>
      expect(screen.getByTestId<HTMLButtonElement>('slot-10:00').disabled).toBe(true),
    );
    expect(screen.getByTestId<HTMLButtonElement>('slot-09:00').disabled).toBe(false);
  });

  it('calls a day fully booked only when every slot of it is taken', async () => {
    const availability = vi.fn().mockResolvedValue({
      taken: ['2026-09-18T09:00', '2026-09-18T09:30', '2026-09-18T10:00', '2026-09-18T10:30'],
      capped: false,
    });
    renderForm(document({ slots: SLOTS, availability: {} }), { availability });

    await waitFor(() =>
      expect(screen.getByTestId<HTMLButtonElement>('calendar-day-2026-09-18').disabled).toBe(true),
    );
    // One taken slot is NOT a booked day — the 17th holds 09:30 in these
    // values and is still open.
    expect(screen.getByTestId<HTMLButtonElement>('calendar-day-2026-09-17').disabled).toBe(false);
  });

  it('strikes out NOTHING when the month was capped', async () => {
    const availability = vi.fn().mockResolvedValue({ taken: [], capped: true });
    renderForm(document({ slots: SLOTS, availability: {} }), { availability });

    await screen.findByTestId('calendar-uncapped');
    // A prefix drawn as the whole marks free everything the cap cut off, so a
    // capped month draws no claim at all — and says why.
    expect(screen.getByTestId<HTMLButtonElement>('slot-09:00').disabled).toBe(false);
  });

  it('scopes the question by the sibling field the rule names', async () => {
    const availability = vi.fn().mockResolvedValue({ taken: [], capped: false });
    const { user } = renderForm(document({ slots: SLOTS, availability: { resource: 'room' } }), {
      availability,
    });
    await waitFor(() => expect(availability).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/^Room/), 'B');
    await waitFor(() =>
      expect(availability.mock.calls.at(-1)?.[0]).toMatchObject({ resource: 'room', resourceValue: 'B' }),
    );
  });

  it('writes the day and the time into ONE value', async () => {
    const { onSubmit, user } = renderForm(document({ slots: SLOTS }));
    await user.click(screen.getByTestId('calendar-day-2026-09-21'));
    await user.click(screen.getByTestId('slot-10:30'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Two fields over one column is how a form ends up holding half a booking.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ starts_at: '2026-09-21T10:30' });
  });

  it('sends a plain day when the field declares no times', async () => {
    const { onSubmit, user } = renderForm(document({}));
    expect(screen.queryByTestId('slot-grid')).toBeNull();
    await user.click(screen.getByTestId('calendar-day-2026-09-21'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ starts_at: '2026-09-21' });
  });
});
