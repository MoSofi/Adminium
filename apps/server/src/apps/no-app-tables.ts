// SPDX-License-Identifier: AGPL-3.0-only
/**
 * No app or add-on makes or changes tables in the user's own database.
 *
 * In an operator project the visitor's database is connected as `yours`
 * (`ADMINIUM_YOUR_DATABASE`). It is theirs: Adminium builds pages over the
 * tables it has, and an app, an add-on, the Designer or the schema assistant
 * putting tables of its own there would change a database the visitor never
 * asked us to change. So the one place tables are created for an install
 * (`add-ons/schema-target.ts` `applyPlanTo`, which apps and add-ons share)
 * and the one place an app's edit changes existing tables (`apps/schema-target.ts`)
 * refuse a connection with the project key `yours`, by its key alone (E15).
 * A person in Studio editing their own schema is not an app, and is not held here.
 */
import { ForbiddenError } from '../errors.js';

/** The project key of the user's own database in an operator project. */
export const YOURS_KEY = 'yours';

/** Throws 403 when an app or add-on would make or change tables on `yours`. */
export function assertNoAppTables(connection: { projectKey: string | null; name: string }, tables: readonly string[]): void {
  if (connection.projectKey !== YOURS_KEY || tables.length === 0) return;
  throw new ForbiddenError(
    'Apps and add-ons do not make or change tables in your own database. Their tables go in the server’s own database.',
    'FORBIDDEN',
    { code: 'NO_APP_TABLES', projectKey: YOURS_KEY, tables: [...tables] },
  );
}
