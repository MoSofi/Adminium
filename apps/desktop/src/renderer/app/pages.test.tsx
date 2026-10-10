// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { I18nInstance } from '@adminium/i18n';
import { I18nProvider } from '@adminium/i18n/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminiumDesktopApi, DesktopRecentProject, DesktopStartApi, DesktopStartState } from '../../preload/api.js';
import { App, screenFromHash } from './App.js';
import { desktopApi } from './bridge.js';
import { refusalWords, warningWords } from './new/NewProjectScreen.js';
import { openedWhen } from './start/StartScreen.js';
import { PAGE_LANGUAGES, initWords, loadWords, localeFor } from './words.js';

const recentProject = (over: Partial<DesktopRecentProject> = {}): DesktopRecentProject => ({
  path: '/Users/sam/Adminium/juniper-kitchen',
  displayPath: '~/Adminium/juniper-kitchen',
  name: 'Juniper Kitchen',
  lastOpened: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  state: 'shared',
  missing: false,
  ...over,
});

const STATE: DesktopStartState = {
  firstLaunch: false,
  recent: [recentProject(), recentProject({ path: '/Users/sam/Documents/old-bakery', displayPath: '~/Documents/old-bakery', name: 'Old Bakery', state: 'building', missing: true })],
  proposedParent: '/Users/sam/Adminium',
  proposedParentDisplay: '~/Adminium',
  language: null,
  theme: 'light',
};

function fakeStart(over: Partial<DesktopStartApi> = {}): DesktopStartApi {
  return {
    state: vi.fn(() => Promise.resolve(STATE)),
    judgeNewFolder: vi.fn(({ parent, name }: { parent: string; name: string }) =>
      Promise.resolve(
        name.trim() === ''
          ? { ok: false as const, path: null, displayPath: null, refused: 'no-name' as const }
          : { ok: true as const, path: `${parent}/${name.toLowerCase().replace(/\s+/g, '-')}`, displayPath: `${parent.replace('/Users/sam', '~')}/${name.toLowerCase().replace(/\s+/g, '-')}`, warning: null },
      ),
    ),
    chooseParent: vi.fn(() => Promise.resolve<string | null>('/Users/sam/Documents')),
    createProject: vi.fn(() => Promise.resolve({ status: 'created' as const, path: '/Users/sam/Adminium/shop' })),
    makeProgress: vi.fn(() => Promise.resolve({ step: null, since: 0 })),
    chooseFolder: vi.fn(() => Promise.resolve<{ path: string; displayPath: string } | null>({ path: '/Users/sam/Downloads/shop', displayPath: '~/Downloads/shop' })),
    openProject: vi.fn(() => Promise.resolve({ status: 'opened' as const })),
    forgetProject: vi.fn(() => Promise.resolve([recentProject()])),
    locateProject: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    useClassic: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await initWords('en_US');
});
beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

function show(start: DesktopStartApi, state: DesktopStartState = STATE): void {
  Object.defineProperty(window, 'adminiumDesktop', { value: { platform: 'darwin', start } as unknown as AdminiumDesktopApi, configurable: true });
  const wrap = (children: ReactNode): ReactNode => <I18nProvider i18n={i18n}>{children}</I18nProvider>;
  render(wrap(<App initial={state} />));
}

describe('the bridge as the pages see it', () => {
  it('says so when it is missing, rather than drawing dead buttons', () => {
    expect(() => desktopApi()).toThrow(/bridge is missing/);
  });
});

describe('the words', () => {
  it('are loaded for the eight languages, by a loader that names two namespaces and no more', async () => {
    expect([...PAGE_LANGUAGES].sort()).toEqual(['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW']);
    expect(await loadWords('de-DE', 'desktop')).not.toBeNull();
    expect(await loadWords('de-DE', 'ui')).not.toBeNull();
    // The dashboard's vocabulary is not this bundle's to carry.
    for (const namespace of ['common', 'studio', 'designer', 'errors']) expect(await loadWords('de-DE', namespace)).toBeNull();
  });

  it('follow the saved language, or the system’s when none was saved', () => {
    expect(localeFor('de-DE', 'en-US')).toBe('de_DE');
    expect(localeFor(null, 'fr-FR')).toBe('fr_FR');
    expect(localeFor(null, 'xx-YY')).toBe('en_US');
  });

  it('draw the page in another language when it is the app’s', async () => {
    const german = await initWords('de_DE');
    expect(german.t('desktop:start.heading')).toBe('Was möchten Sie tun?');
    expect(german.t('desktop:trust.title')).toBe('Diesen Ordner öffnen?');
  });
});

describe('which screen the address names', () => {
  it('is New app for #/new and Start for anything else', () => {
    expect(screenFromHash('#/new')).toBe('new');
    expect(screenFromHash('')).toBe('start');
    expect(screenFromHash('#/nowhere')).toBe('start');
  });
});

describe('how long ago a project was opened', () => {
  const now = new Date(2026, 9, 10, 9, 0, 0);
  it('is the system’s own words', () => {
    expect(openedWhen(new Date(2026, 9, 10, 1, 0, 0).toISOString(), now, 'en-US')).toBe('today');
    expect(openedWhen(new Date(2026, 9, 9, 23, 0, 0).toISOString(), now, 'en-US')).toBe('yesterday');
    expect(openedWhen(new Date(2026, 9, 7, 9, 0, 0).toISOString(), now, 'en-US')).toBe('3 days ago');
    expect(openedWhen(new Date(2026, 6, 10, 9, 0, 0).toISOString(), now, 'en-US')).toBe('3 months ago');
    expect(openedWhen(new Date(2024, 9, 10, 9, 0, 0).toISOString(), now, 'en-US')).toBe('2 years ago');
    expect(openedWhen(new Date(2026, 9, 9, 23, 0, 0).toISOString(), now, 'de-DE')).toBe('gestern');
  });
  it('never says a project was opened in the future because a clock moved', () => {
    expect(openedWhen(new Date(2026, 9, 12).toISOString(), now, 'en-US')).toBe('today');
  });
});

describe('Start', () => {
  it('offers the four things, the first as the main one, and welcomes only a first launch', () => {
    show(fakeStart());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What would you like to do?');
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('data-choice')).map((button) => button.getAttribute('data-choice'))).toEqual(['build', 'open', 'connect', 'db']);
    expect(screen.queryByText('Welcome to Adminium.')).toBeNull();
    // Nothing to connect to yet.
    expect((screen.getByText('Connect to another Adminium').closest('button') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    show(fakeStart(), { ...STATE, firstLaunch: true, recent: [] });
    expect(screen.getByText('Welcome to Adminium.')).toBeTruthy();
    expect(screen.queryByText('Recent projects')).toBeNull();
  });

  it('lists the recent projects: a path that reads left to right, when it was opened, and how it was last served', () => {
    show(fakeStart());
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Recent projects');
    const path = screen.getByText('~/Adminium/juniper-kitchen');
    expect(path.getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('Opened yesterday')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
    // A folder that is gone is not a button, and says so.
    expect(screen.queryByRole('button', { name: 'Open Old Bakery' })).toBeNull();
    expect(screen.getByText('This folder was moved or deleted')).toBeTruthy();
    expect(screen.getByText('~/Documents/old-bakery').className).toContain('line-through');
  });

  it('goes to New app, and back', async () => {
    show(fakeStart());
    fireEvent.click(screen.getByText('Build an app'));
    window.dispatchEvent(new Event('hashchange'));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    window.dispatchEvent(new Event('hashchange'));
    expect(await screen.findByText('What would you like to do?')).toBeTruthy();
  });

  it('chooses the classic workspace', async () => {
    const start = fakeStart();
    show(start);
    fireEvent.click(screen.getByText('Use my own database'));
    await waitFor(() => {
      expect(start.useClassic).toHaveBeenCalledTimes(1);
    });
  });

  it('asks before a folder is opened, Cancel first; "Open" says the person agreed', async () => {
    const openProject = vi
      .fn<DesktopStartApi['openProject']>()
      .mockResolvedValueOnce({ status: 'trust-needed', path: '/Users/sam/Downloads/shop', displayPath: '~/Downloads/shop', changed: true })
      .mockResolvedValueOnce({ status: 'opened' });
    const start = fakeStart({ openProject });
    show(start);
    fireEvent.click(screen.getByText('Open a folder'));
    const dialog = await screen.findByRole('dialog');
    expect(start.chooseFolder).toHaveBeenCalledWith({ title: 'Open a folder' });
    expect(openProject).toHaveBeenLastCalledWith({ path: '/Users/sam/Downloads/shop' });
    expect(dialog.textContent).toContain('Open this folder?');
    expect(dialog.textContent).toContain('~/Downloads/shop');
    expect(dialog.textContent).toContain('This folder’s code changed since you last opened it.');
    const buttons = [...dialog.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toEqual(['Cancel', 'Open']);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(openProject).toHaveBeenLastCalledWith({ path: '/Users/sam/Downloads/shop', agreed: true });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens a recent project from its whole row and its two buttons: the Designer, or its dashboard', async () => {
    const start = fakeStart();
    show(start);
    const row = document.querySelector('[data-recent]') as HTMLElement;
    const path = row.dataset.recent ?? '';
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Open Juniper Kitchen in the Designer' }));
    await waitFor(() => {
      expect(start.openProject).toHaveBeenCalledTimes(2);
    });
    expect(start.openProject).toHaveBeenNthCalledWith(1, { path });
    expect(start.openProject).toHaveBeenNthCalledWith(2, { path });
    // One click, one opening: a button inside the row does not also open the row.
    fireEvent.click(screen.getByRole('button', { name: 'Open the dashboard of Juniper Kitchen' }));
    await waitFor(() => {
      expect(start.openProject).toHaveBeenCalledTimes(3);
    });
    expect(start.openProject).toHaveBeenLastCalledWith({ path, land: 'dashboard' });
  });

  it('keeps where it was to land across the question about the folder’s code', async () => {
    const openProject = vi.fn<DesktopStartApi['openProject']>().mockResolvedValue({ status: 'trust-needed', path: '/p', displayPath: '/p', changed: false });
    show(fakeStart({ openProject }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the dashboard of Juniper Kitchen' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(openProject).toHaveBeenLastCalledWith({ path: '/p', agreed: true, land: 'dashboard' });
    });
  });

  it('opens nothing when the question is cancelled or no folder was picked', async () => {
    const openProject = vi.fn<DesktopStartApi['openProject']>().mockResolvedValue({ status: 'trust-needed', path: '/p', displayPath: '/p', changed: false });
    const start = fakeStart({ openProject });
    show(start);
    fireEvent.click(screen.getByRole('button', { name: 'Open Juniper Kitchen' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(openProject).toHaveBeenCalledTimes(1);

    (start.chooseFolder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByText('Open a folder'));
    await waitFor(() => {
      expect(start.chooseFolder).toHaveBeenCalled();
    });
    expect(openProject).toHaveBeenCalledTimes(1);
  });

  it('says in a notice why a folder was not opened', async () => {
    for (const [status, words] of [
      ['missing', 'This folder was moved or deleted'],
      ['not-a-project', 'This folder is not an Adminium project.'],
      ['needs-packages', 'This project’s packages are not on this computer yet.'],
    ] as const) {
      show(fakeStart({ openProject: vi.fn(() => Promise.resolve({ status })) }), { ...STATE, recent: [recentProject()] });
      fireEvent.click(screen.getByRole('button', { name: 'Open Juniper Kitchen' }));
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'Notices' }).textContent).toContain(words);
      });
      cleanup();
    }
    show(fakeStart({ openProject: vi.fn(() => Promise.reject(new Error('INTERNAL: the disk said no'))) }), { ...STATE, recent: [recentProject()] });
    fireEvent.click(screen.getByRole('button', { name: 'Open Juniper Kitchen' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Notices' }).textContent).toContain('the disk said no');
    });
  });

  it('removes a folder that is gone from the list, and locates one that moved', async () => {
    const start = fakeStart();
    show(start);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(screen.queryByText('Old Bakery')).toBeNull();
    });
    expect(start.forgetProject).toHaveBeenCalledWith('/Users/sam/Documents/old-bakery');
    expect(screen.getByRole('region', { name: 'Notices' }).textContent).toContain('Removed from the recent projects');
  });

  it('says so when the folder picked for a moved project is not it', async () => {
    const located = recentProject({ path: '/Users/sam/new-bakery', displayPath: '~/new-bakery', name: 'Old Bakery' });
    const locateProject = vi
      .fn<DesktopStartApi['locateProject']>()
      .mockResolvedValueOnce({ status: 'not-a-project' })
      .mockResolvedValueOnce({ status: 'already-listed' })
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({ status: 'located', recent: [located] });
    show(fakeStart({ locateProject }));
    const notices = (): string => screen.getByRole('region', { name: 'Notices' }).textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Locate…' }));
    await waitFor(() => {
      expect(notices()).toContain('That folder is not an Adminium project.');
    });
    expect(locateProject).toHaveBeenCalledWith({ path: '/Users/sam/Documents/old-bakery', title: 'Where is Old Bakery now?' });
    fireEvent.click(screen.getByRole('button', { name: 'Locate…' }));
    await waitFor(() => {
      expect(notices()).toContain('That folder is already in the list.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Locate…' }));
    await waitFor(() => {
      expect(locateProject).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Locate…' }));
    expect(await screen.findByRole('button', { name: 'Open Old Bakery' })).toBeTruthy();
    expect(screen.getByText('~/new-bakery')).toBeTruthy();
  });
});

describe('New app', () => {
  const open = (start: DesktopStartApi): void => {
    window.location.hash = '#/new';
    show(start);
  };

  it('proposes a folder made from the name, and makes the project there', async () => {
    const start = fakeStart();
    open(start);
    const where = screen.getByRole('textbox', { name: 'Where to keep it' }) as HTMLInputElement;
    expect(where.readOnly).toBe(true);
    expect(where.getAttribute('dir')).toBe('ltr');
    await waitFor(() => {
      expect(where.value).toBe('~/Adminium');
    });
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Name'), 'Juniper Kitchen');
    await waitFor(() => {
      expect(where.value).toBe('~/Adminium/juniper-kitchen');
    });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => {
      expect(start.createProject).toHaveBeenCalledWith({ parent: '/Users/sam/Adminium', name: 'Juniper Kitchen' });
    });
  });

  it('"Change…" asks the system for a folder and the path follows it', async () => {
    const start = fakeStart();
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: 'Where to keep it' }) as HTMLInputElement).value).toBe('~/Documents/shop');
    });
    expect(start.chooseParent).toHaveBeenCalledWith({ from: '/Users/sam/Adminium', title: 'Where to keep it' });
    // Nothing picked: the folder stays.
    (start.chooseParent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await waitFor(() => {
      expect(start.chooseParent).toHaveBeenCalledTimes(2);
    });
    expect((screen.getByRole('textbox', { name: 'Where to keep it' }) as HTMLInputElement).value).toBe('~/Documents/shop');
  });

  it('warns about a synced folder and waits for the person’s choice, for that folder only', async () => {
    const judgeNewFolder = vi.fn<DesktopStartApi['judgeNewFolder']>(({ parent }) =>
      Promise.resolve({ ok: true, path: `${parent}/shop`, displayPath: `${parent}/shop`, warning: 'icloud' }),
    );
    const start = fakeStart({ judgeNewFolder });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This folder is synced by iCloud Drive.');
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Use it anyway' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => {
      expect(start.createProject).toHaveBeenCalledWith({ parent: '/Users/sam/Adminium', name: 'Shop', acceptWarning: true });
    });

    // Another folder is another question.
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }));
    await waitFor(() => {
      expect(start.chooseParent).toHaveBeenCalledTimes(2);
    });
  });

  it('refuses a folder with the reason, and "Create" stays off', async () => {
    const start = fakeStart({ judgeNewFolder: vi.fn(() => Promise.resolve({ ok: false as const, path: '/Users/sam', displayPath: '~', refused: 'home-folder' as const })) });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    expect((await screen.findByRole('alert')).textContent).toBe('A project cannot be kept directly in your home folder. Choose or make a folder inside it.');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows what main saw when it judged differently at "Create"', async () => {
    const judgeNewFolder = vi
      .fn<DesktopStartApi['judgeNewFolder']>()
      .mockResolvedValue({ ok: true, path: '/p/shop', displayPath: '/p/shop', warning: null });
    const start = fakeStart({ judgeNewFolder, createProject: vi.fn(() => Promise.resolve({ status: 'refused' as const, refused: 'exists-with-files' as const })) });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(create.disabled).toBe(false);
    });
    judgeNewFolder.mockResolvedValue({ ok: false, path: '/p/shop', displayPath: '/p/shop', refused: 'exists-with-files' });
    fireEvent.click(create);
    expect((await screen.findByRole('alert')).textContent).toContain('A folder with this name is already there and holds files.');
  });

  it('shows what is being done while the project is made, with the step in hand marked', async () => {
    let finish: (value: { status: 'failed'; detail: string }) => void = () => undefined;
    const start = fakeStart({
      createProject: vi.fn(() => new Promise<{ status: 'failed'; detail: string }>((done) => (finish = done))),
      makeProgress: vi.fn(() => Promise.resolve({ step: 'packages' as const, since: Date.now() - 65_000 })),
    });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(create.disabled).toBe(false);
    });
    fireEvent.click(create);
    const steps = await screen.findByRole('status', { name: 'What is being done' });
    const states = [...steps.querySelectorAll('li')].map((item) => `${item.dataset.step ?? ''}:${item.dataset.state ?? ''}`);
    expect(states).toEqual(['files:done', 'packages:active', 'database:waiting', 'opening:waiting']);
    expect(steps.textContent).toContain('Getting what your app is built with');
    expect(steps.textContent).toMatch(/1:0\d/);
    expect(screen.getByText(/This is the long step, the first time/)).toBeDefined();
    // It ended: the steps go with it.
    finish({ status: 'failed', detail: 'no' });
    await screen.findByRole('alert');
    expect(screen.queryByRole('status', { name: 'What is being done' })).toBeNull();
  });

  it('says why a project could not be made, in the maker’s own last lines', async () => {
    const start = fakeStart({ createProject: vi.fn(() => Promise.resolve({ status: 'failed' as const, detail: 'npm error code ENOTFOUND' })) });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(create.disabled).toBe(false);
    });
    fireEvent.click(create);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The project could not be made.');
    expect(alert.textContent).toContain('npm error code ENOTFOUND');
    // And it can be tried again.
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so in a notice when the bridge itself fails', async () => {
    const start = fakeStart({ createProject: vi.fn(() => Promise.reject(new Error('UNAVAILABLE: The first screens are not open.'))) });
    open(start);
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(create.disabled).toBe(false);
    });
    fireEvent.click(create);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Notices' }).textContent).toContain('The first screens are not open.');
    });
  });

  it('has a sentence for every warning and every refusal main can give', () => {
    const t = (_key: string, fallback: string): string => fallback;
    const warnings = ['icloud', 'onedrive', 'dropbox', 'googledrive', 'no-links'] as const;
    expect(new Set(warnings.map((warning) => warningWords(t, warning))).size).toBe(warnings.length);
    const refusals = ['bad-name', 'home-folder', 'system-folder', 'inside-the-app', 'inside-a-project', 'exists-with-files', 'not-absolute'] as const;
    const sentences = refusals.map((refused) => refusalWords(t, refused));
    expect(new Set(sentences).size).toBe(refusals.length);
    for (const sentence of sentences) expect(sentence).not.toBeNull();
    // An empty name needs no box: the field says it.
    expect(refusalWords(t, 'no-name')).toBeNull();
  });
});
