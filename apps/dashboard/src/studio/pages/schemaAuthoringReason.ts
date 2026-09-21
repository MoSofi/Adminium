// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Why Adminium cannot add a column to this connection — one sentence, one
 * source.
 *
 * `schemaAuthoring` on the schema reply answers whether a connection's schema
 * can be authored at all, and its four reasons are facts about the CONNECTION
 * that hold identically for every operator (`schema-ddl/authorable.ts` says so
 * on the server side, for the same "one function, two callers, no drift"
 * reason). Two surfaces now render that answer — the Attachments card on the
 * page editor and the template-fit panel on the create screen — and a third
 * hand-rolled `? :` chain is how one of them ends up describing a refusal the
 * other has stopped giving.
 *
 * THE KEYS STILL READ `attachments.sidecar`. They were written for the first
 * caller and their TEXT is already connection-shaped rather than
 * attachment-shaped ("…so Adminium cannot add a column to it"), so renaming
 * them would churn eight locales to change nothing a reader sees. Edit the
 * copy here knowing both callers show it.
 */

import { t } from '../../i18n/t.js';

export type UnauthorableReason =
  | 'NO_LIVE_DATABASE'
  | 'READ_ONLY_ROLE'
  | 'NO_DDL_PRIVILEGE'
  | 'READ_ONLY_INTENT';

export interface SchemaAuthoring {
  authorable: boolean;
  reason: UnauthorableReason | null;
}

/**
 * The sentence, or `null` when this connection's schema CAN be authored.
 *
 * An ABSENT `schemaAuthoring` counts as authorable — the same tolerance
 * `RemapEditor` applies. A server one release behind does not send the field,
 * and hiding a working flow because of a missing field breaks an install that
 * was fine.
 */
export function schemaAuthoringRefusal(authoring: SchemaAuthoring | undefined): string | null {
  if (authoring === undefined || authoring.authorable) return null;
  switch (authoring.reason) {
    case 'NO_LIVE_DATABASE':
      return t(
        'studio:pages.attachments.sidecar.schemaFile',
        'This connection was created from a schema file, so Adminium cannot add a column to it.',
      );
    case 'READ_ONLY_ROLE':
      return t(
        'studio:pages.attachments.sidecar.readOnlyRole',
        'This connection signs in with a read-only role, so Adminium cannot add a column to it.',
      );
    case 'NO_DDL_PRIVILEGE':
      return t(
        'studio:pages.attachments.sidecar.noPrivilege',
        "This connection's role cannot alter tables, so Adminium cannot add a column to it.",
      );
    default:
      return t(
        'studio:pages.attachments.sidecar.readOnlyIntent',
        'This connection is set up for read-only analytics, so Adminium cannot add a column to it.',
      );
  }
}
