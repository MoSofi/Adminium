// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAMPLE'S OWN FILE, held to what a person's upload of it is held to
 * (`files/store.ts`) before it goes into the Files library. A sample may give
 * a model or an SVG to a column every visitor's browser loads
 * (`routes/public/assets.ts` serves them as kept), so it may carry no more
 * than an upload could:
 *
 *  - an SVG is written again by the cleaner (`files/svg.ts`), as an upload's
 *    is: what the cleaner drops (a script, an `onload`) is gone from the copy
 *    kept, and what it refuses (a `<foreignObject>`, a link out) refuses the
 *    sample, naming the file;
 *  - a model is what its name says by its whole bytes (`files/sniff.ts`,
 *    `files/models.ts`), and is stored as the type that check finds;
 *  - either is no larger than the public route serves its kind
 *    (`PUBLIC_ASSET_MAX_BYTES`).
 *
 * A picture is stored by its name, as before. Both the add (`sample-data.ts`)
 * and the folder check (`project/apps/check-app.ts`) ask these, so the two
 * refuse the same files.
 */
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { PUBLIC_ASSET_MAX_BYTES, sampleFileKindOf, type SampleFileKind } from '@adminium/manifest';

import { confirmKind, ModelRefused } from '../files/models.js';
import { SNIFF_HEAD_BYTES, sniff, type SniffTypeKey } from '../files/sniff.js';
import { cleanSvg, SvgRefused } from '../files/svg.js';

/** A sample file no upload of it would be kept as, with the sentence the person reads. */
export class SampleFileRefused extends Error {
  override readonly name = 'SampleFileRefused';
}

const MIME_BY_KIND: Readonly<Record<SampleFileKind, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  // As the upload door stores them (`files/sniff.ts`): a column's `accept` is judged on these.
  glb: 'model/gltf-binary',
  stl: 'model/stl',
  '3mf': 'model/3mf',
};

/** The kinds read whole before they are kept: no head can vouch for them. */
const MODEL_KINDS: ReadonlySet<SampleFileKind> = new Set(['glb', 'stl', '3mf']);

const mib = (bytes: number): string => String(Math.round((bytes / (1024 * 1024)) * 10) / 10);

/**
 * What a sample file is kept as, as far as can be told without reading it
 * whole from disk: its size within its kind's public cap, and an SVG cleaned.
 * The bytes returned are the ones to keep. A model still needs
 * {@link sampleModelRefusal}. Throws {@link SampleFileRefused}.
 */
export function sampleFileAsKept(bytes: Buffer, file: string): { bytes: Buffer; mime: string; kind: SampleFileKind | undefined } {
  const kind = sampleFileKindOf(file);
  if (kind === undefined) return { bytes, mime: 'application/octet-stream', kind };
  const cap = (PUBLIC_ASSET_MAX_BYTES as Partial<Record<string, number>>)[kind];
  if (cap !== undefined && bytes.length > cap) {
    throw new SampleFileRefused(`The sample file "${file}" is ${mib(bytes.length)} MB. Every visitor's browser loads a file of its kind, so it can be at most ${mib(cap)} MB.`);
  }
  if (kind !== 'svg') return { bytes, mime: MIME_BY_KIND[kind], kind };
  try {
    return { bytes: cleanSvg(bytes), mime: MIME_BY_KIND.svg, kind };
  } catch (error) {
    if (!(error instanceof SvgRefused)) throw error;
    throw new SampleFileRefused(`The sample file "${file}" cannot be kept: ${error.message}`);
  }
}

/**
 * Why a model on disk is not the kind its name says, read as an upload of it
 * is read (`confirmKind`); null when it is. Anything but a model is null.
 */
export async function sampleModelRefusal(path: string, bytes: Buffer, file: string): Promise<string | null> {
  const kind = sampleFileKindOf(file);
  if (kind === undefined || !MODEL_KINDS.has(kind)) return null;
  const head = bytes.subarray(0, SNIFF_HEAD_BYTES);
  const name = basename(file);
  try {
    const found = await confirmKind({ path, sizeBytes: bytes.length, head }, sniff(head, name), name, [kind as SniffTypeKey]);
    if (found.ok && found.type.key === kind) return null;
    return `The sample file "${file}" is not the ${kind.toUpperCase()} model its name says.`;
  } catch (error) {
    if (!(error instanceof ModelRefused)) throw error;
    return `The sample file "${file}" cannot be kept: ${error.message}`;
  }
}

/** A sample file as it is kept: {@link sampleFileAsKept}, and a model read whole from a copy on disk. Throws {@link SampleFileRefused}. */
export async function keptSampleFile(bytes: Buffer, file: string): Promise<{ bytes: Buffer; mime: string }> {
  const kept = sampleFileAsKept(bytes, file);
  if (kept.kind === undefined || !MODEL_KINDS.has(kept.kind)) return kept;
  const path = join(tmpdir(), `adminium-sample-${randomBytes(8).toString('hex')}`);
  try {
    await writeFile(path, bytes);
    const refusal = await sampleModelRefusal(path, bytes, file);
    if (refusal !== null) throw new SampleFileRefused(refusal);
  } finally {
    await rm(path, { force: true });
  }
  return kept;
}
