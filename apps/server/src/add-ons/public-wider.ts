// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE THAT WOULD WIDEN A PUBLIC ENDPOINT A KEY ALREADY USES — show a
 * column visitors did not see, take a method, let more rows through — asks
 * the operator first, the way a wider role grant does (`roleTables`): the
 * check lists each such endpoint (`publicWider`), and the update is refused
 * before anything moves unless the call allows it (`"publicWider": true`).
 *
 * Shared by an app's update and an add-on's, so both say it in one way. The
 * list itself is worked out where endpoints are planned (`apps/`).
 */
import { ForbiddenError, ValidationFailedError } from '../errors.js';

/** An endpoint an update would widen for the keys that already use it: what it would show and take more, and why that is asked. */
export interface PublicWidening {
  ref: string;
  /** The manifest whose entry it is: the app, or an add-on. */
  owner: string;
  /** Columns the endpoint would newly show. */
  columns: string[];
  /** Methods it would newly take. */
  methods: string[];
  /** A filter, or a limit on what may be written, loosened. */
  rows: boolean;
  /** Each widening in words. */
  reasons: string[];
}

/** One widening in words: `"customiser_ready_designs" would show app`. */
function wideningWords(entry: PublicWidening): string {
  const parts = [
    ...(entry.columns.length === 0 ? [] : [`show ${entry.columns.join(', ')}`]),
    ...(entry.methods.length === 0 ? [] : [`take ${entry.methods.join(', ')}`]),
    ...(entry.rows ? ['let more rows through'] : []),
  ];
  return `"${entry.ref}" would ${parts.length === 0 ? 'reach more' : parts.join(' and ')}`;
}

/**
 * Refused before anything moves: an update that would widen an endpoint a
 * key already uses, unless the operator allowed it on the check
 * (`publicWider: true`) — and only someone who may manage API keys may.
 */
export function refusePublicWider(what: string, wider: readonly PublicWidening[], allowed: boolean | undefined, mayManageKeys: boolean): void {
  if (wider.length === 0) return;
  if (allowed !== true) {
    throw new ValidationFailedError(
      `${what} lets visitors who already use its public endpoints see or do more: ${wider.map(wideningWords).join('; ')}. ` +
        'Check the update and allow it ("publicWider": true), or keep the running version.',
      { reason: 'PUBLIC_WIDER', publicWider: wider.map((entry) => ({ ...entry })) },
    );
  }
  if (!mayManageKeys) {
    throw new ForbiddenError(`${what} widens what its public endpoints show, which only someone who may manage API keys can allow.`);
  }
}
