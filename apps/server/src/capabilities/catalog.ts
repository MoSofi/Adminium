/**
 * The host-capability vocabulary the desktop shell can be granted (11-electron.md
 * §12 / 13-marketplace.md §2.11).
 *
 * A CLOSED set, and that is the point. A capability grant is an authorization to
 * reach real hardware on the user's machine, so the route that writes one
 * validates its `capabilityId` against this list rather than trusting the caller
 * — an unknown id is a bad request (a typo, a manifest for a driver this build
 * does not have), not a grant for a capability that cannot exist. v1 ships one
 * concrete id, the ESC/POS receipt printer the POS micro-SaaS (13-marketplace.md
 * §10) will use; the list grows with the drivers.
 *
 * WHAT THIS FILE DOES NOT OWN: the DESCRIPTOR — a capability's status
 * (`available` / `stub` / `unavailable`) and method list. Those belong to the
 * main-process `CapabilityHost`, which holds the providers and is the only thing
 * that ever sees a device (§1 principle 2: the server owns data, not hardware).
 * The server owns the id vocabulary — enough to validate a grant — and the grant
 * table itself (`adminium_settings`, reached over the loopback REST API by main).
 */

import { z } from 'zod';

/**
 * The dotted capability ids this build knows how to grant. Reverse-mapped from
 * 13-marketplace.md's advisory `capabilities` vocabulary: a manifest declaring
 * `receipt-printer` needs `printer.escpos`.
 */
export const capabilityIdSchema = z.enum(['printer.escpos']);

export type KnownCapabilityId = z.infer<typeof capabilityIdSchema>;

/** The known ids as a tuple, for callers that want to iterate the vocabulary. */
export const KNOWN_CAPABILITY_IDS = capabilityIdSchema.options;

export function isKnownCapabilityId(id: string): id is KnownCapabilityId {
  return capabilityIdSchema.safeParse(id).success;
}
