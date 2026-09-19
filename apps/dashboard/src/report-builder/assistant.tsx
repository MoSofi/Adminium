// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the report pages hand the assistant.
 *
 * ONE CONTEXT, TWO ROUTES. Unlike the invoice pages, the manager and the
 * editor are the same context here — both are about reports, and a report is
 * the same thing whether it is a layout or a run of one. Both preview the
 * same way, too: `ReportCanvas readOnly`, the same component the editor draws
 * with, so there is one report renderer in this product and not two.
 *
 * THE FIGURES ARE NOT RECOMPUTED HERE. A report block holds typed-in values,
 * and the numbers in them came from the database when the draft was made.
 * *Run full preview* asks the SERVER to re-run the stored descriptors with
 * the acting person's own grants; this file draws whatever artefact comes
 * back. A sheet that recalculated anything locally would be showing a number
 * nobody could account for.
 *
 * NOTHING HERE PUBLISHES. The editor's primary sets `status: 'sent'`; an
 * assistant save lands a draft and `applyDraft` touches the body alone, so
 * neither path can publish a report on somebody's behalf.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import type { AssistantHostContext } from '../assistant/hostContext.js';
import { ReportCanvas } from './editor/canvas/ReportCanvas.js';
import { normalizeReportBody, type ReportBody } from './model/envelope.js';
import { invalidateReportDocuments } from './queries.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The artefact's `body`, filled out to the envelope the sheet reads. */
export function bodyOf(artefact: Record<string, unknown>): ReportBody {
  return normalizeReportBody(record(artefact['body']));
}

/** The sheet, read-only, in the viewer's own locale (the figures are formatted by it). */
function ReportSheet({ artefact, locale }: { artefact: Record<string, unknown>; locale: string }) {
  const body = useMemo(() => bodyOf(artefact), [artefact]);
  return <ReportCanvas body={body} locale={locale} readOnly />;
}

/** Everything both routes share: the sheet, the locale it is drawn in, and what a save does. */
function useReportHostParts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const locale = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);

  const renderPreview = useCallback(
    (artefact: Record<string, unknown>) => <ReportSheet artefact={artefact} locale={locale} />,
    [locale],
  );
  const onCreated = useCallback(
    (created: { id: string; kind: string; name: string }, open: boolean) => {
      void invalidateReportDocuments(queryClient);
      if (open) void navigate({ to: '/report-builder/$id', params: { id: created.id } });
    },
    [navigate, queryClient],
  );
  return { renderPreview, onCreated };
}

/** The manager (`/report-builder`, both tabs): nowhere to put a draft without saving it. */
export function useReportManagerAssistant(tab: string): AssistantHostContext {
  const { renderPreview, onCreated } = useReportHostParts();
  return useMemo(
    () => ({ context: 'report', host: { tab, connectionIds: [] }, renderPreview, onCreated }),
    [onCreated, renderPreview, tab],
  );
}

/**
 * The editor: the open document, its unsaved body, and `applyDraft`.
 *
 * `applyDraft` hands the body to the editor, which replaces it in ONE history
 * step — one undo takes the whole thing back. It carries the BODY only, so a
 * draft can never move the document's status.
 */
export function useReportEditorAssistant(input: {
  documentId: string;
  draft: ReportBody;
  applyBody: (body: ReportBody) => void;
}): AssistantHostContext {
  const { renderPreview, onCreated } = useReportHostParts();
  const { documentId, draft, applyBody } = input;
  const applyDraft = useCallback(
    (artefact: Record<string, unknown>) => {
      applyBody(bodyOf(artefact));
    },
    [applyBody],
  );
  return useMemo(
    () => ({
      context: 'report',
      host: { documentId, connectionIds: [] },
      draft,
      renderPreview,
      onCreated,
      applyDraft,
    }),
    [applyDraft, documentId, draft, onCreated, renderPreview],
  );
}
