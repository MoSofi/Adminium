// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE DATA KIT AS THE HOST PUBLISHES IT: exactly the names the contract
 * lists, each a thing a page can use, on the same host object every older
 * page already reads — whose own version does not move.
 */
import { ADD_ON_DATA_EXPORTS, DATA_KIT_VERSION, HOST_API_VERSION, requireAddOnData, requireAddOnHost } from '@adminium/add-on-contracts/runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { dataKit } from './data-kit/index.js';
import { ensureAddOnRuntime, resetAddOnRuntime } from './runtime.js';

afterEach(() => {
  resetAddOnRuntime();
});

describe('the data kit the host publishes', () => {
  it('has exactly the census\'s keys, and its own version', () => {
    expect(Object.keys(dataKit).filter((name) => name !== 'version').sort()).toEqual([...ADD_ON_DATA_EXPORTS].sort());
    expect(dataKit.version).toBe(DATA_KIT_VERSION);
    for (const name of ADD_ON_DATA_EXPORTS) {
      const part = (dataKit as Record<string, unknown>)[name];
      expect(part === undefined || part === null, name).toBe(false);
      expect(['function', 'object'], name).toContain(typeof part);
    }
    // A page cannot grow or change what the host published.
    expect(Object.isFrozen(dataKit)).toBe(true);
  });

  it('is put on the host object only when a page asks, and the host\'s own version stays 1', async () => {
    await ensureAddOnRuntime();
    const host = requireAddOnHost();
    expect(host.data).toBeUndefined();
    expect(() => requireAddOnData()).toThrow('This page needs a newer Adminium.');

    await ensureAddOnRuntime({ data: true });
    // The same object an older page read: nothing was published a second time.
    expect(requireAddOnHost()).toBe(host);
    expect(host.data).toBe(dataKit);
    expect(host.version).toBe(HOST_API_VERSION);
    expect(HOST_API_VERSION).toBe(1);
    expect(requireAddOnData()).toBe(dataKit);
  });

  it('a page built before the kit passes its own check on this host: the check every released bundle carries', async () => {
    await ensureAddOnRuntime({ data: true });
    /*
     * The check as the released contract package compiled it into every page
     * bundle so far (Invoices 1.0.7 among them): the host's version must be
     * EXACTLY 1. Kept here word for word, because a host that published 2
     * would pass every test written against today's package and still turn
     * every released page into a blank screen.
     */
    const released = (): unknown => {
      const runtime = (globalThis as Record<string, unknown>)['__ADMINIUM_ADD_ON_RUNTIME__'] as { host?: { version: number } } | undefined;
      const published = runtime?.host;
      if (published === undefined) throw new Error('This host published no add-on host API.');
      if (published.version !== 1) throw new Error(`This page was built against host API 1, and the host publishes ${String(published.version)}.`);
      return published;
    };
    expect(released()).toBe(requireAddOnHost());
  });
});
