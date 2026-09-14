// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a refused upload records, and what it tells the operator.
 *
 * Shared by the add-on sideload (`routes/add-ons`) and the app upload
 * (`routes/apps`). Both stage their bytes through the same store, so they are
 * refused for the same reasons, and one wording keeps the two forms from
 * describing the same refusal in two different ways.
 */

import { AppError } from '../errors.js';
import { AddOnArchiveError } from './archive.js';
import { AddOnStoreError } from './store.js';

/** The reason code an audit row records for a refusal. */
export function refusalReason(error: unknown): string {
  if (error instanceof AddOnArchiveError || error instanceof AddOnStoreError) return error.reason;
  if (error instanceof AppError) {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    return typeof reason === 'string' ? reason : 'INVALID';
  }
  return 'UNKNOWN';
}

/**
 * The sentence for an upload the store or the archive reader refused.
 *
 * Two refusals are about something the operator can act on from the upload
 * form itself, so they say what: a hash pasted for a different file, and a
 * `.tgz` with no manifest in it. The rest are archive-hardening refusals, named
 * by their code so an operator reporting one has something to quote. Anything
 * else was not a refusal of the file, and says nothing about it.
 *
 * @param noun What the upload is called on its form: `app bundle`, `add-on package`.
 */
export function uploadRefusalMessage(error: unknown, noun: string): string {
  if (!(error instanceof AddOnArchiveError || error instanceof AddOnStoreError)) {
    return `The uploaded ${noun} was refused.`;
  }
  switch (error.reason) {
    case 'INTEGRITY_MISMATCH':
      return `The ${noun} does not match the integrity value it was sent with.`;
    case 'MANIFEST_MISSING':
      return `This file carries no \`manifest.json\` at its root, so it is not an ${noun}.`;
    default:
      return `This file could not be read as an ${noun} (${error.reason}).`;
  }
}
