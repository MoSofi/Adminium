// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A network database's address as fields, never as a connection string.
 *
 * The drivers read a connection string their own way, and several of its query
 * parameters outrank the host written before the `?` (`pg` dials `?host=`,
 * `mysql2` dials `?socketPath=`). So the adapters build each driver's config
 * from these fields alone, and a parameter they do not map never reaches the
 * driver. The server reads the fields once, after its own parameter
 * allow-list, and may add the address it checked the host at.
 */

export interface DatabaseEndpoint {
  /**
   * The host as written (a name or an address, IPv6 without brackets): the
   * TLS server name and certificate check use it. Empty: the driver's own
   * default host.
   */
  readonly host: string;
  /** Null: the engine's own default port. */
  readonly port: number | null;
  readonly database: string | null;
  readonly user: string | null;
  readonly password: string | null;
  /**
   * The query parameters, as written. Each adapter maps the few it knows
   * (TLS mode, application name, `options`, charset, time zone) and drops the
   * rest.
   */
  readonly params: Readonly<Record<string, string>>;
  /**
   * The addresses the host was checked at, in the order to try them. When
   * set, the driver connects to these and never looks the name up again, so an
   * answer that changes after the check cannot move the connection; the name
   * is still the TLS server name and the name the certificate is checked
   * against.
   */
  readonly addresses?: readonly string[];
}

/**
 * Read a `postgres://` or `mysql://` string into its fields. Null when it is
 * not a URL (a keyword string, a socket path, nothing at all).
 * Percent-escapes in the user, password and database are decoded as each
 * driver decodes them: `pg` decodes the database with `decodeURI`, `mysql2`
 * with `decodeURIComponent`.
 */
export function databaseEndpointFromDsn(dsn: string, databaseDecoding: 'uri' | 'component' = 'component'): DatabaseEndpoint | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const params: Record<string, string> = {};
  for (const [name, value] of url.searchParams) params[name] = value;
  const path = url.pathname.replace(/^\//, '');
  const decode = (text: string): string => {
    try {
      return databaseDecoding === 'uri' ? decodeURI(text) : decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  const decodePart = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  return {
    host: decodePart(host),
    port: url.port.length > 0 ? Number(url.port) : null,
    database: path.length > 0 ? decode(path) : null,
    user: url.username.length > 0 ? decodePart(url.username) : null,
    password: url.password.length > 0 ? decodePart(url.password) : null,
    params,
  };
}
