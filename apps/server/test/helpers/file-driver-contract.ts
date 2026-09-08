// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `describeFileDriver` — the driver contract, run identically against every
 * implementation (37-files-and-storage.md D30, 37-T04/T05/T06).
 *
 * WHY ONE SUITE AND NOT THREE. Everything above the driver interface — the
 * store facade, the routes, the retention sweep, the migrate job — is written
 * once. "The same e2e passes against three drivers" is an acceptance criterion
 * (§6 item 2), and it can only be a criterion if the drivers are held to one
 * definition of correct. Three hand-written suites would drift, and the leg
 * that drifts is always the one nobody runs locally.
 *
 * SKIPPED IS NOT PASSED. A driver whose target is not configured prints its
 * skip BY NAME (the mysql lesson): a suite that silently vanishes reads as
 * green in exactly the situation where it proves nothing.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileNotFoundError, type FileDriver, type PutSource } from '../../src/files/drivers/driver.js';

export interface DriverHarness {
  driver: FileDriver;
  /** Called after each test file's suite; closes stubs, drops temp roots. */
  teardown?: () => Promise<void>;
}

export interface DescribeDriverOptions {
  /**
   * Why this driver's leg is not running, when it is not. Present ⇒ skipped,
   * and the reason appears in the test name so a CI log says so out loud.
   */
  skip?: string | undefined;
  /** `local` keys must be bare ids; the remote drivers get dated paths. */
  keyStyle: 'id' | 'dated';
}

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

export function describeFileDriver(
  name: string,
  make: () => Promise<DriverHarness>,
  opts: DescribeDriverOptions,
): void {
  const title = opts.skip === undefined ? `file driver: ${name}` : `file driver: ${name} — SKIPPED (${opts.skip})`;

  describe.skipIf(opts.skip !== undefined)(title, () => {
    let harness: DriverHarness;
    let driver: FileDriver;
    let spoolDir: string;
    const written: string[] = [];

    /** Spool a payload the way the real upload path does, then hand it over. */
    async function put(payload: Buffer, over: Partial<PutSource> = {}, keyOver?: string): Promise<string> {
      const id = `file_${randomBytes(13).toString('hex').toUpperCase().replace(/[ILOU]/g, '0').slice(0, 26)}`;
      const key = keyOver ?? driver.keyFor({ id, kind: 'upload', filename: over.mime === 'text/csv' ? 'rows.csv' : 'doc.pdf', createdAt: Date.UTC(2026, 8, 4) });
      const path = join(spoolDir, `spool-${id}`);
      await writeFile(path, payload);
      await driver.put(key, {
        path,
        sizeBytes: payload.byteLength,
        mime: 'application/pdf',
        sha256: createHash('sha256').update(payload).digest('hex'),
        ...over,
      });
      written.push(key);
      return key;
    }

    beforeAll(async () => {
      harness = await make();
      driver = harness.driver;
      spoolDir = await mkdtemp(join(tmpdir(), 'adminium-driver-'));
    });

    afterAll(async () => {
      for (const key of written) await driver.remove(key).catch(() => undefined);
      await rm(spoolDir, { recursive: true, force: true });
      await harness.teardown?.();
    });

    it('mints a key in this driver’s layout', () => {
      const key = driver.keyFor({ id: 'file_01M1Q000000000000000000000', kind: 'upload', filename: 'Rechnung Müller (final).pdf', createdAt: Date.UTC(2026, 8, 4) });
      if (opts.keyStyle === 'id') {
        // The grammar IS the traversal guard on a filesystem, so the key is the
        // bare id and carries nothing user-supplied.
        expect(key).toBe('file_01M1Q000000000000000000000');
      } else {
        // Dated and human-browsable, with the original name reduced to a safe
        // part — an operator opening their bucket console can find last month.
        expect(key).toMatch(/(^|\/)upload\/2026\/09\/file_01M1Q000000000000000000000-/);
        expect(key).not.toMatch(/[^A-Za-z0-9._/-]/);
      }
    });

    it('round-trips bytes through put → head → open', async () => {
      const payload = randomBytes(4096);
      const key = await put(payload);

      expect(await driver.head(key)).toEqual({ sizeBytes: payload.byteLength });

      const opened = await driver.open(key);
      expect(opened.sizeBytes).toBe(payload.byteLength);
      expect(await drain(opened.stream)).toEqual(payload);
    });

    it('serves a byte range with a Content-Range', async () => {
      const payload = Buffer.from('0123456789ABCDEF');
      const key = await put(payload);

      const opened = await driver.open(key, { start: 4, end: 9 });
      expect(await drain(opened.stream)).toEqual(Buffer.from('456789'));
      expect(opened.contentRange).toBe(`bytes 4-9/${String(payload.byteLength)}`);

      // An open-ended range runs to the end of the object.
      const tail = await driver.open(key, { start: 12 });
      expect(await drain(tail.stream)).toEqual(Buffer.from('CDEF'));
    });

    it('reports a missing key as absent, not as a failure', async () => {
      const missing = driver.keyFor({ id: 'file_01M1Q000000000000000000001', kind: 'upload', filename: 'nope.pdf', createdAt: Date.UTC(2026, 8, 4) });
      expect(await driver.head(missing)).toBeNull();
      await expect(driver.open(missing)).rejects.toBeInstanceOf(FileNotFoundError);
    });

    it('removes idempotently — the GC discipline', async () => {
      const key = await put(randomBytes(32));
      await driver.remove(key);
      expect(await driver.head(key)).toBeNull();
      // A second remove of the same key is success: the sweep re-derives its
      // worklist from rows and may see the same file twice after a crash.
      await driver.remove(key);
    });

    it('carries a file larger than one chunk', async () => {
      // 2 MiB: past every default highWaterMark, so the streaming paths are
      // exercised rather than a single buffered write.
      const payload = randomBytes(2 * 1024 * 1024);
      const key = await put(payload);
      const opened = await driver.open(key);
      const read = await drain(opened.stream);
      expect(read.byteLength).toBe(payload.byteLength);
      expect(createHash('sha256').update(read).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'));
    });

    it('handles a unicode filename in the key it minted', async () => {
      const id = 'file_01M1Q000000000000000000002';
      const key = driver.keyFor({ id, kind: 'upload', filename: 'Facture — Août 2026 (final).pdf', createdAt: Date.UTC(2026, 8, 4) });
      const payload = Buffer.from('unicode');
      const path = join(spoolDir, 'unicode-spool');
      await writeFile(path, payload);
      await driver.put(key, { path, sizeBytes: payload.byteLength, mime: 'application/pdf', sha256: createHash('sha256').update(payload).digest('hex') });
      written.push(key);
      expect(await drain((await driver.open(key)).stream)).toEqual(payload);
    });

    it('refuses a key that escapes its namespace', async () => {
      // `local` accepts ONLY a well-formed prefixed ULID — the grammar is the
      // traversal guard — so a too-short id and an illegal Crockford character
      // (I, L, O and U are not in the alphabet) are refused alongside the
      // traversal shapes. The remote drivers accept paths, so theirs are the
      // path escapes.
      const escapes =
        opts.keyStyle === 'id'
          ? [
              '../etc/passwd',
              'file_01M1Q000000000000000000000/../x',
              'not-an-id',
              '',
              'file_01M1Q00000000000000000000',
              'file_01M1Q00000000000000000000I',
              'conn_01M1Q000000000000000000000',
            ]
          : ['../etc/passwd', 'upload/../../etc/passwd', '/absolute/key', 'upload//double', 'trailing/'];
      for (const key of escapes) {
        await expect(driver.head(key)).rejects.toThrow();
      }
    });

    it('probes its own target end to end', async () => {
      const result = await driver.probe();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
}
