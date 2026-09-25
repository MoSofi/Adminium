// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document store that keeps its bytes in memory — a leaf, so the add-on
 * harness and the documents harness can both use it without importing each
 * other.
 */
import { Readable } from 'node:stream';

import type { FileStore } from '../src/files/store.js';

/** Bytes kept in memory, read back by the content route. */
export function memoryStorage(): FileStore {
  const bytes = new Map<string, Buffer>();
  return {
    defaultDestinationId: () => Promise.resolve(null),
    write: (input: { id: string; bytes: Buffer | string }) => {
      const buffer = Buffer.from(input.bytes);
      bytes.set(`documents/${input.id}`, buffer);
      return Promise.resolve({ sizeBytes: buffer.byteLength, sha256: 'x', storageKey: `documents/${input.id}`, destinationId: null, storage: 'local' });
    },
    read: (file: { storageKey: string }) => Promise.resolve(Readable.from([bytes.get(file.storageKey) ?? Buffer.alloc(0)])),
    open: (file: { storageKey: string }) => {
      const held = bytes.get(file.storageKey) ?? Buffer.alloc(0);
      return Promise.resolve({ stream: Readable.from([held]), sizeBytes: held.byteLength });
    },
  } as unknown as FileStore;
}
