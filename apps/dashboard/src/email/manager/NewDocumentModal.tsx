// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New modal (comp 117-151, Appendix A §M8): a dashed *Blank email* tile
 * and the twelve starters in a four-column grid, each starter drawn as a
 * mini preview in its own accent. In the campaign tab a *Your templates*
 * section follows (D21): a campaign can begin as a copy of a live template,
 * which `POST /:id/from-template` makes server-side.
 *
 * Picking creates the row at once and hands the reply up — the manager opens
 * the editor on it. There is no name step: the starter's name (or *Untitled
 * template*) is the name until the editor's inline input changes it.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { LayoutTemplate, MailPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal, ModalBody, ModalHeader, Spinner, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { emailIcon } from '../icons.js';
import { useAppToasts } from '../../pages/toasts.js';
import { emailApi, type EmailDocumentDetail, type EmailDocumentKind, type EmailStarterCard } from '../api.js';
import { emailDocumentsQuery, emailStartersQuery } from '../queries.js';
import { accentOf, categoryLabel } from './model.js';

export interface NewDocumentModalProps {
  kind: EmailDocumentKind;
  onClose: () => void;
  onCreated: (detail: EmailDocumentDetail) => void;
}

const TILE = 'flex min-h-[196px] flex-col overflow-hidden rounded-[14px] border text-start transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60';

/** The starter tile's thumbnail (comp 137-140): banner in the starter's accent, three skeleton lines, mini CTA. */
function StarterPreview({ accent }: { accent: string }) {
  return (
    <div className="h-[120px] border-b border-border bg-surface-2 px-3.5 pt-3.5" style={{ '--adm-email-accent': accent }}>
      <div className="h-full overflow-hidden rounded-t-lg border border-[#ececef] bg-white">
        <div className="flex h-[26px] items-center bg-[linear-gradient(120deg,var(--adm-email-accent),color-mix(in_srgb,var(--adm-email-accent)_72%,transparent))] px-2.5">
          <div className="size-3.5 rounded-[4px] bg-white/[.3]" />
        </div>
        <div className="flex flex-col gap-[5px] px-2.5 py-[9px]">
          <div className="h-[5px] w-[70%] rounded-[3px] bg-[#191920] opacity-80" />
          <div className="h-[3.5px] w-full rounded-sm bg-[#e2e2e8]" />
          <div className="h-[3.5px] w-[80%] rounded-sm bg-[#e2e2e8]" />
          <div className="mt-1 h-[11px] w-[42px] rounded-[4px] bg-[var(--adm-email-accent)]" />
        </div>
      </div>
    </div>
  );
}

function StarterTile({ starter, disabled, onPick }: { starter: EmailStarterCard; disabled: boolean; onPick: () => void }) {
  const Icon = emailIcon(starter.icon);
  return (
    <button
      type="button"
      data-testid="email-starter"
      data-starter={starter.key}
      disabled={disabled}
      onClick={onPick}
      className={cn(TILE, 'border-border bg-surface')}
    >
      <StarterPreview accent={starter.accent} />
      <div className="px-[13px] pb-[13px] pt-[11px]">
        <div className="flex items-center gap-[7px]" style={{ '--adm-email-accent': starter.accent }}>
          <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--adm-email-accent)_14%,transparent)] text-[var(--adm-email-accent)]">
            <Icon className="size-3" aria-hidden="true" />
          </div>
          <div className="text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{starter.name}</div>
        </div>
        <div className="mt-1 text-[11px] text-fg-subtle">{categoryLabel(starter.category)}</div>
      </div>
    </button>
  );
}

export function NewDocumentModal({ kind, onClose, onCreated }: NewDocumentModalProps) {
  const toasts = useAppToasts();
  const starters = useQuery(emailStartersQuery());
  // D21: a campaign may start from one of the workspace's live templates.
  const templates = useQuery({ ...emailDocumentsQuery({ kind: 'template' }), enabled: kind === 'campaign' });
  const [picking, setPicking] = useState<string | null>(null);

  const fail = (error: unknown) => {
    setPicking(null);
    toasts.push({
      variant: 'error',
      title: t('email:new.failed', 'Could not create it'),
      description: error instanceof Error ? error.message : undefined,
    });
  };
  const create = useMutation({
    mutationFn: (starter: string | null) => emailApi.create({ kind, starter }),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const fromTemplate = useMutation({
    mutationFn: (templateId: string) => emailApi.fromTemplate(templateId),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const busy = create.isPending || fromTemplate.isPending;

  const title = kind === 'template' ? t('email:new.template', 'New template') : t('email:new.campaign', 'New campaign');
  const yourTemplates = (templates.data?.items ?? []).filter((doc) => doc.archivedAt === null);

  return (
    <Modal
      open
      size="xl"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader
        icon={<MailPlus />}
        title={title}
        subtitle={t('email:new.subtitle', 'Start blank or from a ready-made email design.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="pt-1">
        {starters.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner label={t('common.loading', 'Loading')} />
          </div>
        ) : starters.isError ? (
          <p role="alert" className="py-10 text-center text-body-sm text-danger">
            {t('email:new.startersFailed', 'The starters could not be loaded. Start blank, or try again.')}
          </p>
        ) : null}
        <div data-testid="email-new-grid" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <button
            type="button"
            data-testid="email-starter"
            data-starter=""
            disabled={busy}
            onClick={() => {
              setPicking('');
              create.mutate(null);
            }}
            className={cn(TILE, 'items-center justify-center gap-2.5 border-[1.5px] border-dashed border-border-strong bg-surface-2 p-[18px]')}
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-surface-3 text-fg-muted">
              {picking === '' && busy ? <Spinner /> : <Plus className="size-[22px]" aria-hidden="true" />}
            </div>
            <div className="text-[13px] font-extrabold text-fg">{t('email:new.blank', 'Blank email')}</div>
            <div className="text-center text-[11px] leading-[1.4] text-fg-subtle">{t('email:new.blankHint', 'Start from scratch')}</div>
          </button>
          {(starters.data?.starters ?? []).map((starter) => (
            <StarterTile
              key={starter.key}
              starter={starter}
              disabled={busy}
              onPick={() => {
                setPicking(starter.key);
                create.mutate(starter.key);
              }}
            />
          ))}
        </div>
        {kind === 'campaign' && yourTemplates.length > 0 ? (
          <section data-testid="email-your-templates" className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              <LayoutTemplate className="size-3.5" aria-hidden="true" />
              {t('email:new.yourTemplates', 'Your templates')}
            </h3>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {yourTemplates.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  data-testid="email-from-template"
                  data-template={doc.id}
                  disabled={busy}
                  onClick={() => {
                    setPicking(doc.id);
                    fromTemplate.mutate(doc.id);
                  }}
                  className={cn(TILE, 'border-border bg-surface')}
                >
                  <StarterPreview accent={accentOf(doc)} />
                  <div className="px-[13px] pb-[13px] pt-[11px]">
                    <div className="truncate text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{doc.name}</div>
                    <div className="mt-1 truncate text-[11px] text-fg-subtle">{doc.subject}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </ModalBody>
    </Modal>
  );
}
