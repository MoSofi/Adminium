// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { checkGuest, guestMayNavigate, guestPartition, isPrivateHost, judgeGuestAddress, rememberGuest } from './guest.js';

describe('an address on the person’s own network', () => {
  it('is a .local name, this computer, a bare name, or a private range', () => {
    for (const host of ['office-pc.local', 'localhost', 'office-pc', '10.0.0.5', '172.16.4.1', '172.31.255.1', '192.168.1.20', '169.254.3.3', '127.0.0.1', '[::1]', 'fd12:3456::1', 'fe80::1']) expect(isPrivateHost(host), host).toBe(true);
  });
  it('is not a site, nor an address just outside a private range', () => {
    for (const host of ['example.com', 'adminium.dev', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '2001:db8::1', 'local.example.com']) expect(isPrivateHost(host), host).toBe(false);
  });
});

describe('what a person typed', () => {
  it('with no scheme: http on their own network, https anywhere else; only the origin is kept', () => {
    expect(judgeGuestAddress(' office-pc.local:4600 ')).toEqual({ ok: true, origin: 'http://office-pc.local:4600', encrypted: false });
    expect(judgeGuestAddress('192.168.1.20:4712/login?x=1')).toEqual({ ok: true, origin: 'http://192.168.1.20:4712', encrypted: false });
    expect(judgeGuestAddress('admin.example.com')).toEqual({ ok: true, origin: 'https://admin.example.com', encrypted: true });
    expect(judgeGuestAddress('https://admin.example.com/some/page#x')).toEqual({ ok: true, origin: 'https://admin.example.com', encrypted: true });
    expect(judgeGuestAddress('https://office-pc.local')).toMatchObject({ ok: true, encrypted: true });
  });
  it('reads the address as the window will: a name in any case, a number that is really an address, a port that says nothing', () => {
    expect(judgeGuestAddress('Office-PC.local:4600')).toEqual({ ok: true, origin: 'http://office-pc.local:4600', encrypted: false });
    expect(judgeGuestAddress('office-pc.local:80')).toEqual({ ok: true, origin: 'http://office-pc.local', encrypted: false });
    // 134744072 is 8.8.8.8 to a browser, not a computer's name on this network.
    expect(judgeGuestAddress('134744072')).toEqual({ ok: true, origin: 'https://8.8.8.8', encrypted: true });
    expect(judgeGuestAddress('http://0x8080808')).toEqual({ ok: false, reason: 'not-private' });
    expect(judgeGuestAddress('3232235797:4600')).toEqual({ ok: true, origin: 'http://192.168.1.21:4600', encrypted: false });
  });
  it('refuses plain http to anything that is not on their own network', () => {
    expect(judgeGuestAddress('http://admin.example.com')).toEqual({ ok: false, reason: 'not-private' });
    expect(judgeGuestAddress('http://8.8.8.8:4600')).toEqual({ ok: false, reason: 'not-private' });
  });
  it('refuses what is not an address: nothing, spaces, another scheme, a name and password in it', () => {
    for (const typed of ['', '   ', 'two words', 'file:///etc/passwd', 'javascript://x', 'ftp://office-pc.local', 'https://user:pw@example.com', 'http://', '://x']) expect(judgeGuestAddress(typed), typed).toEqual({ ok: false, reason: 'not-an-address' });
  });
});

describe('asking whether an Adminium is there', () => {
  const answer = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  it('asks its health with no redirect followed, and takes its version', async () => {
    const fetcher = vi.fn(() => Promise.resolve(answer(200, { ok: true, version: '0.3.24', uptime: 12 })));
    await expect(checkGuest('http://office-pc.local:4600', fetcher)).resolves.toEqual({ ok: true, version: '0.3.24' });
    expect(fetcher).toHaveBeenCalledWith('http://office-pc.local:4600/api/v1/healthz', expect.objectContaining({ redirect: 'manual' }));
  });
  it('something else that answers is not an Adminium', async () => {
    for (const response of [answer(404, 'Not Found'), answer(200, '<html>router</html>'), answer(200, { ok: false, version: '0.3.24' }), answer(200, { ok: true }), answer(200, { ok: true, version: 'latest' }), answer(302, '')]) {
      await expect(checkGuest('http://office-pc.local:4600', () => Promise.resolve(response))).resolves.toEqual({ ok: false, reason: 'not-adminium' });
    }
  });
  it('nothing that answers, or nothing in time, is no answer', async () => {
    await expect(checkGuest('http://office-pc.local:4600', () => Promise.reject(new Error('ECONNREFUSED')))).resolves.toEqual({ ok: false, reason: 'no-answer' });
    const slow = (_url: string, init: { signal: AbortSignal }): Promise<Response> => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(checkGuest('http://office-pc.local:4600', slow, 10)).resolves.toEqual({ ok: false, reason: 'no-answer' });
  });
});

describe('a guest', () => {
  it('has a cookie jar of its own per address, the same one at the next visit', () => {
    expect(guestPartition('http://office-pc.local:4600')).toMatch(/^persist:guest-[0-9a-f]{24}$/);
    expect(guestPartition('http://office-pc.local:4600')).toBe(guestPartition('http://office-pc.local:4600'));
    expect(guestPartition('http://office-pc.local:4601')).not.toBe(guestPartition('http://office-pc.local:4600'));
  });
  it('is held to the address that was typed', () => {
    const origin = 'http://office-pc.local:4600';
    expect(guestMayNavigate('http://office-pc.local:4600/t/orders?x=1', origin)).toBe(true);
    for (const target of ['http://office-pc.local:4601/', 'https://office-pc.local:4600/', 'http://office-pc.local.evil.com:4600/', 'file:///etc/passwd', 'javascript:alert(1)', 'about:blank', '']) expect(guestMayNavigate(target, origin), target).toBe(false);
  });
  it('is remembered at the head of a short list, once', () => {
    const now = new Date('2026-10-10T10:00:00.000Z');
    const list = rememberGuest([{ address: 'http://a.local', version: '0.3.1', lastOpened: 'x' }, { address: 'http://b.local', version: '0.3.2', lastOpened: 'y' }], 'http://b.local', '0.3.24', now);
    expect(list).toEqual([{ address: 'http://b.local', version: '0.3.24', lastOpened: '2026-10-10T10:00:00.000Z' }, { address: 'http://a.local', version: '0.3.1', lastOpened: 'x' }]);
    const many = Array.from({ length: 12 }, (_, i) => ({ address: `http://h${String(i)}.local`, version: '1.0.0', lastOpened: 'z' }));
    expect(rememberGuest(many, 'http://new.local', '1.0.0', now)).toHaveLength(8);
  });
});
