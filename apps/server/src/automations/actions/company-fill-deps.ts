// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the "fill in the company" step reaches a lead source add-on with.
 *
 * It lives in its own file, apart from the step, because the actions' shared
 * context (`types.ts`) names it: kept beside the step, the context would import
 * the step, which imports the record writer, which imports the context again.
 */
import type { LeadSourceDeps } from '../../lead-sources/call.js';

export interface CompanyFillDeps {
  /** One call to one source (`lead-sources/call.ts`), with the add-on runtime, the keys and the operator's switches. */
  call: Omit<LeadSourceDeps, 'meta'>;
  /** Whether this server calls anything outside at all. */
  networkFeatures: () => boolean;
}
