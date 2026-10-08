// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The work bar: what it draws at each level, what "More" holds, the states
 * nobody drew (before the first build, a live server, an app with one side),
 * and the level picked from what the bar itself measures.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs, ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { DesignerSession } from '../api.js';
import { AddressBar } from './AddressBar.js';
import type { BarLevel } from './barLevel.js';
import type { PreviewModel, PreviewSide } from './usePreview.js';
import { WorkArea } from './WorkArea.js';
import { seenAs, WorkBar, type WorkTab } from './WorkBar.js';

vi.mock('../architecture/ArchitectureTab.js', () => ({ default: () => null }));

const TABS: WorkTab[] = [
  { value: 'preview', label: 'Preview' },
  { value: 'architecture', label: 'Architecture' },
];

function model(over: Partial<PreviewModel> = {}): PreviewModel {
  return {
    noPreview: false,
    app: { key: 'shop', version: '0.1.0', sides: [] } as unknown as PreviewModel['app'],
    appPending: false,
    sides: ['dashboard', 'staff', 'customer'],
    side: 'staff',
    setSide: vi.fn(),
    width: 'desktop',
    setWidth: vi.fn(),
    round: 0,
    reload: vi.fn(),
    sees: true,
    setSees: vi.fn(),
    prefix: '/apps/shop/staff',
    to: '/apps/shop/staff/',
    path: '/',
    spoken: true,
    go: vi.fn(),
    visited: [],
    frame: { current: null },
    dashboardSrc: '/',
    onStaffNavigate: vi.fn(),
    ticket: { url: 'http://localhost:4731/x', origin: 'http://localhost:4731', seenAs: null },
    ticketError: null,
    running: false,
    openTab: vi.fn(),
    ...over,
  };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

function bar(level: BarLevel, preview: PreviewModel, options: { tab?: string; end?: React.ReactNode } = {}) {
  const onNotice = vi.fn<(text: string) => void>();
  render(
    <ThemeProvider>
      <Tabs value={options.tab ?? 'preview'}>
        <WorkBar tabs={TABS} tab={options.tab ?? 'preview'} level={level} preview={preview} address={<AddressBar side={preview.side} path={preview.path} />} end={options.end} onNotice={onNotice} />
      </Tabs>
    </ThemeProvider>,
  );
  return { onNotice };
}

/** What is in the bar, by what a person would call each thing. */
function parts(): Record<string, boolean> {
  const has = (role: string, name: string | RegExp): boolean => screen.queryByRole(role, { name }) !== null;
  return {
    sideSwitch: has('radiogroup', 'Side'),
    sideMenu: has('button', /^Side: /),
    sizeSwitch: has('radiogroup', 'Size'),
    sizeMenu: has('button', /^Size: /),
    // The words are in the bar, on a thing that may carry a name: a bare span may not, and a screen reader would be told nothing.
    chipText: has('note', /^Seen as: /) && screen.queryByText(/^Seen as: /) !== null,
    chipIcon: has('img', /^Seen as: /),
    reload: has('button', 'Reload the preview'),
    address: screen.queryByLabelText(/^Address on the /) !== null,
    camera: has('button', 'The Designer looks at the page after it builds'),
    newTab: has('button', 'Open in a new tab'),
    more: has('button', 'More'),
  };
}

describe('the work bar', () => {
  it('draws everything at level 0, and no "More" with nothing in it', () => {
    bar(0, model());
    expect(parts()).toEqual({ sideSwitch: true, sideMenu: false, sizeSwitch: true, sizeMenu: false, chipText: true, chipIcon: false, reload: true, address: true, camera: true, newTab: true, more: false });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Preview', 'Architecture']);
    expect(screen.getByRole('tablist', { name: 'Work area' })).toBeTruthy();
    // The side's key, as an address has it, and the bar written left to right whatever the page is.
    const address = screen.getByLabelText('Address on the staff side');
    expect(address.closest('[dir="ltr"]')?.textContent).toBe('staff');
    expect(within(screen.getByRole('radiogroup', { name: 'Size' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Desktop', 'Tablet', 'Phone']);
  });

  it('moves the camera switch into "More" at level 1, where it says the same sentence, keeps its tick, and stays open', async () => {
    const preview = model();
    const { onNotice } = bar(1, preview);
    expect(parts()).toMatchObject({ sideSwitch: true, sizeSwitch: true, chipText: true, camera: false, newTab: true, more: true });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu', { name: 'More' });
    const row = within(menu).getByRole('menuitemcheckbox', { name: 'The Designer looks at the page after it builds' });
    expect(row.getAttribute('aria-checked')).toBe('true');
    // Off a phone the menu holds the switch alone.
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Open in a new tab' })).toBeNull();
    await userEvent.click(row);
    expect(preview.setSees).toHaveBeenCalledWith(false);
    expect(onNotice).toHaveBeenCalledWith('The Designer will not look at the page after it builds');
    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeNull();
  });

  it('makes the side and the size one menu button each at level 2', async () => {
    const preview = model();
    bar(2, preview);
    expect(parts()).toMatchObject({ sideSwitch: false, sideMenu: true, sizeSwitch: false, sizeMenu: true, chipText: true, chipIcon: false, more: true });
    const side = screen.getByRole('button', { name: 'Side: Staff' });
    expect(side.textContent).toBe('Staff');
    await userEvent.click(side);
    const rows = within(await screen.findByRole('menu', { name: 'Side: Staff' })).getAllByRole('menuitemradio');
    expect(rows.map((row) => [row.textContent, row.getAttribute('aria-checked')])).toEqual([
      ['Dashboard', 'false'],
      ['Staff', 'true'],
      ['Customer', 'false'],
    ]);
    await userEvent.click(rows[2]!);
    expect(preview.setSide).toHaveBeenCalledWith('customer');
    await userEvent.click(screen.getByRole('button', { name: 'Size: Desktop' }));
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Size: Desktop' })).getByRole('menuitemradio', { name: 'Phone' }));
    expect(preview.setWidth).toHaveBeenCalledWith('phone');
  });

  it('makes "seen as" its icon at level 3, which still says the words and the sentence', () => {
    bar(3, model());
    expect(parts()).toMatchObject({ sideMenu: true, sizeMenu: true, chipText: false, chipIcon: true, reload: true, address: true, newTab: true, more: true });
    expect(screen.getByRole('img', { name: 'Seen as: staff. Staff. A preview, not your own sign-in.' })).toBeTruthy();
  });

  it('is two rows at level 4: the tabs, then reload, the address and "More", which holds the rest; there is no size', async () => {
    const preview = model({ side: 'customer' });
    bar(4, preview);
    expect(parts()).toEqual({ sideSwitch: false, sideMenu: false, sizeSwitch: false, sizeMenu: false, chipText: false, chipIcon: false, reload: true, address: true, camera: false, newTab: false, more: true });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu', { name: 'More' });
    expect(within(menu).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['Dashboard', 'Staff', 'Customer']);
    expect(menu.textContent).toContain('Seen as: visitor');
    expect(menu.textContent).toContain('A visitor, not signed in.');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'The Designer looks at the page after it builds' })).toBeTruthy();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open in a new tab' }));
    expect(preview.openTab).toHaveBeenCalled();
  });

  it('moves through the sides with the arrow keys, the chosen one the row’s one tab stop', async () => {
    const preview = model();
    bar(0, preview);
    const radios = within(screen.getByRole('radiogroup', { name: 'Side' })).getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    radios[1]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(preview.setSide).toHaveBeenLastCalledWith('customer');
    await userEvent.keyboard('{Home}');
    expect(preview.setSide).toHaveBeenLastCalledWith('dashboard');
  });

  it('says whose eyes the preview is in a few words, with the sentence behind them', () => {
    const said = (side: PreviewSide, roles: readonly string[] | null) => {
      const seen = seenAs(side, roles);
      return [seen.label, seen.tip, seen.said];
    };
    expect(said('customer', null)).toEqual(['Seen as: visitor', 'A visitor, not signed in.', 'Seen as: visitor. A visitor, not signed in.']);
    expect(said('dashboard', ['Cook'])).toEqual(['Seen as: owner', 'You, the owner.', 'Seen as: owner. You, the owner.']);
    expect(said('staff', null)).toEqual(['Seen as: staff', 'Staff. A preview, not your own sign-in.', 'Seen as: staff. Staff. A preview, not your own sign-in.']);
    expect(said('staff', [])).toEqual(['Seen as: no role', 'A person with no role yet. A preview.', 'Seen as: no role. A person with no role yet. A preview.']);
    // A list the chip may cut short is said whole in its sentence, once.
    expect(said('staff', ['Cook', 'Cashier'])).toEqual(['Seen as: Cook, Cashier', 'Seen as: Cook, Cashier. A preview, not your own sign-in.', 'Seen as: Cook, Cashier. A preview, not your own sign-in.']);
  });

  it('is its tabs alone before the first build and on a live server, and has no side switch for an app with one side', async () => {
    const nothing = { sideSwitch: false, sideMenu: false, sizeSwitch: false, sizeMenu: false, chipText: false, chipIcon: false, reload: false, address: false, camera: false, newTab: false, more: false };
    const first = render(<div />);
    first.unmount();
    for (const preview of [model({ app: null }), model({ noPreview: true })]) {
      for (const level of [0, 2, 4] as const) {
        const shown = render(
          <ThemeProvider>
            <Tabs value="preview">
              <WorkBar tabs={TABS} tab="preview" level={level} preview={preview} address={null} onNotice={() => undefined} />
            </Tabs>
          </ThemeProvider>,
        );
        expect(parts(), String(level)).toEqual(nothing);
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        shown.unmount();
      }
    }
    const one = model({ sides: ['dashboard'], side: 'dashboard' });
    bar(4, one);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu', { name: 'More' });
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
    expect(menu.textContent).toContain('Seen as: owner');
  });

  it('puts what another tab says at the bar’s end, and none of the preview’s tools', () => {
    bar(0, model(), { tab: 'architecture', end: <span>Read only</span> });
    expect(parts()).toMatchObject({ sideSwitch: false, reload: false, address: false, camera: false, more: false });
    expect(screen.getByText('Read only')).toBeTruthy();
  });
});

describe('the work area’s bar, measured', () => {
  const SESSION: DesignerSession = { id: 'ds_000000000000000000000012', appKey: 'shop', title: 'Crispy Bites', target: 'auto', connectionId: 'c', model: 'm', createdAt: 1, updatedAt: 1, turns: 1, version: 4, createdApp: true, tokens: { in: 0, out: 0 } };
  // What the bar wants at each level, and how wide it is: the test's DOM lays nothing out.
  const NEEDS = [1122, 1080, 854, 714, 0];
  let width = 1400;
  let observers: (() => void)[] = [];
  let narrow = false;

  beforeEach(() => {
    width = 1400;
    observers = [];
    narrow = false;
    vi.stubGlobal('WebSocket', class { send(): void {} close(): void {} });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly run: () => void) {
          observers.push(run);
        }
        observe(): void {}
        disconnect(): void {
          observers = observers.filter((entry) => entry !== this.run);
        }
      },
    );
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? narrow : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => true })) as unknown as typeof window.matchMedia;
    const live = (element: Element): boolean => (element as HTMLElement).dataset['part'] === 'work-bar' && element.closest('[inert]') === null;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return live(this) ? width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.dataset['part'] !== 'work-bar') return 0;
      // The copy measured off-screen is as wide as its words: the dashboard's name is the longest.
      if (!live(this)) return this.textContent?.includes('Dashboard') === true ? 744 : 714;
      return Math.max(width, NEEDS[Number(this.dataset['level'])] ?? 0);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        if (url === '/api/v1/system/info') return Promise.resolve(jsonResponse(200, { designer: { mode: 'local', link: false } }));
        if (url === '/api/v1/apps') return Promise.resolve(jsonResponse(200, { apps: [{ key: 'shop', version: '0.1.0', sides: [{ side: 'staff', prefix: '/apps/shop/staff', navAvailable: true }, { side: 'customer', prefix: '/apps/shop/customer', navAvailable: true }] }], staged: [] }));
        if (url.endsWith('/preview-ticket')) return Promise.resolve(jsonResponse(200, { url: 'http://localhost:4731/designer-preview/enter?ticket=t', origin: 'http://localhost:4731' }));
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount() {
    const onFoldedNeed = vi.fn<(need: number) => void>();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <WorkArea session={SESSION} turns={[]} onFix={() => undefined} onNotice={() => undefined} onFoldedNeed={onFoldedNeed} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return { onFoldedNeed };
  }
  const level = (): string | undefined => document.querySelector<HTMLElement>('[data-part="work-bar"]:not([inert] *)')?.dataset['level'];
  const resize = (to: number): void => {
    width = to;
    act(() => observers.forEach((run) => run()));
  };

  it('folds as the work area narrows and unfolds as it widens, and says what its most folded bar needs', async () => {
    const { onFoldedNeed } = mount();
    await screen.findByRole('radiogroup', { name: 'Side' });
    expect(level()).toBe('0');
    for (const [to, wanted] of [[1100, '1'], [1000, '2'], [800, '3'], [700, '4'], [721, '4'], [722, '3'], [900, '2'], [1088, '1'], [1400, '0']] as const) {
      resize(to);
      await waitFor(() => expect(level(), String(to)).toBe(wanted));
    }
    // Measured off-screen, at level 3, for each side: the widest of them, and it did not wait for the bar to overflow.
    expect(onFoldedNeed.mock.calls[0]).toEqual([744]);
    expect(new Set(onFoldedNeed.mock.calls.map(([need]) => need))).toEqual(new Set([744]));
    // The measured copy is out of everything's reach, and has no name for anything to find.
    const copy = document.querySelector('[inert][aria-hidden="true"]');
    expect(copy?.querySelectorAll('[data-part="work-bar"]')).toHaveLength(3);
    expect(copy?.querySelector('[aria-label]')).toBeNull();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('measures again when the tab changes, and says "read only" with the version at the bar’s end', async () => {
    mount();
    await screen.findByRole('radiogroup', { name: 'Side' });
    resize(800);
    await waitFor(() => expect(level()).toBe('3'));
    // The Architecture tab's bar is short: what the preview's bar needed says nothing of it.
    NEEDS.fill(300);
    await userEvent.click(screen.getByRole('tab', { name: 'Architecture' }));
    await waitFor(() => expect(level()).toBe('0'));
    const end = screen.getByText('v4');
    expect(end.className).toContain('font-mono');
    expect(end.parentElement?.textContent).toBe('Read only · drawn from v4');
    NEEDS.splice(0, 5, 1122, 1080, 854, 714, 0);
  });

  it('is two rows in a phone-wide window whatever fits', async () => {
    narrow = true;
    mount();
    await screen.findByRole('button', { name: 'More' });
    expect(level()).toBe('4');
    expect(screen.queryByRole('radiogroup', { name: 'Size' })).toBeNull();
  });
});
