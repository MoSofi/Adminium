// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The phone door: how a real phone opens an app's phone side while it is
 * being designed.
 *
 * Design mode answers on this machine only, and stays so. A phone is another
 * machine. So a door of its own is opened, for one app, by a person's click,
 * and for the phone preview alone. Nothing is sent to anyone else: no tunnel.
 *
 * Behind the door are two things on this machine:
 *
 *  - Expo's bundler, started here on `127.0.0.1` and never on the network (it
 *    answers `/open-stack-frame`, `/json/list` and a debugger). The door
 *    passes it exactly what a phone asks to run the app: the manifest, the
 *    app's one bundle, its assets, and the socket that refreshes it.
 *  - this server's own public API, answered as the preview answers it, with
 *    the caller's own address for the limits.
 *
 * Who may come through:
 *
 *  - a request to the door's own address and port by number (a name that
 *    points here is refused: 421);
 *  - with no `Origin`, no `Sec-Fetch-*` and no `Referer` header, and not
 *    saying it is a browser (every browser says `Mozilla/…` and a page cannot
 *    change that; over plain http a page may send none of the first three.
 *    A phone app says what its platform's network code says: `Expo…` on iOS,
 *    `okhttp/…` on Android);
 *  - from the one device that showed the code. The code is in the address a
 *    phone scans; the first device to show it is the one admitted, by its
 *    address, until the door closes. A second phone: stop, and open again.
 *
 * It closes when asked, when the server stops, when this machine's address
 * goes, and after half an hour in which nothing came through it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, createServer as createNetServer, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import encodeQR from 'qr';

import { PHONE_METRO_CONFIG, phoneEnvironment, phoneNow } from '../project/apps/phone-build.js';
import { phoneDir } from '../project/apps/phone.js';
import { guardEnvironment } from '../project/apps/own-build.js';
import { nodeProgram } from '../project/programs.js';
import { startLongChild, type LongChild } from './child.js';

/** How long the door stays open with nothing coming through it. */
export const PHONE_DOOR_IDLE_MS = 30 * 60_000;
/** How long the bundler may take to answer its first question. */
const BUNDLER_READY_MS = 60_000;
/** The most a phone may send in one request through the door. */
const MAX_BODY = 12 * 1024 * 1024;

/** An address of this machine a phone on the same network could reach. */
export interface PhoneAddress {
  address: string;
  /** The interface's name (`en0`, `Wi-Fi`). */
  name: string;
}

/**
 * This machine's IPv4 addresses on a network, private ranges first (a home or
 * office network), the rest after. No loopback, no link-local.
 */
export function phoneAddresses(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): PhoneAddress[] {
  const out: (PhoneAddress & { rank: number })[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      const home = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      // A bridge or a tunnel is rarely the network a phone is on.
      const side = /^(utun|tun|tap|docker|br-|veth|vmnet|bridge|awdl|llw)/i.test(name);
      out.push({ address: entry.address, name, rank: (home ? 0 : 2) + (side ? 1 : 0) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map(({ address, name }) => ({ address, name }));
}

/** What the door is doing, as the Designer's page shows it. Never the code alone: it is in `url`, for the page that draws it. */
export type PhoneDoorState =
  | { state: 'off' }
  | { state: 'starting'; app: string }
  | {
      state: 'open';
      app: string;
      /** The address a phone scans: `exp://<address>:<port>/?code=…`. */
      url: string;
      /** The same, as a picture. */
      qr: string;
      address: string;
      /** The Expo SDK the phone side is written for: Expo Go must be for the same one. */
      sdk: string | null;
      /** A phone showed the code and was let in. */
      connected: boolean;
      /** The SDK the phone's Expo Go said it is for, when that is another one. */
      phoneSdk: string | null;
      /** When something last came through, epoch ms; null before the first. */
      lastSeen: number | null;
    }
  | { state: 'closed'; app: string; why: 'stopped' | 'idle' | 'network' | 'failed'; words: string };

export interface PhoneDoorOptions {
  /** The project's folder. */
  root: string;
  /** The server, for the public API's own answers. */
  app: Pick<FastifyInstance, 'inject'>;
  /** The name the server's own preview goes by (`localhost:<port>`): what the public API is asked as. */
  previewHost: string;
  /** The phone app's key and the app's tables, or null when the app has no key for a phone app. */
  access: (key: string) => Promise<{ token: string; tables: Record<string, string> } | null>;
  /** Test seams. */
  interfaces?: () => ReturnType<typeof networkInterfaces>;
  startBundler?: (dir: string, port: number, env: Record<string, string>, guard: string) => LongChild;
  now?: () => number;
  idleMs?: number;
  /** Where the door listens: the chosen address in life, a loopback one in a test. */
  bindOverride?: string;
}

export interface PhoneDoor {
  state: () => PhoneDoorState;
  addresses: () => PhoneAddress[];
  /** Open the door for an app, at one of this machine's addresses. Closes one that is open first. */
  open: (key: string, address: string) => Promise<PhoneDoorState>;
  /** Close it. */
  stop: () => void;
}

/** A free port on this machine's own address. */
function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** The QR code of `text`, as an SVG on a white square. */
export function doorQr(text: string): string {
  const framed = encodeQR(text, 'raw', { ecc: 'medium', border: 1 });
  const modules = framed.slice(1, -1).map((row) => row.slice(1, -1));
  const quiet = 4;
  const width = modules.length + 2 * quiet;
  const path: string[] = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== true) {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === true) run += 1;
      path.push(`M${String(x + quiet)} ${String(y + quiet)}h${String(run)}v1h-${String(run)}z`);
      x += run;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(width)}" shape-rendering="crispEdges"><rect width="${String(width)}" height="${String(width)}" fill="#fff"/><path fill="#000" d="${path.join('')}"/></svg>`;
}

/** A path as asked, or null for one that tries to be read two ways. */
export function doorPath(url: string | undefined): { pathname: string; search: string } | null {
  const raw = url ?? '/';
  // (No `#` either: a bundler that reads the address as a URL would drop what follows it, and read less than was checked.)
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\0\s#]/.test(raw)) return null;
  const mark = raw.indexOf('?');
  const pathname = mark === -1 ? raw : raw.slice(0, mark);
  const search = mark === -1 ? '' : raw.slice(mark);
  // No escape in a path: a phone's own requests have none, and `%2e%2e`, `%2f` and `%5c` are how a path is read two ways.
  if (pathname.includes('%') || pathname.split('/').includes('..')) return null;
  return { pathname, search };
}

/** What the door passes of a phone's request: the paths and nothing else. */
export function doorRoute(method: string, pathname: string, search: string): 'manifest' | 'bundle' | 'asset' | 'api' | null {
  if (pathname.startsWith('/api/v1/public/')) return 'api';
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (pathname === '/') return 'manifest';
  // The app's one bundle, by the name Expo's manifest gives it.
  if (pathname === '/index.ts.bundle') return 'bundle';
  // An asset. Expo's bundler hands a phone every asset as `/assets/?unstable_path=./<its path>`, and that
  // word reads a file by its path: it is passed for a picture or a font under the app's own `assets/` or
  // in a package, and for nothing else. (The question is read as the bundler reads it, so
  // `unstable%5Fpath` is the same word.)
  if (pathname === '/assets/' || pathname.startsWith('/assets/')) {
    let asked: URLSearchParams;
    try {
      asked = new URLSearchParams(search);
    } catch {
      return null;
    }
    const given = [...asked.entries()].filter(([name]) => name.toLowerCase() === 'unstable_path');
    if (given.length === 0) return pathname.length > '/assets/'.length ? 'asset' : null;
    const [name, value] = given[0] as [string, string];
    return given.length === 1 && name === 'unstable_path' && pathname === '/assets/' && doorAssetPath(value) ? 'asset' : null;
  }
  return null;
}

/**
 * Whether a path given as `unstable_path` is an asset a phone may have: a
 * picture or a font, under the phone side's `assets/` or in one of its
 * packages, named plainly. No step up, no dot file, nothing left to decode.
 */
export function doorAssetPath(value: string): boolean {
  // (Metro cuts the path at its first `?` and reads what is before it: no `?` and no `#`, so the name checked is the name read.)
  if (value.length > 400 || /[\\%?#]/.test(value) || [...value].some((letter) => letter.charCodeAt(0) < 0x20)) return false;
  if (!/^\.\/(assets|node_modules)\//.test(value)) return false;
  const parts = value.slice(2).split('/');
  if (parts.some((part) => part === '' || part.startsWith('.'))) return false;
  return /\.(png|jpe?g|webp|gif|svg|ttf|otf)$/i.test(parts[parts.length - 1] as string);
}

/** Headers a phone's request may carry to the bundler or the API. Never a cookie, never what says where it came from. */
function passed(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    if (/^(host|origin|cookie|forwarded|x-forwarded-.*|x-real-ip|connection|upgrade|keep-alive|transfer-encoding|proxy-.*|te|trailer)$/i.test(name)) continue;
    out[name] = value;
  }
  return out;
}

/** Whether two texts are the same, in the same time whatever they are: by their digests, so a text of any length or letters compares. */
const same = (a: string, b: string): boolean => timingSafeEqual(createHash('sha256').update(a, 'utf8').digest(), createHash('sha256').update(b, 'utf8').digest());

/** The SDK the phone side is written for: the major of its `expo`. */
function sdkOf(root: string, key: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(phoneDir(root, key), 'node_modules', 'expo', 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? (pkg.version.split('.')[0] ?? null) : null;
  } catch {
    return null;
  }
}

export function createPhoneDoor(opts: PhoneDoorOptions): PhoneDoor {
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? PHONE_DOOR_IDLE_MS;
  const interfaces = opts.interfaces ?? networkInterfaces;
  let current: PhoneDoorState = { state: 'off' };
  let server: Server | null = null;
  let bundler: LongChild | null = null;
  let watch: NodeJS.Timeout | null = null;
  /** Moves at every open and every close: an open that was overtaken while it waited stops what it started. */
  let generation = 0;
  const sockets = new Set<Socket>();

  const close = (why: 'stopped' | 'idle' | 'network' | 'failed', words: string): void => {
    generation += 1;
    const app = current.state === 'off' ? '' : current.app;
    if (watch !== null) clearInterval(watch);
    watch = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    server?.close();
    server?.closeAllConnections?.();
    server = null;
    bundler?.stop();
    bundler = null;
    current = app === '' ? { state: 'off' } : { state: 'closed', app, why, words };
  };

  const startBundler =
    opts.startBundler ??
    ((dir: string, port: number, env: Record<string, string>, guard: string): LongChild => {
      // Expo listens on `localhost`; with this, that is 127.0.0.1 on every machine, which is where the door asks.
      const launch = nodeProgram(['--dns-result-order=ipv4first', '--require', guard, join(dir, 'node_modules', 'expo', 'bin', 'cli'), 'start', '--localhost', '--port', String(port), '--max-workers', '2']);
      return startLongChild(launch.command, launch.args, { cwd: dir, env: { ...env, ...launch.env } });
    });

  /** Ask the bundler something, as the door. */
  const toBundler = (port: number, req: IncomingMessage, res: ServerResponse, path: string): void => {
    const out = httpRequest({ host: '127.0.0.1', port, method: req.method, path, headers: { ...passed(req.headers), host: `127.0.0.1:${String(port)}` } }, (answer) => {
      const status = answer.statusCode ?? 502;
      if (status >= 500) {
        // The bundler's own words carry this machine's paths and the app's code: the Designer shows them, a phone does not.
        answer.resume();
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('The phone app did not build. Look at the Designer on the computer.');
        return;
      }
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !/^(connection|keep-alive|transfer-encoding|set-cookie|x-powered-by)$/i.test(name)) headers[name] = value;
      }
      res.writeHead(status, headers);
      answer.pipe(res);
    });
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The phone app is not ready yet.');
    });
    req.pipe(out);
  };

  /** Answer the public API as this server answers its own preview, for the phone's own address. */
  const toApi = (req: IncomingMessage, res: ServerResponse, path: string, remote: string): void => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'That is too much to send through the phone preview.' } }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const body = Buffer.concat(chunks);
      void opts.app
        .inject({
          method: (req.method ?? 'GET') as 'GET',
          url: path,
          headers: { ...passed(req.headers), host: opts.previewHost },
          remoteAddress: remote,
          ...(body.length === 0 ? {} : { payload: body }),
        })
        .then(
          (answer) => {
            const headers: Record<string, string> = { 'cache-control': 'no-store' };
            for (const name of ['content-type', 'retry-after', 'x-next-cursor', 'x-adminium-session-ended', 'content-disposition']) {
              const value = answer.headers[name];
              if (typeof value === 'string') headers[name] = value;
            }
            res.writeHead(answer.statusCode, headers).end(answer.rawPayload);
          },
          () => {
            res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The app did not answer.' } }));
          },
        );
    });
  };

  return {
    state: () => current,
    addresses: () => phoneAddresses(interfaces()),
    stop: () => close('stopped', 'The phone preview was stopped.'),

    async open(key, address) {
      if (current.state === 'starting') return current;
      close('stopped', '');
      current = { state: 'starting', app: key };
      const mine = generation;
      /** Whether this open is still the one wanted: a stop, or another open, since it began means it is not. */
      const overtaken = (): boolean => generation !== mine;
      const fail = (words: string): PhoneDoorState => {
        if (!overtaken()) close('failed', words);
        return current;
      };
      if (!phoneAddresses(interfaces()).some((entry) => entry.address === address)) return fail('That is not an address of this computer on a network. Choose another.');
      const phone = phoneNow(opts.root, key);
      if (phone.state !== 'built') return fail(phone.state === 'none' ? 'This app has no phone app.' : phone.words);
      const access = await opts.access(key);
      if (overtaken()) return current;
      if (access === null) return fail('The phone app has no key yet. Give the app public access (manifest/access.json), and it is made when the app is applied.');

      const dir = phoneDir(opts.root, key);
      const bind = opts.bindOverride ?? address;
      let doorPort: number;
      let bundlerPort: number;
      try {
        doorPort = await freePort(bind);
        bundlerPort = await freePort('127.0.0.1');
      } catch {
        return fail('This computer gave the phone preview no port to listen on.');
      }
      if (overtaken()) return current;
      // The door's own address, as an origin: this machine's address on its network, by number.
      const at = new URL('http://127.0.0.1');
      at.hostname = address;
      at.port = String(doorPort);
      const origin = at.origin;
      const guard = guardEnvironment(opts.root, dir);
      const env = {
        ...phoneEnvironment(),
        ADMINIUM_BUILD_ROOT: guard['ADMINIUM_BUILD_ROOT'] as string,
        ADMINIUM_BUILD_GUARD: guard['ADMINIUM_BUILD_GUARD'] as string,
        EXPO_OVERRIDE_METRO_CONFIG: join(dir, PHONE_METRO_CONFIG),
        // The manifest a phone gets names the door, never the bundler.
        EXPO_PACKAGER_PROXY_URL: origin,
        EXPO_PUBLIC_ADMINIUM_URL: origin,
        EXPO_PUBLIC_ADMINIUM_KEY: access.token,
        EXPO_PUBLIC_ADMINIUM_TABLES: JSON.stringify(access.tables),
      };
      if (!existsSync(join(dir, PHONE_METRO_CONFIG))) return fail('The phone app is not built yet.');
      const child = startBundler(dir, bundlerPort, env, guard['ADMINIUM_BUILD_GUARD'] as string);
      bundler = child;

      // Ready when it answers its own status question; ended or silent for a minute is a failure, said with its words.
      const deadline = now() + BUNDLER_READY_MS;
      let ready = false;
      let gone = false;
      void child.ended.then(() => {
        gone = true;
        // The bundler ended under an open door: the door goes with it.
        if (ready && bundler === child) close('failed', 'Expo’s bundler stopped. Open the phone preview again.');
      });
      while (!ready && !gone && now() < deadline && bundler === child) {
        ready = await new Promise<boolean>((resolve) => {
          const probe = httpRequest({ host: '127.0.0.1', port: bundlerPort, path: '/status', timeout: 1500 }, (answer) => {
            answer.resume();
            resolve(answer.statusCode === 200);
          });
          probe.on('error', () => resolve(false));
          probe.on('timeout', () => {
            probe.destroy();
            resolve(false);
          });
          probe.end();
        });
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (bundler !== child || overtaken()) {
        // Stopped, or opened again, while the bundler was starting: this one is nobody's now.
        child.stop();
        return current;
      }
      if (!ready) {
        const said = child
          .output()
          .split('\n')
          .map((line) => line.trimEnd())
          .filter((line) => line !== '')
          .slice(-8)
          .join('\n');
        return fail(`Expo’s bundler did not start.${said === '' ? '' : `\n${said}`}`);
      }

      const code = randomBytes(9).toString('base64url');
      let admitted: string | null = null;
      const host = `${address}:${String(doorPort)}`;
      const seen = (): void => {
        if (current.state === 'open') current = { ...current, lastSeen: now() };
      };
      /** Whether this request may come through, admitting the first device that shows the code. */
      const allowed = (req: IncomingMessage, route: string | null, search: string): boolean => {
        const h = req.headers;
        if ((h.host ?? '').toLowerCase() !== host) return false;
        // (React Native on Android gives its own socket an Origin: the address it connects to. No page has the door's own
        // address as its origin, since the door serves no page; so the refresh socket, and only it, may say that one.)
        const ownSocket = route === 'hot' && h.origin === `http://${host}`;
        if ((h.origin !== undefined && !ownSocket) || h.referer !== undefined || Object.keys(h).some((name) => name.startsWith('sec-fetch-'))) return false;
        // A browser always says it is one, and a page in it cannot say otherwise: a phone app never does.
        if (/^\s*Mozilla\//i.test(String(h['user-agent'] ?? ''))) return false;
        const remote = req.socket.remoteAddress ?? '';
        if (admitted === null) {
          if (route !== 'manifest') return false;
          const shown = new URLSearchParams(search).get('code') ?? '';
          if (!same(shown, code)) return false;
          admitted = remote;
          const said = /Expo(?:nent)?\/(\d+)\./i.exec(String(h['user-agent'] ?? ''))?.[1] ?? null;
          if (current.state === 'open') current = { ...current, connected: true, phoneSdk: said !== null && said !== current.sdk ? said : null };
          return true;
        }
        return remote === admitted;
      };

      const door = createServer((req, res) => {
        try {
          answer(req, res);
        } catch {
          // Whatever a stranger sent that this could not read: not found, and the server goes on.
          if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          res.end('Not found.');
        }
      });
      const answer = (req: IncomingMessage, res: ServerResponse): void => {
        const parsed = doorPath(req.url);
        const route = parsed === null ? null : doorRoute(req.method ?? 'GET', parsed.pathname, parsed.search);
        if ((req.headers.host ?? '').toLowerCase() !== host) {
          res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end('Not here.');
          return;
        }
        if (parsed === null || route === null || !allowed(req, route, parsed.search)) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('Not found.');
          return;
        }
        seen();
        // The code is the door's: the bundler is never shown it.
        const path = route === 'manifest' ? '/' : `${parsed.pathname}${parsed.search}`;
        if (route === 'api') toApi(req, res, path, req.socket.remoteAddress ?? '');
        else toBundler(bundlerPort, req, res, path);
      };
      // The refresh socket, to the bundler: what makes the phone show the app as it was last written.
      door.on('upgrade', (req, socket: Socket, head) => {
        let parsed: ReturnType<typeof doorPath> = null;
        let may = false;
        try {
          parsed = doorPath(req.url);
          may = parsed !== null && parsed.pathname === '/hot' && allowed(req, 'hot', parsed.search);
        } catch {
          may = false;
        }
        if (parsed === null || !may) {
          socket.destroy();
          return;
        }
        seen();
        const up = connect(bundlerPort, '127.0.0.1', () => {
          const headers = { ...passed(req.headers), host: `127.0.0.1:${String(bundlerPort)}`, connection: 'Upgrade', upgrade: 'websocket' };
          up.write(`GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\n${Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
          if (head.length > 0) up.write(head);
          socket.pipe(up).pipe(socket);
        });
        sockets.add(socket);
        sockets.add(up);
        const end = (): void => {
          socket.destroy();
          up.destroy();
          sockets.delete(socket);
          sockets.delete(up);
        };
        up.on('error', end);
        up.on('close', end);
        socket.on('error', end);
        socket.on('close', end);
      });
      door.on('clientError', (_error, socket) => socket.destroy());

      try {
        await new Promise<void>((resolve, reject) => {
          door.once('error', reject);
          door.listen(doorPort, bind, () => resolve());
        });
      } catch {
        return fail('This computer would not let the phone preview listen on that address.');
      }
      if (bundler !== child || overtaken()) {
        door.close();
        child.stop();
        return current;
      }
      server = door;
      const url = `exp://${address}:${String(doorPort)}/?code=${code}`;
      current = { state: 'open', app: key, url, qr: doorQr(url), address, sdk: sdkOf(opts.root, key), connected: false, phoneSdk: null, lastSeen: null };
      const opened = now();
      watch = setInterval(() => {
        if (current.state !== 'open') return;
        // This machine's address went (another network): the address in the code leads nowhere.
        if (!phoneAddresses(interfaces()).some((entry) => entry.address === address)) close('network', 'The network changed. Open the phone preview again.');
        // An open refresh socket is a phone looking at the app.
        else if (sockets.size === 0 && now() - (current.lastSeen ?? opened) > idleMs) close('idle', 'The phone preview closed after half an hour with no phone using it.');
      }, 5000);
      watch.unref();
      return current;
    },
  };
}
