// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Can Adminium's own tables live in the database you just connected?
 *
 * The decision tree, as a CODE rather than a sentence — the wizard-side mirror
 * of `ConnectionManager.enforceMetaPlacement`, which re-validates independently
 * and answers 409 META_PLACEMENT_INVALID on bypass.
 *
 * It lives in its own module because two wizards now ask the question and they
 * cannot share the words: the Studio's copy is in the lazily-loaded `studio`
 * namespace, which nothing outside `src/studio` may read, and first-run
 * onboarding needs the same RULE with its own strings. A second copy of the
 * rule would drift, and the two front doors would disagree about the same
 * database — which is exactly the class of defect that put the meta question in
 * front of a browser user in the first place.
 */
import type { DsnPrivileges } from '../api.js';

export type SameDbDisabledCode = 'file' | 'read-only' | 'no-ddl';

export interface SameDbInput {
  readOnly: boolean;
  privileges: DsnPrivileges | null;
  /** A schema file (an upload) rather than a live server. */
  sourceIsFile: boolean;
}

/** `null` when the source can host the `adminium_*` tables. */
export function sameDbDisabledCode(input: SameDbInput): SameDbDisabledCode | null {
  if (input.sourceIsFile) return 'file';
  if (input.readOnly || input.privileges?.canWrite === false) return 'read-only';
  if (input.privileges !== null && !input.privileges.canDDL) return 'no-ddl';
  return null;
}
