/**
 * Relations tab: declared FKs read-only, inferred relations with confidence
 * and accept/suppress (relation.add / relation.remove ops, 05 §6 accept →
 * confidence 1.0 override), and the ADD virtual relation form emitting the
 * §3.15 relation.add payload.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openRelations(tableName: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: tableName }));
  await userEvent.click(await screen.findByRole('tab', { name: 'Relations' }));
  await screen.findByTestId('relations-tab');
}

describe('declared + inferred listing', () => {
  it('lists declared FKs read-only and inferred relations with confidence', async () => {
    installFetch();
    renderEditor();
    await openRelations(/Orders/);

    expect(screen.getByText('public.orders.customer_id → public.customers.id')).toBeDefined();
    // Badge on the declared row (the cardinality string also exists as a form <option>).
    expect(screen.getAllByText('one-to-many').length).toBeGreaterThan(0);
    // orders is also the target of the inferred order_notes relation.
    expect(screen.getByText('public.order_notes.order_ref → public.orders.id')).toBeDefined();
    expect(screen.getByText('inferred · 72%')).toBeDefined();
  });
});

describe('accept / suppress', () => {
  it('accept stages relation.add with the FK-side cardinality', async () => {
    const harness = installFetch();
    renderEditor();
    await openRelations(/Order notes/);

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('1 change')).toBeDefined();
    expect(screen.getByText('Accepted')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [
        {
          op: 'relation.add',
          tableName: 'public.order_notes',
          value: {
            fromColumn: 'order_ref',
            toTable: 'public.orders',
            toColumn: 'id',
            cardinality: 'many-to-one',
          },
        },
      ],
    });
  });

  it('suppress replaces an accept with relation.remove', async () => {
    installFetch();
    renderEditor();
    await openRelations(/Order notes/);

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(screen.getByRole('button', { name: 'Suppress' }));

    expect(await screen.findByText('1 change')).toBeDefined();
    expect(screen.getByText('relation.remove · public.order_notes')).toBeDefined();
    expect(screen.getByText('Suppressed')).toBeDefined();
  });
});

describe('add virtual relation', () => {
  it('builds the §3.15 relation.add payload from the form', async () => {
    const harness = installFetch();
    renderEditor();
    await openRelations(/Order notes/);

    await userEvent.click(screen.getByLabelText('From column'));
    await userEvent.click(await screen.findByRole('option', { name: /order_ref/ }));

    await userEvent.type(screen.getByLabelText('To table'), 'customers');
    await userEvent.click(await screen.findByRole('option', { name: /public\.customers/ }));

    await userEvent.click(screen.getByLabelText('To column'));
    await userEvent.click(await screen.findByRole('option', { name: /^id/ }));

    await userEvent.selectOptions(screen.getByLabelText('Cardinality'), 'one-to-one');
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));

    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [
        {
          op: 'relation.add',
          tableName: 'public.order_notes',
          value: {
            fromColumn: 'order_ref',
            toTable: 'public.customers',
            toColumn: 'id',
            cardinality: 'one-to-one',
          },
        },
      ],
    });
  });
});
