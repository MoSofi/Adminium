// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio LLM-runs review area (milestone). The route factory
 * (`studio/routes.tsx`) lazy-loads {@link ReviewScreen} from
 * `./ReviewScreen.tsx` and mounts it at `/studio/llm-runs/:runId/review`.
 */
export { ReviewScreen } from './ReviewScreen.js';
export type { ReviewScreenProps } from './ReviewScreen.js';
