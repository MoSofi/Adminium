import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { ENC_TOKEN_PREFIX } from './secrets.js';

/**
 * Bootstrap file `<dataDir>/adminium.json` (01-architecture.md §7.2). The
 * meta DSN cannot live in the meta store itself (chicken-and-egg), so when
 * it is not provided by `ADMINIUM_META_URL` the first-run wizard persists it
 * here, AES-256-GCM-encrypted with the key derived from `ADMINIUM_SECRET`.
 * Environment always wins over this file.
 */
export const BOOTSTRAP_FILENAME = 'adminium.json';

export const bootstrapSchema = z.object({
  v: z.literal(1),
  /** Encrypted meta-store DSN (`enc:v1:` token); absent until the wizard sets it. */
  metaUrl: z
    .string()
    .startsWith(ENC_TOKEN_PREFIX, `must be an encrypted "${ENC_TOKEN_PREFIX}" token`)
    .optional(),
  createdAt: z.iso.datetime(),
  instanceId: z.string().min(1),
});

export type Bootstrap = z.infer<typeof bootstrapSchema>;

export class BootstrapFileError extends Error {
  override readonly name = 'BootstrapFileError';
}

export function bootstrapPath(dataDir: string): string {
  return join(dataDir, BOOTSTRAP_FILENAME);
}

/**
 * Reads and validates `<dataDir>/adminium.json`. Returns `null` when the
 * file does not exist (first run); throws `BootstrapFileError` when it
 * exists but is unreadable as a bootstrap document.
 */
export async function readBootstrap(dataDir: string): Promise<Bootstrap | null> {
  const file = bootstrapPath(dataDir);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BootstrapFileError(`${file} is not valid JSON`);
  }

  const result = bootstrapSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new BootstrapFileError(`${file} is not a valid bootstrap file — ${problems}`);
  }
  return result.data;
}

/**
 * Atomically writes `<dataDir>/adminium.json` with mode 0600: the document
 * is written to a temp file in the same directory, then renamed over the
 * target, so a crash mid-write can never leave a truncated bootstrap file.
 */
export async function writeBootstrap(dataDir: string, bootstrap: Bootstrap): Promise<void> {
  const doc = bootstrapSchema.parse(bootstrap);
  await mkdir(dataDir, { recursive: true });
  const target = bootstrapPath(dataDir);
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
