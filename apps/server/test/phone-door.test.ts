// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The phone door: how a real phone opens an app's phone side while it is
 * being designed.
 *
 * It is the one thing in design mode that answers another machine, so what is
 * proved is who comes through and what is passed: the door's own address by
 * number, no web page, the one device that showed the code; the manifest, the
 * bundle, the assets and the public API, and nothing else of Expo's bundler
 * or of this server. Expo's bundler is a small stand-in here, and the door
 * listens on this machine alone (`bindOverride`), asked as a phone would ask
 * it: by the network address in the `Host` header.
 */
import { rmSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LongChild } from '../src/designer/child.js';
import { createPhoneDoor, doorPath, doorQr, doorRoute, phoneAddresses, type PhoneDoor, type PhoneDoorOptions, type PhoneDoorState } from '../src/designer/phone-door.js';
import { phoneNow } from '../src/project/apps/phone-build.js';
import { phoneDir } from '../src/project/apps/phone.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { buildFixturePhone, phoneProject, standIn } from './phone-fixtures.js';

const ADDRESS = '192.168.7.20';
const net = (address: string, over: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24`, ...over }) as NetworkInterfaceInfo;

describe('this machine’s addresses a phone could reach', () => {
  it('are its IPv4 addresses on a network: no loopback, no link-local, no IPv6', () => {
    const found = phoneAddresses({
      lo0: [net('127.0.0.1', { internal: true }), net('::1', { family: 'IPv6', internal: true })],
      en0: [net('fe80::1', { family: 'IPv6' }), net('192.168.7.20')],
      en5: [net('169.254.12.9')],
      en7: undefined,
    });
    expect(found).toEqual([{ address: '192.168.7.20', name: 'en0' }]);
  });

  it('puts a home or office network first, and a bridge or a tunnel last', () => {
    const found = phoneAddresses({
      utun4: [net('10.8.0.2')],
      docker0: [net('172.17.0.1')],
      bridge100: [net('192.168.64.1')],
      en9: [net('8.8.4.4')],
      en1: [net('10.0.0.12')],
      en0: [net('192.168.7.20')],
      eth2: [net('172.20.1.4')],
    });
    expect(found.map((entry) => entry.name)).toEqual(['en0', 'en1', 'eth2', 'bridge100', 'docker0', 'utun4', 'en9']);
    expect(found[0]).toEqual({ address: '192.168.7.20', name: 'en0' });
  });

  it('with no network there is none', () => {
    expect(phoneAddresses({ lo0: [net('127.0.0.1', { internal: true })] })).toEqual([]);
  });
});

describe('a path asked of the door', () => {
  it('is kept as asked, with its question', () => {
    expect(doorPath('/')).toEqual({ pathname: '/', search: '' });
    expect(doorPath(undefined)).toEqual({ pathname: '/', search: '' });
    expect(doorPath('/?code=abc')).toEqual({ pathname: '/', search: '?code=abc' });
    expect(doorPath('/index.ts.bundle?platform=ios&dev=true&x=%2F')).toEqual({ pathname: '/index.ts.bundle', search: '?platform=ios&dev=true&x=%2F' });
    expect(doorPath('/assets/img/logo.png')).toEqual({ pathname: '/assets/img/logo.png', search: '' });
  });

  it.each(['//evil.example/x', 'http://evil.example/', 'index.ts.bundle', '/a\\b', '\\\\host\\x', '/a b', '/a\tb', '/a\0b', '/assets/%2e%2e/x', '/assets/..%2fpackage.json', '/%2f', '/a%5cb', '/assets/../package.json', '/..', '/../x', '/assets/x/..'])(
    'refuses %j: a path that could be read two ways',
    (url) => {
      expect(doorPath(url)).toBeNull();
    },
  );
});

describe('what the door passes of a phone’s request', () => {
  it('the manifest, the app’s one bundle, its assets, and the public API', () => {
    expect(doorRoute('GET', '/', '')).toBe('manifest');
    expect(doorRoute('HEAD', '/', '?code=x')).toBe('manifest');
    expect(doorRoute('GET', '/index.ts.bundle', '?platform=ios')).toBe('bundle');
    // (One entry, one bundle: no other name is passed.)
    expect(doorRoute('GET', '/index.bundle', '')).toBeNull();
    expect(doorRoute('GET', '/assets/x.png', '')).toBe('asset');
    expect(doorRoute('GET', '/assets/src/img/x.png', '?platform=ios&hash=abc')).toBe('asset');
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) expect(doorRoute(method, '/api/v1/public/records/x', ''), method).toBe('api');
  });

  it.each([
    ['GET', '/assets/', '?unstable_path=..%2F..%2Fpackage.json'],
    ['GET', '/assets/x.png', '?platform=ios&unstable_path=.%2Fsecret'],
    ['GET', '/assets/x.png', '?UNSTABLE_PATH=x'],
    ['GET', '/assets/x.png', '?unstable%5Fpath=..%2Fpackage.json'],
    ['GET', '/assets/x.png', '?platform=ios&%75nstable_path=x'],
    ['GET', '/assets', ''],
    ['GET', '/assets/', ''],
    ['GET', '/package.json.bundle', ''],
    ['GET', '/src/adminium.ts.bundle', ''],
    ['GET', '/status', ''],
    ['GET', '/json/list', ''],
    ['GET', '/open-stack-frame', ''],
    ['POST', '/open-stack-frame', ''],
    ['GET', '/inspector/device', ''],
    ['GET', '/message', ''],
    ['GET', '/hot', ''],
    ['GET', '/symbolicate', ''],
    ['POST', '/symbolicate', ''],
    ['GET', '/api/v1/designer/x', ''],
    ['GET', '/api/v1/records/x', ''],
    ['GET', '/api/v1/public', ''],
    ['POST', '/', ''],
    ['PUT', '/index.ts.bundle', ''],
    ['DELETE', '/assets/x.png', ''],
  ])('never %s %s%s', (method, pathname, search) => {
    expect(doorRoute(method, pathname, search)).toBeNull();
  });
});

describe('the code a phone scans', () => {
  it('is drawn as black on a white square', () => {
    const svg = doorQr('exp://192.168.7.20:9000/?code=abcdefghijkl');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ')).toBe(true);
    expect(svg).toMatch(/<rect width="(\d+)" height="\1" fill="#fff"\/>/);
    expect(svg).toMatch(/<path fill="#000" d="(M\d+ \d+h\d+v1h-\d+z)+"\/><\/svg>$/);
    expect(doorQr('exp://192.168.7.20:9000/?code=another')).not.toBe(svg);
  });
});

// ── the door itself ──────────────────────────────────────────────────────────

interface Answer {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

/** Ask the door on this machine, saying the `Host` a phone would say. `fetch` drops a caller's Host; this does not. */
function ask(port: number, path: string, opts: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', setHost: false, agent: false, headers: { host: opts.host ?? `${ADDRESS}:${String(port)}`, ...opts.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** Ask for the refresh socket; says whether the door let it through to the bundler. */
function askSocket(port: number, path: string): Promise<'through' | 'shut'> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, setHost: false, agent: false, headers: { host: `${ADDRESS}:${String(port)}`, connection: 'Upgrade', upgrade: 'websocket' } });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve('through');
    });
    req.on('response', (res) => {
      res.resume();
      resolve('shut');
    });
    req.on('error', () => resolve('shut'));
    req.end();
  });
}

interface FakeBundler {
  start: NonNullable<PhoneDoorOptions['startBundler']>;
  /** What the bundler was asked, but for the door's own "are you there". */
  seen: { method: string; url: string; headers: IncomingHttpHeaders }[];
  starts: { dir: string; port: number; env: Record<string, string>; guard: string }[];
  stops: number;
  /** End the bundler as if it had stopped by itself. */
  die: () => void;
  /** False: it starts and never listens. */
  listens: boolean;
  close: () => void;
}

/** A stand-in for Expo's bundler: a small server on the port it is given, on this machine alone. */
function fakeBundler(): FakeBundler {
  const servers = new Set<Server>();
  let end: (code: number | null) => void = () => undefined;
  const fake: FakeBundler = {
    seen: [],
    starts: [],
    stops: 0,
    listens: true,
    die: () => end(1),
    close: () => {
      for (const server of servers) {
        server.close();
        server.closeAllConnections();
      }
      servers.clear();
    },
    start: (dir, port, env, guard): LongChild => {
      fake.starts.push({ dir, port, env, guard });
      const ended = new Promise<number | null>((resolve) => {
        end = resolve;
      });
      const server = createServer((req, res) => {
        const url = req.url ?? '';
        if (url === '/status') {
          res.writeHead(200, { 'content-type': 'text/plain' }).end('packager-status:running');
          return;
        }
        fake.seen.push({ method: req.method ?? '', url, headers: req.headers });
        if (url === '/') res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'bundler=1', 'x-powered-by': 'Express' }).end(JSON.stringify({ launchAsset: { url: 'bundle' } }));
        else if (url.startsWith('/index.ts.bundle')) res.writeHead(200, { 'content-type': 'application/javascript' }).end('var __BUNDLE__ = 1;');
        else if (url === '/assets/boom.png') res.writeHead(500, { 'content-type': 'application/json' }).end('{"message":"Unable to resolve /Users/someone/project/apps/shop/mobile/src/secret.ts"}');
        else if (url.startsWith('/assets/')) res.writeHead(200, { 'content-type': 'image/png' }).end('PNG');
        else res.writeHead(404).end('bundler: not found');
      });
      server.on('upgrade', (req, socket) => {
        fake.seen.push({ method: 'UPGRADE', url: req.url ?? '', headers: req.headers });
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
      if (fake.listens) {
        servers.add(server);
        server.listen(port, '127.0.0.1');
      }
      return {
        stop: () => {
          fake.stops += 1;
          server.close();
          server.closeAllConnections();
          servers.delete(server);
          end(null);
        },
        ended,
        output: () => 'Starting Metro Bundler\nError: something of Expo’s own\n',
      };
    },
  };
  return fake;
}

describe('the phone door', () => {
  let root: string;
  let bundler: FakeBundler;
  let door: PhoneDoor;
  let injected: InjectOptions[];
  let access: { token: string; tables: Record<string, string> } | null;
  let interfaces: Record<string, NetworkInterfaceInfo[]>;
  let clock: number | null;
  const kept: Record<string, string | undefined> = {};

  const makeDoor = (over: Partial<PhoneDoorOptions> = {}): PhoneDoor =>
    createPhoneDoor({
      root,
      app: {
        inject: async (asked: InjectOptions) => {
          injected.push(asked);
          return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'sid=1', 'x-next-cursor': 'c2' }, rawPayload: Buffer.from('{"data":[{"id":1}]}') };
        },
      } as unknown as Pick<FastifyInstance, 'inject'>,
      previewHost: 'localhost:4600',
      access: async () => access,
      interfaces: () => interfaces,
      startBundler: bundler.start,
      bindOverride: '127.0.0.1',
      now: () => clock ?? Date.now(),
      ...over,
    });

  /** Open the door for the shop, and read the port and the code out of the address a phone scans. */
  const opened = async (which: PhoneDoor = door): Promise<{ port: number; code: string; state: Extract<PhoneDoorState, { state: 'open' }> }> => {
    const state = await which.open('shop', ADDRESS);
    if (state.state !== 'open') throw new Error(`the door did not open: ${JSON.stringify(state)}`);
    const found = /^exp:\/\/192\.168\.7\.20:(\d+)\/\?code=([A-Za-z0-9_-]{12})$/.exec(state.url);
    if (found === null) throw new Error(`not the address of a door: ${state.url}`);
    return { port: Number(found[1]), code: found[2] as string, state };
  };

  beforeEach(async () => {
    root = phoneProject('adminium-phone-door-');
    const built = await buildFixturePhone(root, 'shop', standIn());
    expect(built.state).toBe('built');
    expect(phoneNow(root, 'shop').state).toBe('built');
    bundler = fakeBundler();
    injected = [];
    access = { token: 'adm_app_test', tables: { items: 'shop_items' } };
    interfaces = { lo0: [net('127.0.0.1', { internal: true })], en0: [net(ADDRESS)] };
    clock = null;
    for (const name of ['ADMINIUM_SECRET', 'MY_TOKEN']) kept[name] = process.env[name];
    door = makeDoor();
  });
  afterEach(() => {
    vi.useRealTimers();
    door.stop();
    bundler.close();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries(kept)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe('opening it', () => {
    it('is off until asked, and names this machine’s addresses', () => {
      expect(door.state()).toEqual({ state: 'off' });
      expect(door.addresses()).toEqual([{ address: ADDRESS, name: 'en0' }]);
      // Stopping a door that is not open is nothing.
      door.stop();
      expect(door.state()).toEqual({ state: 'off' });
    });

    it.each(['10.0.0.99', '127.0.0.1', '0.0.0.0', 'localhost', 'evil.example', ''])('refuses %j: not an address of this computer on a network', async (address) => {
      const state = await door.open('shop', address);
      expect(state).toEqual({ state: 'closed', app: 'shop', why: 'failed', words: 'That is not an address of this computer on a network. Choose another.' });
      expect(door.state()).toEqual(state);
      expect(bundler.starts).toEqual([]);
    });

    it('refuses an app whose phone side is not built, in the words of how it stands', async () => {
      scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: [], version: APP_VERSION, phone: true });
      scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
      expect(await door.open('cafe', ADDRESS)).toEqual({ state: 'closed', app: 'cafe', why: 'failed', words: expect.stringContaining('apps/cafe/mobile is not approved') });
      expect(await door.open('plain', ADDRESS)).toEqual({ state: 'closed', app: 'plain', why: 'failed', words: 'This app has no phone app.' });
      expect(bundler.starts).toEqual([]);
    });

    it('refuses an app that has no key for a phone app', async () => {
      access = null;
      const state = await door.open('shop', ADDRESS);
      expect(state).toEqual({ state: 'closed', app: 'shop', why: 'failed', words: expect.stringContaining('The phone app has no key yet.') });
      expect(bundler.starts).toEqual([]);
    });

    it('opens at the address chosen, with the code in the address a phone scans and in its picture', async () => {
      const { state, port, code } = await opened();
      expect(state).toEqual({ state: 'open', app: 'shop', url: `exp://${ADDRESS}:${String(port)}/?code=${code}`, qr: expect.stringContaining('<svg'), address: ADDRESS, sdk: '57', connected: false, phoneSdk: null, lastSeen: null });
      expect(state.qr).toBe(doorQr(state.url));
      expect(door.state()).toEqual(state);
    });

    it('a new code each time, and opening again closes the door that was open', async () => {
      const first = await opened();
      const second = await opened();
      expect(second.code).not.toBe(first.code);
      expect(bundler.starts).toHaveLength(2);
      expect(bundler.stops).toBe(1);
      await expect(ask(first.port, `/?code=${first.code}`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      expect((await ask(second.port, `/?code=${first.code}`)).status).toBe(404);
      expect((await ask(second.port, `/?code=${second.code}`)).status).toBe(200);
    });

    it('starts Expo’s bundler in the phone folder, on this machine alone, told where the door is and nothing of this server’s', async () => {
      process.env['ADMINIUM_SECRET'] = 'x';
      process.env['MY_TOKEN'] = 'made-up';
      const { port } = await opened();
      expect(bundler.starts).toHaveLength(1);
      const [start] = bundler.starts;
      const dir = phoneDir(root, 'shop');
      expect(start?.dir).toBe(dir);
      expect(start?.port).not.toBe(port);
      expect(start?.guard).toBe(start?.env['ADMINIUM_BUILD_GUARD']);
      const origin = `http://${ADDRESS}:${String(port)}`;
      expect(start?.env).toMatchObject({
        EXPO_PACKAGER_PROXY_URL: origin,
        EXPO_PUBLIC_ADMINIUM_URL: origin,
        EXPO_PUBLIC_ADMINIUM_KEY: 'adm_app_test',
        EXPO_PUBLIC_ADMINIUM_TABLES: '{"items":"shop_items"}',
        EXPO_OVERRIDE_METRO_CONFIG: join(dir, 'node_modules', '.adminium', 'metro.config.cjs'),
        ADMINIUM_BUILD_ROOT: dir,
        EXPO_OFFLINE: '1',
        EXPO_NO_TELEMETRY: '1',
        EXPO_NO_DOTENV: '1',
      });
      // A bundler that is told it is a CI does not refresh the phone.
      expect(start?.env).not.toHaveProperty('CI');
      expect(start?.env).not.toHaveProperty('ADMINIUM_SECRET');
      expect(start?.env).not.toHaveProperty('MY_TOKEN');
    });

    it('a bundler that never answers is a failed door, said with the bundler’s last lines, and the bundler is ended', async () => {
      bundler.listens = false;
      // The first look is before the minute is up; the second is past it.
      let looks = 0;
      door = makeDoor({ now: () => ((looks += 1) <= 2 ? 0 : 61_000) });
      const state = await door.open('shop', ADDRESS);
      expect(state).toEqual({ state: 'closed', app: 'shop', why: 'failed', words: 'Expo’s bundler did not start.\nStarting Metro Bundler\nError: something of Expo’s own' });
      expect(bundler.starts).toHaveLength(1);
      expect(bundler.stops).toBe(1);
    });

    it('a bundler that ends before it answers is a failed door', async () => {
      bundler.listens = false;
      const waiting = door.open('shop', ADDRESS);
      await vi.waitFor(() => expect(bundler.starts).toHaveLength(1));
      bundler.die();
      expect(await waiting).toMatchObject({ state: 'closed', why: 'failed', words: expect.stringContaining('Expo’s bundler did not start.') });
    });

    it('asked again while it is starting, says so and starts no second bundler', async () => {
      const first = door.open('shop', ADDRESS);
      await vi.waitFor(() => expect(bundler.starts).toHaveLength(1));
      const state = door.state();
      if (state.state === 'starting') expect(await door.open('shop', ADDRESS)).toEqual({ state: 'starting', app: 'shop' });
      expect((await first).state).toBe('open');
      expect(bundler.starts).toHaveLength(1);
    });
  });

  describe('who comes through', () => {
    it('a code of the right length in other letters is a wrong code, and the door stands', async () => {
      const { port, code } = await opened();
      // The same count of letters, more bytes: comparing them byte for byte once ended the server.
      for (const wrong of ['é'.repeat(code.length), '%C3%A9'.repeat(code.length), '\u{1F600}'.repeat(code.length), `${code.slice(0, -1)}é`, '%', '%E0%A4%A']) {
        expect((await ask(port, `/?code=${wrong.startsWith('%') ? wrong : encodeURIComponent(wrong)}`)).status, wrong).toBe(404);
      }
      expect(door.state()).toMatchObject({ state: 'open', connected: false });
      expect((await ask(port, `/?code=${code}`)).status).toBe(200);
    });

    it('a request by a name, or to another address, is told it is not here', async () => {
      const { port, code } = await opened();
      for (const host of [`localhost:${String(port)}`, `127.0.0.1:${String(port)}`, 'evil.example', `${ADDRESS}`, `${ADDRESS}:${String(port + 1)}`, `my-mac.local:${String(port)}`, '']) {
        const answer = await ask(port, `/?code=${code}`, { host });
        expect(answer.status, host).toBe(421);
        expect(answer.body, host).toBe('Not here.');
      }
      expect(bundler.seen).toEqual([]);
      expect(door.state()).toMatchObject({ state: 'open', connected: false });
    });

    it('with no code or a wrong one there is nothing here, and nothing of the app before a device is let in', async () => {
      const { port, code } = await opened();
      for (const path of ['/', '/?code=', '/?code=wrong', `/?code=${code}x`, `/?code=${code.slice(0, -1)}`, `/?Code=${code}`, '/index.ts.bundle?platform=ios', `/index.ts.bundle?code=${code}`, `/assets/logo.png?code=${code}`]) {
        const answer = await ask(port, path);
        expect(answer.status, path).toBe(404);
        expect(answer.body, path).toBe('Not found.');
        expect(answer.headers['cache-control'], path).toBe('no-store');
      }
      const api = await ask(port, `/api/v1/public/records/shop_items?code=${code}`);
      expect(api.status).toBe(404);
      expect(bundler.seen).toEqual([]);
      expect(injected).toEqual([]);
      expect(door.state()).toMatchObject({ state: 'open', connected: false, lastSeen: null });
    });

    it.each([
      ['an Origin', { origin: 'https://evil.example' }],
      ['an Origin of the door’s own', { origin: `http://${ADDRESS}` }],
      ['Sec-Fetch-Site', { 'sec-fetch-site': 'cross-site' }],
      ['Sec-Fetch-Mode', { 'sec-fetch-mode': 'no-cors' }],
      ['Sec-Fetch-Dest', { 'sec-fetch-dest': 'script' }],
      ['a Referer', { referer: 'http://evil.example/page' }],
      // Over plain http a page may send none of the above: what it cannot change is that its browser says it is one.
      ['a browser’s name', { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Mobile/15E148 Safari/604.1' }],
    ])('a web page is never let in, though it has the code: a request with %s', async (_what, headers) => {
      const { port, code } = await opened();
      expect((await ask(port, `/?code=${code}`, { headers })).status).toBe(404);
      expect(door.state()).toMatchObject({ state: 'open', connected: false });
      // And once a phone is in, a page on the same machine as that phone still is not.
      expect((await ask(port, `/?code=${code}`)).status).toBe(200);
      expect((await ask(port, '/index.ts.bundle?platform=ios', { headers })).status).toBe(404);
      expect((await ask(port, '/api/v1/public/records/shop_items', { headers })).status).toBe(404);
      expect(bundler.seen.map((entry) => entry.url)).toEqual(['/']);
      expect(injected).toEqual([]);
    });

    it('the first device to show the code is let in, and the bundler is never shown the code', async () => {
      const { port, code } = await opened();
      const answer = await ask(port, `/?code=${code}`, { headers: { cookie: 'sid=secret', 'x-forwarded-for': '10.9.9.9', 'expo-platform': 'ios' } });
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({ launchAsset: { url: 'bundle' } });
      // What the bundler says of itself is not passed on.
      expect(answer.headers).not.toHaveProperty('set-cookie');
      expect(answer.headers).not.toHaveProperty('x-powered-by');

      expect(bundler.seen).toHaveLength(1);
      const [asked] = bundler.seen;
      expect(asked?.url).toBe('/');
      expect(JSON.stringify(bundler.seen)).not.toContain(code);
      expect(asked?.headers.host).toBe(`127.0.0.1:${String(bundler.starts[0]?.port)}`);
      expect(asked?.headers['expo-platform']).toBe('ios');
      expect(asked?.headers).not.toHaveProperty('cookie');
      expect(asked?.headers).not.toHaveProperty('x-forwarded-for');

      const state = door.state();
      expect(state).toMatchObject({ state: 'open', connected: true, phoneSdk: null });
      expect((state as { lastSeen: number | null }).lastSeen).toEqual(expect.any(Number));
    });

    it('says when the phone’s Expo Go is for another SDK than the phone side', async () => {
      const { port, code } = await opened();
      await ask(port, `/?code=${code}`, { headers: { 'user-agent': 'Exponent/54.0.6 CFNetwork/1568 Darwin/24.0.0' } });
      expect(door.state()).toMatchObject({ state: 'open', connected: true, sdk: '57', phoneSdk: '54' });
    });

    it('says nothing of the phone’s SDK when it is the phone side’s own', async () => {
      const { port, code } = await opened();
      await ask(port, `/?code=${code}`, { headers: { 'user-agent': 'Exponent/57.0.2 CFNetwork/1568 Darwin/24.0.0' } });
      expect(door.state()).toMatchObject({ state: 'open', connected: true, sdk: '57', phoneSdk: null });
    });

    // A LIKELY BUG IN src, left failing on purpose: src/designer/phone-door.ts:411 reads the phone's SDK with
    // /Expon?ent?\/(\d+)\./, which matches "Exponent/54." and not "Expo/54." (the "e" after "Expo" is not optional).
    // If the pattern was meant to read both names (`Expo(?:nent)?`), a phone that says "Expo/54.0.6" is never told
    // its Expo Go is for another SDK. Take `.fails` off with the fix, or remove this if "Exponent" alone is meant.
    it('reads the SDK of a phone that calls its Expo Go "Expo"', async () => {
      const { port, code } = await opened();
      await ask(port, `/?code=${code}`, { headers: { 'user-agent': 'Expo/54.0.6 CFNetwork/1568 Darwin/24.0.0' } });
      expect(door.state()).toMatchObject({ state: 'open', connected: true, phoneSdk: '54' });
    });
  });

  describe('what is passed, once a phone is in', () => {
    let port: number;
    let code: string;
    beforeEach(async () => {
      ({ port, code } = await opened());
      expect((await ask(port, `/?code=${code}`)).status).toBe(200);
      bundler.seen.length = 0;
    });

    it('the app’s bundle and its assets, as asked', async () => {
      const bundle = await ask(port, '/index.ts.bundle?platform=ios&dev=true');
      expect(bundle.status).toBe(200);
      expect(bundle.body).toBe('var __BUNDLE__ = 1;');
      expect(bundle.headers['content-type']).toBe('application/javascript');
      const asset = await ask(port, '/assets/src/img/logo.png?platform=ios');
      expect(asset.status).toBe(200);
      expect(asset.body).toBe('PNG');
      expect(bundler.seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual(['GET /index.ts.bundle?platform=ios&dev=true', 'GET /assets/src/img/logo.png?platform=ios']);
    });

    it('a bundler that fails is one plain sentence: none of its own words reach the phone', async () => {
      const answer = await ask(port, '/assets/boom.png');
      expect(answer.status).toBe(502);
      expect(answer.body).toBe('The phone app did not build. Look at the Designer on the computer.');
      expect(answer.headers['content-type']).toContain('text/plain');
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.body).not.toContain('/Users/someone');
    });

    it('the public API is answered by this server as its own preview is, for the phone’s own address', async () => {
      const answer = await ask(port, '/api/v1/public/records/shop_items?limit=50', { headers: { authorization: 'Bearer adm_app_test', cookie: 'sid=secret', 'x-forwarded-for': '10.9.9.9', forwarded: 'for=10.9.9.9', 'x-real-ip': '10.9.9.9' } });
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({ data: [{ id: 1 }] });
      expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(answer.headers['x-next-cursor']).toBe('c2');
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.headers).not.toHaveProperty('set-cookie');

      expect(injected).toHaveLength(1);
      const [asked] = injected;
      expect(asked?.method).toBe('GET');
      expect(asked?.url).toBe('/api/v1/public/records/shop_items?limit=50');
      expect(asked?.remoteAddress).toBe('127.0.0.1');
      const headers = asked?.headers as Record<string, string>;
      expect(headers['host']).toBe('localhost:4600');
      expect(headers['authorization']).toBe('Bearer adm_app_test');
      for (const name of ['cookie', 'x-forwarded-for', 'forwarded', 'x-real-ip', 'connection']) expect(headers, name).not.toHaveProperty(name);
      expect(asked).not.toHaveProperty('payload');
      // The bundler has no part in it.
      expect(bundler.seen).toEqual([]);
    });

    it('what a phone sends to the public API is passed whole', async () => {
      const body = JSON.stringify({ message: 'Two loaves, please.' });
      const answer = await ask(port, '/api/v1/public/records/shop_requests', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body });
      expect(answer.status).toBe(200);
      expect(injected[0]?.method).toBe('POST');
      expect((injected[0]?.payload as Buffer).toString('utf8')).toBe(body);
      expect((injected[0]?.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('nothing else of the bundler or of this server', async () => {
      for (const [method, path] of [
        ['GET', '/status'],
        ['GET', '/json/list'],
        ['GET', '/open-stack-frame'],
        ['POST', '/open-stack-frame'],
        ['POST', '/symbolicate'],
        ['GET', '/inspector/device'],
        ['GET', '/message'],
        ['GET', '/hot'],
        ['GET', '/package.json.bundle'],
        ['GET', '/src/adminium.ts.bundle'],
        ['GET', '/assets/?unstable_path=..%2F..%2Fpackage.json'],
        ['GET', '/assets/x.png?platform=ios&unstable_path=.%2Fpackage.json'],
        ['GET', '/assets/%2e%2e/package.json'],
        ['GET', '/assets/..%2fpackage.json'],
        ['GET', '//evil.example/'],
        ['POST', '/'],
        ['GET', '/api/v1/designer/sessions'],
        ['GET', '/api/v1/records/shop_items'],
        ['GET', '/apps/shop/mobile/'],
        ['GET', '/api/v1/public/..%2f..%2fdesigner/sessions'],
      ] as const) {
        const answer = await ask(port, path, { method });
        expect(answer.status, `${method} ${path}`).toBe(404);
        expect(answer.body, `${method} ${path}`).toBe('Not found.');
      }
      expect(bundler.seen).toEqual([]);
      expect(injected).toEqual([]);
    });

    it('the refresh socket goes to the bundler, and no other socket does', async () => {
      expect(await askSocket(port, '/message')).toBe('shut');
      expect(await askSocket(port, '/inspector/device')).toBe('shut');
      expect(bundler.seen).toEqual([]);
      expect(await askSocket(port, '/hot')).toBe('through');
      expect(bundler.seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual(['UPGRADE /hot']);
      expect(bundler.seen[0]?.headers.host).toBe(`127.0.0.1:${String(bundler.starts[0]?.port)}`);
    });
  });

  describe('closing it', () => {
    it('the refresh socket is shut to a device that has not shown the code', async () => {
      const { port } = await opened();
      expect(await askSocket(port, '/hot')).toBe('shut');
      expect(bundler.seen).toEqual([]);
    });

    it('stop closes the listener and ends the bundler', async () => {
      const { port, code } = await opened();
      expect((await ask(port, `/?code=${code}`)).status).toBe(200);
      door.stop();
      expect(door.state()).toEqual({ state: 'closed', app: 'shop', why: 'stopped', words: 'The phone preview was stopped.' });
      expect(bundler.stops).toBe(1);
      await expect(ask(port, `/?code=${code}`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      await expect(ask(bundler.starts[0]?.port as number, '/status', { host: '127.0.0.1' })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    it('a bundler that ends under an open door takes the door with it', async () => {
      const { port, code } = await opened();
      bundler.die();
      await vi.waitFor(() => expect(door.state().state).toBe('closed'));
      expect(door.state()).toEqual({ state: 'closed', app: 'shop', why: 'failed', words: 'Expo’s bundler stopped. Open the phone preview again.' });
      await expect(ask(port, `/?code=${code}`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    it('closes after its idle time with no phone using it, and not before', async () => {
      // Only the door's own watch is on a made clock: the sockets stay real.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      clock = 1_000_000;
      door = makeDoor({ idleMs: 60_000 });
      const { port, code } = await opened();
      clock += 59_000;
      vi.advanceTimersByTime(5000);
      expect(door.state().state).toBe('open');
      // Something came through: the time is counted from then.
      expect((await ask(port, `/?code=${code}`)).status).toBe(200);
      clock += 59_000;
      vi.advanceTimersByTime(5000);
      expect(door.state().state).toBe('open');
      clock += 2000;
      vi.advanceTimersByTime(5000);
      expect(door.state()).toEqual({ state: 'closed', app: 'shop', why: 'idle', words: expect.stringContaining('closed after half an hour') });
      expect(bundler.stops).toBe(1);
      await expect(ask(port, `/?code=${code}`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    it('closes when this machine’s address on the network goes', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const { port, code } = await opened();
      vi.advanceTimersByTime(5000);
      expect(door.state().state).toBe('open');
      interfaces = { lo0: [net('127.0.0.1', { internal: true })], en0: [net('10.0.0.7')] };
      vi.advanceTimersByTime(5000);
      expect(door.state()).toEqual({ state: 'closed', app: 'shop', why: 'network', words: 'The network changed. Open the phone preview again.' });
      await expect(ask(port, `/?code=${code}`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });
  });
});
