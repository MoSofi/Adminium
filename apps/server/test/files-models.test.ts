// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shop's models and fonts, told by their whole bytes: a GLB only when it
 * is self-contained glTF 2, an STL by its own form (never by "starts with
 * solid"), a 3MF read from its zip's directory with caps before anything is
 * inflated, a WOFF2 by its signature and its length.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { check3mf, checkGlb, confirmKind, isBinaryStl, isTextStl, ModelRefused, THREE_MF_MAX_UNPACKED, type WholeFile } from '../src/files/models.js';
import { sniff, SNIFF_HEAD_BYTES, SNIFF_TYPE_KEYS, mimesForKeys, type SniffTypeKey } from '../src/files/sniff.js';
import { binaryStl, glb, goodGlb, MODEL, textStl, threeMf, triangleGltf, woff2 } from './model-files.js';
import { makeZip } from './zip-maker.js';

let dir: string;
let n = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-models-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A file on disk, as the spool hands it over. */
async function onDisk(bytes: Buffer): Promise<WholeFile> {
  n += 1;
  const path = join(dir, `f${String(n)}`);
  await writeFile(path, bytes);
  return { path, sizeBytes: bytes.length, head: bytes.subarray(0, SNIFF_HEAD_BYTES) };
}

const ALL: SniffTypeKey[] = [...SNIFF_TYPE_KEYS];

/** What an upload of `bytes` named `name` is found to be, or the sentence it is refused with. */
async function kindOf(bytes: Buffer, name: string, allowed: SniffTypeKey[] = ALL): Promise<string> {
  const file = await onDisk(bytes);
  try {
    const result = await confirmKind(file, sniff(file.head, name), name, allowed);
    return result.ok ? result.type.key : `unknown: ${result.refusal.detail}`;
  } catch (error) {
    if (error instanceof ModelRefused) return `refused: ${error.message}`;
    throw error;
  }
}

describe('the new kinds in the allowlist', () => {
  it('names glb, stl, 3mf and woff2, each with its mime', () => {
    expect(SNIFF_TYPE_KEYS).toEqual(expect.arrayContaining(['glb', 'stl', '3mf', 'woff2']));
    expect(mimesForKeys(['glb', 'stl', '3mf', 'woff2'])).toEqual(['font/woff2', 'model/3mf', 'model/gltf-binary', 'model/stl']);
  });
});

describe('a GLB', () => {
  it('is taken when it is glTF 2 with everything inside it', async () => {
    expect(await kindOf(goodGlb(), 'teapot.glb')).toBe('glb');
    const { json, bin } = triangleGltf({ extensionsUsed: ['KHR_materials_clearcoat', 'KHR_texture_transform', 'KHR_mesh_quantization'], images: [{ bufferView: 0, mimeType: 'image/png' }] });
    expect(await kindOf(glb(json, { bin }), 'nook.glb')).toBe('glb');
  });

  it('is refused when a buffer or a picture points outside it (a uri)', async () => {
    const outside = triangleGltf({ buffers: [{ byteLength: 36, uri: 'https://tracker.example/model.bin' }] });
    expect(await kindOf(glb(outside.json, { bin: outside.bin }), 'a.glb')).toMatch(/^refused: .*outside it \(a "uri"\)/);
    const picture = triangleGltf({ images: [{ uri: 'data:image/png;base64,AAAA' }] });
    expect(await kindOf(glb(picture.json, { bin: picture.bin }), 'b.glb')).toMatch(/outside it/);
    // Anywhere in the description, an extension's own included.
    const deep = triangleGltf({ extensions: { KHR_materials_variants: { variants: [{ name: 'x', uri: 'http://x' }] } } });
    expect(await kindOf(glb(deep.json, { bin: deep.bin }), 'c.glb')).toMatch(/outside it/);
  });

  it('is refused when it uses Draco, meshopt, Basis textures or an extension off the list', async () => {
    for (const [extension, said] of [
      ['KHR_draco_mesh_compression', 'Draco'],
      ['EXT_meshopt_compression', 'meshopt'],
      ['KHR_texture_basisu', 'Basis'],
      ['KHR_lights_punctual', 'KHR_lights_punctual'],
    ] as const) {
      const { json, bin } = triangleGltf({ extensionsRequired: [extension], extensionsUsed: [extension] });
      expect(await kindOf(glb(json, { bin }), 'x.glb')).toMatch(new RegExp(`refused: .*${said}`));
    }
  });

  it('is refused when its length, version or chunks are not what its header says', async () => {
    const { json, bin } = triangleGltf();
    const good = glb(json, { bin });
    expect(await kindOf(glb(json, { bin, length: good.length + 4 }), 'a.glb')).toMatch(/not as long as its header says/);
    expect(await kindOf(glb(json, { bin, version: 1 }), 'b.glb')).toMatch(/not glTF 2/);
    expect(await kindOf(Buffer.concat([good, Buffer.alloc(8)]), 'c.glb')).toMatch(/refused/);
    // A description that is not JSON.
    const broken = Buffer.from(good);
    broken.write('{{{{', 20, 'latin1');
    expect(await kindOf(broken, 'd.glb')).toMatch(/not JSON/);
    // A buffer with no binary chunk to be.
    expect(await kindOf(glb(json), 'e.glb')).toMatch(/carries no binary data/);
    // Two buffers: the second could only be somewhere else.
    const two = triangleGltf({ buffers: [{ byteLength: 36 }, { byteLength: 4 }] });
    expect(await kindOf(glb(two.json, { bin: two.bin }), 'f.glb')).toMatch(/more than one buffer/);
  });

  it('is refused when its description is over 4 MB', async () => {
    const { json, bin } = triangleGltf({ extras: { padding: 'x'.repeat(4 * 1024 * 1024) } });
    const file = await onDisk(glb(json, { bin }));
    await expect(checkGlb(file)).rejects.toThrow(/over 4 MB/);
  });
});

describe('an STL', () => {
  it('takes a binary STL whose header starts with "solid" as binary, by its size', async () => {
    const bytes = binaryStl(3, 'solid exported by a slicer');
    expect(isBinaryStl(bytes, bytes.length)).toBe(true);
    // Its bytes are no text STL at all: only its size says what it is.
    expect(await isTextStl((await onDisk(bytes)).path)).toBe(false);
    expect(await kindOf(bytes, 'bracket.stl')).toBe('stl');
  });

  it('takes a text STL by its grammar, and refuses text that only starts with "solid"', async () => {
    expect(await kindOf(textStl(4), 'part.stl')).toBe('stl');
    expect(await kindOf(Buffer.from('solid nothing here\nhello world\nendsolid\n'), 'fake.stl')).toMatch(/refused: This is not an STL/);
    // A facet with two vertices.
    const short = textStl(1).toString('latin1').replace('      vertex 1 0 0\n', '');
    expect(await kindOf(Buffer.from(short, 'latin1'), 'short.stl')).toMatch(/refused/);
    // Never closed.
    expect(await kindOf(Buffer.from(textStl(1).toString('latin1').replace('endsolid part', ''), 'latin1'), 'open.stl')).toMatch(/refused/);
  });

  it('refuses a binary STL one byte off its size', async () => {
    const bytes = Buffer.concat([binaryStl(2), Buffer.alloc(1)]);
    expect(isBinaryStl(bytes, bytes.length)).toBe(false);
    expect(await kindOf(bytes, 'off.stl')).toMatch(/refused/);
  });

  it('is reached only by its name, and only where an STL is taken', async () => {
    expect(await kindOf(binaryStl(2), 'bracket.bin')).toMatch(/^unknown/);
    expect(await kindOf(binaryStl(2), 'bracket.stl', ['png'])).toMatch(/^unknown/);
  });
});

describe('a 3MF', () => {
  it('is taken when its package names its model part', async () => {
    expect(await kindOf(threeMf(), 'nook.3mf')).toBe('3mf');
    // Found by its parts even with another name: the zip's own directory says what it is.
    expect(await kindOf(threeMf(), 'nook.zip')).toBe('3mf');
  });

  it('refuses a plain zip renamed .3mf: it has no model part', async () => {
    const zip = makeZip([{ name: 'readme.txt', data: 'hello' }, { name: 'photo.png', data: 'not really' }]);
    expect(await kindOf(zip, 'model.3mf')).toMatch(/^refused: This is not a 3MF/);
    // The same zip under its own name stays a zip.
    expect(await kindOf(zip, 'model.zip')).toBe('zip');
    // A package whose relationships name a part that is not there.
    expect(await kindOf(threeMf({ leaveOut: ['3D/3dmodel.model'], more: [{ name: '3D/other.model', data: MODEL }] }), 'x.3mf')).toMatch(/model part \/3D\/3dmodel.model is missing/);
    // A model part that is not a model.
    expect(await kindOf(threeMf({ model: { data: '<html><body>hi</body></html>' } }), 'y.3mf')).toMatch(/is not a 3D model/);
  });

  it('refuses a zip bomb before inflating: a small file declaring a huge entry', async () => {
    const bomb = threeMf({ model: { size: THREE_MF_MAX_UNPACKED + 1 } });
    expect(bomb.length).toBeLessThan(4096);
    expect(await kindOf(bomb, 'bomb.3mf')).toMatch(/3D\/3dmodel.model in this 3MF says it unpacks to more than 200 MB/);
    // Many entries together over the cap.
    const many = threeMf({ more: Array.from({ length: 3 }, (_, i) => ({ name: `Metadata/big${String(i)}.bin`, data: Buffer.alloc(16), size: 90 * 1024 * 1024 })) });
    expect(await kindOf(many, 'many.3mf')).toMatch(/^refused: This 3MF unpacks to more than 200 MB/);
  });

  it('stops inflating a model part the moment it passes what it declared', async () => {
    // Declares 1 KB, holds a megabyte of zeros deflated to a few KB: refused as damaged, never inflated whole.
    const lying = threeMf({ model: { stored: deflateRawSync(Buffer.concat([Buffer.from(MODEL), Buffer.alloc(1024 * 1024)])), size: 1024 } });
    expect(await kindOf(lying, 'lie.3mf')).toMatch(/damaged/);
  });

  it('refuses more than 64 entries, counted before the directory is read', async () => {
    const crowded = threeMf({ more: Array.from({ length: 62 }, (_, i) => ({ name: `Metadata/p${String(i)}.txt`, data: 'x' })) });
    expect(await kindOf(crowded, 'crowded.3mf')).toMatch(/more than 64 files/);
  });

  it('refuses the package parts when they are over 64 KB', async () => {
    const file = await onDisk(threeMf({ rels: `<?xml version="1.0"?><Relationships>${' '.repeat(70 * 1024)}</Relationships>` }));
    await expect(check3mf(file)).rejects.toThrow(/over 64 KB/);
  });
});

describe('a WOFF2 font', () => {
  it('is taken by its signature and its length, and refused when the length lies', async () => {
    expect(await kindOf(woff2(), 'brand.woff2')).toBe('woff2');
    expect(await kindOf(woff2({ length: 9000 }), 'brand.woff2')).toMatch(/not as long as its header says/);
    expect(await kindOf(woff2({ tables: 0 }), 'brand.woff2')).toMatch(/no tables/);
  });
});
