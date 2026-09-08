// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `FileStore` for tests (37-files-and-storage.md 37-T07).
 *
 * The default is the IMPLICIT destination — no destination rows at all — which
 * is the state every pre-wave-0024 suite was written against and the state a
 * store that never opens Studio → Storage stays in. That is what makes the
 * byte-identity criterion checkable: the exports, imports, branding and
 * report suites construct their store through here and assert nothing new.
 *
 * Pass `meta` to get a real `filesRepo` (needed only by `putUpload`); the
 * artifact pipelines never call it, so a store built without one is fine for
 * them and fails loudly rather than silently if they ever do.
 */

import { resolve } from 'node:path';

import { destinationsRepo, filesRepo, type FilesRepo, type MetaDb } from '@adminium/meta';

import { createDestinationResolver, type DestinationResolver } from '../../src/files/destinations.js';
import { FILES_DIR } from '../../src/files/drivers/local.js';
import { createSpool } from '../../src/files/spool.js';
import { createFileStore, type FileStore } from '../../src/files/store.js';

/** Round-trips, so a test can assert what was stored without holding a key. */
export const TEST_STORAGE_CRYPTO = {
  encrypt: (plaintext: string) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token: string) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

export interface TestFileStoreOptions {
  dataDir: string;
  /** Without one, `putUpload` throws — every other method works. */
  meta?: MetaDb;
}

export function createTestFileStore(opts: TestFileStoreOptions): FileStore {
  const localRoot = resolve(opts.dataDir, FILES_DIR);
  const destinations: DestinationResolver =
    opts.meta === undefined
      ? // No meta ⇒ no destinations table to read; the implicit local disk is
        // the only answer, which is exactly the pre-wave state.
        {
          driverFor: async (destinationId) => {
            const { createLocalDriver } = await import('../../src/files/drivers/local.js');
            if (destinationId !== null && destinationId !== 'local') {
              throw new Error(`this test store has no destination ${destinationId}`);
            }
            return createLocalDriver({ root: localRoot });
          },
          rowFor: async () => null,
          driverForDraft: () => {
            throw new Error('this test store cannot build a draft driver');
          },
          defaultDestinationId: async () => null,
          publicBases: async () => [],
          clearCache: () => undefined,
        }
      : createDestinationResolver({ repo: destinationsRepo(opts.meta, TEST_STORAGE_CRYPTO), localRoot });

  const files: FilesRepo =
    opts.meta === undefined
      ? (new Proxy(
          {},
          {
            get: () => () => {
              throw new Error('this test store was built without `meta`; putUpload needs one');
            },
          },
        ) as FilesRepo)
      : filesRepo(opts.meta);

  return createFileStore({ spool: createSpool({ dataDir: opts.dataDir }), destinations, files });
}
