// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `mysql2` config for one database, built from fields and never from a
 * connection string.
 *
 * Handed a `uri`, `mysql2` copies every query parameter it does not already
 * know into its config (`socketPath`, `localAddress`, `flags`,
 * `multipleStatements`, `stream`), and `socketPath` outranks the host the
 * server checked. Built from {@link DatabaseEndpoint} fields, a parameter this
 * file does not map never reaches the driver.
 *
 * When the server checked the host's addresses, every connection is opened to
 * those addresses (in the resolver's order, falling back between them as
 * `net.connect` does) and never looks the name up again, so a name whose
 * answer changes after the check cannot move the connection. `host` stays the
 * name: `mysql2` sends it as the TLS server name and checks the certificate
 * against it, and has no setting to do so for a host given as an address.
 */
import net, { isIP, type LookupFunction } from 'node:net';

import { AdapterError, databaseEndpointFromDsn, type ConnectionConfig, type DatabaseEndpoint } from '@adminium/engine/adapter';

export interface MysqlEndpointConfig {
  host: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: string | Record<string, unknown>;
  charset?: string;
  timezone?: string;
  connectTimeout?: number;
  /** Opens each connection to the checked address. */
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

/** The fields of a config: the server's {@link DatabaseEndpoint}, or the adapter's own reading of a DSN. */
export function endpointOf(config: Pick<ConnectionConfig, 'dsn' | 'endpoint'>, what: string): DatabaseEndpoint {
  if (config.endpoint !== undefined) return config.endpoint;
  const endpoint = config.dsn === undefined ? null : databaseEndpointFromDsn(config.dsn, 'component');
  if (endpoint === null) {
    throw new AdapterError('UNKNOWN', `${what} a DSN`, {
      hint: 'pass a mysql:// connection string naming the host and database',
    });
  }
  return endpoint;
}

/**
 * `?ssl=` as `mysql2` reads it (JSON when it parses, else a profile name),
 * held to what cannot change what the connection trusts: a profile name, a
 * boolean, or an object that only switches certificate checking.
 */
function sslFrom(value: string | undefined): MysqlEndpointConfig['ssl'] | boolean | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (typeof parsed === 'boolean') return parsed;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
  const reject = (parsed as Record<string, unknown>)['rejectUnauthorized'];
  return typeof reject === 'boolean' ? { rejectUnauthorized: reject } : {};
}

/** `mysql2` options for one endpoint. */
export function mysqlEndpointConfig(endpoint: DatabaseEndpoint): MysqlEndpointConfig {
  const params = endpoint.params;
  const config: MysqlEndpointConfig = { host: endpoint.host };
  if (endpoint.port !== null) config.port = endpoint.port;
  if (endpoint.database !== null) config.database = endpoint.database;
  if (endpoint.user !== null) config.user = endpoint.user;
  if (endpoint.password !== null) config.password = endpoint.password;
  const ssl = sslFrom(params['ssl']);
  // A bare boolean is what `mysql2` makes of `?ssl=true` and refuses ("SSL profile must be an object"); left as it was.
  if (ssl !== undefined) (config as { ssl?: unknown }).ssl = ssl;
  const charset = params['charset'];
  if (charset !== undefined) config.charset = charset;
  const timezone = params['timezone'];
  if (timezone !== undefined) config.timezone = timezone;
  const connectTimeout = Number(params['connectTimeout']);
  if (params['connectTimeout'] !== undefined && Number.isFinite(connectTimeout)) config.connectTimeout = connectTimeout;
  const addresses = endpoint.addresses;
  if (addresses !== undefined) {
    const host = endpoint.host;
    const port = endpoint.port ?? 3306;
    const lookup = pinnedLookup(addresses);
    // What `mysql2` does for its own socket: no Nagle, keep-alive once connected.
    config.stream = () => {
      const socket = net.connect({ host, port, lookup });
      socket.setNoDelay(true);
      socket.once('connect', () => socket.setKeepAlive(true, 0));
      return socket;
    };
  }
  return config;
}
