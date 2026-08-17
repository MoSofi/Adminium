// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-scheduler` template (09-generated-app.md §7.6; 04 §10) — the component
 * the dashboard PageRenderer mounts for `template: 'page-scheduler'` envelopes,
 * plus the interactive ShiftMatrix (click-to-cycle shift writes, M7-T03).
 */
export {
  PAGE_SCHEDULER_TEMPLATE_ID,
  PageScheduler,
  capacityItemConfigOf,
  capacityModelOf,
  matrixItemConfigOf,
  matrixModelOf,
  type MatrixModel,
  type PageSchedulerLabels,
  type PageSchedulerProps,
} from './PageScheduler.js';
export {
  ShiftMatrix,
  type ShiftCell,
  type ShiftMatrixLabels,
  type ShiftMatrixProps,
  type ShiftResource,
  type ShiftTypeDef,
} from './ShiftMatrix.js';
