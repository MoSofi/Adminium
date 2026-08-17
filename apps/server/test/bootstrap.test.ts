// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_FILENAME,
  BootstrapFileError,
  bootstrapPath,
  readBootstrap,
  writeBootstrap,
  type Bootstrap,
} from '../src/config/bootstrap.js';
import { deriveKey, encryptSecret } from '../src/config/secrets.js';

const key = deriveKey('a-sufficiently-long-master-secret', 'bootstrap-test');

function makeBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    v: 1,
    metaUrl: encryptSecret('postgres://adminium:pw@localhost:5432/meta', key),
    createdAt: '2026-07-12T10:00:00Z',
    instanceId: 'inst_01HZX0000000000000000000',
    ...overrides,
  };
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'adminium-bootstrap-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('writeBootstrap / readBootstrap', () => {
  it('round-trips a bootstrap document', async () => {
    const doc = makeBootstrap();
    await writeBootstrap(dataDir, doc);
    await expect(readBootstrap(dataDir)).resolves.toEqual(doc);
  });

  it('accepts a document without metaUrl (env-provided DSN)', async () => {
    const doc = makeBootstrap();
    delete doc.metaUrl;
    await writeBootstrap(dataDir, doc);
    const read = await readBootstrap(dataDir);
    expect(read?.metaUrl).toBeUndefined();
  });

  it('creates the data dir when missing', async () => {
    const nested = join(dataDir, 'deep', 'data');
    await writeBootstrap(nested, makeBootstrap());
    await expect(readBootstrap(nested)).resolves.not.toBeNull();
  });

  it('writes adminium.json with mode 0600', async () => {
    await writeBootstrap(dataDir, makeBootstrap());
    const info = await stat(bootstrapPath(dataDir));
    if (process.platform !== 'win32') {
      expect(info.mode & 0o777).toBe(0o600);
    }
  });

  it('leaves no temp files behind (atomic tmp+rename)', async () => {
    await writeBootstrap(dataDir, makeBootstrap());
    await expect(readdir(dataDir)).resolves.toEqual([BOOTSTRAP_FILENAME]);
  });

  it('overwrites an existing bootstrap file atomically', async () => {
    await writeBootstrap(dataDir, makeBootstrap({ instanceId: 'inst_first' }));
    await writeBootstrap(dataDir, makeBootstrap({ instanceId: 'inst_second' }));
    const read = await readBootstrap(dataDir);
    expect(read?.instanceId).toBe('inst_second');
    await expect(readdir(dataDir)).resolves.toEqual([BOOTSTRAP_FILENAME]);
  });

  it('refuses to write a plaintext (non enc:v1:) metaUrl', async () => {
    await expect(
      writeBootstrap(dataDir, makeBootstrap({ metaUrl: 'postgres://plain:pw@host/db' })),
    ).rejects.toThrow();
    await expect(readBootstrap(dataDir)).resolves.toBeNull();
  });

  it('persists pretty-printed JSON with a trailing newline', async () => {
    await writeBootstrap(dataDir, makeBootstrap());
    const text = await readFile(bootstrapPath(dataDir), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ v: 1 });
  });
});

describe('readBootstrap — failure modes', () => {
  it('returns null when the file does not exist', async () => {
    await expect(readBootstrap(dataDir)).resolves.toBeNull();
  });

  it('throws BootstrapFileError on invalid JSON', async () => {
    await writeFile(bootstrapPath(dataDir), '{ not json', 'utf8');
    await expect(readBootstrap(dataDir)).rejects.toThrow(BootstrapFileError);
  });

  it.each([
    ['wrong version', { ...makeBootstrap(), v: 2 }],
    ['plaintext metaUrl', { ...makeBootstrap(), metaUrl: 'postgres://plain' }],
    ['bad createdAt', { ...makeBootstrap(), createdAt: 'yesterday' }],
    ['missing instanceId', { v: 1, createdAt: '2026-07-12T10:00:00Z' }],
  ])('throws BootstrapFileError on %s', async (_label, doc) => {
    await writeFile(bootstrapPath(dataDir), JSON.stringify(doc), 'utf8');
    await expect(readBootstrap(dataDir)).rejects.toThrow(BootstrapFileError);
  });
});
