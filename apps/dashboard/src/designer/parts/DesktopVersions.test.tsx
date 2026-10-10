// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AdminiumDesktopApi, DesktopVersionsApi, DesktopVersionsState } from '@adminium/desktop/api';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { TurnVersionsOn, useDesktopVersions, VersionsCard, VersionsOfferDialog } from './DesktopVersions.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

const OFFER: DesktopVersionsState = { on: false, declined: false, megabytes: 62, appleTools: true, download: { phase: 'idle' } };

/** A bridge whose answers the test moves along. */
function bridge(first: DesktopVersionsState = OFFER, over: Partial<DesktopVersionsApi> = {}) {
  let now = first;
  const set = (next: DesktopVersionsState): DesktopVersionsState => (now = next);
  const api: DesktopVersionsApi = {
    state: vi.fn(() => Promise.resolve(now)),
    download: vi.fn(() => Promise.resolve(set({ ...now, download: { phase: 'downloading', received: 0, total: 62_348_987 } }))),
    cancel: vi.fn(() => Promise.resolve(set({ ...now, download: { phase: 'idle' } }))),
    notNow: vi.fn(() => Promise.resolve(set({ ...now, declined: true }))),
    lookAgain: vi.fn(() => Promise.resolve(now)),
    appleTools: vi.fn(() => Promise.resolve(now)),
    ...over,
  };
  Object.defineProperty(window, 'adminiumDesktop', {
    value: { platform: 'darwin', project: { info: () => Promise.resolve(null), showInFolder: () => Promise.resolve(), close: () => Promise.resolve(true), versions: api } } as unknown as AdminiumDesktopApi,
    configurable: true,
  });
  return { api, set };
}

function Home({ onTurnedOn }: { onTurnedOn?: () => void }) {
  const versions = useDesktopVersions(onTurnedOn);
  const [reopened, setReopened] = useState(false);
  return (
    <>
      <VersionsCard versions={versions} reopened={reopened} />
      <h1>What do you want to build?</h1>
      <TurnVersionsOn versions={versions} reopened={reopened} onReopen={() => setReopened(true)} />
    </>
  );
}

describe('the offer to keep versions, on Home', () => {
  it('is nothing in a browser, in an app older than the offer, and where versions are on', async () => {
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull();
    cleanup();

    Object.defineProperty(window, 'adminiumDesktop', { value: { platform: 'darwin', project: {} } as unknown as AdminiumDesktopApi, configurable: true });
    render(<Home />);
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull();
    cleanup();

    const { api } = bridge({ ...OFFER, on: true });
    render(<Home />);
    await waitFor(() => expect(api.state).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn versions on' })).toBeNull();
  });

  it('offers the download with its size, "Not now", and Apple’s road on a Mac; nothing is fetched until asked', async () => {
    const { api } = bridge();
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Keep versions of your work?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download git (62 MB)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(screen.getByText(/Or install Apple’s developer tools/)).toBeTruthy();
    expect(api.download).not.toHaveBeenCalled();

    // Apple's installer is theirs to run; afterwards the link is "Look again".
    await userEvent.click(screen.getByRole('button', { name: 'Install Apple’s tools' }));
    expect(api.appleTools).toHaveBeenCalledTimes(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Look again' }));
    expect(api.lookAgain).toHaveBeenCalledTimes(1);
  });

  it('has no Apple line off a Mac, and where there is no file to fetch it says so and can only look again', async () => {
    bridge({ ...OFFER, appleTools: false, megabytes: null });
    render(<Home />);
    expect(await screen.findByText(/There is no git to download for this kind of computer/)).toBeTruthy();
    expect(screen.queryByText(/Apple/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Download git/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Look again' })).toBeTruthy();
  });

  it('"Not now" puts the card away and leaves a button that brings it back', async () => {
    const { api } = bridge();
    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(api.notNow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Turn versions on' }));
    expect(screen.getByRole('heading', { name: 'Keep versions of your work?' })).toBeTruthy();
    // Said once already: the card that came back offers the download, not "Not now" again.
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn versions on' })).toBeNull();
  });

  it('shows how far the download is, asks again while it runs, and says once that versions are on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, set } = bridge();
    const turnedOn = vi.fn();
    render(<Home onTurnedOn={turnedOn} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download git (62 MB)' }));
    const bar = await screen.findByRole('progressbar', { name: 'Downloading git' });
    expect(bar.getAttribute('aria-valuemax')).toBe('62');
    expect(screen.getByRole('status').textContent).toBe('0 of 62 MB');

    set({ ...OFFER, download: { phase: 'downloading', received: 38_000_000, total: 62_348_987 } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole('status').textContent).toBe('38 of 62 MB');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('38');

    set({ ...OFFER, on: true });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull();
    expect(turnedOn).toHaveBeenCalledTimes(1);
    // Nothing is asked once there is nothing to wait for.
    const asked = vi.mocked(api.state).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(vi.mocked(api.state).mock.calls.length).toBe(asked);
  });

  it('Cancel stops it and the offer is back', async () => {
    const { api } = bridge();
    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download git (62 MB)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Download git (62 MB)' })).toBeTruthy();
  });

  it.each([
    ['wrong-file', 'The download did not match what Adminium expected and was deleted.'],
    ['no-connection', 'Could not reach the internet. Check your connection and try again.'],
    ['failed', 'git could not be set up on this computer.'],
  ] as const)('says why a download did not finish (%s) and offers to try again', async (reason, words) => {
    const { api } = bridge({ ...OFFER, declined: true, download: { phase: 'failed', reason } });
    render(<Home />);
    // Shown even after an earlier "Not now": a failure the person caused by asking is theirs to see.
    expect((await screen.findByRole('alert')).textContent).toBe(words);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.download).toHaveBeenCalledTimes(1);
  });

  it('a bridge that fails to answer leaves the page as it is', async () => {
    const { api } = bridge(OFFER, { state: vi.fn(() => Promise.reject(new Error('gone'))) });
    render(<Home />);
    await waitFor(() => expect(api.state).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Keep versions of your work?' })).toBeNull();
  });
});

function Page() {
  const versions = useDesktopVersions();
  const [open, setOpen] = useState(true);
  return versions === null ? null : (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <VersionsOfferDialog versions={versions} open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('the same offer on the build page', () => {
  it('is a dialog with the offer in it, and closes itself when versions come on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { set } = bridge({ ...OFFER, declined: true });
    render(<Page />);
    const dialog = await screen.findByRole('dialog', { name: 'Keep versions of your work?' });
    expect(dialog.textContent).toContain('This computer has none.');
    await userEvent.click(screen.getByRole('button', { name: 'Download git (62 MB)' }));
    await screen.findByRole('progressbar');
    set({ ...OFFER, on: true });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await waitFor(() => expect(screen.getByText('closed')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
