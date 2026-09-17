// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's draft (`model/doc.ts`): the four things a save carries — name,
 * category, status and the envelope — as one value, so history snapshots and
 * the dirty check cover all of them.
 *
 * The draft is read from the detail reply once, when the editor opens, and
 * from then on it is the editor's own (D1): a refetch never overwrites what is
 * being typed. The dirty state is DERIVED — the draft against the last saved
 * draft — so undoing back to exactly what was saved reads *All changes saved*
 * again, which is the truth.
 */
import type { EmailCategory, EmailDocument, EmailDocumentDetail, EmailDocumentInput, EmailMirrorOp } from '../api.js';

export interface EditorDraft {
  name: string;
  category: EmailCategory;
  enabled: boolean;
  document: EmailDocument;
}

export function draftFromDetail(detail: EmailDocumentDetail): EditorDraft {
  return {
    name: detail.name,
    category: detail.category,
    enabled: detail.enabled,
    document: detail.document,
  };
}

/** What `PUT /email-templates/:id` takes; mirror ops ride the same save (D1). */
export function putBodyOf(draft: EditorDraft, mirrorOps: readonly EmailMirrorOp[]) {
  const document: EmailDocumentInput = {
    subject: draft.document.subject,
    preheader: draft.document.preheader,
    blocks: draft.document.blocks.map((block) => ({ ...block })),
    footer: draft.document.footer,
    brand: draft.document.brand,
    attachments: draft.document.attachments,
  };
  return {
    name: draft.name.trim() === '' ? draft.name : draft.name.trim(),
    category: draft.category,
    enabled: draft.enabled,
    document,
    ...(mirrorOps.length === 0 ? {} : { mirrorOps: [...mirrorOps] }),
  };
}

export function sameDraft(a: EditorDraft, b: EditorDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
