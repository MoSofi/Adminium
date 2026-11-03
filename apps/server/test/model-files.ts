// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Models and fonts made byte by byte for tests: a GLB, an STL in both its
 * forms, a 3MF package, a WOFF2 header, each well made unless told to lie.
 */
import { makeZip, type ZipPart } from './zip-maker.js';

/** A GLB: `json` as its description chunk, `bin` as its binary chunk; `length` lies about the whole when given. */
export function glb(json: Record<string, unknown>, opts: { bin?: Buffer; length?: number; version?: number; trailing?: Buffer } = {}): Buffer {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4 !== 0) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const chunks: Buffer[] = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(text.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  chunks.push(jsonHeader, text);
  if (opts.bin !== undefined) {
    let bin = opts.bin;
    if (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    chunks.push(binHeader, bin);
  }
  if (opts.trailing !== undefined) chunks.push(opts.trailing);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(opts.version ?? 2, 4);
  header.writeUInt32LE(opts.length ?? 12 + body.length, 8);
  return Buffer.concat([header, body]);
}

/** A one-triangle glTF whose buffer is the binary chunk. */
export function triangleGltf(extra: Record<string, unknown> = {}): { json: Record<string, unknown>; bin: Buffer } {
  const bin = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, i) => bin.writeFloatLE(value, i * 4));
  return {
    bin,
    json: {
      asset: { version: '2.0', generator: 'test' },
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
      ...extra,
    },
  };
}

/** A good GLB of one triangle, grown to `size` bytes when asked (the binary chunk padded). */
export function goodGlb(size?: number): Buffer {
  const { json, bin } = triangleGltf();
  const base = glb(json, { bin });
  if (size === undefined || size <= base.length) return base;
  const grown = Buffer.concat([bin, Buffer.alloc(size - base.length)]);
  return glb(json, { bin: grown });
}

/** A binary STL of `triangles` facets, its 80-byte header starting with `header`. */
export function binaryStl(triangles: number, header = 'binary stl'): Buffer {
  const out = Buffer.alloc(84 + 50 * triangles);
  out.write(header.slice(0, 80), 0, 'latin1');
  out.writeUInt32LE(triangles, 80);
  for (let t = 0; t < triangles; t += 1) {
    const at = 84 + t * 50;
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, i) => out.writeFloatLE(value, at + i * 4));
  }
  return out;
}

/** A text STL of `facets` facets. */
export function textStl(facets = 1, name = 'part'): Buffer {
  const facet = ['  facet normal 0 0 1', '    outer loop', '      vertex 0 0 0', '      vertex 1 0 0', '      vertex 0 1.5e0 0', '    endloop', '  endfacet'].join('\n');
  return Buffer.from([`solid ${name}`, ...Array.from({ length: facets }, () => facet), `endsolid ${name}`, ''].join('\n'), 'latin1');
}

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;

export const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

export const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;

/** A 3MF package; `model` overrides the model part's entry (to lie about its size, say), `more` adds entries. */
export function threeMf(opts: { model?: Partial<ZipPart>; more?: ZipPart[]; rels?: string; leaveOut?: string[] } = {}): Buffer {
  const parts: ZipPart[] = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: opts.rels ?? RELS },
    { name: '3D/3dmodel.model', data: MODEL, ...opts.model },
    ...(opts.more ?? []),
  ].filter((part) => !(opts.leaveOut ?? []).includes(part.name));
  return makeZip(parts);
}

/** A WOFF2 font's header (and nothing a browser would draw), `length` lying when given. */
export function woff2(opts: { length?: number; tables?: number; size?: number } = {}): Buffer {
  const out = Buffer.alloc(opts.size ?? 64);
  out.write('wOF2', 0, 'latin1');
  out.write('OTTO', 4, 'latin1');
  out.writeUInt32BE(opts.length ?? out.length, 8);
  out.writeUInt16BE(opts.tables ?? 1, 12);
  return out;
}
