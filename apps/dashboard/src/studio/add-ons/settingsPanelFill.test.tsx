// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SETTINGS CONTROL, DRAWN IN ITS SETTINGS FORM.
 *
 * Holiday Calendars keeps the business's closed days as one `json` setting
 * and ships its own form for it, a fill of `settings.add-on.panel`: its slot
 * file's `register()` hands the fill back. The form draws that fill, handed
 * the stored values and a `patch` that saves through the settings route, in
 * place of the raw JSON box; the generated fields stay for the rest. An
 * add-on that ships no such control keeps the raw box; one whose file will
 * not load says so; a refused save says so and goes back to what is kept.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetAddOnModules, setAddOnModuleImporter } from '../../add-ons/client.js';

vi.mock('../../add-ons/runtime.js', () => ({ ensureAddOnRuntime: async () => undefined }));
const saveAddOnSettings = vi.fn((key: string, values: Record<string, unknown>) => Promise.resolve({ key, values: { days: [], ...values }, updatedAt: 1 }));
vi.mock('./addOnsApi.js', async (original) => ({
  ...(await original<typeof import('./addOnsApi.js')>()),
  saveAddOnSettings: (...args: [string, Record<string, unknown>]) => saveAddOnSettings(...args),
}));

import type { AddOnDto } from './addOnsApi.js';
import { SettingsForm } from './AddOnsPage.js';

const FILL_URL = '/api/v1/add-ons/holiday-calendars/bundle/dist/client.js';

/** The add-on's slot file: a `register()` whose one fill draws the values and saves a day. */
const module = {
  register: () => ({
    key: 'holiday-calendars',
    fills: [
      {
        slot: 'settings.add-on.panel',
        order: 10,
        render: (payload: { settings: Record<string, unknown>; patch: (values: Record<string, unknown>) => void; samples: readonly unknown[] }) => (
          <div>
            <p data-testid="held">{JSON.stringify(payload.settings['days'])}</p>
            <p data-testid="samples">{payload.samples.length}</p>
            <button type="button" onClick={() => payload.patch({ days: ['2026-12-25'] })}>
              Import
            </button>
          </div>
        ),
      },
    ],
  }),
};

function addOn(over: Partial<AddOnDto> = {}): AddOnDto {
  return {
    key: 'holiday-calendars',
    name: 'Holiday Calendars',
    settings: [
      { key: 'days', type: 'json', label: null, help: null, secret: false, required: false, options: [] },
      { key: 'note', type: 'string', label: null, help: null, secret: false, required: false, options: [] },
    ],
    settingValues: { days: ['2026-01-01'] },
    slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
    bundles: [{ path: 'dist/client.js', url: FILL_URL, integrity: 'sha256-Y2xpZW50' }],
    ...over,
  } as unknown as AddOnDto;
}

function mount(dto: AddOnDto) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsForm addOn={dto} busy={false} />
    </QueryClientProvider>,
  );
}

let imported: string[] = [];
let restore: () => void = () => undefined;
beforeEach(() => {
  imported = [];
  restore = setAddOnModuleImporter(async (url) => {
    imported.push(url);
    if (url.includes('broken')) throw new Error('integrity');
    return module;
  });
});
afterEach(() => {
  cleanup();
  restore();
  forgetAddOnModules();
  saveAddOnSettings.mockClear();
});

describe("an add-on's own settings control", () => {
  it('is drawn with the stored values and no samples, in place of the raw box; the other fields stay', async () => {
    mount(addOn());
    expect((await screen.findByTestId('held')).textContent).toBe('["2026-01-01"]');
    expect(screen.getByTestId('samples').textContent).toBe('0');
    expect(imported).toEqual([FILL_URL]);
    expect(screen.queryByRole('textbox', { name: 'days' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'note' })).toBeDefined();
  });

  it('saves what it patches through the settings route, and draws what was saved', async () => {
    const user = userEvent.setup();
    mount(addOn());
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(saveAddOnSettings).toHaveBeenCalledWith('holiday-calendars', { days: ['2026-12-25'] });
    await waitFor(() => expect(screen.getByTestId('held').textContent).toBe('["2026-12-25"]'));
  });

  it('saves the generated fields alone, never the values its control keeps', async () => {
    const user = userEvent.setup();
    mount(addOn());
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.type(screen.getByRole('textbox', { name: 'note' }), 'Closed for stocktake');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(saveAddOnSettings).toHaveBeenLastCalledWith('holiday-calendars', { note: 'Closed for stocktake' });
  });

  it('says a refused save, and goes back to what is kept', async () => {
    saveAddOnSettings.mockImplementationOnce(() => Promise.reject(new Error('403')));
    const user = userEvent.setup();
    mount(addOn());
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByText('That change could not be saved. Nothing was changed.')).toBeDefined();
    expect(screen.getByTestId('held').textContent).toBe('["2026-01-01"]');
  });

  it('keeps the raw box for an add-on that ships no control, or whose list names no file for it', () => {
    mount(addOn({ slots: [] }));
    expect(screen.getByRole('textbox', { name: 'days' })).toBeDefined();
    cleanup();
    mount(addOn({ bundles: [] }));
    expect(screen.getByRole('textbox', { name: 'days' })).toBeDefined();
    expect(imported).toEqual([]);
  });

  it('says so when its file will not load, and runs nothing of it', async () => {
    mount(addOn({ bundles: [{ path: 'dist/client.js', url: '/broken/client.js', integrity: 'sha256-eA==' }] }));
    expect(await screen.findByText('This add-on’s own settings control could not be loaded. Nothing from it has been run.')).toBeDefined();
    expect(screen.queryByTestId('held')).toBeNull();
  });
});
