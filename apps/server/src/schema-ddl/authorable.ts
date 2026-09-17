// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Can this connection's schema be authored at all?.
 *
 * ─── One function, two callers, no drift ───────────────────────────────────
 *
 * The same fact is needed in two places: the DDL routes refuse a
 * connection they cannot write to (403 `READ_ONLY_MODE`), and Studio does not
 * offer a surface that would only produce that 403 — "absence, not a disabled
 * button".
 *
 * Those are the same four questions, and answering them twice is how the UI
 * ends up hiding a surface the server allows, or worse, offering one the
 * server refuses. So the guard and the DTO both call this, and the reason
 * codes the UI renders are literally the ones the refusal carries.
 *
 * Not a permission check. Whether the SIGNED-IN PERSON may do this is
 * `schema.ddl` plus, for a destructive plan, Super Admin; this is about the
 * connection itself, and it holds identically for every operator.
 */
import type { Connection } from '@adminium/meta';

/** Why a connection's schema cannot be authored. `null` means it can. */
export type UnauthorableReason =
  | 'NO_LIVE_DATABASE'
  | 'READ_ONLY_ROLE'
  | 'NO_DDL_PRIVILEGE'
  | 'READ_ONLY_INTENT';

export interface UnauthorableRefusal {
  reason: UnauthorableReason;
  message: string;
}

/**
 * The refusal this connection earns, or `null` when its schema is authorable.
 *
 * Order matters and is deliberate: a schema-file connection has no database at
 * all, so saying "your role cannot run DDL" about it would name a role that is
 * not the problem. Each check is only reached once the ones above it have
 * passed, which is what makes every message true when it is the one shown.
 */
export function unauthorableReason(connection: Connection): UnauthorableRefusal | null {
  if (connection.sourceKind === 'schema-file') {
    return {
      reason: 'NO_LIVE_DATABASE',
      message: 'This connection was created from a schema file, so there is no database to change.',
    };
  }
  if (connection.readOnly) {
    return {
      reason: 'READ_ONLY_ROLE',
      message: 'This connection uses a read-only role, so Adminium cannot change its schema.',
    };
  }
  if (connection.canDdl === false) {
    return {
      reason: 'NO_DDL_PRIVILEGE',
      message:
        "This connection's role cannot run DDL. Grant it schema privileges, or connect a role that has them.",
    };
  }
  if (connection.settings.intent === 'read-only-analytics') {
    return {
      reason: 'READ_ONLY_INTENT',
      message: 'This connection was set up for read-only analytics. Change its intent to edit its schema.',
    };
  }
  return null;
}
