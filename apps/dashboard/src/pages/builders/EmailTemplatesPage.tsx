// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email Templates surface (M7-T06; comps: Email Templates.dc.html; 09 §7.11).
 *
 * Manager: the template list from `GET /api/v1/email-templates` — name, key,
 * locale, subject, live/disabled pill, updated stamp — with a search filter.
 * Editor: the `page-builder` email flavor over the selected template's blocks
 * (`GET /:key/:locale`), plus name/subject fields and the enabled switch;
 * every change autosaves through `PUT /:key/:locale` on the §7.10 choreography
 * (dirty → 900 ms → saving → saved pill). Email bodies always render light —
 * that scope is owned by `document-canvas`'s `adm-always-light` paper.
 *
 * Persistence is the email-templates API CONTRACT exactly (api/emailTemplates.ts)
 * — NOT adminium_pages: templates are keyed `(key, locale)` rows in
 * `adminium_email_templates` (07-meta-store.md §3.28).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  Input,
  SearchInput,
  Spinner,
  StatusPill,
  Switch,
  type AutosaveStatus,
} from '@adminium/ui';

import {
  PageBuilder,
  type DocRecord,
} from '@adminium/widgets';
import {
  emailTemplateQuery,
  emailTemplatesApi,
  emailTemplatesQuery,
  type EmailTemplateDetail,
} from '../../api/emailTemplates.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { docToEmailBlocks, emailBlocksToDoc } from './emailDoc.js';

export const EMAIL_AUTOSAVE_DEBOUNCE_MS = 900;

interface EditorTarget {
  key: string;
  locale: string;
}

export function EmailTemplatesPage() {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  return editing === null ? (
    <EmailTemplatesManager onOpen={(key, locale) => setEditing({ key, locale })} />
  ) : (
    <EmailTemplateEditor
      target={editing}
      onBack={() => setEditing(null)}
    />
  );
}

function EmailTemplatesManager({ onOpen }: { onOpen: (key: string, locale: string) => void }) {
  const list = useQuery(emailTemplatesQuery());
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    const all = list.data ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((item) =>
      `${item.name} ${item.key} ${item.subject} ${item.locale}`.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  return (
    <PageSurface width="page" fill className="gap-4" testId="email-templates-manager">
      <PageActions
        title={t('emailTemplates.title', 'Email templates')}
        subtitle={t('emailTemplates.subtitle', 'Transactional and lifecycle emails your workspace sends.')}
      />
      <header className="flex flex-wrap items-center justify-end gap-3">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          clearLabel={t('common.clearSearch', 'Clear search')}
          placeholder={t('emailTemplates.search', 'Search templates…')}
          className="w-64"
        />
      </header>

      {list.isLoading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner label={t('common.loading', 'Loading')} />
        </div>
      ) : list.isError ? (
        <EmptyState
          tone="danger"
          title={t('emailTemplates.loadFailed', 'Couldn’t load templates')}
          body={list.error instanceof Error ? list.error.message : ''}
          actions={
            <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          preset={search === '' ? 'no-data' : 'no-matches'}
          title={
            search === ''
              ? t('emailTemplates.empty', 'No email templates yet')
              : t('emailTemplates.noMatches', 'No matching templates')
          }
          body={
            search === ''
              ? t('emailTemplates.emptyBody', 'Templates appear here once the server seeds or you create them.')
              : t('emailTemplates.noMatchesBody', 'Try a different search.')
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="email-templates-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid={`email-template-${item.key}-${item.locale}`}
                onClick={() => onOpen(item.key, item.locale)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-start transition-colors duration-150 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Mail className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-bold text-fg">{item.name}</span>
                  <span className="block truncate text-caption text-fg-muted">{item.subject}</span>
                </span>
                <span className="hidden shrink-0 text-caption text-fg-subtle sm:block">
                  {item.key} · {item.locale}
                </span>
                <StatusPill status={item.enabled ? 'live' : 'disabled'} tone={item.enabled ? 'pos' : 'neutral'}>
                  {item.enabled
                    ? t('emailTemplates.live', 'Live')
                    : t('emailTemplates.disabled', 'Disabled')}
                </StatusPill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageSurface>
  );
}

function EmailTemplateEditor({ target, onBack }: { target: EditorTarget; onBack: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery(emailTemplateQuery(target.key, target.locale));
  return detail.data === undefined ? (
    <div className="flex h-full items-center justify-center" data-testid="email-editor-loading">
      {detail.isError ? (
        <EmptyState
          tone="danger"
          title={t('emailTemplates.loadFailed', 'Couldn’t load templates')}
          actions={
            <Button size="sm" variant="secondary" onClick={onBack}>
              {t('common.back', 'Back')}
            </Button>
          }
        />
      ) : (
        <Spinner label={t('common.loading', 'Loading')} />
      )}
    </div>
  ) : (
    <LoadedEmailEditor
      key={`${target.key}:${target.locale}`}
      detail={detail.data}
      onBack={onBack}
      onSaved={() => void queryClient.invalidateQueries({ queryKey: ['email-templates'] })}
    />
  );
}

function LoadedEmailEditor({
  detail,
  onBack,
  onSaved,
}: {
  detail: EmailTemplateDetail;
  onBack: () => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => emailBlocksToDoc(detail.blocks, { name: detail.name, subject: detail.subject }),
    [detail],
  );

  const [name, setName] = useState(detail.name);
  const [subject, setSubject] = useState(detail.subject);
  const [enabled, setEnabled] = useState(detail.enabled);
  const [doc, setDoc] = useState<DocRecord>(initial.doc);
  const [autosave, setAutosave] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest field values, so a trailing save never persists stale state.
  const latest = useRef({ name, subject, enabled, doc });
  latest.current = { name, subject, enabled, doc };

  const save = useCallback((): void => {
    setAutosave('saving');
    const current = latest.current;
    emailTemplatesApi
      .put(detail.key, detail.locale, {
        name: current.name,
        subject: current.subject,
        enabled: current.enabled,
        blocks: docToEmailBlocks(current.doc, initial.unknown),
      })
      .then(() => {
        setAutosave('saved');
        setSavedAt(Date.now());
        onSaved();
      })
      .catch(() => setAutosave('error'));
  }, [detail.key, detail.locale, initial.unknown, onSaved]);

  const markDirty = useCallback((): void => {
    setAutosave('dirty');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(save, EMAIL_AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  return (
    <PageSurface width="page" fill className="gap-3" testId="email-template-editor">
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />}
          onClick={onBack}
          data-testid="email-editor-back"
        >
          {t('common.back', 'Back')}
        </Button>
        <Input
          aria-label={t('emailTemplates.name', 'Template name')}
          data-testid="email-editor-name"
          className="w-64"
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            markDirty();
          }}
        />
        <Input
          aria-label={t('emailTemplates.subject', 'Subject')}
          data-testid="email-editor-subject"
          className="min-w-0 flex-1"
          value={subject}
          onChange={(event) => {
            setSubject(event.currentTarget.value);
            markDirty();
          }}
        />
        <label className="flex cursor-pointer items-center gap-2">
          <span className="text-caption text-fg-muted">{t('emailTemplates.enabled', 'Enabled')}</span>
          <Switch
            data-testid="email-editor-enabled"
            checked={enabled}
            onCheckedChange={(next) => {
              setEnabled(next);
              markDirty();
            }}
          />
        </label>
      </header>

      <div className="min-h-0 flex-1">
        <PageBuilder
          config={{ docType: 'email' }}
          data={{ row: doc }}
          autosave={autosave}
          {...(savedAt === undefined ? {} : { savedAt })}
          onDocChange={(next) => {
            setDoc(next);
            markDirty();
          }}
        />
      </div>
    </PageSurface>
  );
}
