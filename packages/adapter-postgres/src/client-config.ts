// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `pg` config for one database, built from fields and never from a
 * connection string.
 *
 * Handed a `connectionString`, `pg` copies every query parameter into its
 * config and lets them outrank the URL: `?host=` and `?port=` replace the host
 * the server checked (a unix socket too), and `sslcert`, `sslkey` and
 * `sslrootcert` are read from disk. Built from {@link DatabaseEndpoint} fields,
 * a parameter this file does not map never reaches the driver.
 *
 * When the server checked the host's addresses, every connection is opened to
 * those addresses (in the resolver's order, falling back between them as
 * `net.connect` does) and never looks the name up again, so a name whose
 * answer changes after the check cannot move the connection. The host stays
 * the name: `pg` sends it as the TLS server name and checks the certificate
 * against it, and a provider that routes by server name (Neon) sees its own.
 */
import net, { isIP, type LookupFunction } from 'node:net';

import { AdapterError, databaseEndpointFromDsn, type ConnectionConfig, type DatabaseEndpoint } from '@adminium/engine/adapter';

/** What a pool needs to reach the database, minus pool size and startup options. */
export interface PgEndpointConfig {
  host: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;
  sslnegotiation?: string;
  application_name?: string;
  fallback_application_name?: string;
  /** A socket for each connection that can reach only the checked addresses. */
  stream?: () => net.Socket;
}

/** A `lookup` that answers with the checked addresses, whatever the name says now. */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
  return (_name, options, callback) => {
    const [first] = entries;
    if (first === undefined) {
      callback(Object.assign(new Error('no checked address to connect to'), { code: 'ENOTFOUND' }), '', 4);
      return;
    }
    if (options.all === true) callback(null, entries);
    else callback(null, first.address, first.family);
  };
}

/**
 * A socket whose `connect(port, host)` (the call `pg` makes) reaches only the
 * checked addresses. A host written as an address is dialled as it is: it was
 * checked as written, and `net` looks nothing up for it.
 */
export function pinnedSocket(addresses: readonly string[]): net.Socket {
  const socket = new net.Socket();
  const lookup = pinnedLookup(addresses);
  const connect = socket.connect.bind(socket) as (options: net.TcpSocketConnectOpts) => net.Socket;
  (socket as { connect: (port: number, host: string) => net.Socket }).connect = (port, host) => connect({ port, host, lookup });
  return socket;
}

/** TLS as `pg-connection-string` reads `ssl`, `sslmode`, `sslnegotiation` and `uselibpqcompat`, without its certificate files. */
function sslFrom(params: Readonly<Record<string, string>>): PgEndpointConfig['ssl'] {
  let ssl: PgEndpointConfig['ssl'];
  const flag = params['ssl'];
  if (flag === 'true' || flag === '1') ssl = true;
  // `pg` reads the string "false" as switched on; it can only have meant off.
  if (flag === '0' || flag === 'false') ssl = false;
  if (flag === 'no-verify') ssl = { rejectUnauthorized: false };
  const mode = params['sslmode'];
  if (mode !== undefined) ssl = {};
  if (params['sslnegotiation'] === 'direct' && ssl === undefined) ssl = true;
  if (params['uselibpqcompat'] === 'true') {
    if (mode === 'disable') return false;
    if (mode === 'prefer' || mode === 'require') return { rejectUnauthorized: false };
    if (mode === 'verify-ca') {
      throw new AdapterError('UNKNOWN', 'sslmode=verify-ca needs a CA file, which a connection string here may not name', {
        hint: 'use sslmode=verify-full, which checks the certificate against the system CAs',
      });
    }
    return ssl;
  }
  if (mode === 'disable') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return ssl;
}

/** The fields of a config: the server's {@link DatabaseEndpoint}, or the adapter's own reading of a DSN. */
export function endpointOf(config: Pick<ConnectionConfig, 'dsn' | 'endpoint'>, what: string): DatabaseEndpoint {
  if (config.endpoint !== undefined) return config.endpoint;
  const endpoint = config.dsn === undefined ? null : databaseEndpointFromDsn(config.dsn, 'uri');
  if (endpoint === null) {
    throw new AdapterError('UNKNOWN', `${what} a DSN`, {
      hint: 'pass a postgres:// connection string with a host; TLS is honored from sslmode',
    });
  }
  return endpoint;
}

/**
 * `pg` options for one endpoint. The `options` parameter is returned apart,
 * because the adapter joins it with its own session settings (see
 * `splitDsnOptions`).
 */
export function pgEndpointConfig(endpoint: DatabaseEndpoint): { config: PgEndpointConfig; options: string | null } {
  const params = endpoint.params;
  const ssl = sslFrom(params);
  const host = endpoint.host;
  const config: PgEndpointConfig = { host };
  if (endpoint.port !== null) config.port = endpoint.port;
  if (endpoint.database !== null) config.database = endpoint.database;
  if (endpoint.user !== null) config.user = endpoint.user;
  if (endpoint.password !== null) config.password = endpoint.password;
  if (ssl !== undefined) config.ssl = ssl;
  const negotiation = params['sslnegotiation'];
  if (negotiation !== undefined) config.sslnegotiation = negotiation;
  const appName = params['application_name'];
  if (appName !== undefined) config.application_name = appName;
  const fallbackName = params['fallback_application_name'];
  if (fallbackName !== undefined) config.fallback_application_name = fallbackName;
  const addresses = endpoint.addresses;
  if (addresses !== undefined) config.stream = () => pinnedSocket(addresses);
  return { config, options: params['options'] ?? null };
}
