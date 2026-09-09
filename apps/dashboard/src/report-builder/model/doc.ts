// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's draft (43-report-builder.md §3.5): the three things a save
 * carries — name, status and the body — as one value, so history snapshots
 * and the dirty check cover all of them.
 *
 * The draft is read from the detail reply once, when the editor opens, and
 * from then on it is the editor's own (34 O22 → 39 D1's model, inherited by
 * 43 D4/O6: explicit save, no timer): a refetch never overwrites what is
 * being typed. The dirty state is DERIVED — the draft against the last saved
 * draft — so undoing back to exactly what was saved reads *All changes saved*
 * again, which is the truth.
 */
import type { ReportDetail, ReportPutBody } from '../api.js';
import type { ReportBody, ReportStatus } from './envelope.js';

export interface EditorDraft {
  name: string;
  status: ReportStatus;
  body: ReportBody;
}

export function draftFromDetail(detail: ReportDetail): EditorDraft {
  return { name: detail.name, status: detail.status, body: detail.body };
}

/** What `PUT /report-documents/:id` takes. */
export function putBodyOf(draft: EditorDraft): ReportPutBody {
  return {
    name: draft.name.trim() === '' ? draft.name : draft.name.trim(),
    status: draft.status,
    body: draft.body,
  };
}

export function sameDraft(a: EditorDraft, b: EditorDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
