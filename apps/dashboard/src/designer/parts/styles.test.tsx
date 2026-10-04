// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The style picker of a new app, "Add your own" and removing a style of the
 * project's own, over the Designer's routes.
 *
 *  1. The picker starts at "Let the Designer choose", lists every style with
 *     what it suits, the project's own under "Yours", and "Add your own…"
 *     last. A style that does not read cannot be picked, and says why.
 *  2. Adding sends the file's bytes; an accepted style is said, picked and
 *     listed, with what was left out of it; a refused one shows the server's
 *     own sentence, and another file can be chosen.
 *  3. Removing asks first, says that apps keep their look, and a removed
 *     style that was picked gives the choice back to the Designer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { DesignerStyle } from '../api.js';
import { StylePicker } from './styles.js';

const BUILT_IN: DesignerStyle[] = [
  { key: 'clean', title: 'Clean service', description: 'Cool white, slate and a clear blue.', origin: 'built-in', hasTheme: true, hasPreview: false, swatch: { bg: '#f6f7f9', text: '#14171f', accent: '#2f5bea' } },
  { key: 'warm', title: 'Warm table', description: 'Cream, terracotta and a serif.', origin: 'built-in', hasTheme: true, hasPreview: false, swatch: { bg: '#faf4ea', text: '#2c1d13', accent: '#a04e26' } },
];
const OWN: DesignerStyle = { key: 'lucia-house', title: 'Lucia house style', description: '', origin: 'project', hasTheme: true, hasPreview: true };
const BROKEN: DesignerStyle = { key: 'broken', title: 'Broken', description: '', origin: 'project', hasTheme: false, hasPreview: false, problem: 'It has no SKILL.md.' };

let styles: DesignerStyle[];
let calls: { method: string; url: string }[];
let upload: () => Response;
let picked: (string | null)[];

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  styles = [...BUILT_IN];
  calls = [];
  picked = [];
  upload = () => {
    styles = [...styles, OWN];
    return jsonResponse(201, { key: 'lucia-house', left: ['scripts/install.sh'] });
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url === '/api/v1/designer/styles' && method === 'GET') return Promise.resolve(jsonResponse(200, { styles }));
      if (url.startsWith('/api/v1/designer/styles?filename=') && method === 'POST') return Promise.resolve(upload());
      if (url === '/api/v1/designer/styles/lucia-house' && method === 'DELETE') {
        styles = styles.filter((style) => style.key !== 'lucia-house');
        return Promise.resolve(jsonResponse(200, { removed: true }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no' } }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness(): ReactNode {
  const [value, setValue] = useState<string | null>(null);
  return (
    <StylePicker
      value={value}
      disabled={false}
      onChange={(key) => {
        picked.push(key);
        setValue(key);
      }}
    />
  );
}
const open = async (): Promise<HTMLElement> => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Style: Let the Designer choose' }));
  return screen.findByRole('menu');
};

describe('the style picker', () => {
  it('starts at "Let the Designer choose" and lists every style, the project’s own under "Yours", with "Add your own…" last', async () => {
    styles = [...BUILT_IN, OWN, BROKEN];
    const menu = await open();
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')).toHaveLength(6));
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Let the Designer chooseIt picks what suits the business, and you can change it afterwards.',
      'Clean serviceCool white, slate and a clear blue.',
      'Warm tableCream, terracotta and a serif.',
      'Lucia house styleFrom this project',
      // One that does not read says why, and cannot be picked.
      'BrokenCannot be used: It has no SKILL.md.',
      'Add your own…',
    ]);
    expect(within(menu).getByText('Yours')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /^Broken/ }).getAttribute('aria-disabled')).toBe('true');
    // A style with a picture of its own shows it, from this server.
    expect(menu.querySelector('img')?.getAttribute('src')).toBe('/api/v1/designer/styles/lucia-house/preview');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Warm table/ }));
    expect(picked).toEqual(['warm']);
    expect(await screen.findByRole('button', { name: 'Style: Warm table' })).toBeTruthy();
  });

  it('adds a style of the person’s own: said, picked, listed, with what was left out of it', async () => {
    const menu = await open();
    await userEvent.click(await within(menu).findByRole('menuitem', { name: 'Add your own…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a style of your own' });
    expect(dialog.textContent).toContain('It is saved in your project’s design-skills folder. Scripts in it are never run.');
    const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'lucia.zip', { type: 'application/zip' }));
    expect(await within(dialog).findByText('Added. It is in the list now.')).toBeTruthy();
    expect(dialog.textContent).toContain('Left out, as no part of a style: scripts/install.sh');
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual(['/api/v1/designer/styles?filename=lucia.zip']);
    expect(picked).toEqual(['lucia-house']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: 'Style: Lucia house style' })).toBeTruthy();
  });

  it('shows the server’s own sentence when a file is refused, and lets another be chosen', async () => {
    upload = () => jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'preview.svg has a script in it, so the folder was not added.', details: { reason: 'UNSAFE' } } });
    const menu = await open();
    await userEvent.click(await within(menu).findByRole('menuitem', { name: 'Add your own…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a style of your own' });
    await userEvent.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'bad.zip'));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('The style was not addedpreview.svg has a script in it, so the folder was not added.');
    expect(within(dialog).getByRole('button', { name: 'Choose another file' })).toBeTruthy();
    expect(picked).toEqual([]);
  });

  it('removes a style of the project’s own after asking, and says apps keep the look they have', async () => {
    styles = [...BUILT_IN, OWN];
    const menu = await open();
    await userEvent.click(await within(menu).findByRole('menuitem', { name: /^Lucia house style/ }));
    expect(picked).toEqual(['lucia-house']);
    await userEvent.click(await screen.findByRole('button', { name: 'Style: Lucia house style', hidden: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Lucia house style…', hidden: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove “Lucia house style”?' });
    expect(dialog.textContent).toContain('Its folder is deleted from the project. Apps that use it keep the look they have.');
    // "Keep it" removes nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove “Lucia house style”?' })).toBeNull());
    // The menu may have stayed open under the dialog: open it only if it closed.
    if (screen.queryByRole('button', { name: 'Remove Lucia house style…', hidden: true }) === null) await userEvent.click(await screen.findByRole('button', { name: 'Style: Lucia house style', hidden: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Lucia house style…', hidden: true }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove “Lucia house style”?' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/designer/styles/lucia-house']));
    // It was the picked one: the choice goes back to the Designer.
    expect(await screen.findByRole('button', { name: 'Style: Let the Designer choose', hidden: true })).toBeTruthy();
  });
});
