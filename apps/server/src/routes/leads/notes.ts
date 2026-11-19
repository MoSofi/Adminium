// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE EACH FILLED FIELD OF A COMPANY CAME FROM: `GET /leads/:key/notes`.
 *
 * When the lead door fills a field of a company, Adminium notes it in the
 * add-on's fields' sources table: the table and row, the column, the source
 * and when, and the hash of the value as the record page reads it
 * (`leads/write.ts`). The record page asks this route for one record and
 * draws "From {source} · {date}" under each field it answers for.
 *
 * A note is answered only while the field's current value still hashes the
 * same: an edit of the field (by anyone, through any door, or in the
 * database itself) hides its note with nothing to clear, and the other
 * fields keep theirs. The value is the one the reader is shown, read as them
 * (`readAsPerson`): a field they may not read, or read masked, has no note.
 *
 * WHO: a signed-in person who reaches the add-on's database and may open the
 * record. The add-on's own pages are not needed: whoever reads the record
 * may read where its fields came from, as they may read its history.
 * Each source is named in the add-on's own words for it (`sources[].label`,
 * in the reader's language where it has them), else by its id.
 */
import type { InstalledManifest, ManifestsRepo, MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import { storedTableRef, tableRefIndex } from '../../apps/table-ref.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { readAsPerson } from '../../crud/as-person.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readInstant } from '../../crud/moments.js';
import { NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { readerWords } from '../../i18n/bcp47.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { installReachOf } from '../../installs/reach.js';
import { rememberInstall, rememberedInstall, resolveInstall, selectorOf } from '../../installs/resolve.js';
import { installManifest } from '../../lead-sources/call.js';
import { sourcesOf, speaksForSources } from '../../lead-sources/state.js';
import { companiesTableFor } from '../../leads/companies.js';
import { leadsInstall } from '../../leads/people.js';
import { shownKindOf, valueHash } from '../../leads/write.js';

export interface LeadNotesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  manager: Pick<ConnectionManager, 'data'>;
  connectionNames: () => Promise<Map<string, string>>;
  /** The database's schema as the install reads it. */
  viewOf: (connectionId: string) => Promise<SnapshotView>;
}

/** The most notes one record answers with: one per column of a table at most, and no table has more than this many. */
const NOTES_MAX = 500;

const notesParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
const notesQuery = z
  .object({
    /** The companies table, by its id or its stored name `<app>:<ref>`. */
    table: z.string().min(1).max(200),
    /** The record's key. */
    row: z.string().min(1).max(200),
  })
  .strict();
const notesReply = z.object({
  /** The table as the add-on's tables name it (`<app>:<ref>`). */
  table: z.string(),
  row: z.string(),
  notes: z.array(
    z.object({
      column: z.string(),
      /** The source's id, and its name in the reader's language (the add-on's key for it, to translate where its words are loaded). */
      source: z.string(),
      label: z.string(),
      labelKey: z.string().nullable(),
      /** When it was found, in milliseconds. */
      foundAt: z.number(),
    }),
  ),
});
export type LeadNotesReply = z.infer<typeof notesReply>;

/** A source's name for a reader: the add-on's words in their language, else its English, else the source's id. */
export function sourceLabel(manifest: Parameters<typeof sourcesOf>[0], source: string, locale: string): { label: string; labelKey: string | null } {
  const entry = sourcesOf(manifest).find((one) => one.id === source);
  if (entry?.label === undefined) return { label: source, labelKey: null };
  return { label: readerWords(entry.labels, locale) ?? entry.label.fallback, labelKey: entry.label.key };
}

/** Registers the notes route on the lead door's plugin (`/api/v1/leads/:key/notes`). */
export function leadNotesRoute(app: FastifyInstance, deps: LeadNotesDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { meta, manifests } = deps;

  /** The install a person reaches, of an add-on that speaks for sources. */
  async function notesGuard(request: FastifyRequest): Promise<void> {
    const { key } = request.params as { key: string };
    const reach = installReachOf(meta, request);
    const install: InstalledManifest | null = await resolveInstall(manifests, key, selectorOf(request), { kind: 'add-on', connectionNames: deps.connectionNames, reaches: reach });
    // One install is answered without asking whether the caller reaches it: asked here, and refused as absent.
    if (install === null || !(await reach(install))) throw new NotFoundError(`${key} is not installed.`);
    const manifest = installManifest(install);
    if (manifest === null || !speaksForSources(manifest)) throw new NotFoundError(`"${key}" finds no companies.`);
    rememberInstall(request, install);
  }

  api.get(
    '/leads/:key/notes',
    {
      preHandler: [app.requireAuth, notesGuard],
      // A read of where a record's fields came from: it writes nothing.
      config: { audience: 'staff' as const },
      schema: { params: notesParams, querystring: notesQuery, response: { 200: notesReply } },
    },
    async (request) => {
      const install = rememberedInstall(request);
      if (install === undefined) throw new NotFoundError('That add-on is not installed.');
      const manifest = installManifest(install);
      if (manifest === null) throw new NotFoundError('That add-on is not installed.');
      const user = (request as unknown as { user?: { id?: string } }).user;
      if (user?.id === undefined) throw new UnauthorizedError();
      const connectionId = install.row.connectionId;
      if (connectionId === null) throw new ValidationFailedError('This add-on is not attached to an app’s database.', { reason: 'no-database' });
      const { table: named, row: key } = request.query;
      const view = await deps.viewOf(connectionId);
      const companies = await companiesTableFor(meta, connectionId, view, named);
      if (companies === null) throw new ValidationFailedError(`"${named}" is not a table of companies here.`, { reason: 'no-companies-table' });
      const tableRef = storedTableRef(await tableRefIndex(meta, connectionId, view.model), companies.table.id);
      // The record as the person reads it: none, a 404, as the record page has.
      const row = await readAsPerson(app, request, connectionId, companies.table.id, key);
      if (row === null) throw new NotFoundError('That company is not here, or not one you can open.');
      const found = await leadsInstall({ meta, manager: deps.manager, viewFor: async () => view }, install.row.id);
      const fieldSources = found?.addOn.fieldSources ?? null;
      if (fieldSources === null) return { table: tableRef, row: key, notes: [] };

      const { db } = await deps.manager.data(connectionId);
      const noted = (await db
        .selectFrom(fieldSources.id as never)
        .select([sql.ref('column_name').as('column_name'), sql.ref('source').as('source'), sql.ref('found_at').as('found_at'), sql.ref('value_hash').as('value_hash')] as never)
        .where(sql.ref('table_ref'), '=', tableRef as never)
        .where(sql.ref('row_key'), '=', key as never)
        .limit(NOTES_MAX)
        .execute()) as { column_name: string; source: string; found_at: unknown; value_hash: string }[];
      const locale = await recipientLocale(meta, user.id);
      const notes: LeadNotesReply['notes'] = [];
      for (const one of noted) {
        const column = String(one.column_name);
        // A row of the engine's own (`*person`, a sole trader's mark), not a field of the record.
        if (column.startsWith('*')) continue;
        // A field whose value moved since the fill has no note; nor one the reader is not shown (it reads as empty, and an
        // empty value is never noted) or is shown masked.
        const kind = shownKindOf(companies.table.columns.get(column)?.logicalType);
        if (valueHash(row[column], kind) !== String(one.value_hash).trim().toLowerCase()) continue;
        const foundAt = readInstant(one.found_at)?.getTime();
        if (foundAt === undefined) continue;
        notes.push({ column, source: String(one.source), ...sourceLabel(manifest, String(one.source), locale), foundAt });
      }
      notes.sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
      return { table: tableRef, row: key, notes };
    },
  );
}
