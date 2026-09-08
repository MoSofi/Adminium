// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Diagram-layout persistence — 35-schema-authoring.md D21, 35-T37.
 *
 * Behind `schema.remap`, not `connections.manage`: moving a box is a schema
 * presentation edit, and requiring the credential-rotation grant to tidy the
 * map would put it out of reach of the people who use it.
 */
import { csrfHeaders } from '../../../app/api.js';
import type { Point } from './layout.js';

export async function saveDiagramLayout(
  connectionId: string,
  positions: Record<string, Point>,
): Promise<void> {
  const response = await fetch(
    `/api/v1/connections/${encodeURIComponent(connectionId)}/diagram-layout`,
    {
      method: 'PUT',
      credentials: 'same-origin',
      // Hand-rolled fetch ⇒ hand-rolled CSRF header (08 §7 item 4), the same
      // reason `remap/api.ts` carries one.
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...csrfHeaders(),
      },
      body: JSON.stringify({ positions }),
    },
  );
  if (!response.ok) {
    throw new Error(`Saving the layout failed with status ${response.status}.`);
  }
}
