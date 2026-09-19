// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the invoice pages hand the assistant.
 *
 * TWO PAGES, TWO CONTEXTS, TWO PREVIEWS. The manager at `/invoices` is the
 * `invoices` context: what it drafts is a RECORD, and a record has no sheet
 * until it is a document — so its preview is the assistant's own field grid,
 * handed the account, the template, the period and the money. The editor is
 * the `invoice-template` context, and its preview is this page's own paper:
 * `InvoiceCanvas readOnly`, the same component the editor draws with, so
 * there is one invoice renderer in this product and not two.
 *
 * THE MONEY IS THIS PAGE'S, ALWAYS. Every figure in either preview comes from
 * `model/money.ts` — integer minor units, one rounding per line, the same
 * cents on every runtime. The model's own arithmetic is never shown: it is
 * not wrong often, but "not often" is not a property a document can be built
 * on, and the figure a person approves must be the figure the save writes.
 *
 * THE ARTEFACT IS NOT A BODY YET. `normalizeBody` fills an envelope from
 * whatever the turn produced — the same lenient reader a stored row goes
 * through — so a missing field renders as its default instead of failing a
 * preview.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { DraftPreview } from '../assistant/parts/DraftPreview.js';
import type { AssistantHostContext, AssistantPreviewMeta } from '../assistant/hostContext.js';
import { InvoiceCanvas } from './editor/canvas/InvoiceCanvas.js';
import type { EditorDraft } from './model/doc.js';
import {
  isInvoiceTopic,
  normalizeBody,
  type InvoiceBody,
  type InvoiceTopic,
} from './model/envelope.js';
import { isInvoiceLang, type InvoiceLang } from './model/languages.js';
import { formatMoney, totalsOf } from './model/money.js';
import { invalidateInvoices } from './queries.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The artefact's `body`, filled out to the envelope both previews read. */
export function bodyOf(artefact: Record<string, unknown>): InvoiceBody {
  return normalizeBody(record(artefact['body']));
}

/** The artefact as the sheet's draft: an unsaved document, so its status is `draft`. */
export function draftOf(artefact: Record<string, unknown>): EditorDraft {
  const topic: InvoiceTopic = isInvoiceTopic(artefact['topic']) ? artefact['topic'] : 'other';
  const lang: InvoiceLang = isInvoiceLang(artefact['lang']) ? artefact['lang'] : 'en';
  const name = typeof artefact['name'] === 'string' ? artefact['name'] : '';
  return { name, status: 'draft', topic, lang, body: bodyOf(artefact) };
}

/** What a save does on both pages: the list first, then the route (a stale list outlives a navigation). */
function useOnCreated() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    (created: { id: string; kind: string; name: string }, open: boolean) => {
      void invalidateInvoices(queryClient);
      if (open) void navigate({ to: '/invoices/$id', params: { id: created.id } });
    },
    [navigate, queryClient],
  );
}

/** The record grid: the manager's preview, priced by this page's own law. */
function InvoiceRecordPreview({ artefact, meta }: { artefact: Record<string, unknown>; meta: AssistantPreviewMeta }) {
  const { amounts, total } = useMemo(() => {
    const body = bodyOf(artefact);
    const totals = totalsOf(body);
    return {
      amounts: totals.lines.map((minor) => formatMoney(minor, body.currency, body.cents)),
      total: formatMoney(totals.total, body.currency, body.cents),
    };
  }, [artefact]);
  return <DraftPreview artefact={artefact} basedOnLabel={meta.basedOn} amounts={amounts} total={total} />;
}

/** The paper: the editor's preview, drawn by the editor's own canvas. */
function InvoiceSheetPreview({ artefact }: { artefact: Record<string, unknown> }) {
  const draft = useMemo(() => draftOf(artefact), [artefact]);
  const totals = useMemo(() => totalsOf(draft.body), [draft.body]);
  return <InvoiceCanvas draft={draft} totals={totals} readOnly />;
}

/** The manager (`/invoices`, both tabs): a record host with nowhere to put a draft. */
export function useInvoiceManagerAssistant(tab: string): AssistantHostContext {
  const onCreated = useOnCreated();
  const renderPreview = useCallback(
    (artefact: Record<string, unknown>, meta: AssistantPreviewMeta) => <InvoiceRecordPreview artefact={artefact} meta={meta} />,
    [],
  );
  return useMemo(
    () => ({ context: 'invoices', host: { tab, connectionIds: [] }, renderPreview, onCreated }),
    [onCreated, renderPreview, tab],
  );
}

/**
 * The editor: the open document, its unsaved body, and `applyDraft`.
 *
 * `applyDraft` hands the body to the editor, which replaces the draft in ONE
 * history step and selects a section — one undo takes the whole thing back,
 * because one thing happened.
 */
export function useInvoiceEditorAssistant(input: {
  documentId: string;
  draft: InvoiceBody;
  applyBody: (body: InvoiceBody) => void;
}): AssistantHostContext {
  const onCreated = useOnCreated();
  const { documentId, draft, applyBody } = input;
  const renderPreview = useCallback((artefact: Record<string, unknown>) => <InvoiceSheetPreview artefact={artefact} />, []);
  const applyDraft = useCallback(
    (artefact: Record<string, unknown>) => {
      applyBody(bodyOf(artefact));
    },
    [applyBody],
  );
  return useMemo(
    () => ({
      context: 'invoice-template',
      host: { documentId, connectionIds: [] },
      draft,
      renderPreview,
      onCreated,
      applyDraft,
    }),
    [applyDraft, documentId, draft, onCreated, renderPreview],
  );
}
