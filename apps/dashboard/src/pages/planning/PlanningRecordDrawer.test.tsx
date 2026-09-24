// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record drawer a calendar, a board and a schedule open: a choice column
 * reads in the person's language, from the page reply's column facts, as it
 * does on the calendar behind it.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { PlanningRecordDrawer } from './PlanningRecordDrawer.js';

function fakeCrud() {
  return {
    connectionId: 'conn_1',
    table: 'public.visits',
    list: vi.fn(async () => ({ data: [] })),
    get: vi.fn(async () => ({ data: { id: 1, name: 'Ada', status: 'waiting' }, references: [] })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    references: vi.fn(async () => []),
    undo: vi.fn(),
  };
}

function renderDrawer(facts?: Parameters<typeof PlanningRecordDrawer>[0]['facts']) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PlanningRecordDrawer crud={fakeCrud() as never} recordId="1" onClose={() => undefined} facts={facts} />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(cleanup);

describe('the planning record drawer', () => {
  it('names a status in the reader’s words, from the page’s column facts', async () => {
    renderDrawer({ status: { filledBy: null, required: false, writable: true, enumLabels: { waiting: 'Wartend' }, enumTones: { waiting: 'warn' } } });
    const drawer = await screen.findByRole('dialog');
    const word = await within(drawer).findByText('Wartend');
    expect(word.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warn');
    expect(within(drawer).queryByText('waiting')).toBeNull();
  });

  it('shows the raw value when the facts have no word for it', async () => {
    renderDrawer();
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('waiting')).toBeDefined();
  });
});
