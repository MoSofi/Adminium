// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-queue-inbox` template (09-generated-app.md §7.4; 04 §10) — the
 * component the dashboard PageRenderer mounts for
 * `template: 'page-queue-inbox'` envelopes: KPI row + segment tabs + queue
 * list with undo-first bulk approve/reject + reject-with-reason modal, plus
 * the QueueApi adapter contract the interpreter implements over the CRUD
 * bulk endpoint.
 */
export {
  PAGE_QUEUE_INBOX_TEMPLATE_ID,
  PageQueueInbox,
  QUEUE_PAGE_SIZE,
  decisionValuesOf,
  type PageQueueInboxLabels,
  type PageQueueInboxProps,
} from './PageQueueInbox.js';
export type { QueueApi, QueueMutationResult } from './queue-api.js';
