// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A model's address is checked, and then called at the address that was
 * checked: a name whose answer changes between the two gains nothing.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { checkedFetch, forgetCheckedAddresses, resolveAndCheck } from '../src/llm/outbound.js';
import { pinnedFetch } from '../src/net/pinned-fetch.js';

let server: Server;
let port: number;
let seen: { method: string; url: string; host: string; encoding: string | undefined; body: string }[];

const read = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    req.on('end', () => resolve(text));
  });

beforeAll(async () => {
  server = createServer((req, res) => {
    void read(req).then((body) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', host: req.headers.host ?? '', encoding: req.headers['accept-encoding'] as string | undefined, body });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write('{"n":1}\n');
        setTimeout(() => {
          res.write('{"n":2}\n');
          res.end();
        }, 30);
        return;
      }
      if (req.url === '/hang') return;
      res.writeHead(200, { 'content-type': 'application/json', 'x-twice': ['a', 'b'] });
      res.end(JSON.stringify({ echoed: body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  seen = [];
  forgetCheckedAddresses();
});
seen = [];

/** A name no resolver knows: a request that reaches the server did not ask one. */
const NAME = 'model.never-resolves.invalid';

describe('a fetch pinned to one address', () => {
  it('connects to the address it was given whatever the name is, and keeps the name for the far end', async () => {
    const reply = await pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/v1/chat?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
      body: JSON.stringify({ hello: 'né' }),
    });
    expect(reply.status).toBe(200);
    expect(reply.ok).toBe(true);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(reply.headers.get('x-twice')).toBe('a, b');
    expect(await reply.json()).toEqual({ echoed: '{"hello":"né"}' });
    expect(seen).toEqual([{ method: 'POST', url: '/v1/chat?x=1', host: `${NAME}:${String(port)}`, encoding: 'identity', body: '{"hello":"né"}' }]);
  });

  it('streams the answer as it arrives', async () => {
    const reply = await pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/stream`, { method: 'POST', body: '{}' });
    const reader = (reply.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('{"n":1}\n');
    let rest = '';
    for (let part = await reader.read(); !part.done; part = await reader.read()) rest += new TextDecoder().decode(part.value);
    expect(rest).toBe('{"n":2}\n');
  });

  it('tries every address the name gave, in order, and no other: a name that is ::1 first still reaches a server on 127.0.0.1', async () => {
    const both = pinnedFetch([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const reply = await both(`http://${NAME}:${String(port)}/v1/x`, { method: 'POST', body: 'x' });
    expect(await reply.json()).toEqual({ echoed: 'x' });
    // Addresses where nothing listens: the call fails; it does not fall back to asking the name.
    await expect(pinnedFetch([{ address: '::1', family: 6 }])(`http://localhost:${String(port)}/v1/x`, { method: 'POST', body: 'x' })).rejects.toThrow();
    expect(() => pinnedFetch([])).toThrow('needs an address');
  });

  it('hands a redirect back as it is, and never goes where it points', async () => {
    const reply = await pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/redirect`, { method: 'POST', body: '{}', redirect: 'manual' });
    expect(reply.status).toBe(302);
    expect(reply.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data/');
    expect(seen).toHaveLength(1);
  });

  it('ends with the caller’s signal, and refuses what it does not send', async () => {
    const controller = new AbortController();
    const pending = pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/hang`, { method: 'POST', body: '{}', signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    await expect(pinnedFetch([{ address: '127.0.0.1', family: 4 }])('ftp://x/y')).rejects.toThrow('Only http and https');
    await expect(pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/`, { method: 'POST', body: new Uint8Array([1]) })).rejects.toThrow('Only a text body');
  });
});

describe('a checked address is the address that is called', () => {
  it('pins a name the system resolved, and calls it there', async () => {
    const url = `http://localhost:${String(port)}/v1/x`;
    expect(checkedFetch(url)).toBeNull();
    await resolveAndCheck(url);
    const pinned = checkedFetch(url);
    expect(pinned).not.toBeNull();
    // Another path on the same name and port is the same pin; another port is not.
    expect(checkedFetch(`http://LOCALHOST:${String(port)}/other`)).not.toBeNull();
    expect(checkedFetch(`http://localhost:${String(port + 1)}/v1/x`)).toBeNull();
    // `localhost` is this machine by every address it has: the pinned call arrives at the one that listens.
    const reply = await (pinned as typeof fetch)(url, { method: 'POST', body: 'x' });
    expect(await reply.json()).toEqual({ echoed: 'x' });
  });

  it('pins nothing for an address written as numbers, for a resolver handed in, or for a name that was refused', async () => {
    await resolveAndCheck(`http://127.0.0.1:${String(port)}/`);
    expect(checkedFetch(`http://127.0.0.1:${String(port)}/`)).toBeNull();
    await resolveAndCheck('https://models.example.test/v1', { resolve: () => Promise.resolve(['203.0.113.7']) });
    expect(checkedFetch('https://models.example.test/v1')).toBeNull();
    await expect(resolveAndCheck('http://localhost:9/', { blockPrivate: true })).rejects.toThrow('own network');
    expect(checkedFetch('http://localhost:9/')).toBeNull();
    expect(checkedFetch('not an address')).toBeNull();
  });

  it('a name that passed and is then refused is no longer called anywhere', async () => {
    const url = 'http://localhost:9/v1';
    await resolveAndCheck(url);
    expect(checkedFetch(url)).not.toBeNull();
    await expect(resolveAndCheck(url, { blockPrivate: true })).rejects.toThrow();
    expect(checkedFetch(url)).toBeNull();
  });
});
