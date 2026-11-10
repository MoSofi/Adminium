// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The DSN guard decides on the host the DRIVER will dial, not on the one the
 * URL shows.
 *
 * Both drivers copy query parameters into their config, and some outrank the
 * URL: `pg` dials `?host=` and `?port=`, and reads `sslrootcert` from disk;
 * `mysql2` dials `?socketPath=`. Both percent-decode the host. So each case
 * below is checked against the real driver parsers as well as the guard:
 * first that the driver really would go somewhere else (the hole), then that
 * the guard refuses the string.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guardDsn, maskDsn, parseDsn } from '../src/connections/dsn.js';

const require = createRequire(import.meta.url);
const pgParse = (createRequire(require.resolve('pg')) as NodeRequire)('pg-connection-string').parse as (
  dsn: string,
) => { host?: string | null; port?: string | number | null };
const mysqlConfig = require(join(dirname(require.resolve('mysql2')), 'lib', 'connection_config.js')) as {
  parseUrl: (dsn: string) => Record<string, unknown>;
};

const PROD = { blockLoopback: true } as const;

describe('a query parameter cannot replace the host the guard checked', () => {
  it('pg dials ?host= and ?port= over the URL, and the guard refuses both', () => {
    const dsn = 'postgres://u:p@db.example.com:5432/app?host=127.0.0.1';
    expect(pgParse(dsn).host).toBe('127.0.0.1'); // the hole
    expect(() => guardDsn(dsn)).toThrow('"host" parameter is not allowed');
    expect(() => guardDsn('postgres://u@db.example.com/app?host=169.254.169.254&port=80')).toThrow('"host"');
    expect(() => guardDsn('postgres://u@db.example.com/app?port=6379')).toThrow('"port"');
    expect(() => guardDsn('postgres://u@db.example.com/app?hostaddr=10.0.0.5')).toThrow('"hostaddr"');
  });

  it('refuses a unix socket named through ?host=', () => {
    const dsn = 'postgres://u@db.example.com/app?host=/var/run/postgresql';
    expect(pgParse(dsn).host).toBe('/var/run/postgresql');
    expect(() => guardDsn(dsn)).toThrow('"host"');
  });

  it('refuses the parameters pg reads from disk', () => {
    for (const name of ['sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) {
      expect(() => guardDsn(`postgres://u@db.example.com/app?sslmode=require&${name}=/dev/zero`)).toThrow(`"${name}"`);
    }
  });

  it('refuses a parameter name spelled with percent-escapes, as the driver decodes it', () => {
    const dsn = 'postgres://u@db.example.com/app?ho%73t=127.0.0.1';
    expect(pgParse(dsn).host).toBe('127.0.0.1');
    expect(() => guardDsn(dsn)).toThrow('"host"');
  });

  it('mysql2 dials ?socketPath= and takes flags, and the guard refuses them', () => {
    const dsn = 'mysql://u@db.example.com:3306/app?socketPath=/tmp/mysql.sock';
    expect(mysqlConfig.parseUrl(dsn)['socketPath']).toBe('/tmp/mysql.sock'); // the hole
    expect(() => guardDsn(dsn)).toThrow('"socketPath"');
    for (const name of ['localAddress', 'flags', 'multipleStatements', 'stream', 'host', 'port']) {
      expect(() => guardDsn(`mysql://u@db.example.com/app?${name}=x`)).toThrow(`"${name}"`);
    }
  });

  it('lets mysql ?ssl= switch certificate checking only', () => {
    expect(() => guardDsn('mysql://u@db.example.com/app?ssl={"rejectUnauthorized":true}')).not.toThrow();
    expect(() => guardDsn('mysql://u@db.example.com/app?ssl=Amazon%20RDS')).not.toThrow();
    expect(() => guardDsn('mysql://u@db.example.com/app?ssl={"ca":"x"}')).toThrow('"ssl" parameter has a value');
    expect(() => guardDsn('mysql://u@db.example.com/app?ssl=[1]')).toThrow('"ssl" parameter has a value');
  });

  it('refuses at parse too, so the seed and project databases refuse before anything is stored', () => {
    expect(() => parseDsn('postgres://u@db.example.com/app?host=127.0.0.1')).toThrow('"host"');
    expect(() => parseDsn('mysql://u@db.example.com/app?socketPath=/tmp/x')).toThrow('"socketPath"');
  });

  it('names the parameter but never echoes its value', () => {
    try {
      guardDsn('postgres://u@db.example.com/app?password=hunter2');
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).toContain('"password"');
      expect(JSON.stringify(error)).not.toContain('hunter2');
    }
  });
});

describe('the host is read the way the drivers read it', () => {
  it('refuses a percent-encoded host, which both drivers decode before dialling', () => {
    const metadata = 'postgres://u@%31%36%39.254.169.254/app';
    expect(pgParse(metadata).host).toBe('169.254.169.254'); // the hole
    expect(() => guardDsn(metadata)).toThrow('percent-encoded');

    const socket = 'postgres://u@%2Fvar%2Frun%2Fpostgresql/app';
    expect(pgParse(socket).host).toBe('/var/run/postgresql');
    expect(() => guardDsn(socket)).toThrow('percent-encoded');

    const mysqlLoopback = 'mysql://u@%31%32%37.0.0.1/app';
    expect(mysqlConfig.parseUrl(mysqlLoopback)['host']).toBe('127.0.0.1');
    expect(() => guardDsn(mysqlLoopback, PROD)).toThrow('percent-encoded');
  });

  it('refuses a DSN with no host in production, where the driver would dial this machine', () => {
    expect(() => guardDsn('postgres:///app', PROD)).toThrow('names no host');
    expect(() => guardDsn('postgres:app', PROD)).toThrow('names no host');
    expect(() => guardDsn('postgres:///app')).not.toThrow(); // development: a local socket is normal
  });

  it('agrees with both drivers on the host of every DSN it accepts', () => {
    const accepted = [
      'postgres://u:p@ep-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      'postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1',
      'postgres://u@db.example.com:5432/app?options=-c%20search_path%3Dshop&application_name=adminium',
      'postgres://u@db.example.com/app?schema=public&ssl=true&connect_timeout=10&search_path=shop',
      'postgres://u@[2001:db8::1]:5432/app',
    ];
    for (const dsn of accepted) {
      const guarded = guardDsn(dsn, PROD);
      expect(pgParse(dsn).host, dsn).toBe(guarded.host);
    }
    const mysql = [
      'mysql://USER:PASSWORD@aws.connect.psdb.cloud/mydb?ssl={"rejectUnauthorized":true}',
      'mysql://u@db.example.com:3306/shop?charset=utf8mb4&timezone=Z&connectTimeout=5000',
    ];
    for (const dsn of mysql) {
      const guarded = guardDsn(dsn, PROD);
      expect(mysqlConfig.parseUrl(dsn)['host'], dsn).toBe(guarded.host);
      expect(mysqlConfig.parseUrl(dsn)['socketPath'], dsn).toBeUndefined();
    }
  });

  it('still accepts the provider strings the connect form offers', () => {
    expect(() => guardDsn('postgres://USER:PASSWORD@ep-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require', PROD)).not.toThrow();
    expect(() => guardDsn('postgres://u@db.example.com/app?sslmode=verify-full', PROD)).not.toThrow();
    expect(() => guardDsn('postgres://u@db.example.com/app?sslmode=sideways', PROD)).toThrow('"sslmode" parameter has a value');
  });

  it('leaves SQLite paths alone', () => {
    expect(guardDsn('sqlite:/data/app.db?mode=ro').file).toBe('/data/app.db?mode=ro');
  });
});

describe('masking a stored string the guard now refuses', () => {
  it('still masks it, so the connections list can show what to fix', () => {
    expect(maskDsn('postgres://ava:secret@db.example.com:5432/prod?sslrootcert=/etc/ca.pem')).toBe(
      'postgres://ava@db.example.com:5432/prod',
    );
  });
});
