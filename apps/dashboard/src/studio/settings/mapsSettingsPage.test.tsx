// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → Maps: two switches and what each server learns.
 *
 * Worth proving: each switch writes its own field and nothing else; the page
 * names the servers the environment set and offers no box to type one into;
 * a switch the operator or the desktop app has decided is drawn disabled, off,
 * and says why; switching maps OFF makes the session be read again (so open
 * maps give way at once), while switching them ON asks for a reload and leaves
 * the session alone — a page loaded while maps were off may not ask the map
 * server, and a map that tried would only fail.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { MapsSettingsPage } from './MapsSettingsPage.js';
import { mapsShown, type MapsSettings } from './mapsApi.js';

const ON: MapsSettings = {
  enabled: true,
  routing: false,
  mapServer: 'https://tiles.example.test',
  mapServerOff: false,
  routingServer: 'https://router.example.test',
  routingServerOff: false,
  runtime: 'self-host',
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let stored: MapsSettings;
let calls: Call[];
let failWrites = false;

beforeEach(async () => {
  await installTestI18n();
  stored = { ...ON };
  calls = [];
  failWrites = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, body });
      if (url.endsWith('/api/v1/bootstrap')) return jsonResponse(200, { data: makeBootstrap() });
      if (url.endsWith('/api/v1/settings/maps')) {
        if (method === 'PUT') {
          if (failWrites) return jsonResponse(500, { error: { code: 'INTERNAL', message: 'no' } });
          stored = { ...stored, ...(body as Partial<MapsSettings>) };
        }
        return jsonResponse(200, { data: stored });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function open(session: Parameters<typeof makeBootstrap>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(bootstrapQuery().queryKey, makeBootstrap(session));
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <MapsSettingsPage />
    </QueryClientProvider>,
  );
  return { invalidated };
}

const puts = (): Call[] => calls.filter((call) => call.method === 'PUT');
const maps = (): Promise<HTMLElement> => screen.findByRole('switch', { name: 'Show maps' });
const routes = (): Promise<HTMLElement> => screen.findByRole('switch', { name: 'Routes along roads' });

describe('Settings → Maps', () => {
  it('shows both switches as stored, and names the servers the environment set — with no box to type one into', async () => {
    open();
    expect((await maps()).getAttribute('aria-checked')).toBe('true');
    expect((await routes()).getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-part="maps-server"]')?.textContent).toBe(
      'Map server: tiles.example.test. Set by whoever runs this server, with ADMINIUM_MAP_SERVER. It cannot be changed here.',
    );
    expect(document.querySelector('[data-part="routes-server"]')?.textContent).toBe(
      'Routing server: router.example.test. Set by whoever runs this server, with ADMINIUM_ROUTING_SERVER.',
    );
    expect(document.querySelectorAll('input[type="text"], input[type="url"], textarea')).toHaveLength(0);
    // What each server learns, in plain words.
    expect(screen.getByText(/learns that person’s internet address and the area they looked at/)).toBeTruthy();
    expect(screen.getByText(/sends it the stops’ positions in order/)).toBeTruthy();
    expect(screen.getByText(/a list of the same places is shown where a map would be/)).toBeTruthy();
  });

  it('switching maps off writes that one field and reads the session again, so open maps give way at once', async () => {
    const user = userEvent.setup();
    const { invalidated } = open();
    await user.click(await maps());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]?.body).toEqual({ enabled: false });
    await waitFor(() => expect(invalidated).toHaveBeenCalledWith({ queryKey: bootstrapQuery().queryKey }));
    expect((await maps()).getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-part="maps-reload"]')).toBeNull();
  });

  it('switching maps on asks for a reload and leaves the session as it was', async () => {
    stored = { ...ON, enabled: false };
    const user = userEvent.setup();
    const { invalidated } = open();
    expect((await maps()).getAttribute('aria-checked')).toBe('false');
    await user.click(await maps());
    await waitFor(() => expect(document.querySelector('[data-part="maps-reload"]')).not.toBeNull());
    expect(puts()[0]?.body).toEqual({ enabled: true });
    expect(screen.getByText('Maps are on. Reload to see them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload this page' })).toBeTruthy();
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('while a reload is still owed, the routes switch leaves the session alone: open maps must not try under the old policy', async () => {
    stored = { ...ON, enabled: false };
    const user = userEvent.setup();
    const { invalidated } = open();
    await user.click(await maps());
    await waitFor(() => expect(document.querySelector('[data-part="maps-reload"]')).not.toBeNull());
    await user.click(await routes());
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]?.body).toEqual({ routing: true });
    await waitFor(() => expect((document.querySelector('[data-part="routes-switch"] [role="switch"]') as HTMLElement).getAttribute('aria-checked')).toBe('true'));
    expect(invalidated).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="maps-reload"]')).not.toBeNull();
  });

  it('still owes the reload after the page was left and opened again: the session says no map server while the setting says maps are on', async () => {
    const user = userEvent.setup();
    // Maps were switched on earlier in this sitting; the session is the one the page was loaded with.
    const { invalidated } = open({ maps: { enabled: false, server: null, routing: false } });
    expect((await maps()).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-part="maps-reload"]')).not.toBeNull();
    await user.click(await routes());
    await waitFor(() => expect(puts()).toHaveLength(1));
    await waitFor(() => expect((document.querySelector('[data-part="routes-switch"] [role="switch"]') as HTMLElement).getAttribute('aria-checked')).toBe('true'));
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('the routes switch writes its own field only', async () => {
    const user = userEvent.setup();
    const { invalidated } = open();
    await user.click(await routes());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]?.body).toEqual({ routing: true });
    await waitFor(() => expect(invalidated).toHaveBeenCalled());
    expect((await routes()).getAttribute('aria-checked')).toBe('true');
  });

  it('the operator said no: the maps switch is off, cannot be moved, and says why', async () => {
    // The stored switch is still "on": what is shown is what happens, not what is stored.
    stored = { ...ON, mapServer: null, mapServerOff: true };
    open();
    const control = await maps();
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-part="maps-switch-why"]')?.textContent).toContain('ADMINIUM_MAP_SERVER=off');
    expect(document.querySelector('[data-part="maps-server"]')?.textContent).toBe('Map server: none.');
  });

  it('the desktop app: the maps switch is off, cannot be moved, and says a list is shown instead', async () => {
    stored = { ...ON, runtime: 'desktop' };
    open();
    const control = await maps();
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-part="maps-switch-why"]')?.textContent).toContain('The desktop app works without the internet');
  });

  it('the routing server switched off by the operator: that switch cannot be moved, and says why', async () => {
    stored = { ...ON, routing: true, routingServer: null, routingServerOff: true };
    open();
    const control = await routes();
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-part="routes-switch-why"]')?.textContent).toContain('ADMINIUM_ROUTING_SERVER=off');
  });

  it('a write that fails says so and leaves the switch where it was', async () => {
    failWrites = true;
    const user = userEvent.setup();
    open();
    await user.click(await maps());
    expect((await screen.findByRole('alert')).textContent).toContain('This could not be saved. Try again.');
    expect((await maps()).getAttribute('aria-checked')).toBe('true');
  });
});

describe('mapsShown', () => {
  it('is the switch, unless something above it said no', () => {
    expect(mapsShown(ON)).toBe(true);
    expect(mapsShown({ ...ON, enabled: false })).toBe(false);
    expect(mapsShown({ ...ON, mapServerOff: true })).toBe(false);
    expect(mapsShown({ ...ON, runtime: 'desktop' })).toBe(false);
  });
});
