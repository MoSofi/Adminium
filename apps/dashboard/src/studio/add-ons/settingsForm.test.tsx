// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's generated settings form, and its one raw field.
 *
 * A `json` setting nobody has filled used to draw the word `null` in its box —
 * which reads as a value somebody typed, and three of the invoices add-on's
 * settings opened that way. The box is empty until it holds something, and
 * emptying it again takes the value back to unset.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const saveAddOnSettings = vi.fn(() => Promise.resolve({ key: 'holiday-calendars', values: {}, updatedAt: 0 }));
vi.mock('./addOnsApi.js', async (original) => ({
  ...(await original<typeof import('./addOnsApi.js')>()),
  saveAddOnSettings: (...args: unknown[]) => saveAddOnSettings(...(args as [])),
}));

import type { AddOnDto } from './addOnsApi.js';
import { SettingsForm } from './AddOnsPage.js';

afterEach(() => {
  cleanup();
  saveAddOnSettings.mockClear();
});

function mount(settingValues: Record<string, unknown>) {
  const addOn = {
    key: 'holiday-calendars',
    settings: [{ key: 'days', type: 'json', label: null, help: null, secret: false }],
    settingValues,
  } as unknown as AddOnDto;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsForm addOn={addOn} busy={false} />
    </QueryClientProvider>,
  );
  return screen.getByRole('textbox', { name: 'days' }) as HTMLTextAreaElement;
}

describe('a json setting', () => {
  it('opens empty when nobody has filled it, never as the word null', () => {
    expect(mount({}).value).toBe('');
    cleanup();
    expect(mount({ days: null }).value).toBe('');
  });

  it('shows a stored value as it is kept', () => {
    expect(JSON.parse(mount({ days: ['2026-12-25'] }).value)).toEqual(['2026-12-25']);
  });

  it('saves an emptied box as unset, and still refuses text that is not JSON', async () => {
    const user = userEvent.setup();
    const box = mount({ days: ['2026-12-25'] });
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(saveAddOnSettings).toHaveBeenCalledWith('holiday-calendars', { days: null });

    await user.type(box, 'not json');
    expect(screen.getByText('That is not valid JSON, so it was not saved.')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
