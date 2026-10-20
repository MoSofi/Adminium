// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project's site templates in the Designer:
 *
 *  1. Home names one in a sentence with "Start from it"; several in a list, one with a name the
 *     Designer cannot take saying to rename it; past 100, how many more. Why a folder was not copied
 *     in is said until it is put away.
 *  2. "Start from it" writes "Make an app from {name}." in the box, holds the template with the
 *     message, and the one-template card goes; the template goes in by its name when the message is
 *     sent, right after the session is made.
 *  3. The attach menu has "A folder…" and, when there are any, the templates opening in place; a
 *     name picked goes in at once on the build page, read by the server.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { DesignerAttachment, SiteTemplates } from '../api.js';

let listing: SiteTemplates;
const taken: { sessionId: string; name: string; replace?: string }[] = [];
let cleared = 0;
vi.mock('../api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api.js')>();
  return {
    ...real,
    designerApi: {
      ...real.designerApi,
      siteTemplates: async () => listing,
      clearTemplateNote: async () => {
        cleared += 1;
        listing = { ...listing, note: null };
      },
      siteFromProject: async (sessionId: string, name: string, replace?: string): Promise<DesignerAttachment> => {
        taken.push({ sessionId, name, ...(replace === undefined ? {} : { replace }) });
        return { id: 'att_00000000000000000007', label: name, kind: 'site', mediaType: 'application/zip', bytes: 1, pages: 3, files: 12, leftOut: [], leftOutCount: 0 };
      },
    },
  };
});

const { HomeTemplates } = await import('./homeTemplates.js');
const { AttachMenu, AttachTray, useAttach } = await import('../parts/attach.js');

beforeAll(() => installTestI18n());
beforeEach(() => {
  taken.length = 0;
  cleared = 0;
  listing = { templates: [], more: 0, note: null };
});

const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;

describe('the site templates on Home', () => {
  it('names one in a sentence, and "Start from it" says so in the box and goes', async () => {
    listing = { templates: [{ name: 'harbor-bakery', usable: true }], more: 0, note: null };
    const started: string[] = [];
    const view = render(wrap(<HomeTemplates started={null} onStart={(name) => started.push(name)} />));
    const card = await screen.findByRole('region', { name: 'Site templates in this project' });
    expect(card.textContent).toContain('There is a site template in this project: harbor-bakery.');
    await userEvent.click(within(card).getByRole('button', { name: 'Start from it' }));
    expect(started).toEqual(['harbor-bakery']);
    view.rerender(wrap(<HomeTemplates started="harbor-bakery" onStart={() => undefined} />));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Site templates in this project' })).toBeNull());
  });

  it('lists several, says to rename one it cannot take, and how many more there are', async () => {
    listing = {
      templates: [
        { name: 'harbor bakery!', usable: false },
        { name: 'lantern-books', usable: true },
        { name: 'tidewater-yoga', usable: true },
      ],
      more: 4,
      note: null,
    };
    render(wrap(<HomeTemplates started={null} onStart={() => undefined} />));
    const card = await screen.findByRole('region', { name: 'Site templates in this project' });
    expect(card.textContent).toContain('There are site templates in this project.');
    expect(within(card).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['harbor bakery!: rename this folder to use it (letters, digits, space, . _ -)', 'lantern-booksStart from it', 'tidewater-yogaStart from it']);
    expect(within(card).getByRole('button', { name: 'Start from tidewater-yoga' })).toBeTruthy();
    expect(card.textContent).toContain('and 4 more');
  });

  it('says why a folder was not copied in, until it is put away', async () => {
    listing = { templates: [], more: 0, note: { name: 'Downloads', why: 'Downloads holds more than 1,000 files and folders, so it is not copied in as a site template.' } };
    render(wrap(<HomeTemplates started={null} onStart={() => undefined} />));
    expect((await screen.findByRole('status')).textContent).toBe('Downloads was not copied in as a site template: Downloads holds more than 1,000 files and folders, so it is not copied in as a site template.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(cleared).toBe(1);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('holds a started template with the message, and takes it in by its name once the session is made', async () => {
    const { result } = renderHook(() => useAttach());
    act(() => result.current.site.addProject('harbor-bakery'));
    render(<AttachTray state={result.current} modelName={null} readsImages={null} />);
    expect((document.querySelector('[data-part="site-chip"]') as HTMLElement).textContent).toBe('harbor-bakery · site template');
    expect(taken).toEqual([]);
    expect(await result.current.upload('ds_000000000000000000000001')).toEqual(['att_00000000000000000007']);
    expect(taken).toEqual([{ sessionId: 'ds_000000000000000000000001', name: 'harbor-bakery' }]);
  });
});

describe('the attach menu', () => {
  it('offers a folder, and the project’s templates opening in place; a name picked goes in at once on the build page', async () => {
    listing = { templates: [{ name: 'harbor-bakery', usable: true }, { name: 'bad name!', usable: false }, { name: 'studio-one', usable: true }], more: 0, note: null };
    const { result } = renderHook(() => useAttach({ sessionId: 'ds_000000000000000000000002' }));
    render(wrap(<AttachMenu state={result.current} figma={undefined} onFigma={() => undefined} place="chat" />));
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByRole('menuitem', { name: /A folder… A site template, as a folder/ })).toBeTruthy();
    const group = await screen.findByRole('menuitem', { name: 'A site template in this project' });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(group);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    const names = within(screen.getByRole('group', { name: 'Site templates in this project' })).getAllByRole('menuitem');
    expect(names.map((name) => name.textContent)).toEqual(['harbor-bakery', 'studio-one']);
    await userEvent.click(names[1]!);
    await waitFor(() => expect(taken).toEqual([{ sessionId: 'ds_000000000000000000000002', name: 'studio-one' }]));
  });

  it('has no templates item where the project has none', async () => {
    const { result } = renderHook(() => useAttach());
    render(wrap(<AttachMenu state={result.current} figma={undefined} onFigma={() => undefined} />));
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByRole('menuitem', { name: /A folder…/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'A site template in this project' })).toBeNull();
  });
});
