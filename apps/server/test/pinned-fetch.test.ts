// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A model's address is checked, and then called at the address that was
 * checked: a name whose answer changes between the two gains nothing.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { checkedFetch, forgetCheckedAddresses, resolveAndCheck } from '../src/llm/outbound.js';
import { outboundFetch } from '../src/net/outbound-check.js';
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

  it('ends with the caller’s signal, and refuses a body it does not send (a Blob, a form)', async () => {
    const controller = new AbortController();
    const pending = pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/hang`, { method: 'POST', body: '{}', signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    await expect(pinnedFetch([{ address: '127.0.0.1', family: 4 }])('ftp://x/y')).rejects.toThrow('Only http and https');
    await expect(pinnedFetch([{ address: '127.0.0.1', family: 4 }])(`http://${NAME}:${String(port)}/`, { method: 'POST', body: new Blob(['x']) })).rejects.toThrow('Only a text, bytes or stream body');
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

  it('pins nothing for an address written as numbers or for a resolver handed in', async () => {
    await resolveAndCheck(`http://127.0.0.1:${String(port)}/`);
    expect(checkedFetch(`http://127.0.0.1:${String(port)}/`)).toBeNull();
    await resolveAndCheck('https://models.example.test/v1', { resolve: () => Promise.resolve(['203.0.113.7']) });
    expect(checkedFetch('https://models.example.test/v1')).toBeNull();
    expect(checkedFetch('not an address')).toBeNull();
  });

  // No pin is not "no check": with none, the platform's own fetch would look the name up again and call what it then gave.
  it('a name that was refused is not called at all, whether or not it passed before', async () => {
    await expect(resolveAndCheck('http://localhost:9/', { blockPrivate: true })).rejects.toThrow('own network');
    await expect((checkedFetch('http://localhost:9/') as typeof fetch)('http://localhost:9/')).rejects.toThrow('not checked');
    const url = `http://localhost:${String(port)}/v1`;
    await resolveAndCheck(url);
    expect(await (await (checkedFetch(url) as typeof fetch)(url, { method: 'POST', body: 'x' })).json()).toEqual({ echoed: 'x' });
    await expect(resolveAndCheck(url, { blockPrivate: true })).rejects.toThrow();
    seen = [];
    await expect((checkedFetch(url) as typeof fetch)(url)).rejects.toThrow('not checked');
    expect(seen).toEqual([]);
    // The next check that passes opens it again.
    await resolveAndCheck(url);
    expect((await (checkedFetch(url) as typeof fetch)(url, { method: 'POST', body: 'y' })).status).toBe(200);
  });

  it('a name that gave no address is not left to a later lookup', async () => {
    const url = 'http://no-such-name.invalid:8080/v1';
    // Let through, as before: the request fails on its own. It fails here, and not at whatever the name answers next.
    await resolveAndCheck(url);
    await expect((checkedFetch(url) as typeof fetch)(url)).rejects.toThrow('fetch failed');
  });

  it('keeps the checked address while the name is checked again', async () => {
    const url = `http://localhost:${String(port)}/v1`;
    await resolveAndCheck(url);
    const again = resolveAndCheck(url);
    // A turn already on its way asks for its fetch now, before the second lookup has answered.
    expect(await (await (checkedFetch(url) as typeof fetch)(url, { method: 'POST', body: 'z' })).json()).toEqual({ echoed: 'z' });
    await again;
  });

  it('closes the oldest name when there are too many, and never hands it to the platform', async () => {
    const first = `http://localhost:${String(port)}/v1`;
    await resolveAndCheck(first);
    for (let n = 1; n <= 200; n += 1) await resolveAndCheck(`http://localhost:${String(20000 + n)}/v1`);
    await expect((checkedFetch(first) as typeof fetch)(first)).rejects.toThrow('not checked');
  });
});

describe('storage requests keep their connections, and check the name again', () => {
  let keep: Server;
  let keepPort: number;
  let connections: number;
  beforeAll(async () => {
    keep = createServer((req, res) => {
      void read(req).then(() => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    keep.on('connection', () => {
      connections += 1;
    });
    // Every address, both families: an answer that moves from 127.0.0.1 to ::1 still reaches it.
    await new Promise<void>((resolve) => keep.listen(0, '::', resolve));
    keepPort = (keep.address() as AddressInfo).port;
  });
  afterAll(async () => {
    keep.closeAllConnections();
    await new Promise<void>((resolve) => keep.close(() => resolve()));
  });

  function rig(answers: string[][]) {
    let clock = 1_000;
    const asked: string[] = [];
    const fetcher = outboundFetch(
      {
        blockLoopback: false,
        lookup: async (host) => {
          asked.push(host);
          return Promise.resolve(answers[Math.min(asked.length - 1, answers.length - 1)] ?? []);
        },
      },
      { recheckMs: 60_000, now: () => clock },
    );
    return {
      fetcher,
      asked,
      later: (ms: number) => {
        clock += ms;
      },
      url: (path: string) => `http://files.storage.test:${String(keepPort)}${path}`,
    };
  }

  it('two requests in a row go over one connection, after one lookup', async () => {
    connections = 0;
    const { fetcher, asked, url } = rig([['127.0.0.1']]);
    expect(await (await fetcher(url('/a'))).text()).toBe('ok');
    expect(await (await fetcher(url('/b'))).text()).toBe('ok');
    expect(connections).toBe(1);
    expect(asked).toEqual(['files.storage.test']);
  });

  it('thirty at once look the name up once', async () => {
    const { fetcher, asked, url } = rig([['127.0.0.1']]);
    const answers = await Promise.all(Array.from({ length: 30 }, async (_, i) => (await fetcher(url(`/t${String(i)}`))).text()));
    expect(answers.every((text) => text === 'ok')).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('after the interval the name is checked again: the same answer keeps the connection, a new one gets its own', async () => {
    connections = 0;
    const { fetcher, asked, later, url } = rig([['127.0.0.1'], ['127.0.0.1'], ['::1']]);
    await (await fetcher(url('/1'))).text();
    later(59_000);
    await (await fetcher(url('/2'))).text();
    expect(asked).toHaveLength(1);
    later(2_000);
    await (await fetcher(url('/3'))).text();
    expect(asked).toHaveLength(2);
    expect(connections).toBe(1);
    later(61_000);
    await (await fetcher(url('/4'))).text();
    expect(asked).toHaveLength(3);
    expect(connections).toBe(2);
  });

  it('a name that moves to the metadata address is refused before anything is reused', async () => {
    connections = 0;
    const { fetcher, later, url } = rig([['127.0.0.1'], ['169.254.169.254']]);
    await (await fetcher(url('/1'))).text();
    later(61_000);
    await expect(fetcher(url('/2'))).rejects.toThrow('blocked address range');
    // Refused again on the next request, within the interval too: nothing of the old answer is kept.
    await expect(fetcher(url('/3'))).rejects.toThrow('blocked address range');
    expect(connections).toBe(1);
  });
});
