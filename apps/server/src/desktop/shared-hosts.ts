// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The names a project shared from the desktop app answers to.
 *
 * A shared project listens on every interface, so that a phone on the same
 * network can open it. Listening everywhere is not answering to every name:
 * the server answers to the names the app's "Shared" page shows, and to no
 * other:
 *
 *   <computer>.local:<port>      the computer's own name on the network
 *   <address>:<port>             each address this computer has, on any network
 *   127.0.0.1 / localhost / [::1] this computer itself
 *
 * Any other `Host` is refused before a route is reached, as design mode
 * refuses its own (`designer/design-mode.ts`). It is what stops a web page
 * from reaching the project through DNS rebinding: a page on `evil.example`
 * whose name now points at this computer still sends `Host: evil.example`.
 *
 * The addresses are read again as they change (a laptop joins another
 * network while it shares), not once at the start.
 */
import { hostname as osHostname, networkInterfaces } from 'node:os';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface SharedHostsOptions {
  port: number;
  /** Test seams: the computer's name and its interfaces. */
  hostname?: () => string;
  interfaces?: () => ReturnType<typeof networkInterfaces>;
  now?: () => number;
}

/**
 * A computer's name as other devices on the network ask for it: its first
 * label, lower case, with `.local`. `null` for a name that cannot be one.
 * The desktop app's `main/share.ts` shows the same name; a test there holds
 * the two together.
 */
export function localName(hostname: string): string | null {
  const first = (hostname.split('.')[0] ?? '').trim().toLowerCase();
  if (first === '' || first === 'localhost' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(first)) return null;
  return `${first}.local`;
}

/** Every `host:port` a shared project answers to, lower case. */
export function sharedHosts(port: number, hostname: string, interfaces: ReturnType<typeof networkInterfaces>): Set<string> {
  const at = `:${String(port)}`;
  const hosts = new Set([`127.0.0.1${at}`, `localhost${at}`, `[::1]${at}`]);
  const name = localName(hostname);
  if (name !== null) hosts.add(`${name}${at}`);
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      // Node 18.0 to 18.3 said `4` and `6`; every other release says the words.
      const v4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      // A zone (`fe80::1%en0`) is this computer's name for the interface, never part of what a client sends.
      const address = (entry.address.split('%')[0] ?? '').toLowerCase();
      if (address === '') continue;
      hosts.add(v4 ? `${address}${at}` : `[${address}]${at}`);
    }
  }
  return hosts;
}

/** A `Host` header as it is compared: lower case, without the dot a full name may end with. */
export function normalHost(host: string | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/\.(?=:\d+$)/, '');
}

/** How long a read of the computer's addresses is used for: an address given a moment ago is answered within this. */
const ADDRESSES_MS = 1_000;

export function registerSharedHosts(app: FastifyInstance, opts: SharedHostsOptions): void {
  const now = opts.now ?? Date.now;
  const readName = opts.hostname ?? osHostname;
  const readInterfaces = opts.interfaces ?? networkInterfaces;
  let known: { hosts: Set<string>; at: number } | null = null;
  const read = (): Set<string> => {
    known = { hosts: sharedHosts(opts.port, readName(), readInterfaces()), at: now() };
    return known.hosts;
  };

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = normalHost(request.headers.host);
    const hosts = known !== null && now() - known.at < ADDRESSES_MS ? known.hosts : read();
    if (hosts.has(host)) return undefined;
    // 421: this server does not answer to that name. No body worth reading for a page that should not be here.
    return reply.code(421).header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-store').send('This Adminium answers to its own addresses only.');
  });
}
