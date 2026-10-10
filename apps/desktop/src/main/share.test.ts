// SPDX-License-Identifier: AGPL-3.0-only
// A test may import the server freely (it does not ship): main may not, so the two copies of the rule are held here.
import { sharedHosts, sharedLocalName } from '@adminium/server';
import { describe, expect, it, vi } from 'vitest';

import { localName, shareAddresses, sharePortFor } from './share.js';

const NET = () => ({
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
  en7: [{ address: '10.0.0.5', family: 4, internal: false }],
});

describe('a computer’s name on the network', () => {
  it('is its first label, lower case, with .local', () => {
    expect(localName('Office-Mac.local')).toBe('office-mac.local');
    expect(localName('DESKTOP-7QK2')).toBe('desktop-7qk2.local');
    expect(localName('studio.lan.example')).toBe('studio.local');
  });
  it('is nothing for a name no device could ask for', () => {
    for (const name of ['', 'localhost', 'Ava’s MacBook', 'bad_name', '-x', 'x-']) expect(localName(name), name).toBeNull();
  });
});

describe('the addresses a shared project answers on', () => {
  it('every address the app shows is one the shared server answers to', () => {
    for (const name of ['Office-Mac.local', 'DESKTOP-7QK2', 'studio.lan.example', '', 'localhost', 'bad_name', '-x']) expect(sharedLocalName(name), name).toBe(localName(name));
    const answered = sharedHosts(4712, 'Office-Mac.local', NET() as never);
    const shown = shareAddresses(4712, 'Office-Mac.local', NET as never);
    expect(shown.length).toBeGreaterThan(0);
    for (const address of shown) expect(answered.has(new URL(address.url).host), address.url).toBe(true);
  });
  it('gives the computer’s name first, as the one to hand out, then one per network', () => {
    expect(shareAddresses(4712, 'Office-Mac.local', NET as never)).toEqual([
      { url: 'http://office-mac.local:4712', via: null, best: true },
      { url: 'http://192.168.1.20:4712', via: 'en0', best: false },
      { url: 'http://10.0.0.5:4712', via: 'en7', best: false },
    ]);
  });
  it('with no usable name, the first network address is the one to hand out', () => {
    expect(shareAddresses(4712, 'localhost', NET as never).map((address) => address.best)).toEqual([true, false]);
  });
  it('on no network there is nothing to hand out, the name included', () => {
    expect(shareAddresses(4712, 'office-mac', (() => ({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })) as never)).toEqual([]);
  });
});

describe('the port a project is shared on', () => {
  it('is picked free the first time', async () => {
    await expect(sharePortFor(null, vi.fn(), () => Promise.resolve(4712))).resolves.toEqual({ port: 4712, changedFrom: null });
  });
  it('is the one it had, while that is free: a phone’s bookmark still works', async () => {
    const pick = vi.fn(() => Promise.resolve(4799));
    await expect(sharePortFor(4712, () => Promise.resolve(true), pick)).resolves.toEqual({ port: 4712, changedFrom: null });
    expect(pick).not.toHaveBeenCalled();
  });
  it('is another when that one is taken, and says the address changed', async () => {
    await expect(sharePortFor(4712, () => Promise.resolve(false), () => Promise.resolve(4713))).resolves.toEqual({ port: 4713, changedFrom: 4712 });
  });
});
