// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the email pages hand the assistant.
 *
 * THE PREVIEW IS THIS PAGE'S OWN SHEET. `renderPreview` draws the artefact
 * with `EmailCanvas readOnly` — the same component the editor draws a
 * document with — so there is one renderer for an email in this product and
 * not two to keep in step. The arrow only points this way: nothing in
 * `src/assistant` imports this file, and nothing here imports the modal.
 *
 * THE ARTEFACT IS NOT A DOCUMENT YET. What comes back is the envelope the
 * server accepts — `{ kind, name, locale, document }` — where `document` is
 * the PUT body's shape, which leaves out what it can default. The canvas
 * needs the full envelope, so {@link documentOf} fills the gaps and throws
 * nothing away; a field it cannot read renders as the empty value rather
 * than failing a preview over a missing footer.
 *
 * WHAT A SAVE DOES HERE. Invalidate the manager's lists, then navigate —
 * that order, because a list invalidated while it is unmounted can still be
 * inside its stale window when it mounts again a moment later.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { dirForLocale, isLocaleId } from '@adminium/i18n';

import { DEFAULT_BRANDING, brandingQuery } from '../app/branding.js';
import type { AssistantHostContext } from '../assistant/hostContext.js';
import type { EmailAttachment, EmailBlockRecord, EmailBrand, EmailDocument } from './api.js';
import { EmailCanvas } from './editor/canvas/EmailCanvas.js';
import { invalidateEmailDocuments } from './queries.js';

const NO_FILES = new Map<string, null>();

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The artefact's `document`, filled out to what the canvas reads. */
export function documentOf(artefact: Record<string, unknown>): EmailDocument {
  const doc = record(artefact['document']);
  const raw = Array.isArray(doc['blocks']) ? doc['blocks'] : [];
  const blocks: EmailBlockRecord[] = raw.map((entry, index) => {
    const block = record(entry);
    return {
      // A proposed block has no row id yet; the index is a stable key for a
      // list that is re-rendered, never re-ordered, inside a preview.
      id: str(block['id']) === '' ? `draft_${index}` : str(block['id']),
      block: str(block['block']),
      data: record(block['data']),
      style: record(block['style']),
    };
  });
  const brand = doc['brand'];
  return {
    subject: str(doc['subject']),
    preheader: str(doc['preheader']),
    blocks,
    brand: brand === null || brand === undefined ? null : (record(brand) as unknown as EmailBrand),
    footer: str(doc['footer']),
    attachments: (Array.isArray(doc['attachments']) ? doc['attachments'] : []) as EmailAttachment[],
  };
}

/** The locale the sheet is laid out in — the artefact's, not the operator's. */
function dirOf(artefact: Record<string, unknown>): 'ltr' | 'rtl' {
  const locale = str(artefact['locale']);
  return isLocaleId(locale) ? dirForLocale(locale) : 'ltr';
}

/** The two things both email hosts share: the sheet and what a save does. */
function useEmailHostParts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const branding = useQuery(brandingQuery()).data ?? DEFAULT_BRANDING;

  const renderPreview = useCallback(
    (artefact: Record<string, unknown>) => (
      <EmailSheet artefact={artefact} appName={branding.appName} logoUrl={branding.logoUrl} />
    ),
    [branding.appName, branding.logoUrl],
  );

  const onCreated = useCallback(
    (created: { id: string; kind: string; name: string }, open: boolean) => {
      void invalidateEmailDocuments(queryClient);
      if (open) void navigate({ to: '/email-templates/$id', params: { id: created.id } });
    },
    [navigate, queryClient],
  );

  return { renderPreview, onCreated };
}

/**
 * The sheet itself, a component rather than a call so the canvas keeps its
 * own render scope inside the modal's tree.
 */
function EmailSheet({
  artefact,
  appName,
  logoUrl,
}: {
  artefact: Record<string, unknown>;
  appName: string;
  logoUrl: string | null;
}) {
  const document = useMemo(() => documentOf(artefact), [artefact]);
  return (
    <EmailCanvas
      document={document}
      dir={dirOf(artefact)}
      vars={[]}
      attachmentsResolved={[]}
      appName={appName}
      accent="var(--accent)"
      logoUrl={logoUrl}
      files={NO_FILES}
      readOnly
    />
  );
}

/** The manager: no open document, and nowhere to put a draft without saving it. */
export function useEmailManagerAssistant(tab: string): AssistantHostContext {
  const { renderPreview, onCreated } = useEmailHostParts();
  return useMemo(
    () => ({ context: 'email', host: { tab, connectionIds: [] }, renderPreview, onCreated }),
    [onCreated, renderPreview, tab],
  );
}

/**
 * The editor: the open document, the unsaved draft, and `applyDraft`.
 *
 * `applyDraft` is ONE `histMutate` — one history step, because one thing
 * happened, and `Ctrl/⌘+S` still governs whether it ever reaches the server.
 * It selects the first block whose contents differ so the inspector opens on
 * something that changed, and falls back to the first block when the whole
 * document is new.
 */
export function useEmailEditorAssistant(input: {
  documentId: string;
  draft: EmailDocument;
  applyDocument: (document: EmailDocument) => void;
}): AssistantHostContext {
  const { renderPreview, onCreated } = useEmailHostParts();
  const { documentId, draft, applyDocument } = input;
  const applyDraft = useCallback(
    (artefact: Record<string, unknown>) => {
      applyDocument(documentOf(artefact));
    },
    [applyDocument],
  );
  return useMemo(
    () => ({
      context: 'email',
      host: { documentId, connectionIds: [] },
      draft,
      renderPreview,
      onCreated,
      applyDraft,
    }),
    [applyDraft, documentId, draft, onCreated, renderPreview],
  );
}
