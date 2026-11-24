// SPDX-License-Identifier: AGPL-3.0-only
/** Two-way text conversations: the replies customers send, and the answers. */
export { notReadText, NOT_READ_LANGUAGES } from './not-read.js';
export { TEXTS_READ_ACTION, TEXTS_READ_LABEL, TEXTS_READ_PERMISSION, TEXTS_REPLY_ACTION, TEXTS_REPLY_LABEL, TEXTS_REPLY_PERMISSION } from './permission.js';
export { textsRoutes, textViewerOf, type RecordPhone, type TextsRoutesDeps } from './routes.js';
export {
  createTextThreads,
  deliveryStatusFor,
  mayReadApp,
  mayReplyApp,
  NOT_READ_EVERY_MS,
  readsAny,
  TEXT_ANSWER_WINDOW_MS,
  TEXT_BODY_MAX,
  TEXT_THREAD_RETAIN_MS,
  TEXT_WAITING_MS,
  TextCursorError,
  type TextApp,
  type TextDeliveryStatus,
  type TextItemView,
  type TextSendInput,
  type TextSwitchView,
  type TextThreadDetail,
  type TextThreads,
  type TextThreadsDeps,
  type TextThreadView,
  type TextViewer,
} from './service.js';
export { createTextThreadStore, type TextThreadStore } from './store.js';
export * from './types.js';
