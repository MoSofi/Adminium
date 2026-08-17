// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two desktop-only setup endpoints (11-electron.md §6 step 2), as the
 * wizard's cards 1 and 4 call them.
 *
 * Shapes mirror the server's Zod reply schemas
 * (`apps/server/src/routes/desktop-{local-db,demo}/schema.ts`) — the type-only
 * copy convention from `studio/api.ts` and `app/bootstrap.ts` applies (the
 * dashboard may not import server runtime code, 01-architecture.md §2.3). Change
 * both together.
 *
 * Cards 2 and 3 are NOT here, and their absence is the design: "Open an existing
 * SQLite file" and "Connect to a server database" are both
 * `POST /api/v1/connections` with a DSN — the same call self-host makes — so they
 * go through `studioApi.createConnection`. Only the two that need
 * `<dataDir>` (a path the server knows and the browser does not) needed a route
 * of their own.
 */

import { api } from '../../app/api.js';

/** A translation gap the SQLite DDL emitter could not carry across. */
export interface LocalDatabaseWarning {
  code: string;
  message: string;
  tableId: string | null;
}

export interface LocalDatabaseResult {
  connectionId: string;
  name: string;
  slug: string;
  /** Absolute `<dataDir>/databases/<slug>.sqlite` — feeds `showItemInFolder`. */
  file: string;
  tables: string[];
  rows: Record<string, number>;
  warnings: LocalDatabaseWarning[];
}

export interface CreateLocalDatabaseInput {
  name: string;
  /** Absent ⇒ a blank database; present ⇒ §6's "From a schema file". */
  schemaFile?: { content: string; format?: string | undefined; fileName?: string | undefined };
  /** `Connect Database.dc.html`'s "Auto-generate placeholder entries". */
  placeholderRows: boolean;
}

export async function createLocalDatabase(input: CreateLocalDatabaseInput): Promise<LocalDatabaseResult> {
  const body = await api.post<{ data: LocalDatabaseResult }>('/api/v1/desktop/local-database', {
    name: input.name,
    ...(input.schemaFile === undefined
      ? {}
      : {
          schemaFile: {
            content: input.schemaFile.content,
            ...(input.schemaFile.format === undefined || input.schemaFile.format === 'auto'
              ? {}
              : { format: input.schemaFile.format }),
            ...(input.schemaFile.fileName === undefined ? {} : { fileName: input.schemaFile.fileName }),
          },
        }),
    placeholderRows: input.placeholderRows,
  });
  return body.data;
}

export interface DemoDatabaseResult {
  connectionId: string;
  name: string;
  file: string;
  /** False when the call adopted a `demo.sqlite` already on disk. */
  seeded: boolean;
  rows: Record<string, number>;
}

/**
 * §6 step 2 card 4. A 409 `CONFLICT` means a connection already points at the
 * demo file; `details.connectionId` names it, so the caller can route to the
 * existing demo rather than offer a retry that can never succeed. See
 * {@link demoConflictConnectionId}.
 */
export async function createDemoDatabase(name?: string): Promise<DemoDatabaseResult> {
  const body = await api.post<{ data: DemoDatabaseResult }>(
    '/api/v1/desktop/demo-database',
    name === undefined ? {} : { name },
  );
  return body.data;
}

/**
 * The existing demo's connection id out of a 409's `details`, or `null` if this
 * is not that failure.
 *
 * Defensive about the shape rather than casting: `details` is `unknown` on
 * `ApiError` because it is whatever the server put there, and a wizard that
 * navigated to `undefined` would be a worse bug than one that showed the error.
 */
export function demoConflictConnectionId(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const id = (details as { connectionId?: unknown }).connectionId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
