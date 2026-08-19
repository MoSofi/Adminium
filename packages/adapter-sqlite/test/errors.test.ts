// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Driver failure → typed `AdapterError` mapping — 05-introspection-engine.md
 * §3. The mapped `code` is the whole UX for failure states (the Studio wizard
 * and the `diagnostics-readout` widget key their remediation copy off it), so
 * the classification is asserted against errors better-sqlite3 and Node
 * ACTUALLY throw — a missing file, a read-only database, a locked database, a
 * file that is not SQLite at all, a dropped table — rather than hand-built
 * objects. The offline block below covers the shapes no driver produces:
 * something thrown that is not an `Error`, and an error that lost its `code`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdapterError } from '@adminium/engine/adapter';

import { toAdapterError } from '../src/errors.js';

import { sqliteDriverAvailable } from './harness.js';

const driverReady = await sqliteDriverAvailable();

/** Run `fn`, returning whatever it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('toAdapterError — non-driver inputs', () => {
  it('passes an AdapterError through untouched', () => {
    const original = new AdapterError('UNSUPPORTED', 'nope');
    expect(toAdapterError(original, 'ignored')).toBe(original);
  });

  it('maps a thrown non-Error, and the detail carries no phantom code', () => {
    const mapped = toAdapterError('kaboom', 'sqlite query failed');
    expect(mapped).toMatchObject({
      code: 'UNKNOWN',
      message: 'sqlite query failed: kaboom',
      detail: 'kaboom',
    });
    expect(mapped.hint).toBeNull(); // UNKNOWN has no remediation copy
  });

  it('classifies by message when the error lost its code', () => {
    // An error that crossed a worker boundary (the 05 §4.3 pool follow-up)
    // arrives as a plain Error: the code is gone, the message is not.
    expect(toAdapterError(new Error('unable to open database file'), 'open')).toMatchObject({
      code: 'HOST_UNREACHABLE',
      detail: 'unable to open database file',
    });
    expect(toAdapterError(new Error('file is not a database'), 'open').code).toBe(
      'HOST_UNREACHABLE',
    );
    expect(toAdapterError(new Error('no such table: orders'), 'query').code).toBe('SCHEMA_DRIFT');
  });

  it('falls back to UNKNOWN for an unrecognized code, keeping it in the detail', () => {
    const mapped = toAdapterError(
      Object.assign(new Error('constraint failed'), { code: 'SQLITE_CONSTRAINT' }),
      'sqlite query failed',
    );
    expect(mapped).toMatchObject({
      code: 'UNKNOWN',
      detail: 'SQLITE_CONSTRAINT: constraint failed',
    });
  });

  it('maps filesystem errnos the same way as driver codes', () => {
    const enoent = thrown(() => readFileSync(join(tmpdir(), 'adminium-does-not-exist-9f3a')));
    expect(toAdapterError(enoent, 'stat failed')).toMatchObject({
      code: 'HOST_UNREACHABLE',
      hint: expect.stringContaining('file path') as string,
    });
  });
});

describe.skipIf(!driverReady)('toAdapterError — real better-sqlite3 failures', () => {
  let dir = '';
  let file = '';

  beforeAll(async () => {
    const { default: Database } = await import('better-sqlite3');
    dir = mkdtempSync(join(tmpdir(), 'adminium-sqlite-errors-'));
    file = join(dir, 'app.db');
    const db = new Database(file);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.close();
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('a missing file is HOST_UNREACHABLE with the "check the path" hint', async () => {
    const { default: Database } = await import('better-sqlite3');
    const error = thrown(() => new Database(join(dir, 'missing.db'), { fileMustExist: true }));
    const mapped = toAdapterError(error, 'sqlite open failed');
    expect(mapped.code).toBe('HOST_UNREACHABLE');
    expect(mapped.detail).toContain('SQLITE_CANTOPEN');
    expect(mapped.hint).toContain('valid SQLite database');
  });

  it('a file that is not a database is HOST_UNREACHABLE, not UNKNOWN', async () => {
    const { default: Database } = await import('better-sqlite3');
    const garbage = join(dir, 'garbage.db');
    writeFileSync(garbage, 'this is plainly not a sqlite file'.repeat(32));
    const error = thrown(() => {
      const db = new Database(garbage);
      db.prepare('SELECT name FROM sqlite_master').all();
    });
    expect(toAdapterError(error, 'sqlite query failed').code).toBe('HOST_UNREACHABLE');
  });

  it('a write against a read-only handle is PERMISSION', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      const error = thrown(() => db.prepare('INSERT INTO t VALUES (1)').run());
      const mapped = toAdapterError(error, 'sqlite query failed');
      expect(mapped.code).toBe('PERMISSION');
      expect(mapped.hint).toContain('file permissions');
    } finally {
      db.close();
    }
  });

  it('a locked database is TIMEOUT — the caller may retry', async () => {
    const { default: Database } = await import('better-sqlite3');
    const holder = new Database(file);
    const waiter = new Database(file);
    waiter.pragma('busy_timeout = 0'); // do not wait: fail immediately
    try {
      holder.exec('BEGIN EXCLUSIVE');
      holder.prepare('INSERT INTO t VALUES (7)').run();
      const error = thrown(() => waiter.prepare('INSERT INTO t VALUES (8)').run());
      const mapped = toAdapterError(error, 'sqlite query failed');
      expect(mapped.code).toBe('TIMEOUT');
      expect(mapped.detail).toContain('SQLITE_BUSY');
      expect(mapped.hint).toContain('retry');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
      waiter.close();
    }
  });

  it.each([
    ['a dropped table', 'SELECT id FROM gone'],
    ['a dropped column', 'SELECT gone FROM t'],
  ])('%s is SCHEMA_DRIFT, so the model can be re-introspected', async (_label, sql) => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      const mapped = toAdapterError(
        thrown(() => db.prepare(sql).all()),
        'sqlite query failed',
      );
      expect(mapped.code).toBe('SCHEMA_DRIFT');
      expect(mapped.cause).toBeDefined();
    } finally {
      db.close();
    }
  });
});
