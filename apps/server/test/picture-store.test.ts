// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture cleaned once is kept beside its file, under a key worked out
 * from the file's id and the cleaning's version alone (on this server's
 * disk, one the files root's grammar accepts): its first bytes say what it
 * is and its tag, the picture streams after them, a copy that does not read
 * back is none, and it goes when the file's bytes go.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isId } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalDriver } from '../src/files/drivers/local.js';
import { cleanPicture, PICTURE_PIPELINE } from '../src/public-api/picture.js';
import { cleanedPictureId, createPictureStore, removeCleanedPicture } from '../src/public-api/picture-store.js';
import { png } from './picture-images.js';

describe('a cleaned picture, kept beside its file', () => {
  let root: string;
  const storage = () => {
    const driver = createLocalDriver({ root });
    return { driverFor: async () => Promise.resolve(driver) };
  };
  const file = { id: 'file_01J0000000000000000000000A', destinationId: null, createdAt: 1_700_000_000_000, mime: 'image/png' };
  const read = async (stream: NodeJS.ReadableStream) => {
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(chunk as Buffer);
    return Buffer.concat(parts);
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'adminium-pictures-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is kept under a key of the files root, one per file and version', () => {
    const id = cleanedPictureId(file.id);
    expect(isId(id, 'file')).toBe(true);
    expect(id.startsWith('file_0000000000')).toBe(true);
    expect(cleanedPictureId(file.id)).toBe(id);
    expect(cleanedPictureId('file_01J0000000000000000000000B')).not.toBe(id);
    expect(cleanedPictureId(file.id, `${PICTURE_PIPELINE}x`)).not.toBe(id);
  });

  it('says its tag from its first bytes, streams the picture after them, and goes when asked', async () => {
    const store = createPictureStore(storage());
    expect(await store.head(file)).toBeNull();
    const picture = cleanPicture(png({ text: 'GPS 51.5' }).bytes, 'image/png');
    await store.save(file, picture);
    const stored = await store.head(file);
    expect(stored).toEqual({ mime: 'image/png', etag: picture.etag, length: picture.bytes.length });
    const opened = await store.open(file, stored!);
    expect(opened!.length).toBe(picture.bytes.length);
    expect((await read(opened!.stream)).equals(picture.bytes)).toBe(true);
    // Another type than the file now says: none.
    expect(await store.head({ ...file, mime: 'image/jpeg' })).toBeNull();
    await removeCleanedPicture(storage(), file);
    expect(await store.head(file)).toBeNull();
    // Gone already: no error.
    await removeCleanedPicture(storage(), file);
  });

  it('is none when it does not read back: cut short, or not a copy this version wrote', async () => {
    const store = createPictureStore(storage());
    const picture = cleanPicture(png().bytes, 'image/png');
    await store.save(file, picture);
    const path = join(root, cleanedPictureId(file.id));
    const whole = await readFile(path);
    await writeFile(path, whole.subarray(0, whole.length - 3));
    const stored = await store.head(file);
    expect(stored).not.toBeNull();
    expect(await store.open(file, stored!)).toBeNull();
    await writeFile(path, Buffer.concat([Buffer.from('ADMPIC p0 image/png 10 "p0-x"\n'.padEnd(160, ' '), 'latin1'), picture.bytes]));
    expect(await store.head(file)).toBeNull();
  });
});
