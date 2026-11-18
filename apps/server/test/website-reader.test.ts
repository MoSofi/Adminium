// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The engine's website reader against a local hostile-page server.
 *
 * Every request goes through the real `safeFetch` (its name checks and pinning stand). Names resolve through
 * `safeFetch`'s test seam (public names to a public address, inside names to private ones), and a checked
 * address is connected to a plain http server on 127.0.0.1, told which host and scheme the reader asked for.
 * The server is the sites: each test says what each host answers.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PinnedTarget, RawResponse } from '../src/net/safe-fetch.js';
import { createWebsiteReaderState, PAGE_MAX_BYTES, readCompanyWebsite, siteOf, startAddress, type WebsiteReaderDeps, type WebsiteReaderState, type WebsiteReadOutcome } from '../src/net/website-reader.js';

interface Asked {
  scheme: 'http' | 'https';
  host: string;
  path: string;
  headers: IncomingMessage['headers'];
}
type Site = (asked: Asked, res: ServerResponse) => void;

let server: Server;
let port = 0;
let site: Site = (_asked, res) => res.writeHead(404).end();
let asked: Asked[] = [];
/** Hosts whose https cannot be connected to (always, or for the first try only). */
let httpsDown = new Set<string>();
let httpsDownOnce = new Set<string>();
/** Bytes a streamed body sent before the reader hung up. */
let streamed = 0;

const NAMES: Record<string, string> = {
  'intranet.kestrel-yard.example': '10.0.0.7',
  'metadata.example': '169.254.169.254',
  'db.internal.example': '192.168.1.20',
};

const resolve = async (host: string): Promise<{ address: string; family: 4 | 6 }[]> => {
  if (host.startsWith('nowhere.')) throw new Error('ENOTFOUND');
  return [{ address: NAMES[host] ?? '8.8.8.8', family: 4 }];
};

const connect = (target: PinnedTarget, opts: { headers: Record<string, string>; signal: AbortSignal }): Promise<RawResponse> =>
  new Promise((done, fail) => {
    const scheme = target.url.protocol === 'http:' ? 'http' : 'https';
    if (scheme === 'https' && httpsDownOnce.delete(target.url.hostname)) return fail(new Error('connect ECONNREFUSED'));
    if (scheme === 'https' && httpsDown.has(target.url.hostname)) return fail(new Error('connect ECONNREFUSED'));
    const req = httpRequest(
      { host: '127.0.0.1', port, path: `${target.url.pathname}${target.url.search}`, method: 'GET', headers: { ...opts.headers, host: target.url.host, 'x-test-scheme': scheme }, signal: opts.signal, agent: false },
      (res) => done({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() }),
    );
    req.on('error', fail);
    req.end();
  });

const html = (body: string, headers: Record<string, string> = {}) => (res: ServerResponse) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);
const robots = (text: string) => (res: ServerResponse) => res.writeHead(200, { 'content-type': 'text/plain' }).end(text);
const redirect = (location: string) => (res: ServerResponse) => res.writeHead(301, { location }).end();
const PAGE = '<!doctype html><html><head><title>Kestrel Yard Architects</title><meta name="description" content="A made-up studio."></head><body><a href="mailto:info@kestrel-yard.example">Write</a></body></html>';

/** The sites, by `scheme://host/path` (robots.txt included); anything else is a 404. */
function sites(table: Record<string, (res: ServerResponse) => void>): Site {
  return (a, res) => {
    const answer = table[`${a.scheme}://${a.host}${a.path}`];
    if (answer === undefined) res.writeHead(404, { 'content-type': 'text/plain' }).end('not here');
    else answer(res);
  };
}

const logs: { payload: Record<string, unknown>; message: string }[] = [];
let state: WebsiteReaderState;
let now = 1_000_000;
const deps = (): WebsiteReaderDeps => ({
  state,
  log: { info: (payload, message) => logs.push({ payload, message }), warn: (payload, message) => logs.push({ payload, message }) },
  outside: () => true,
  seams: { resolve, connect },
});
const read = (website: string, more: { install?: string; confirmedHost?: string; country?: string; signal?: AbortSignal } = {}): Promise<WebsiteReadOutcome> =>
  readCompanyWebsite({ website, install: more.install ?? 'install-1', confirmedHost: more.confirmedHost, country: more.country, signal: more.signal }, deps());
const pagesAsked = (host: string): Asked[] => asked.filter((a) => a.host === host && a.path !== '/robots.txt');

/** Waits, with a deadline, until `ready` holds. */
async function until(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((settle) => setTimeout(settle, 5));
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const a: Asked = { scheme: req.headers['x-test-scheme'] === 'http' ? 'http' : 'https', host: req.headers.host ?? '', path: req.url ?? '/', headers: req.headers };
    asked.push(a);
    res.on('error', () => undefined);
    site(a, res);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((closed) => server.close(closed));
});
beforeEach(() => {
  asked = [];
  logs.length = 0;
  httpsDown = new Set();
  httpsDownOnce = new Set();
  streamed = 0;
  now = 1_000_000;
  state = createWebsiteReaderState(() => now);
  site = sites({});
});

describe('the address typed', () => {
  it('is read over https first, as a name; a literal IP, a password, another port or one word is not called', async () => {
    expect(startAddress('kestrel-yard.example')?.toString()).toBe('https://kestrel-yard.example/');
    expect(startAddress('http://kestrel-yard.example/about#team')?.toString()).toBe('https://kestrel-yard.example/about');
    expect(startAddress('not an address')).toBeNull();
    site = sites({ 'https://kestrel-yard.example/': html(PAGE) });
    for (const typed of ['https://8.8.8.8/', 'https://[2606:4700::1111]/', 'https://user:pass@kestrel-yard.example/', 'https://kestrel-yard.example:8443/', 'http://kestrel-yard.example:8080/', 'localhost', 'https://intranet/', 'ftp://kestrel-yard.example/']) {
      expect(await read(typed), typed).toEqual({ outcome: 'unreachable' });
    }
    expect(asked).toEqual([]);
    // Refused by the reader's own rule, before any name is looked up.
    expect(logs.map((entry) => entry.payload['reason'])).toEqual(['literal-ip', 'literal-ip', 'userinfo', 'port', 'port', 'not-a-name', 'not-a-name', 'not-an-address']);
  });

  it('reads the page’s facts, with this reader’s own user agent and nothing of anyone’s', async () => {
    site = sites({ 'https://kestrel-yard.example/': html(PAGE) });
    const outcome = await read('kestrel-yard.example');
    expect(outcome).toEqual({
      outcome: 'read',
      page: { url: 'https://kestrel-yard.example/', finalUrl: 'https://kestrel-yard.example/', name: 'Kestrel Yard Architects', about: 'A made-up studio.', jsonLd: [], emails: ['info@kestrel-yard.example'], phones: [] },
    });
    expect(asked.map((a) => `${a.scheme}://${a.host}${a.path}`)).toEqual(['https://kestrel-yard.example/robots.txt', 'https://kestrel-yard.example/']);
    for (const a of asked) {
      expect(a.headers['user-agent']).toBe('Adminium-LeadFinder/1 (+https://adminium.dev/lead-finder)');
      expect(a.headers['cookie']).toBeUndefined();
      expect(a.headers['authorization']).toBeUndefined();
    }
  });

  it('is not read at all where the operator lets this server call nothing outside', async () => {
    site = sites({ 'https://kestrel-yard.example/': html(PAGE) });
    expect(await readCompanyWebsite({ website: 'kestrel-yard.example', install: 'install-1' }, { ...deps(), outside: () => false })).toEqual({ outcome: 'unreachable' });
    expect(asked).toEqual([]);
  });
});

describe('falling back to http', () => {
  it('uses plain http on port 80 only when https cannot be connected to, and sends nothing of anyone’s over it', async () => {
    httpsDown.add('millbeck.example');
    site = sites({ 'http://millbeck.example/': html(PAGE) });
    expect((await read('millbeck.example')).outcome).toBe('read');
    expect(asked.map((a) => `${a.scheme}://${a.host}${a.path}`)).toEqual(['http://millbeck.example/robots.txt', 'http://millbeck.example/']);
    expect(asked.every((a) => a.headers['cookie'] === undefined && a.headers['authorization'] === undefined)).toBe(true);
  });

  it('does not fall back when https answered, even with an error', async () => {
    site = sites({ 'https://millbeck.example/robots.txt': (res) => res.writeHead(200).end(''), 'https://millbeck.example/': (res) => res.writeHead(500).end(), 'http://millbeck.example/': html(PAGE) });
    expect(await read('millbeck.example')).toEqual({ outcome: 'unreachable' });
    expect(asked.some((a) => a.scheme === 'http')).toBe(false);
  });
});

describe('redirects', () => {
  it('follows www. and the bare name, both ways', async () => {
    site = sites({ 'https://kestrel-yard.example/': redirect('https://www.kestrel-yard.example/'), 'https://www.kestrel-yard.example/': html(PAGE) });
    expect(await read('kestrel-yard.example')).toMatchObject({ outcome: 'read', page: { url: 'https://kestrel-yard.example/', finalUrl: 'https://www.kestrel-yard.example/' } });
    site = sites({ 'https://www.ouseburn.example/': redirect('https://ouseburn.example/home'), 'https://ouseburn.example/home': html(PAGE) });
    expect(await read('www.ouseburn.example')).toMatchObject({ outcome: 'read', page: { finalUrl: 'https://ouseburn.example/home' } });
    // The new host's robots.txt is read before its page.
    expect(asked.filter((a) => a.host === 'ouseburn.example').map((a) => a.path)).toEqual(['/robots.txt', '/home']);
  });

  it('follows http to https on one name', async () => {
    // https fails to connect the first time, so the page is asked over http, which sends the reader back to https.
    httpsDownOnce.add('tannery-row.example');
    site = sites({ 'http://tannery-row.example/': redirect('https://tannery-row.example/'), 'https://tannery-row.example/': html(PAGE) });
    expect(await read('tannery-row.example')).toMatchObject({ outcome: 'read', page: { finalUrl: 'https://tannery-row.example/' } });
    expect(asked.map((a) => `${a.scheme}://${a.host}${a.path}`)).toEqual(['http://tannery-row.example/robots.txt', 'http://tannery-row.example/', 'https://tannery-row.example/robots.txt', 'https://tannery-row.example/']);
  });

  it('stops at a redirect to another site and says which, reading that one only once the person confirms it', async () => {
    site = sites({ 'https://kestrel-yard.example/': redirect('https://kestrel-architects.example/welcome'), 'https://kestrel-architects.example/welcome': html(PAGE) });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'asks', host: 'kestrel-architects.example' });
    expect(asked.filter((a) => a.host === 'kestrel-architects.example')).toEqual([]);
    expect(await read('kestrel-yard.example', { confirmedHost: 'kestrel-architects.example' })).toMatchObject({ outcome: 'read', page: { finalUrl: 'https://kestrel-architects.example/welcome' } });
  });

  it('holds a registrable domain under a two-part suffix to its own name and www.', async () => {
    expect(siteOf('www.example.co.uk')).toBe(siteOf('example.co.uk'));
    expect(siteOf('other.co.uk')).not.toBe(siteOf('example.co.uk'));
    expect(siteOf('co.uk')).not.toBe(siteOf('example.co.uk'));
    site = sites({ 'https://example.co.uk/': redirect('https://www.example.co.uk/'), 'https://www.example.co.uk/': html(PAGE) });
    expect((await read('example.co.uk')).outcome).toBe('read');
    site = sites({ 'https://example.co.uk/': redirect('https://other.co.uk/') });
    expect(await read('example.co.uk')).toEqual({ outcome: 'asks', host: 'other.co.uk' });
    site = sites({ 'https://example.co.uk/': redirect('https://shop.example.co.uk/') });
    expect(await read('example.co.uk')).toEqual({ outcome: 'asks', host: 'shop.example.co.uk' });
  });

  it('never goes from https to http, even on the same name', async () => {
    site = sites({ 'https://kestrel-yard.example/': redirect('http://kestrel-yard.example/plain'), 'http://kestrel-yard.example/plain': html(PAGE) });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'unreachable' });
    expect(asked.filter((a) => a.scheme === 'http')).toEqual([]);
  });

  it('to a private name, this machine, a literal IP or another port: unreachable, and nothing read there', async () => {
    for (const target of ['https://intranet.kestrel-yard.example/', 'https://db.internal.example/', 'https://metadata.example/latest', 'https://localhost/', 'https://admin.localhost/', 'https://127.0.0.1/', 'https://10.0.0.7/', 'https://[::1]/', 'https://kestrel-yard.example:8443/', 'https://nowhere.example/']) {
      asked = [];
      site = sites({ 'https://kestrel-yard.example/': redirect(target) });
      expect(await read('kestrel-yard.example'), target).toEqual({ outcome: 'unreachable' });
      expect(asked.filter((a) => a.host !== 'kestrel-yard.example'), target).toEqual([]);
    }
    // A redirect within the site whose name resolves inside: refused by safeFetch's own address checks.
    site = sites({ 'https://kestrel-yard.example/': redirect('https://intranet.kestrel-yard.example/') });
    expect(await read('kestrel-yard.example', { confirmedHost: 'intranet.kestrel-yard.example' })).toEqual({ outcome: 'unreachable' });
  });

  it('gives up after a few', async () => {
    site = sites({ 'https://kestrel-yard.example/': redirect('/a'), 'https://kestrel-yard.example/a': redirect('/b'), 'https://kestrel-yard.example/b': redirect('/c'), 'https://kestrel-yard.example/c': redirect('/d'), 'https://kestrel-yard.example/d': redirect('/e'), 'https://kestrel-yard.example/e': redirect('/f'), 'https://kestrel-yard.example/f': html(PAGE) });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'unreachable' });
  });
});

describe('what is not a page', () => {
  it('a PDF: not a page, and its body is not read', async () => {
    site = sites({ 'https://kestrel-yard.example/': (res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.7 info@kestrel-yard.example') });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'not-a-page' });
    site = sites({ 'https://kestrel-yard.example/': (res) => res.writeHead(200).end('<html></html>') });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'not-a-page' });
    site = sites({ 'https://kestrel-yard.example/': html(PAGE, { 'content-type': 'application/xhtml+xml' }) });
    expect((await read('kestrel-yard.example')).outcome).toBe('read');
  });

  it('a 3 GB body: stopped at 2 MiB while streaming', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    site = sites({
      'https://kestrel-yard.example/': (res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        const total = 3 * 1024 * 1024 * 1024;
        let closed = false;
        res.on('close', () => {
          closed = true;
        });
        const pump = (): void => {
          while (!closed && streamed < total) {
            streamed += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', pump);
              return;
            }
          }
          if (!closed) res.end();
        };
        pump();
      },
    });
    const before = process.memoryUsage().rss;
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'not-a-page' });
    await until(() => streamed > 0, 'the stream to start');
    // A few socket buffers past the limit at most, never the 3 GB.
    expect(streamed).toBeLessThan(PAGE_MAX_BYTES + 32 * 1024 * 1024);
    expect(process.memoryUsage().rss - before).toBeLessThan(256 * 1024 * 1024);
  });
});

describe('robots.txt and the page’s own wishes', () => {
  const kestrel = (robotsAnswer: (res: ServerResponse) => void, page: (res: ServerResponse) => void = html(PAGE)) => sites({ 'https://kestrel-yard.example/robots.txt': robotsAnswer, 'https://kestrel-yard.example/': page });

  it('robots 503: refused by the site, and the page is not asked for', async () => {
    site = kestrel((res) => res.writeHead(503).end());
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    expect(pagesAsked('kestrel-yard.example')).toEqual([]);
  });

  it('robots 429, or larger than 500 KiB: refused by the site too', async () => {
    site = kestrel((res) => res.writeHead(429).end());
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    site = kestrel(robots(`User-agent: *\nAllow: /\n${'#'.repeat(600 * 1024)}`));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    expect(pagesAsked('kestrel-yard.example')).toEqual([]);
  });

  it('robots 404: read', async () => {
    site = kestrel((res) => res.writeHead(404).end());
    expect((await read('kestrel-yard.example')).outcome).toBe('read');
  });

  it('Disallow: / for everyone: refused; an Allow for Adminium: read', async () => {
    site = kestrel(robots('User-agent: *\nDisallow: /\n'));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    expect(pagesAsked('kestrel-yard.example')).toEqual([]);
    state = createWebsiteReaderState(() => now);
    site = kestrel(robots('User-agent: *\nDisallow: /\n\nUser-agent: Adminium\nAllow: /\n'));
    expect((await read('kestrel-yard.example')).outcome).toBe('read');
  });

  it('a noindex meta, an X-Robots-Tag or a TDM reservation: refused', async () => {
    site = kestrel(robots(''), html('<html><head><meta name="robots" content="noindex"></head></html>'));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    site = kestrel(robots(''), html(PAGE, { 'tdm-reservation': '1' }));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    site = kestrel(robots(''), html(PAGE, { 'x-robots-tag': 'adminium: noindex' }));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    site = kestrel(robots(''), html(PAGE, { 'x-robots-tag': 'otherbot: noindex' }));
    expect((await read('kestrel-yard.example')).outcome).toBe('read');
  });

  it('a robots.txt redirected off the site: refused; within the site: followed', async () => {
    site = kestrel(redirect('https://cdn.elsewhere.example/robots.txt'));
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
    state = createWebsiteReaderState(() => now);
    site = sites({ 'https://kestrel-yard.example/robots.txt': redirect('https://www.kestrel-yard.example/robots.txt'), 'https://www.kestrel-yard.example/robots.txt': robots('User-agent: *\nDisallow: /\n'), 'https://kestrel-yard.example/': html(PAGE) });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'refused-by-site' });
  });

  it('a second read within a day does not ask for robots.txt again; after a day it does; a failed one is not kept', async () => {
    site = kestrel(robots('User-agent: *\nAllow: /\n'));
    await read('kestrel-yard.example');
    await read('kestrel-yard.example');
    expect(asked.filter((a) => a.path === '/robots.txt')).toHaveLength(1);
    now += 24 * 60 * 60 * 1000;
    await read('kestrel-yard.example');
    expect(asked.filter((a) => a.path === '/robots.txt')).toHaveLength(2);
    asked = [];
    site = sites({ 'https://ouseburn.example/robots.txt': (res) => res.writeHead(503).end(), 'https://ouseburn.example/': html(PAGE) });
    await read('ouseburn.example');
    await read('ouseburn.example');
    expect(asked.filter((a) => a.path === '/robots.txt')).toHaveLength(2);
  });
});

describe('reads in flight', () => {
  it('three at once on one install: the third waits until one of the first two is done', async () => {
    const held: ServerResponse[] = [];
    site = (a, res) => (a.path === '/robots.txt' ? held.push(res) : html(PAGE)(res));
    const robotsAsked = (): number => asked.filter((a) => a.path === '/robots.txt').length;
    const reads = ['kestrel-yard.example', 'millbeck.example', 'ouseburn.example'].map((website) => read(website, { install: 'install-busy' }));
    await until(() => held.length === 2, 'two robots requests');
    await new Promise((settle) => setTimeout(settle, 50));
    expect(robotsAsked()).toBe(2);
    expect(state.perInstall.count('install-busy')).toEqual({ holding: 2, waiting: 1 });
    // Another install is not held up by this one.
    const other = read('fjordlys.example', { install: 'install-other' });
    await until(() => robotsAsked() === 3, 'the other install’s robots request');
    // One of the first two is done: the third starts.
    held.shift()?.writeHead(404).end();
    await until(() => robotsAsked() === 4, 'the third read to start');
    for (const res of held.splice(0)) res.writeHead(404).end();
    expect((await Promise.all([...reads, other])).map((outcome) => outcome.outcome)).toEqual(['read', 'read', 'read', 'read']);
    expect(state.perInstall.count('install-busy')).toEqual({ holding: 0, waiting: 0 });
  });

  it('two on one site, from two installs and through www., go one after the other', async () => {
    const held: ServerResponse[] = [];
    site = (a, res) => (a.path === '/robots.txt' ? held.push(res) : html(PAGE)(res));
    const first = read('kestrel-yard.example', { install: 'install-a' });
    await until(() => held.length === 1, 'the first robots request');
    const second = read('www.kestrel-yard.example', { install: 'install-b' });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(asked).toHaveLength(1);
    expect(state.perSite.count('kestrel-yard.example')).toEqual({ holding: 1, waiting: 1 });
    held.shift()?.writeHead(404).end();
    await until(() => held.length === 1, 'the second robots request');
    held.shift()?.writeHead(404).end();
    expect((await first).outcome).toBe('read');
    expect((await second).outcome).toBe('read');
  });

  it('a waiting read the person stops leaves the line and throws their reason', async () => {
    const held: ServerResponse[] = [];
    site = (a, res) => (a.path === '/robots.txt' ? held.push(res) : html(PAGE)(res));
    const first = read('kestrel-yard.example', { install: 'install-stop' });
    await until(() => held.length === 1, 'the first robots request');
    const stop = new AbortController();
    const waiting = read('kestrel-yard.example', { install: 'install-stop-2', signal: stop.signal });
    await until(() => state.perSite.count('kestrel-yard.example').waiting === 1, 'the second to wait');
    stop.abort(new Error('stopped by the person'));
    await expect(waiting).rejects.toThrow('stopped by the person');
    expect(state.perSite.count('kestrel-yard.example')).toEqual({ holding: 1, waiting: 0 });
    held.shift()?.writeHead(404).end();
    expect((await first).outcome).toBe('read');
  });
});

describe('the log', () => {
  it('names the host and the path, never the query string or the body', async () => {
    site = sites({ 'https://kestrel-yard.example/robots.txt': robots(''), 'https://kestrel-yard.example/about?token=secret-word-1&q=jane': (res) => res.writeHead(500).end('body-word-2') });
    expect(await read('https://kestrel-yard.example/about?token=secret-word-1&q=jane')).toEqual({ outcome: 'unreachable' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.payload).toEqual({ host: 'kestrel-yard.example', path: '/about', reason: 'page-status-500', outcome: 'unreachable' });
    expect(JSON.stringify(logs)).not.toMatch(/secret-word-1|jane|body-word-2|token/);
  });

  it('keeps the precise reason there, and gives the person only the outcome', async () => {
    site = sites({ 'https://kestrel-yard.example/': redirect('https://db.internal.example/') });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'unreachable' });
    site = sites({ 'https://kestrel-yard.example/': redirect('https://nowhere.example/') });
    expect(await read('kestrel-yard.example')).toEqual({ outcome: 'unreachable' });
    expect(logs.map((entry) => entry.payload['reason'])).toEqual(['redirect-blocked', 'redirect-unresolved']);
  });
});
