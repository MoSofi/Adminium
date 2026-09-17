// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's draft: the five things a save carries — name, status,
 * topic, language and the body — as one value, so history snapshots and
 * the dirty check cover all of them.
 *
 * The draft is read from the detail reply once, when the editor opens, and
 * from then on it is the editor's own (model: explicit save, no timer): a
 * refetch never overwrites what is being typed. The dirty state is DERIVED —
 * the draft against the last saved draft — so undoing back to exactly what
 * was saved reads *All changes saved* again, which is the truth.
 */
import type { InvoiceDetail, InvoicePutBody } from '../api.js';
import type { InvoiceBody, InvoiceStatus, InvoiceTopic } from './envelope.js';
import type { InvoiceLang } from './languages.js';

export interface EditorDraft {
  name: string;
  status: InvoiceStatus;
  topic: InvoiceTopic;
  lang: InvoiceLang;
  body: InvoiceBody;
}

export function draftFromDetail(detail: InvoiceDetail): EditorDraft {
  return { name: detail.name, status: detail.status, topic: detail.topic, lang: detail.lang, body: detail.body };
}

/** What `PUT /invoices/:id` takes. */
export function putBodyOf(draft: EditorDraft): InvoicePutBody {
  return {
    name: draft.name.trim() === '' ? draft.name : draft.name.trim(),
    status: draft.status,
    topic: draft.topic,
    lang: draft.lang,
    body: draft.body,
  };
}

export function sameDraft(a: EditorDraft, b: EditorDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
