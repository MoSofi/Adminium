// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE GATES' ANSWERS, CARRIED OUT ON THE FILE.
 *
 * A secret hit or a warning is answered "clear" (the place is blanked) or
 * "leave out" (its entry goes). The gates skip a place once it is answered, so
 * the answer must be carried out here, on the converter's result, before they
 * run: otherwise a cleared secret would be written with no question asked.
 * Places are named as the gates name them (`content.ts`: `<kind>:<item>:<field>`,
 * and `<kind>:<item>` for a whole entry), from the same walker.
 */
import type { AppManifest } from '@adminium/manifest';

import { decodeFile, entryItems, itemTargetOf, placeOf, targetOf, walkStrings, type PathPart } from './gates/content.js';
import type { SaveChoices } from './types.js';

export interface Answered {
  manifest: AppManifest;
  files: Map<string, Uint8Array>;
}

function setAt(root: unknown, parts: readonly PathPart[], value: string): void {
  let node = root as Record<string | number, unknown>;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string | number, unknown>;
  const last = parts.at(-1);
  if (last !== undefined) node[last] = value;
}

/** Blank every place answered "clear"; drop every entry answered "leave out". */
export function carryOutAnswers(manifest: AppManifest, files: ReadonlyMap<string, Uint8Array>, choices: Pick<SaveChoices, 'clear' | 'leaveOut'>): Answered {
  const clear = new Set(choices.clear ?? []);
  const leaveOut = new Set(choices.leaveOut ?? []);
  const doc = structuredClone(manifest) as unknown as Record<string, unknown>;
  const out = new Map(files);

  if (clear.size > 0) {
    const places: (readonly PathPart[])[] = [];
    walkStrings(doc, [], (_value, parts, isKey) => {
      if (!isKey && clear.has(targetOf(placeOf(doc as unknown as AppManifest, { file: null, parts })))) places.push(parts);
    });
    for (const parts of places) setAt(doc, parts, '');

    for (const [path, bytes] of files) {
      const decoded = decodeFile(path, bytes);
      if (decoded.kind === 'text') {
        if (clear.has(targetOf(placeOf(doc as unknown as AppManifest, { file: path, parts: [] })))) out.set(path, new Uint8Array(0));
        continue;
      }
      const value = decoded.value;
      const hits: (readonly PathPart[])[] = [];
      walkStrings(value, [], (_v, parts, isKey) => {
        if (!isKey && clear.has(targetOf(placeOf(doc as unknown as AppManifest, { file: path, parts }, value)))) hits.push(parts);
      });
      if (hits.length === 0) continue;
      for (const parts of hits) setAt(value, parts, '');
      out.set(path, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
    }
  }

  if (leaveOut.size > 0) {
    for (const [top, block] of Object.entries(doc)) {
      if (!Array.isArray(block)) continue;
      const kind = placeOf(doc as unknown as AppManifest, { file: null, parts: [top, 0] }).kind;
      const items = entryItems(block);
      const kept = block.filter((_entry, index) => !leaveOut.has(itemTargetOf({ kind, item: items[index] ?? String(index) })));
      if (kept.length !== block.length) doc[top] = kept;
    }
  }

  return { manifest: doc as unknown as AppManifest, files: out };
}
