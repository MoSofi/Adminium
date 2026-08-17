// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `main/lan.ts` — the facts §8.3's panel and toggle are built on.
 *
 * The interesting cases here are the ones a developer's laptop never produces,
 * which is the whole reason `os.networkInterfaces` is injectable: a Docker
 * bridge, a VPN's IPv6-only tunnel, a loopback alias, a machine with the cable
 * out. Each one below is an interface list that has actually shipped on somebody
 * else's machine.
 */
import net from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAN_PORT,
  enumerateLanUrls,
  lanShareUrls,
  probeBindable,
  suggestNextPort,
  WILDCARD_HOST,
  type NetworkInterfaceLike,
} from './lan.js';

const lo: NetworkInterfaceLike = { address: '127.0.0.1', family: 'IPv4', internal: true };
const wifi: NetworkInterfaceLike = { address: '192.168.1.9', family: 'IPv4', internal: false };

describe('enumerateLanUrls (§8.3)', () => {
  it('lists http://<LAN-IPv4>:<port> for each non-internal interface', () => {
    const urls = enumerateLanUrls(DEFAULT_LAN_PORT, () => ({ en0: [wifi] }));
    expect(urls).toEqual([
      { interfaceName: 'en0', address: '192.168.1.9', url: 'http://192.168.1.9:4600' },
    ]);
  });

  it('SKIPS internal interfaces — the panel must not offer 127.0.0.1 to other devices', () => {
    // The precise failure this prevents: loopback is the address that WORKS when
    // the admin tests it on this machine and fails for everyone they send it to.
    const urls = enumerateLanUrls(4600, () => ({ lo0: [lo], en0: [wifi] }));
    expect(urls.map((entry) => entry.url)).toEqual(['http://192.168.1.9:4600']);
  });

  it('skips a non-internal IPv6 address: §8.3 says IPv4, and fe80:: is not typeable elsewhere', () => {
    const urls = enumerateLanUrls(4600, () => ({
      en0: [{ address: 'fe80::1c2b:3f4a:5d6e:7f80', family: 'IPv6', internal: false }, wifi],
    }));
    expect(urls.map((entry) => entry.url)).toEqual(['http://192.168.1.9:4600']);
  });

  it('accepts the numeric `family` some Node runtimes report', () => {
    // A strict === 'IPv4' yields an EMPTY list on the wrong runtime, which the
    // panel renders as "no network" rather than as the bug it is.
    const urls = enumerateLanUrls(4600, () => ({ en0: [{ ...wifi, family: 4 }] }));
    expect(urls.map((entry) => entry.url)).toEqual(['http://192.168.1.9:4600']);
  });

  it('is stable across polls — a copy button must not move under the cursor', () => {
    const shuffled = () => ({
      utun3: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
      en0: [wifi],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    });
    expect(enumerateLanUrls(4600, shuffled).map((entry) => entry.interfaceName)).toEqual([
      'docker0',
      'en0',
      'utun3',
    ]);
  });

  it('returns nothing when the machine is off the network — sharing with no address', () => {
    expect(enumerateLanUrls(4600, () => ({ lo0: [lo] }))).toEqual([]);
  });

  it('tolerates an interface whose entry list is absent', () => {
    expect(enumerateLanUrls(4600, () => ({ en0: undefined, en1: [wifi] }))).toHaveLength(1);
  });

  it('lanShareUrls flattens to the string[] the §4 bridge carries', () => {
    expect(lanShareUrls(4600, () => ({ lo0: [lo], en0: [wifi] }))).toEqual([
      'http://192.168.1.9:4600',
    ]);
  });
});

describe('suggestNextPort (§8.3 "Try 4601")', () => {
  it('suggests the next port up', () => {
    expect(suggestNextPort(4600)).toBe(4601);
  });

  it('has nothing to suggest at the top of the range', () => {
    expect(suggestNextPort(65535)).toBeNull();
  });
});

describe('probeBindable (§8.3 collision pre-flight)', () => {
  it('reports a free port bindable', async () => {
    await expect(probeBindable('127.0.0.1', 0)).resolves.toEqual({ ok: true });
  });

  it('releases the port it probed, so the child can take it', async () => {
    // The bug this pins: resolving before `close()` leaves the probe's own
    // socket holding the port, and the restart it green-lit then fails with
    // EADDRINUSE against us.
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const { port } = address;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    await expect(probeBindable('127.0.0.1', port)).resolves.toEqual({ ok: true });
    // Bindable a second time ⇒ the first probe let go.
    await expect(probeBindable('127.0.0.1', port)).resolves.toEqual({ ok: true });
  });

  it('reports `in-use` for a port something else holds — §8.3\'s collision', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    try {
      await expect(probeBindable('127.0.0.1', address.port)).resolves.toEqual({
        ok: false,
        reason: 'in-use',
      });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  it('reports `refused` rather than hanging when listen throws synchronously', async () => {
    // An out-of-range port never reaches the `error` event, so a promise that
    // only settles from listeners would hang the settings form forever.
    const result = await probeBindable('127.0.0.1', 999_999);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('refused');
  });

  it('maps a non-EADDRINUSE error to `refused`, carrying the OS message', async () => {
    const result = await probeBindable(WILDCARD_HOST, 4600, {
      createServer: () => {
        const fake = new net.Server();
        // EACCES is the privileged-port case: real, and NOT a collision — "Try
        // 4601" cannot help, because 4601 is privileged too if 4600 was.
        queueMicrotask(() => {
          const error: NodeJS.ErrnoException = new Error('listen EACCES: permission denied');
          error.code = 'EACCES';
          fake.emit('error', error);
        });
        return fake;
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'refused',
      message: 'listen EACCES: permission denied',
    });
  });
});
