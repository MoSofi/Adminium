// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Documents panel and the Make button.
 *
 * ─── BOTH ARE ABSENT UNTIL A PROVIDER IS INSTALLED ─────────────────────────
 *
 * `GET /documents/providers` is asked first, and a deployment with none gets
 * nothing at all — no empty panel, no greyed-out button. An affordance that
 * cannot do anything is worse than no affordance: it invites a click and then
 * explains itself.
 *
 * The Make button is additionally absent when no MAPPING covers this table.
 * The provider being installed says a document can be drawn somewhere; a
 * profile says it can be drawn from here.
 *
 * ─── A REDACTED ROW STILL RENDERS ──────────────────────────────────────────
 *
 * The server sends the row without its `subject` when the caller may not read
 * every table the mapping uses. The panel shows it with its number, its date
 * and no download — "this exists and is not yours to read" is a true and
 * useful thing for a record page to say, and hiding it would make the page
 * lie about what happened to this row.
 */

import { Button, Spinner } from '@adminium/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';

import { t } from '../i18n/t.js';
import {
  documentContentPath,
  documentPrintPath,
  fetchDocumentProviders,
  fetchDocumentsForEntity,
  fetchProfilesForTable,
  renderDocumentFor,
  type DocumentProfileSummary,
} from './documentsApi.js';

/** The key every documents query hangs off, so one invalidate refreshes all. */
export const documentsQueryKey = ['documents'] as const;

export function useDocumentProviders() {
  return useQuery({
    queryKey: [...documentsQueryKey, 'providers'],
    queryFn: fetchDocumentProviders,
    // Installing an add-on is rare and the answer gates a whole panel, so this
    // is worth caching for the session rather than asking on every record.
    staleTime: 5 * 60_000,
  });
}

export function useProfilesForTable(connectionId: string | null, table: string) {
  return useQuery({
    queryKey: [...documentsQueryKey, 'profiles', connectionId, table],
    queryFn: () => fetchProfilesForTable({ connectionId: connectionId!, table }),
    enabled: connectionId !== null,
    staleTime: 60_000,
  });
}

export function DocumentsPanel({
  entityTable,
  entityId,
}: {
  entityTable: string;
  entityId: string;
}) {
  const documents = useQuery({
    queryKey: [...documentsQueryKey, 'entity', entityTable, entityId],
    queryFn: () => fetchDocumentsForEntity({ entityTable, entityId }),
  });

  if (documents.isPending) return <Spinner />;
  const rows = documents.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {t('ui:documents.panel.empty', 'No documents have been drawn for this record yet.')}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border" data-testid="documents-list">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 px-3 py-2">
          <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {row.number ?? t('ui:documents.panel.unnumbered', 'Not numbered')}
            </p>
            <p className="truncate text-xs text-fg-muted">
              {row.kind}
              {row.status === 'voided'
                ? ` · ${t('ui:documents.panel.voided', 'voided')}`
                : row.status === 'failed'
                  ? ` · ${t('ui:documents.panel.failed', 'could not be drawn')}`
                  : ''}
              {row.redacted
                ? ` · ${t('ui:documents.panel.redacted', 'you may not read this one')}`
                : ''}
            </p>
          </div>
          {/*
            * No download for a redacted row: the server would refuse it, and
            * an affordance that leads to a 403 is a worse answer than none.
            */}
          {row.hasContent && !row.redacted && (
            <>
              {/*
                * ANCHORS, not buttons with an onClick. These fetch a file: an
                * anchor gets the browser's own download handling, its middle-
                * click and its right-click menu for free, and it is what a
                * screen reader announces as a link to a document rather than
                * as a control with unknown consequences.
                */}
              <a
                href={documentContentPath(row.id)}
                aria-label={t('ui:documents.panel.download', 'Download')}
                title={t('ui:documents.panel.download', 'Download')}
                className="rounded p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <Download className="size-3.5" aria-hidden />
              </a>
              <a
                href={documentPrintPath(row.id)}
                target="_blank"
                // `noopener` as well as `noreferrer`: the print view is a
                // sandboxed page of add-on-drawn HTML, and a new tab that kept
                // `window.opener` could navigate this one.
                rel="noopener noreferrer"
                aria-label={t('ui:documents.panel.print', 'Print')}
                title={t('ui:documents.panel.print', 'Print')}
                className="rounded p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <Printer className="size-3.5" aria-hidden />
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The topbar's Make button.
 *
 * ONE MAPPING ⇒ ONE BUTTON; several ⇒ one button per mapping, named. A menu
 * would be the tidier control and is wrong at two items: it hides both behind
 * a click to save a few pixels on a topbar that has room.
 */
export function MakeDocumentButton({
  profiles,
  pk,
  onDrawn,
}: {
  profiles: readonly DocumentProfileSummary[];
  pk: Record<string, unknown>;
  onDrawn?: () => void;
}) {
  const queryClient = useQueryClient();
  const draw = useMutation({
    mutationFn: (profileId: string) => renderDocumentFor({ profileId, pk }),
    onSuccess: () => {
      /*
       * The render is a JOB, so the row does not exist yet when this resolves.
       * Invalidating anyway is right: the panel refetches, shows nothing new,
       * and the realtime `document.created` publish brings it in a moment
       * later. The alternative — polling here — would put a timer on a page
       * for something the socket already announces.
       */
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
      onDrawn?.();
    },
  });

  if (profiles.length === 0) return null;

  return (
    <>
      {profiles.map((profile) => (
        <Button
          key={profile.id}
          size="sm"
          variant="secondary"
          disabled={draw.isPending}
          onClick={() => draw.mutate(profile.id)}
        >
          {profiles.length === 1
            ? t('ui:documents.make.one', 'Make {name}', { name: profile.name })
            : profile.name}
        </Button>
      ))}
    </>
  );
}
