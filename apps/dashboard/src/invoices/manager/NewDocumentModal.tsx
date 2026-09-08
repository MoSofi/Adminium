// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New modal (34-invoices-add-on.md Appendix E §M15; comp 108-141, props
 * 1406-1413): a dashed *Blank invoice* tile and the twelve starters in a
 * four-column grid, each starter a miniature sheet in its own accent. On the
 * invoices tab a *Your templates* section follows (34 O20): an invoice can
 * begin as a copy of one of the workspace's templates, which
 * `POST /:id/from-template` makes server-side, recording the origin.
 *
 * Picking creates the row at once and hands the reply up — the manager opens
 * the editor on it. There is no name step: the starter's name is the name
 * until the editor's inline input changes it (comp `createFrom`, 1375-1382).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, LayoutTemplate, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal, ModalBody, ModalHeader, Spinner, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { invoicesApi, type InvoiceDetail, type InvoiceDocumentKind, type InvoiceStarterCard } from '../api.js';
import { invoiceIcon } from '../icons.js';
import { invoiceStartersQuery, invoicesQuery } from '../queries.js';
import { InvoiceMiniPreview } from './MiniPreview.js';
import { categoryLabel } from './model.js';

export interface NewDocumentModalProps {
  kind: InvoiceDocumentKind;
  onClose: () => void;
  onCreated: (detail: InvoiceDetail) => void;
}

/** The comp's `.nb-starter` (CSS 45-46): accent border, medium shadow and a 2 px lift on hover. */
const TILE =
  'flex min-h-[186px] flex-col overflow-hidden rounded-[14px] border text-start transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-menu focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60';

/** The starter tile's thumbnail (comp 131-135, styles 1408-1412): chip + bar, the title word, two rules, a rule and an accent block. */
function StarterPreview({ starter }: { starter: InvoiceStarterCard }) {
  const Icon = invoiceIcon(starter.icon);
  return (
    <div className="flex h-[116px] flex-col gap-[5px] border-b border-border bg-surface-2 px-3 pb-2.5 pt-3" style={{ '--adm-invoice-accent': starter.accent }}>
      <div className="flex items-center gap-1.5">
        <div className="flex size-[17px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--adm-invoice-accent)] text-white">
          <Icon className="size-[11px]" aria-hidden="true" />
        </div>
        <div className="h-1.5 w-11 rounded-[3px] bg-fg opacity-[.82]" />
      </div>
      <div className="mt-[3px] text-[13px] font-extrabold tracking-[-.02em] text-fg">{starter.title}</div>
      <div className="mt-0.5 flex flex-col gap-1">
        <div className="h-1 w-full rounded-sm bg-border-strong" />
        <div className="h-1 w-[72%] rounded-sm bg-border-strong" />
      </div>
      <div className="mt-auto flex items-center justify-between">
        <div className="h-1 w-[38px] rounded-sm bg-border-strong" />
        <div className="h-[9px] w-10 rounded-[3px] bg-[var(--adm-invoice-accent)]" />
      </div>
    </div>
  );
}

function StarterTile({ starter, disabled, onPick }: { starter: InvoiceStarterCard; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" data-testid="invoices-starter" data-starter={starter.key} disabled={disabled} onClick={onPick} className={cn(TILE, 'border-border bg-surface')}>
      <StarterPreview starter={starter} />
      <div className="px-[13px] pb-[13px] pt-[11px]">
        <div className="text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{starter.name}</div>
        <div className="mt-0.5 text-[11px] text-fg-subtle">{categoryLabel(starter.category)}</div>
      </div>
    </button>
  );
}

export function NewDocumentModal({ kind, onClose, onCreated }: NewDocumentModalProps) {
  const toasts = useAppToasts();
  const starters = useQuery(invoiceStartersQuery());
  // 34 O20: an invoice may start from one of the workspace's templates.
  const templates = useQuery({ ...invoicesQuery({ kind: 'template' }), enabled: kind === 'invoice' });
  const [picking, setPicking] = useState<string | null>(null);

  const fail = (error: unknown) => {
    setPicking(null);
    toasts.push({
      variant: 'error',
      title: t('invoices:new.failed', 'Could not create it'),
      description: error instanceof Error ? error.message : undefined,
    });
  };
  const create = useMutation({
    mutationFn: (starter: string | null) => invoicesApi.create({ kind, starter }),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const fromTemplate = useMutation({
    mutationFn: (templateId: string) => invoicesApi.fromTemplate(templateId),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const busy = create.isPending || fromTemplate.isPending;

  const title = kind === 'template' ? t('invoices:new.template', 'New template') : t('invoices:new.invoice', 'New invoice');
  const yourTemplates = templates.data?.items ?? [];

  return (
    <Modal
      open
      size="xl"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader
        icon={<FilePlus2 />}
        title={title}
        subtitle={t('invoices:new.subtitle', 'Start from a blank canvas or a ready-made template.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="pt-1">
        {starters.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner label={t('common.loading', 'Loading')} />
          </div>
        ) : starters.isError ? (
          <p role="alert" className="py-10 text-center text-body-sm text-danger">
            {t('invoices:new.startersFailed', 'The starters could not be loaded. Start blank, or try again.')}
          </p>
        ) : null}
        <div data-testid="invoices-new-grid" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <button
            type="button"
            data-testid="invoices-starter"
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
            <div className="text-[13px] font-extrabold text-fg">{t('invoices:new.blank', 'Blank invoice')}</div>
            <div className="text-center text-[11px] leading-[1.4] text-fg-subtle">{t('invoices:new.blankHint', 'Build from scratch')}</div>
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
        {kind === 'invoice' && yourTemplates.length > 0 ? (
          <section data-testid="invoices-your-templates" className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              <LayoutTemplate className="size-3.5" aria-hidden="true" />
              {t('invoices:new.yourTemplates', 'Your templates')}
            </h3>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {yourTemplates.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  data-testid="invoices-from-template"
                  data-template={doc.id}
                  disabled={busy}
                  onClick={() => {
                    setPicking(doc.id);
                    fromTemplate.mutate(doc.id);
                  }}
                  className={cn(TILE, 'border-border bg-surface')}
                >
                  <div className="border-b border-border bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] px-3 pt-3">
                    <InvoiceMiniPreview summary={doc.summary} />
                  </div>
                  <div className="px-[13px] pb-[13px] pt-[11px]">
                    <div className="truncate text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{doc.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-fg-subtle">{doc.summary.customerName}</div>
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
