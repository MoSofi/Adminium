// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "THE SCREEN SHOWED THE LINE" — how a staff save says it told the person
 * they can say no to the business's mail, where it took their address.
 *
 * An app's staff screen that shows the line (the CRM's contact sheet, its
 * enquiry form, its new-deal sheet) sends, beside the row's values:
 *
 *   optOut: { shown: true }        the line was shown with the address typed
 *   optOut: { from: "<row key>" }  the person is made from that row (a claimed
 *                                  enquiry): its mark comes with them
 *
 * The server stamps the table's declared opt-out mark from it
 * (`people[].optOutMark`, `crud/decide.ts`): on a create, or a change of the
 * address, with an address in the row. Why a word of the request, and why
 * it is trusted only here:
 *
 *  - only the screen knows what it showed, so the screen must say it; the
 *    mark is a strict stamp, so the value itself is never the writer's;
 *  - it is read only from a signed-in staff member's own save through these
 *    routes (an API key is refused by name), so an import, a rule, an
 *    add-on, the API key path and the sample loader, which never pass
 *    through here as a person, can never set it;
 *  - a mark carried from another row is that row's, read as the person
 *    reads it (their grant and their row limits), and only for the same
 *    address: a mark offered to one address says nothing of another.
 */
import type { FastifyRequest } from 'fastify';
import { slotInstant } from '../../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk } from '../../crud/records.js';
import { fetchVisible, type RowLimitContext } from '../../crud/row-limit.js';
import type { WriteContext } from '../../crud/write-context.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { pkOfRowKey } from '../../payments/payables.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import { getPrincipal } from '../../rbac/principal.js';
import type { MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';
import type { SourceDatabase } from '../../connections/manager.js';
import type { OptOutBody } from './schema.js';

/** Two spellings of one address. */
const sameAddress = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What a save's `optOut` puts in its write context, or nothing when it sent
 * none. Refuses an API key, a table that keeps no mark, and a row to carry
 * from that the person cannot read.
 */
export async function optOutContext(
  meta: MetaDb,
  request: FastifyRequest,
  ctx: { connectionId: string; view: SnapshotView; table: ResolvedTable; db: Kysely<SourceDatabase>; rows: RowLimitContext | null },
  sent: OptOutBody,
  /** The new row's values, on a create: a carried mark needs the address it was offered at. */
  values: Row | null,
): Promise<Pick<WriteContext, 'optOut'>> {
  if (sent === undefined) return {};
  const principal = getPrincipal(request);
  if (principal?.kind === 'api-key') throw new ForbiddenError('The opt-out line is said by a staff screen to a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  if (principal?.kind !== 'user') throw new UnauthorizedError();
  const people = peopleTablesOf(meta);
  const declared = await people.of(ctx.connectionId, ctx.view.model, ctx.table.id);
  if (declared?.optOutMark == null) throw new ValidationFailedError('This table keeps no opt-out mark.', { fields: { optOut: { code: 'not-allowed' } } });
  let carried: string | null = null;
  if (sent.from !== undefined) {
    const from = declared.optOutMarkFrom;
    if (from === null || values === null) throw new ValidationFailedError('A mark is carried only into a new row, from the table the app names.', { fields: { optOut: { code: 'not-allowed' } } });
    let table: ResolvedTable;
    try {
      table = ctx.view.table(from.table);
    } catch {
      throw new NotFoundError('No such record to carry the mark from.');
    }
    if (!(await request.can(`table:${ctx.connectionId}:${table.id}:read`))) throw new NotFoundError('No such record to carry the mark from.');
    const pk = pkOfRowKey(table, sent.from);
    const row = pk === null ? undefined : ctx.rows === null ? await fetchByPk(ctx.db, table, pk) : await fetchVisible(ctx.rows, ctx.db, table, pk, 'read');
    if (row === undefined) throw new NotFoundError('No such record to carry the mark from.');
    const mark = slotInstant(row[from.column]);
    // The mark was offered at that row's address: it comes with the person only to the same one.
    const fromDeclared = await people.of(ctx.connectionId, ctx.view.model, table.id);
    const fromAddress = fromDeclared?.email == null ? undefined : row[fromDeclared.email];
    const toAddress = declared.email === null ? undefined : values[declared.email];
    if (mark !== null && (fromAddress === undefined || sameAddress(fromAddress, toAddress))) carried = mark.toISOString();
  }
  return { optOut: { shown: sent.shown === true, carried } };
}
