// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/` fallback when the nav tree is empty (zero connections): the
 * `empty-no-sources` system state rendered inside the content outlet
 * (09-generated-app.md §2.3 — `/welcome` onboarding lands with 09-T14).
 * When nav items exist the index route redirects before this renders.
 */
import { StateHero } from '../states/StateHero.js';
import { SYSTEM_STATES } from '../states/stateMap.js';

export function HomePage() {
  return <StateHero spec={SYSTEM_STATES['empty-no-sources']} fullPage={false} />;
}
