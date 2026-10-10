// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { GitFetchError } from './git.js';
import { createVersionsOffer, type VersionsOfferDeps } from './versions-offer.js';

const BYTES = 62_348_987;

function harness(over: Partial<VersionsOfferDeps> = {}) {
  let declined = false;
  let found = over.found ?? false;
  const fetches: Array<{ signal: AbortSignal; onProgress: (received: number, total: number) => void; done: (path: string) => void; fail: (error: unknown) => void }> = [];
  const deps: VersionsOfferDeps = {
    found,
    bytes: BYTES,
    platform: 'darwin',
    declined: () => declined,
    setDeclined: (value) => {
      declined = value;
      return Promise.resolve();
    },
    fetch: ({ signal, onProgress }) =>
      new Promise<string>((done, fail) => {
        fetches.push({ signal, onProgress, done, fail });
      }),
    refresh: () => Promise.resolve(found),
    ...over,
  };
  return { offer: createVersionsOffer(deps), fetches, setFound: (value: boolean) => void (found = value), declined: () => declined };
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('the offer to keep versions', () => {
  it('says what there is to offer and starts nothing by itself', () => {
    const h = harness();
    expect(h.offer.state()).toEqual({ on: false, declined: false, megabytes: 62, appleTools: true, download: { phase: 'idle' } });
    expect(h.fetches).toHaveLength(0);
  });

  it('names Apple’s road on a Mac only, and no download where there is no file for the computer', () => {
    expect(harness({ platform: 'linux' }).offer.state().appleTools).toBe(false);
    const none = harness({ bytes: null });
    expect(none.offer.state().megabytes).toBeNull();
    expect(none.offer.download().download).toEqual({ phase: 'idle' });
    expect(none.fetches).toHaveLength(0);
  });

  it('downloads on a yes, shows how far it is, and turns versions on when the git is found', async () => {
    const h = harness();
    expect(h.offer.download().download).toEqual({ phase: 'downloading', received: 0, total: BYTES });
    // A second click while it runs starts no second download.
    h.offer.download();
    expect(h.fetches).toHaveLength(1);
    h.fetches[0]?.onProgress(38_000_000, BYTES);
    expect(h.offer.state().download).toEqual({ phase: 'downloading', received: 38_000_000, total: BYTES });

    h.setFound(true);
    h.fetches[0]?.done('/data/git/bin/git');
    await settle();
    expect(h.offer.state()).toMatchObject({ on: true, download: { phase: 'idle' } });
    // With versions on there is nothing to fetch again.
    h.offer.download();
    expect(h.fetches).toHaveLength(1);
  });

  it('a download that arrives but is not found is a failure, said so', async () => {
    const h = harness();
    h.offer.download();
    h.fetches[0]?.done('/data/git/bin/git');
    await settle();
    expect(h.offer.state()).toMatchObject({ on: false, download: { phase: 'failed', reason: 'failed' } });
  });

  it.each([
    ['no-connection', 'no-connection'],
    ['wrong-file', 'wrong-file'],
    ['refused-address', 'wrong-file'],
    ['could-not-unpack', 'failed'],
    ['no-download', 'failed'],
  ] as const)('tells %s apart as %s', async (reason, shown) => {
    const h = harness();
    h.offer.download();
    h.fetches[0]?.fail(new GitFetchError(reason, 'x'));
    await settle();
    expect(h.offer.state().download).toEqual({ phase: 'failed', reason: shown });
    // "Try again" is the same button.
    h.offer.download();
    expect(h.fetches).toHaveLength(2);
    expect(h.offer.state().download.phase).toBe('downloading');
  });

  it('an error that is not the fetch’s own is still a failure, and logged', async () => {
    const log = vi.fn();
    const h = harness({ log });
    h.offer.download();
    h.fetches[0]?.fail('disk');
    await settle();
    expect(h.offer.state().download).toEqual({ phase: 'failed', reason: 'failed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('disk'));
  });

  it('Cancel stops the download and goes back to the offer; what the stopped fetch says later is not shown', async () => {
    const h = harness();
    h.offer.download();
    const first = h.fetches[0];
    expect(h.offer.cancel().download).toEqual({ phase: 'idle' });
    expect(first?.signal.aborted).toBe(true);
    first?.onProgress(1, BYTES);
    first?.fail(new GitFetchError('stopped', 'stopped'));
    await settle();
    expect(h.offer.state().download).toEqual({ phase: 'idle' });
    // Cancel with nothing running changes nothing.
    expect(h.offer.cancel().download).toEqual({ phase: 'idle' });
  });

  it('a fetch that says it was stopped, without Cancel, goes back to the offer too', async () => {
    const h = harness();
    h.offer.download();
    h.fetches[0]?.fail(new GitFetchError('stopped', 'stopped'));
    await settle();
    expect(h.offer.state().download).toEqual({ phase: 'idle' });
  });

  it('"Not now" is remembered and a later download forgets it', async () => {
    const h = harness();
    expect((await h.offer.notNow()).declined).toBe(true);
    h.offer.download();
    h.setFound(true);
    h.fetches[0]?.done('/data/git/bin/git');
    await settle();
    expect(h.declined()).toBe(false);
  });

  it('"Look again" finds a git installed meanwhile, and does not look while a download runs', async () => {
    const refresh = vi.fn(() => Promise.resolve(true));
    const h = harness({ refresh });
    h.offer.download();
    expect((await h.offer.lookAgain()).on).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    h.offer.cancel();
    expect((await h.offer.lookAgain()).on).toBe(true);
  });

  it('a look that fails leaves things as they were', async () => {
    const h = harness({ refresh: () => Promise.reject(new Error('no shell')) });
    expect((await h.offer.lookAgain()).on).toBe(false);
  });

  it('starts Apple’s installer on a Mac only', async () => {
    const mac = vi.fn(() => Promise.reject(new Error('already installed')));
    await harness({ installAppleTools: mac }).offer.appleTools();
    expect(mac).toHaveBeenCalledTimes(1);
    const other = vi.fn(() => Promise.resolve());
    await harness({ platform: 'win32', installAppleTools: other }).offer.appleTools();
    expect(other).not.toHaveBeenCalled();
    // A build with no installer to start answers all the same.
    expect((await harness().offer.appleTools()).appleTools).toBe(true);
  });

  it('closing the project stops a download under way', () => {
    const h = harness();
    h.offer.download();
    h.offer.dispose();
    expect(h.fetches[0]?.signal.aborted).toBe(true);
    h.offer.dispose();
  });
});
