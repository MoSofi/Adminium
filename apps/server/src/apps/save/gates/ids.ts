// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ID GATE: nothing in the file may name a thing of this install.
 *
 * A contains match, not a whole-string one: an id inside a sentence, a
 * filter value or a URL is as much a leftover as one standing alone. It looks
 * for a meta row id (`<prefix>_<ULID>`, every prefix), a generated page id
 * (`page_<8 hex>_<slug>`), the source connection's own id, and a
 * `connectionId` key anywhere. A database row id (a seed's `id: 42`) is the
 * app's own and fine, unless it has one of those shapes.
 */
import { GENERATED_PAGE_ID_SOURCE, ROW_ID_SOURCE } from '../../../project/instance-ids.js';
import type { GateContent } from './content.js';
import type { GateProblem } from './index.js';

const LEFTOVER = new RegExp(`${ROW_ID_SOURCE}|${GENERATED_PAGE_ID_SOURCE}`);

export function idProblems(content: GateContent, connectionId: string): GateProblem[] {
  const out: GateProblem[] = [];
  for (const leaf of content.leaves) {
    const where = content.placeOf(leaf).path;
    if (leaf.isKey && leaf.value === 'connectionId') {
      out.push({ code: 'INSTANCE_ID_LEFT', path: where, message: `${where} is a "connectionId" key; a file names its database by key, never by id.` });
      continue;
    }
    const found = LEFTOVER.exec(leaf.value)?.[0] ?? (connectionId !== '' && leaf.value.includes(connectionId) ? connectionId : null);
    if (found === null) continue;
    out.push({ code: 'INSTANCE_ID_LEFT', path: where, message: `${where} holds "${found}", an id of this install; the file must name it by its key or name.` });
  }
  return out;
}
