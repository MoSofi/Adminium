// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the meta store's drivers reach its database: at checked addresses only.
 *
 * The boot checks every host the meta store's address names
 * (`guardBootMetaUrl`, `meta/store.ts`). Left to itself, `pg` or `mysql2` would then look
 * the name up again when it connects, so a name whose answer changes between
 * the check and the connection (DNS rebinding) would reach an address the
 * check refused. So each connection is opened through a lookup of ours, as a
 * source pool's is (`connections/dsn.ts` {@link addressRechecker}): the first
 * connections use the addresses the boot checked, and after a few seconds the
 * name is looked up and checked again, so a database whose name moves (a
 * failover) is followed and a name moved to a cloud metadata address is
 * refused on the next connection.
 *
 * Only the socket is ours. The address string still goes to the driver as it
 * is, so every parameter an operator set (`sslrootcert`, `sslmode`, a socket
 * path) keeps what it did, and the host stays the name: the drivers send it as
 * the TLS server name and check the certificate against it.
 *
 * The rule is the boot's: cloud metadata is refused, this machine and the
 * server's own network are not, and a name that does not resolve fails that
 * connection with the driver's usual `ENOTFOUND` (a database container that
 * starts a moment later is reached by the next one).
 */
import net, { isIP, type LookupFunction } from 'node:net';

import { addressRechecker } from '../connections/dsn.js';
import { canonicalHost, type HostLookup, type HostPolicy } from '../net/address-guard.js';

/** Each host the boot checked (as {@link canonicalHost} writes it), with the addresses that passed. */
export type CheckedMetaHosts = ReadonlyMap<string, readonly string[]>;

/**
 * A `lookup` for `net.connect` that answers every name with addresses checked
 * under the boot's rule, whatever the name answers now. One re-check per name,
 * shared by every connection to it.
 */
export function metaDialLookup(checked: CheckedMetaHosts, lookup?: HostLookup): LookupFunction {
  const policy: HostPolicy = { failClosed: false, lookup };
  const recheckers = new Map<string, () => Promise<readonly string[]>>();
  const addressesFor = (name: string): Promise<readonly string[]> => {
    const host = canonicalHost(name);
    let recheck = recheckers.get(host);
    if (recheck === undefined) {
      // A name the boot did not see (a driver's default host) is checked the first time it is dialled.
      recheck = addressRechecker(host, policy, checked.get(host) ?? []);
      recheckers.set(host, recheck);
    }
    return recheck();
  };
  return (name, options, callback) => {
    addressesFor(name).then(
      (addresses) => {
        const entries = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
        const [first] = entries;
        if (first === undefined) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND', hostname: name }), '', 4);
          return;
        }
        if (options.all === true) callback(null, entries);
        else callback(null, first.address, first.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), '', 4),
    );
  };
}

/**
 * The `stream` for a `pg` pool: a socket whose `connect(port, host)`, the call
 * `pg` makes, dials through `lookup`. A host given as an address is dialled as
 * written (it was checked as written, and `net` looks nothing up for it). A
 * socket path (`connect(path)`) is dialled as it was.
 */
export function pgMetaStream(lookup: LookupFunction): () => net.Socket {
  return () => {
    const socket = new net.Socket();
    const connect = socket.connect.bind(socket) as (options: net.TcpSocketConnectOpts | net.IpcSocketConnectOpts) => net.Socket;
    (socket as { connect: (port: number | string, host?: string) => net.Socket }).connect = (port, host) =>
      typeof port === 'string' && host === undefined ? connect({ path: port }) : connect({ port: Number(port), host, lookup });
    return socket;
  };
}

/** What `mysql2` hands a `stream` factory: the connection's settings, the address string's parameters applied. */
interface MysqlStreamOptions {
  config: {
    host?: string | undefined;
    port?: number | undefined;
    socketPath?: string | undefined;
    enableKeepAlive?: boolean | undefined;
    keepAliveInitialDelay?: number | undefined;
  };
}

/**
 * The `stream` for a `mysql2` pool: the socket `mysql2` would open for itself
 * (a socket path as given, else the host and port with no Nagle and its
 * keep-alive setting), with the host dialled through `lookup`.
 */
export function mysqlMetaStream(lookup: LookupFunction): (opts: MysqlStreamOptions) => net.Socket {
  return ({ config }) => {
    if (config.socketPath !== undefined && config.socketPath !== '') return net.connect(config.socketPath);
    const socket = net.connect({ host: config.host ?? 'localhost', port: config.port ?? 3306, lookup });
    if (config.enableKeepAlive === true) socket.once('connect', () => socket.setKeepAlive(true, config.keepAliveInitialDelay));
    socket.setNoDelay(true);
    return socket;
  };
}
