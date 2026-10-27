// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE ADDRESS A PUBLIC SESSION PROVED IT READS MAIL AT.
 *
 * A customer proves a mailbox by reading mail sent to it: a code e-mailed to
 * their row's address (a claim raised to `verified`), or a sign-in link
 * e-mailed there (`link`). Either way the mailbox is the claimed row's
 * address column, the scope's `claim.email`. Nothing else proves one:
 *  - a session found by matching a row's details (`lookup`) proves only that
 *    somebody knew them;
 *  - a row's own link (`token`) may have been handed over, copied or
 *    forwarded, so it proves no mailbox either.
 * A desk change of that address ends the person's sessions
 * (`identity-email-watch.ts`), and the person may not write it themselves,
 * so the row read now still holds the address the mail went to.
 *
 * What the write side does with it (`people/consent-writes.ts`): a public yes
 * overrules a "no" standing for an address only when this is that address.
 */
import type { Row } from '../crud/mask.js';
import { normaliseAddress, plausibleAddress } from './claim-code.js';
import type { PublicSessionContext } from './claim.js';
import type { CompiledScope } from './scope.js';

/** The address (trimmed, lower case) the session proved, or null when it proved none. */
export function provedAddressOf(scope: Pick<CompiledScope, 'claim'>, session: PublicSessionContext | null, claimed: Row | null): string | null {
  if (session === null || claimed === null || session.kind === 'token') return null;
  if (session.level !== 'verified' && session.kind !== 'link') return null;
  const claim = scope.claim;
  if (claim === null || claim === undefined || claim.ref !== session.grant.ref || claim.email === undefined) return null;
  const value = claimed[claim.email];
  return plausibleAddress(value) ? normaliseAddress(value) : null;
}
