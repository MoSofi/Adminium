// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model keys a person gave the app, kept with the app and not with any
 * project: `<userData>/models.json`, each value
 * encrypted by the system's key store, one set for every project on this
 * computer. Never in `config.json` (a backup or a support bundle of that file
 * must not carry them), never in a project folder (a folder that is zipped or
 * shared carries none).
 *
 * Where the system has no key store (some Linux desktops) the values are kept
 * as they are, in a file only its owner can read, and the file says so: the
 * model screen then says it too. The app does not refuse to work there.
 *
 * ELECTRON-FREE: the key store is a port (`safeStorage` satisfies it).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { KEPT_KEY_NAMES, type KeptKeyName } from '../server/protocol.js';
import type { SafeStorageLike } from './config.js';
import type { KeptModels } from './server-manager.js';

export const MODELS_FILE = 'models.json';

const fileSchema = z.object({
  version: z.literal(1),
  storage: z.enum(['key-store', 'plain']),
  /** `key-store`: base64 of the encrypted value. `plain`: the value. */
  values: z.partialRecord(z.enum(KEPT_KEY_NAMES), z.string().min(1)),
});

export interface ModelsStore {
  /** What is kept, readable now. Empty when there is nothing, or nothing that this computer can read. */
  read(): KeptModels;
  /** Add, replace or (with `null`) take away; then what is kept. */
  keep(patch: Partial<Record<KeptKeyName, string | null>>): KeptModels;
}

export function modelsFileFor(userDataDir: string): string {
  return join(userDataDir, MODELS_FILE);
}

export function createModelsStore(opts: { file: string; keyStore: SafeStorageLike; log?: ((line: string) => void) | undefined }): ModelsStore {
  const keeping = (): KeptModels['keeping'] => {
    try {
      return opts.keyStore.isEncryptionAvailable() ? 'key-store' : 'plain';
    } catch {
      return 'plain';
    }
  };

  const read = (): KeptModels => {
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(JSON.parse(readFileSync(opts.file, 'utf8')));
    } catch {
      // No file yet, or one that does not read: nothing is kept. It is not deleted: a person may want it looked at.
      return { values: {}, keeping: keeping() };
    }
    const values: KeptModels['values'] = {};
    for (const name of KEPT_KEY_NAMES) {
      const held = parsed.values[name];
      if (held === undefined) continue;
      if (parsed.storage === 'plain') {
        values[name] = held;
        continue;
      }
      try {
        const value = opts.keyStore.decryptString(Buffer.from(held, 'base64'));
        if (value !== '') values[name] = value;
      } catch {
        // Written by another user, another computer, or a key store that is gone: that one is asked for again.
        opts.log?.(`[models] ${name} is kept but cannot be read on this computer`);
      }
    }
    return { values, keeping: keeping() };
  };

  return {
    read,
    keep(patch) {
      const next: KeptModels['values'] = { ...read().values };
      for (const name of KEPT_KEY_NAMES) {
        const value = patch[name];
        if (value === undefined) continue;
        if (value === null || value.trim() === '') Reflect.deleteProperty(next, name);
        else next[name] = value;
      }
      const storage = keeping();
      const values: Partial<Record<KeptKeyName, string>> = {};
      for (const name of KEPT_KEY_NAMES) {
        const value = next[name];
        if (value === undefined) continue;
        values[name] = storage === 'key-store' ? opts.keyStore.encryptString(value).toString('base64') : value;
      }
      mkdirSync(dirname(opts.file), { recursive: true });
      // Whole or not at all: a file cut short would lose every key at once.
      const draft = `${opts.file}.tmp`;
      writeFileSync(draft, `${JSON.stringify({ version: 1, storage, values } satisfies z.infer<typeof fileSchema>, null, 2)}\n`, { mode: 0o600 });
      renameSync(draft, opts.file);
      return { values: next, keeping: storage };
    },
  };
}
