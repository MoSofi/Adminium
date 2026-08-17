// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column inspector: semantic override over SEMANTIC_TAGS with the classifier
 * confidence hint, PII masking toggle (`column.pii`), and the enum semantics
 * editor (workflow/category + per-value label/tone map → `column.enumLabels`).
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openColumn(tableName: RegExp, columnLabel: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: tableName }));
  await userEvent.click(await screen.findByRole('button', { name: columnLabel }));
  await screen.findByTestId('column-inspector');
}

describe('semantic override', () => {
  it('shows the inferred tag + confidence and stages column.semanticType', async () => {
    const harness = installFetch();
    renderEditor();
    await openColumn(/Orders/, /Total/);

    // Classifier hint (05 §7 output surfaced in the inspector).
    expect(screen.getByText('Classifier: money · 80% confidence · source: heuristic')).toBeDefined();

    const select = screen.getByLabelText('Semantic type');
    await userEvent.selectOptions(select, 'percent');
    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [
        {
          op: 'column.semanticType',
          tableName: 'public.orders',
          columnName: 'total',
          value: { semanticType: 'percent' },
        },
      ],
    });
  });

  it('reverting to the inferred option drops the staged op', async () => {
    installFetch();
    renderEditor();
    await openColumn(/Orders/, /Total/);

    const select = screen.getByLabelText('Semantic type');
    await userEvent.selectOptions(select, 'percent');
    expect(await screen.findByText('1 change')).toBeDefined();
    await userEvent.selectOptions(select, '');
    expect(screen.queryByText('1 change')).toBeNull();
  });
});

describe('PII masking toggle', () => {
  it('reflects maskedByDefault and stages column.pii with the classifier kind', async () => {
    const harness = installFetch();
    renderEditor();
    await openColumn(/Customers/, /Email/);

    const toggle = screen.getByRole('switch', { name: 'Mask by default' });
    expect(toggle.getAttribute('data-state')).toBe('checked');

    await userEvent.click(toggle);
    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [
        {
          op: 'column.pii',
          tableName: 'public.customers',
          columnName: 'email',
          value: { masked: false, kind: 'email' },
        },
      ],
    });
  });
});

describe('enum semantics editor', () => {
  it('stages per-value labels + tones as one column.enumLabels op', async () => {
    const harness = installFetch();
    renderEditor();
    await openColumn(/Orders/, /Status/);

    expect(screen.getByTestId('enum-editor')).toBeDefined();
    // All enum values listed.
    expect(screen.getByText('pending')).toBeDefined();
    expect(screen.getByText('paid')).toBeDefined();
    expect(screen.getByText('cancelled')).toBeDefined();

    await userEvent.type(screen.getByLabelText('Label for paid'), 'Paid');
    await userEvent.selectOptions(screen.getByLabelText('Tone for paid'), 'pos');
    await userEvent.selectOptions(screen.getByLabelText('Tone for cancelled'), 'danger');

    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [
        {
          op: 'column.enumLabels',
          tableName: 'public.orders',
          columnName: 'status',
          value: { labels: { paid: 'Paid' }, tones: { paid: 'pos', cancelled: 'danger' } },
        },
      ],
    });
  });

  it('workflow/category switch stages column.semanticType', async () => {
    installFetch();
    renderEditor();
    await openColumn(/Orders/, /Status/);

    // Inferred status-workflow → switching to Category stages an override.
    await userEvent.click(screen.getByRole('radio', { name: 'Category' }));
    expect(await screen.findByText('1 change')).toBeDefined();
    expect(screen.getByText('column.semanticType · public.orders.status')).toBeDefined();
  });
});
