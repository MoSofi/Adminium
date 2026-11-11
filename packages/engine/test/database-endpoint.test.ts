// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DSN read into the fields a driver is built from. The parameters come back
 * as written; which of them reach a driver is each adapter's call.
 */
import { describe, expect, it } from 'vitest';

import { databaseEndpointFromDsn } from '../src/adapter.js';

describe('databaseEndpointFromDsn', () => {
  it('reads the host, port, database, user, password and parameters', () => {
    expect(databaseEndpointFromDsn('postgres://ava:s%40cret@db.acme.io:6543/prod?sslmode=require&host=10.0.0.5')).toEqual({
      host: 'db.acme.io',
      port: 6543,
      database: 'prod',
      user: 'ava',
      password: 's@cret',
      params: { sslmode: 'require', host: '10.0.0.5' },
    });
  });

  it('drops IPv6 brackets and leaves what is absent null', () => {
    expect(databaseEndpointFromDsn('mysql://[::1]')).toEqual({ host: '::1', port: null, database: null, user: null, password: null, params: {} });
    expect(databaseEndpointFromDsn('postgres:///shop')?.host).toBe('');
  });

  it('decodes the database as each driver does', () => {
    expect(databaseEndpointFromDsn('postgres://h/a%2Fb', 'uri')?.database).toBe('a%2Fb');
    expect(databaseEndpointFromDsn('mysql://h/a%2Fb')?.database).toBe('a/b');
    // A broken escape stays as written rather than failing the read.
    expect(databaseEndpointFromDsn('mysql://u%E0@h/a%E0')).toMatchObject({ user: 'u%E0', database: 'a%E0' });
  });

  it('is null for what is not a URL', () => {
    expect(databaseEndpointFromDsn('host=db port=5432')).toBeNull();
    expect(databaseEndpointFromDsn('')).toBeNull();
  });
});
