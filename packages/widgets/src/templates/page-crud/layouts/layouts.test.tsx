// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The two layouts the comp draws differently, and the rules inside them.
 *
 * A layout is not a second form engine: the same document, the same controls,
 * the same values — only the arrangement changes. So what is tested here is
 * exactly what the arrangement DECIDES: which step a person is on and when
 * they may leave it, and which field becomes the title, the detail box and a
 * pill.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../../families/tables/column-spec.js';
import { RecordForm, quickDatePresets } from '../RecordForm.js';
import type { CrudFormConfig } from '../../../page-config/index.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'title', label: 'Title', logicalType: 'varchar', nullable: false }),
  spec({ name: 'notes', label: 'Notes', logicalType: 'text' }),
  spec({ name: 'due', label: 'Due', logicalType: 'date' }),
  spec({
    name: 'priority',
    label: 'Priority',
    logicalType: 'enum',
    enumValues: ['low', 'high'],
    enumTones: { high: 'danger' },
  }),
  spec({ name: 'done', label: 'Done', logicalType: 'boolean' }),
  spec({ name: 'hours', label: 'Hours', logicalType: 'integer' }),
];

const wizard: CrudFormConfig = {
  v: 2,
  preset: 'wizard',
  sections: [
    { id: 'one', label: 'Profile', hint: 'Who it is for', columns: 2, fields: [{ column: 'title', required: true }] },
    { id: 'two', label: 'When', columns: 2, fields: [{ column: 'due' }] },
  ],
};

const quick: CrudFormConfig = {
  v: 2,
  preset: 'quick-create',
  sections: [
    {
      id: 'main',
      columns: 2,
      fields: [
        { column: 'title' },
        { column: 'notes' },
        { column: 'due' },
        { column: 'priority' },
        { column: 'done' },
        { column: 'hours' },
      ],
    },
  ],
};

function renderForm(document: CrudFormConfig, over: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const wizardState: { back: () => void; next: () => void; step: number; steps: number }[] = [];
  render(
    <RecordForm
      columns={COLUMNS}
      document={document}
      mode="create"
      onSubmit={onSubmit}
      onWizard={(state) => wizardState.push(state)}
      formId="layout-form"
      footer={<button type="submit">Save</button>}
      {...over}
    />,
  );
  return { onSubmit, user: userEvent.setup(), latest: () => wizardState.at(-1)! };
}

describe('the wizard', () => {
  it('shows one step at a time, with the rail saying which', async () => {
    const { latest } = renderForm(wizard);
    expect(screen.getByLabelText(/Title/)).toBeTruthy();
    expect(screen.queryByLabelText(/Due/)).toBeNull();
    // The rail is a landmark with the steps as a list, and the current one
    // carries `aria-current` at every width — the labels themselves hide below
    // 640px (DP11).
    const current = screen.getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step');
    expect(current?.textContent).toContain('Profile');
    expect(latest().steps).toBe(2);
  });

  it('checks the step before letting anybody past it', async () => {
    const { latest } = renderForm(wizard);
    // Title is required and empty: Continue refuses, and says so HERE rather
    // than two steps later.
    latest().next();
    await waitFor(() => expect(screen.getByText('This field is required.')).toBeTruthy());
    expect(screen.queryByLabelText(/Due/)).toBeNull();

    await userEvent.setup().type(screen.getByLabelText(/Title/), 'Ship it');
    latest().next();
    await waitFor(() => expect(screen.getByLabelText(/Due/)).toBeTruthy());
    expect(latest().step).toBe(1);
  });

  it('jumps back to the step a server refusal names', async () => {
    const { latest } = renderForm(wizard);
    await userEvent.setup().type(screen.getByLabelText(/Title/), 'Ship it');
    latest().next();
    await waitFor(() => expect(latest().step).toBe(1));

    cleanup();
    // The same form, re-rendered with the refusal the server sent back.
    renderForm(wizard, { errors: { title: 'Already taken.' } });
    await waitFor(() => expect(screen.getByText('Already taken.')).toBeTruthy());
  });
});

describe('the media aside (comp 268)', () => {
  it('stands a named image field beside the rest, not among them', () => {
    const withAside: CrudFormConfig = {
      v: 2,
      preset: 'sectioned',
      sections: [
        {
          id: 'main',
          columns: 2,
          aside: 'notes',
          fields: [{ column: 'title' }, { column: 'notes' }],
        },
      ],
    };
    renderForm(withAside);
    const aside = document.querySelector('[data-part="section-aside"]');
    expect(aside).not.toBeNull();
    // 150px, the comp's own — a named section feature rather than a per-row
    // pixel grid an admin could not express (DP14).
    expect(aside?.firstElementChild?.className).toContain('w-[150px]');
    expect(aside?.firstElementChild?.textContent).toContain('Notes');
  });
});

describe('quick create', () => {
  it('makes the first field the title, the long one the detail box, and the rest pills', () => {
    renderForm(quick);
    // No labels over the title and detail: the placeholder IS the label there.
    const pills = screen.getByTestId('quick-pills');
    expect(pills.textContent).toContain('Due');
    expect(pills.textContent).toContain('Priority');
    expect(pills.textContent).toContain('Done');
    // A number cannot be a pill, so it keeps the ordinary field anatomy (F20).
    expect(screen.getByLabelText(/Hours/)).toBeTruthy();
  });

  it('sets a value from a pill menu, and clears it by choosing it again', async () => {
    const { user, onSubmit } = renderForm(quick);
    await user.click(screen.getByTestId('quick-pill-priority'));
    await user.click(await screen.findByTestId('quick-option-high'));
    expect(screen.getByTestId('quick-pill-priority').textContent).toContain('high');

    await user.click(screen.getByTestId('quick-pill-priority'));
    // Re-clicking the chosen row CLEARS it (comp 611) — the fastest way to
    // undo a pill is the gesture that set it.
    await user.click(await screen.findByTestId('quick-option-high'));
    expect(screen.getByTestId('quick-pill-priority').textContent).toContain('Priority');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggles a boolean with no menu at all (F19)', async () => {
    const { user } = renderForm(quick);
    const done = screen.getByTestId('quick-pill-done');
    expect(done.getAttribute('aria-pressed')).toBe('false');
    await user.click(done);
    expect(screen.getByTestId('quick-pill-done').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the date presets (DP12)', () => {
  const t = ((_key: string, fallback: string) => fallback) as never;

  it('stores a DATE, not a label', () => {
    const presets = quickDatePresets(t, 'en-US', new Date('2026-09-16T12:00:00Z'));
    expect(presets.map((preset) => preset.label)).toEqual(['Today', 'Tomorrow', 'This week', 'Next week']);
    expect(presets[0]?.value).toBe('2026-09-16');
    expect(presets[1]?.value).toBe('2026-09-17');
  });

  it('ends the week where the READER is', () => {
    // 2026-09-16 is a Wednesday. `en-US` weeks start on Sunday, so the week
    // ends on Saturday the 19th; `ar-EG` weeks start on Saturday, so it ends on
    // Friday the 18th. A hardcoded Sunday would be wrong for both.
    const american = quickDatePresets(t, 'en-US', new Date('2026-09-16T12:00:00Z'));
    const egyptian = quickDatePresets(t, 'ar-EG', new Date('2026-09-16T12:00:00Z'));
    expect(american[2]?.value).toBe('2026-09-19');
    expect(egyptian[2]?.value).toBe('2026-09-18');
    // Next week is seven days past this week's end, in both.
    expect(american[3]?.value).toBe('2026-09-26');
    expect(egyptian[3]?.value).toBe('2026-09-25');
  });
});
