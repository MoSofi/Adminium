// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Public access" on a folder app's page, where a person allows it: the list
 * is the server's, the yes carries the list's checksum, what was allowed can
 * be taken back, and what the app asks for afterwards waits beside what is
 * already open.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { customerTrouble } from './AppSettingsPage.js';
import type { FolderAccessView } from './appsApi.js';
import { FolderAccessCard } from './FolderAccessCard.js';

type Access = NonNullable<FolderAccessView['publicAccess']>;
type Endpoint = Access['access']['endpoints'][number];

const endpoint = (over: Partial<Endpoint> & Pick<Endpoint, 'ref' | 'table' | 'methods'>): Endpoint => ({
  select: ['id'],
  writable: [],
  claim: null,
  kind: 'records',
  confirms: false,
  pending: false,
  issues: [],
  ...over,
});

const ITEMS = endpoint({ ref: 'repairs_items', table: 'items', methods: ['GET'] });
const REQUESTS = endpoint({ ref: 'repairs_requests', table: 'requests', methods: ['POST'] });

const viewOf = (over: Partial<Access> & { endpoints: Endpoint[]; canGrant?: boolean; warnings?: Access['access']['warnings'] }, decides: FolderAccessView['decides'] = 'person'): FolderAccessView => {
  const { endpoints, canGrant, warnings, ...rest } = over;
  return {
    key: 'repairs',
    decides,
    publicAccess: { open: false, waiting: endpoints.filter((entry) => entry.onUpdate !== 'held').length, wider: [], checksum: 'sum-1', access: { endpoints, warnings: warnings ?? [], canGrant: canGrant ?? true }, ...rest },
  };
};

interface Call {
  method: string;
  body?: unknown;
}

let calls: Call[];
/** What the server answers a read with, then each answer in turn. */
let reads: FolderAccessView[];
let answers: (FolderAccessView | { status: number; code: string; message: string })[];

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  reads = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url !== '/api/v1/project/apps/repairs/public-access') return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
      calls.push({ method, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}) });
      if (method === 'GET') return Promise.resolve(jsonResponse(200, reads.length > 1 ? reads.shift() : reads[0]));
      const next = answers.shift();
      if (next === undefined) throw new Error('no answer was scripted for this request');
      return Promise.resolve('status' in next ? jsonResponse(next.status, { error: { code: next.code, message: next.message, requestId: 'r' } }) : jsonResponse(200, next));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const changed = vi.fn(async () => undefined);
const notices: string[] = [];

async function renderCard(): Promise<HTMLElement> {
  notices.length = 0;
  changed.mockClear();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FolderAccessCard appKey="repairs" onChanged={changed} onNotice={(message) => notices.push(message)} />
    </QueryClientProvider>,
  );
  return screen.findByTestId('app-folder-access');
}

const posts = () => calls.filter((call) => call.method === 'POST').map((call) => call.body);

describe('a folder app’s public access, where a person allows it', () => {
  it('lists what the customer screens would do, takes the yes for that list, and can take it back', async () => {
    reads = [viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }, { ...REQUESTS, onUpdate: 'granted' }] })];
    const open = viewOf({ open: true, endpoints: [{ ...ITEMS, onUpdate: 'held' }, { ...REQUESTS, onUpdate: 'held' }], checksum: 'sum-2', skipped: [] });
    const closed = viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'withheld' }, { ...REQUESTS, onUpdate: 'withheld' }], checksum: 'sum-3' });
    answers = [open, closed];

    const card = await renderCard();
    expect(card.dataset['state']).toBe('closed');
    // Closed, and said so: the screens open and can do nothing until someone allows this.
    expect(within(card).getByText(/Nobody has allowed this yet/)).toBeTruthy();
    expect(within(card).getByText('Read items')).toBeTruthy();
    expect(within(card).getByText('Add to requests')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Take it back' })).toBeNull();

    await userEvent.click(within(card).getByRole('button', { name: 'Allow this public access' }));
    // The yes names the list that was on the screen.
    await waitFor(() => expect(posts()).toEqual([{ allow: true, checksum: 'sum-1' }]));
    await waitFor(() => expect(card.dataset['state']).toBe('open'));
    expect(within(card).getByText('Allowed. The app’s customer screens can:')).toBeTruthy();
    expect(within(card).getByText('Read items')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Allow this public access' })).toBeNull();
    expect(notices).toEqual(['Public access allowed.']);
    expect(changed).toHaveBeenCalledTimes(1);

    await userEvent.click(within(card).getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(posts()).toEqual([{ allow: true, checksum: 'sum-1' }, { allow: false }]));
    await waitFor(() => expect(card.dataset['state']).toBe('closed'));
    expect(notices).toEqual(['Public access allowed.', 'Public access taken back.']);
    // Taken back is not the end: it can be allowed again from the same card.
    expect(within(card).getByRole('button', { name: 'Allow this public access' })).toBeTruthy();
  });

  it('keeps what was allowed and asks about the more an app now wants, a wider entry included', async () => {
    reads = [
      viewOf({
        open: true,
        waiting: 2,
        endpoints: [{ ...ITEMS, onUpdate: 'held' }, { ...REQUESTS, onUpdate: 'granted' }],
        wider: [{ ref: 'repairs_items', owner: 'repairs', columns: ['notes'], methods: [], rows: false, reasons: [] }],
      }),
    ];
    const card = await renderCard();
    expect(card.dataset['state']).toBe('more');
    const allowed = card.querySelector<HTMLElement>('[data-role="folder-access-open"]');
    const waiting = card.querySelector<HTMLElement>('[data-role="folder-access-waiting"]');
    if (allowed === null || waiting === null) throw new Error('both lists should be on the card');
    expect(within(allowed).getByText('Read items')).toBeTruthy();
    expect(within(allowed).queryByText('Add to requests')).toBeNull();
    expect(within(waiting).getByText(/The app now asks for more/)).toBeTruthy();
    expect(within(waiting).getByText('Add to requests')).toBeTruthy();
    // The entry that is open and would show more is named, with what more.
    const wider = card.querySelector<HTMLElement>('[data-endpoint="repairs_items"]');
    expect(wider?.textContent).toContain('shows notes');
    // Both answers are there: allow the more, or take all of it back.
    expect(within(card).getByRole('button', { name: 'Allow this public access' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Take it back' })).toBeTruthy();
  });

  it('shows the new list, and allows nothing, when the app changed after the list was read', async () => {
    const first = viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }] });
    const second = viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }, { ...REQUESTS, onUpdate: 'granted' }], checksum: 'sum-9' });
    reads = [first, second];
    answers = [{ status: 409, code: 'CONFLICT', message: 'The app changed since this was shown.' }];
    const card = await renderCard();
    expect(within(card).queryByText('Add to requests')).toBeNull();

    await userEvent.click(within(card).getByRole('button', { name: 'Allow this public access' }));
    expect(await within(card).findByText('The app changed since this list was shown. Check it again, then allow it.')).toBeTruthy();
    // The list is read again: what would be allowed now is what is on the screen.
    expect(await within(card).findByText('Add to requests')).toBeTruthy();
    expect(card.dataset['state']).toBe('closed');
    expect(notices).toEqual([]);
  });

  it('lets someone who may not manage API keys read the list, and allow nothing', async () => {
    reads = [viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }], canGrant: false, warnings: [{ code: 'PUBLIC_API_OFF', message: 'off' }] })];
    const card = await renderCard();
    expect(within(card).getByText('Read items')).toBeTruthy();
    expect((within(card).getByRole('button', { name: 'Allow this public access' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByText('Only someone who may manage API keys can allow this.')).toBeTruthy();
    // What would stop it working once allowed is said here too.
    expect(within(card).getByText('The public API is switched off, so none of this answers until it is on.')).toBeTruthy();
  });

  it('says what the server left out of a yes', async () => {
    reads = [viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }, { ...REQUESTS, onUpdate: 'granted' }] })];
    answers = [viewOf({ open: true, waiting: 1, endpoints: [{ ...ITEMS, onUpdate: 'held' }, { ...REQUESTS, onUpdate: 'granted' }], skipped: [{ ref: 'repairs_requests', reason: 'it writes a column strangers may not set' }] })];
    const card = await renderCard();
    await userEvent.click(within(card).getByRole('button', { name: 'Allow this public access' }));
    const leftOut = await waitFor(() => {
      const found = card.querySelector<HTMLElement>('[data-role="folder-access-left-out"]');
      if (found === null) throw new Error('not yet');
      return found;
    });
    expect(leftOut.textContent).toContain('repairs_requests');
    expect(leftOut.textContent).toContain('it writes a column strangers may not set');
  });

  it('draws nothing where a person does not decide, or for an app that asks for nothing', async () => {
    reads = [viewOf({ endpoints: [{ ...ITEMS, onUpdate: 'granted' }] }, 'config')];
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FolderAccessCard appKey="repairs" onChanged={changed} onNotice={() => undefined} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('app-folder-access')).toBeNull();
  });
});

describe('a folder app’s customer side that cannot answer', () => {
  it('names the place its public access is allowed, which differs by server', () => {
    // A person decides: the card is on this page.
    expect(customerTrouble({ apiOn: true, granted: false, decides: 'person' }, 'repairs')).toContain('Allow it under “Public access” on this page');
    // The committed config decides: the file and the switch are named.
    const config = customerTrouble({ apiOn: true, granted: false, decides: 'config' }, 'repairs');
    expect(config).toContain('adminium.config.ts');
    expect(config).toContain('apps.repairs.publicAccess');
    // A package is still allowed where it is updated.
    expect(customerTrouble({ apiOn: true, granted: false })).toContain('Update the app and allow it');
    // Allowed, with the API off: the same line as any app.
    expect(customerTrouble({ apiOn: false, granted: true, decides: 'person' }, 'repairs')).toContain('the public API is switched off');
  });
});
