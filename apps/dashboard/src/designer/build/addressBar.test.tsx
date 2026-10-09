// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The address bar: what it shows, its keys, where Enter goes, what puts the
 * real path back, when it only shows, and the pages it offers on each side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { designerKeys, type ArchitectureDoc } from '../api.js';
import { AddressBar, cutMiddle, offered, type KnownPage } from './AddressBar.js';
import { customerPages, dashboardPages, staffPages, useKnownPages } from './knownPages.js';
import type { PreviewSide } from './usePreview.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  document.documentElement.removeAttribute('dir');
  vi.unstubAllGlobals();
});

const PAGES: KnownPage[] = [
  { path: '/', name: 'Home' },
  { path: '/menu', name: 'Menu' },
  { path: '/menu/spicy-wings', name: 'Spicy wings' },
  { path: '/cart', name: 'Cart' },
  { path: '/orders/1042', name: '' },
];

function mount(over: Partial<{ side: PreviewSide; path: string; spoken: boolean; pages: KnownPage[]; prefix: string; listLabel: string }> = {}) {
  const onGo = vi.fn<(path: string) => void>();
  render(
    <ThemeProvider>
      <AddressBar side={over.side ?? 'customer'} path={over.path ?? '/menu/spicy-wings'} prefix={over.prefix ?? '/apps/shop/customer'} spoken={over.spoken ?? true} pages={over.pages ?? PAGES} listLabel={over.listLabel} onGo={onGo} />
    </ThemeProvider>,
  );
  const field = screen.getByRole('combobox') as HTMLInputElement;
  return { onGo, field };
}
const rows = (): string[] => within(screen.getByRole('listbox')).getAllByRole('option').map((row) => row.textContent ?? '');

describe('the address bar', () => {
  it('shows the side’s key and the path as a person reads it, left to right whatever the page is', () => {
    document.documentElement.dir = 'rtl';
    const { field } = mount({ path: '/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e' });
    expect(field.value).toBe('/menu/crème brûlée');
    expect(field.getAttribute('aria-label')).toBe('Address on the customer side');
    const box = field.closest('[dir]') as HTMLElement;
    expect(box.getAttribute('dir')).toBe('ltr');
    expect(box.textContent).toBe('customer');
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens the pages known on the side when it is focused, and puts what is typed first and in bold', async () => {
    const { field } = mount();
    await userEvent.click(field);
    const list = await screen.findByRole('listbox', { name: 'Pages on this side' });
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-controls')).toBe(list.id);
    expect(list.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    // The page the side is on is what the field holds, so it comes first; the rest keep their order.
    expect(rows()).toEqual(['/menu/spicy-wingsSpicy wings', '/Home', '/menuMenu', '/cartCart', '/orders/1042']);
    // Nothing is picked until an arrow picks it.
    expect(field.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getByText(/to go to what you typed\./).textContent).toBe('Press Enter to go to what you typed.');
    // At least as wide as a path needs, and never taller than a few rows.
    expect(list.parentElement?.className).toContain('min-w-[280px]');
    expect(list.parentElement?.className).toContain('max-h-[320px]');

    await userEvent.clear(field);
    await userEvent.type(field, 'CAR');
    expect(rows()[0]).toBe('/cartCart');
    expect(within(screen.getAllByRole('option')[0]!).getByText('car').className).toContain('font-bold');
    expect(rows()).toHaveLength(5);
  });

  it('goes on Enter to exactly what was typed, tidied, and to a picked row only after an arrow key', async () => {
    const { field, onGo } = mount();
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, 'menu//{Enter}');
    expect(onGo).toHaveBeenLastCalledWith('/menu');
    // The field shows where the side really is again: the path changes when the side says it moved.
    expect(field.value).toBe('/menu/spicy-wings');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.keyboard('{Enter}');
    expect(onGo).toHaveBeenLastCalledWith('/');

    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, 'http://localhost:4731/apps/shop/customer/specials/of the day?x=1{Enter}');
    expect(onGo).toHaveBeenLastCalledWith('/specials/of%20the%20day');

    // "car" matches /cart, which comes first; it is still what was typed that Enter goes to.
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, 'car{Enter}');
    expect(onGo).toHaveBeenLastCalledWith('/car');

    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, 'car{ArrowDown}');
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id);
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{ArrowUp}');
    // Round the end to the last row.
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[4]!.id);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onGo).toHaveBeenLastCalledWith('/cart');
    expect(onGo).toHaveBeenCalledTimes(5);
  });

  it('goes to a row that is pressed', async () => {
    const { field, onGo } = mount();
    await userEvent.click(field);
    await userEvent.click(within(await screen.findByRole('listbox')).getByText('Cart'));
    expect(onGo).toHaveBeenCalledWith('/cart');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('puts the real path back on Escape and on leaving, and goes nowhere', async () => {
    const { field, onGo } = mount();
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, '/somewhere{Escape}');
    expect(field.value).toBe('/menu/spicy-wings');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).not.toBe(field);

    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, '/elsewhere');
    await userEvent.tab();
    expect(field.value).toBe('/menu/spicy-wings');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onGo).not.toHaveBeenCalled();
  });

  it('leaves Enter to the input method while a word is being composed', async () => {
    const { field, onGo } = mount();
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, '/men');
    // The Enter that takes the composed word: by the event's own flag, and by the key code older browsers give it.
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    expect(onGo).not.toHaveBeenCalled();
    expect(field.value).toBe('/men');
    expect(document.activeElement).toBe(field);
    // The word taken, Enter is the field's again.
    await userEvent.keyboard('u{Enter}');
    expect(onGo).toHaveBeenCalledExactlyOnceWith('/menu');
  });

  it('puts the real path back when the side stops saying where it is while the field is typed in', async () => {
    const onGo = vi.fn<(path: string) => void>();
    const bar = (spoken: boolean) => (
      <ThemeProvider>
        <AddressBar side="customer" path="/menu" prefix="/apps/shop/customer" spoken={spoken} pages={PAGES} onGo={onGo} />
      </ThemeProvider>
    );
    const { rerender } = render(bar(true));
    const field = screen.getByRole('combobox') as HTMLInputElement;
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, '/somewhere');
    rerender(bar(false));
    // Drawn anew under its tooltip, so no key reaches it: it shows the real path by itself.
    const shown = screen.getByRole('combobox') as HTMLInputElement;
    expect(shown.readOnly).toBe(true);
    expect(shown.value).toBe('/menu');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Nothing of the draft comes back with the side's voice.
    rerender(bar(true));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('/menu');
    expect(onGo).not.toHaveBeenCalled();
  });

  it('only shows until the side has said where it is, and says why', async () => {
    const { field, onGo } = mount({ spoken: false, path: '/' });
    expect(field.readOnly).toBe(true);
    await userEvent.tab();
    expect(document.activeElement).toBe(field);
    expect((await screen.findByRole('tooltip')).textContent).toBe('This app’s pages have no addresses yet. Ask the Designer to give each page its own address.');
    await userEvent.keyboard('menu{Enter}{ArrowDown}');
    expect(field.value).toBe('/');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onGo).not.toHaveBeenCalled();
  });

  it('never goes to the Designer itself on the dashboard side, nor to what is no path', async () => {
    const { field, onGo } = mount({ side: 'dashboard', path: '/p/shop-items', prefix: '', pages: [{ path: '/p/shop-items', name: 'Items' }] });
    for (const typed of ['/design', 'design/ds_000000000000000000000001', '/Design/x', `/${'a'.repeat(200)}`]) {
      await userEvent.click(field);
      await userEvent.clear(field);
      await userEvent.type(field, `${typed}{Enter}`);
      expect(field.value, typed).toBe('/p/shop-items');
    }
    expect(onGo).not.toHaveBeenCalled();
    await userEvent.click(field);
    await userEvent.clear(field);
    await userEvent.type(field, '/p/shop-requests{Enter}');
    expect(onGo).toHaveBeenCalledWith('/p/shop-requests');
  });

  it('names the customer side’s list for what it is, and cuts a long path in its middle', async () => {
    const long = `/orders/${'9'.repeat(60)}/receipt`;
    const { field } = mount({ listLabel: 'Pages you have opened', pages: [{ path: long, name: 'Receipt' }] });
    await userEvent.click(field);
    expect(await screen.findByRole('listbox', { name: 'Pages you have opened' })).toBeTruthy();
    expect(rows()[0]).toBe(`${cutMiddle(long)}Receipt`);
    expect(cutMiddle(long)).toHaveLength(44);
    expect(cutMiddle(long).startsWith('/orders/9')).toBe(true);
    expect(cutMiddle(long).endsWith('/receipt')).toBe(true);
    expect(cutMiddle('/menu')).toBe('/menu');
    expect(offered(PAGES, '').map((page) => page.path)).toEqual(PAGES.map((page) => page.path));
    expect(offered(PAGES, ' Menu ').map((page) => page.path)).toEqual(['/menu', '/menu/spicy-wings', '/', '/cart', '/orders/1042']);
  });
});

describe('the pages each side offers', () => {
  it('lists the dashboard’s pages of the app from what the engine applied', () => {
    const doc = { lists: { pages: [{ ref: 'shop-items', name: 'Items', kind: 'page-crud', shows: 'items' }, { ref: 'shop-requests', name: 'Requests', kind: 'page-crud', shows: 'requests' }] } } as unknown as ArchitectureDoc;
    expect(dashboardPages(doc)).toEqual([{ path: '/p/shop-items', name: 'Items' }, { path: '/p/shop-requests', name: 'Requests' }]);
    expect(dashboardPages(undefined)).toEqual([]);
  });

  it('lists the staff side’s screens from the text of its nav.json, and nothing from a file that is not one', () => {
    const nav = JSON.stringify([
      { id: 'items', path: '', label: 'Items', icon: 'list-checks' },
      { id: 'requests', path: 'requests', label: { 'en-US': 'Requests', 'de-DE': 'Anfragen' }, icon: 'inbox' },
      { id: 'again', path: '/requests/', label: 'A second entry for the same screen' },
      { id: 'climb', path: '../../admin', label: 'Up' },
      { id: 'none' },
      'a sentence',
    ]);
    expect(staffPages(nav)).toEqual([{ path: '/', name: 'Items' }, { path: '/requests', name: 'Requests' }, { path: '/admin', name: 'Up' }]);
    for (const bad of [undefined, '', '{', '{"path":"x"}', 'null']) expect(staffPages(bad), String(bad)).toEqual([]);
  });

  it('lists a customer side’s opened pages with the titles the pages gave themselves', () => {
    expect(customerPages([{ path: '/menu', title: 'Our menu' }, { path: '/', title: '' }])).toEqual([{ path: '/menu', name: 'Our menu' }, { path: '/', name: '' }]);
  });

  it('reads nav.json through the route that opens an app’s files, by the path that route lists it under', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        asked.push(url);
        // The reply of the file route, as the server's own schema has it: the path, the file whole, its hash.
        if (url.includes('/files/content?')) {
          return Promise.resolve(jsonResponse(200, { path: 'apps/shop/staff/nav.json', content: '[\n  { "id": "items", "path": "", "label": "Items", "icon": "list-checks" },\n  { "id": "requests", "path": "requests", "label": "Requests", "icon": "inbox" }\n]\n', hash: 'a'.repeat(64) }));
        }
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const shown = renderHook(({ side }: { side: PreviewSide }) => useKnownPages('ds_000000000000000000000013', 'shop', side, [{ path: '/', title: 'Crispy Bites' }], true), { wrapper, initialProps: { side: 'staff' as PreviewSide } });
    await waitFor(() => expect(shown.result.current).toEqual([{ path: '/', name: 'Items' }, { path: '/requests', name: 'Requests' }]));
    expect(asked).toEqual(['/api/v1/designer/sessions/ds_000000000000000000000013/files/content?path=apps%2Fshop%2Fstaff%2Fnav.json']);
    // What ends a turn or a save asks for the files again: the staff pages are among them, or a screen just added is never offered.
    await act(() => client.invalidateQueries({ queryKey: designerKeys.files('ds_000000000000000000000013') }));
    await waitFor(() => expect(asked).toHaveLength(2));
    asked.pop();
    // A customer side asks the server nothing: its list is what this preview has been on.
    shown.rerender({ side: 'customer' });
    expect(shown.result.current).toEqual([{ path: '/', name: 'Crispy Bites' }]);
    expect(asked).toHaveLength(1);
    // A list that cannot be read is an empty one.
    shown.rerender({ side: 'dashboard' });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(shown.result.current).toEqual([]);
  });
});
