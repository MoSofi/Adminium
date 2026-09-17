// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New modal (M15; comp 64-96, props 570-577): a dashed *Blank report*
 * tile and the twelve starters in a four-column grid, each starter a
 * miniature sheet in its own accent. On the Reports tab a *Your templates*
 * section follows: a report can begin as a copy of one of the workspace's
 * report templates, which `POST /:id/from-template` makes server-side,
 * recording the origin — the flow the comp's own subtitle (141) and empty
 * state (600) promise and its `createFrom` (553) never wires.
 *
 * Picking creates the row at once and hands the reply up — the manager opens
 * the editor on it. There is no name step: the starter's name is the name
 * until the editor's inline input changes it (comp `createFrom`, 553).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, ModalBody, ModalHeader, Spinner, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { reportBuilderApi, type ReportDetail, type ReportDocumentKind, type ReportStarterCard } from '../api.js';
import { reportIcon } from '../icons.js';
import { reportDocumentsQuery, reportStartersQuery } from '../queries.js';
import { ReportMiniPreview, barHeights } from './MiniPreview.js';
import { blocksLabel, categoryLabel, starterName } from './model.js';

export interface NewDocumentModalProps {
  kind: ReportDocumentKind;
  onClose: () => void;
  onCreated: (detail: ReportDetail) => void;
}

/** The comp's `.nb-starter` (CSS 44-45): accent border, medium shadow and a 2 px lift on hover. */
const TILE =
  'flex min-h-[190px] flex-col overflow-hidden rounded-[14px] border text-start transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-menu focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60';

/**
 * The starter tile's thumbnail (comp 84-88, styles 570-577): a 38 × 5 accent
 * kicker bar, the report title, and up to six bars at
 * `max(12, v/max·100)%` — the LAST in full accent, the rest at 32 %.
 */
function StarterPreview({ starter }: { starter: ReportStarterCard }) {
  const heights = barHeights(starter.series).map((height) => Math.max(12, height));
  return (
    <div className="flex h-[116px] flex-col gap-[5px] border-b border-border bg-surface-2 p-[13px]" style={{ '--adm-report-accent': starter.accent }}>
      <div className="h-[5px] w-[38px] shrink-0 rounded-[3px] bg-[var(--adm-report-accent)]" aria-hidden="true" />
      <div className="mt-0.5 text-[12px] font-extrabold leading-[1.2] tracking-[-.02em] text-fg">{starter.reportTitle}</div>
      <div className="mt-1 flex h-[34px] items-end gap-1" aria-hidden="true">
        {heights.map((height, index) => (
          <div
            key={index}
            style={{ '--h': `${String(height)}%` }}
            className={
              index === heights.length - 1
                ? 'h-[var(--h)] flex-1 rounded-t-[3px] bg-[var(--adm-report-accent)]'
                : 'h-[var(--h)] flex-1 rounded-t-[3px] bg-[color-mix(in_srgb,var(--adm-report-accent)_32%,transparent)]'
            }
          />
        ))}
      </div>
    </div>
  );
}

function StarterTile({ starter, disabled, onPick }: { starter: ReportStarterCard; disabled: boolean; onPick: () => void }) {
  const Icon = reportIcon(starter.icon);
  return (
    <button type="button" data-testid="report-starter" data-starter={starter.key} disabled={disabled} onClick={onPick} className={cn(TILE, 'border-border bg-surface')}>
      <StarterPreview starter={starter} />
      <div className="px-[13px] pb-[13px] pt-[11px]" style={{ '--adm-report-accent': starter.accent }}>
        <div className="flex items-center gap-[7px]">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--adm-report-accent)_14%,transparent)] text-[var(--adm-report-accent)] dark:bg-[color-mix(in_srgb,var(--adm-report-accent)_24%,transparent)]">
            <Icon className="size-3" aria-hidden="true" />
          </div>
          <div className="truncate text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{starterName(starter.key, starter.name)}</div>
        </div>
        <div className="mt-1 text-[11px] text-fg-subtle">
          {t('reportBuilder:new.starterMeta', '{category} · {blocks}', { category: categoryLabel(starter.category), blocks: blocksLabel(starter.blockCount) })}
        </div>
      </div>
    </button>
  );
}

export function NewDocumentModal({ kind, onClose, onCreated }: NewDocumentModalProps) {
  const toasts = useAppToasts();
  const starters = useQuery(reportStartersQuery());
  // A report may start from one of the workspace's report templates.
  const templates = useQuery({ ...reportDocumentsQuery({ kind: 'template' }), enabled: kind === 'report' });
  const [picking, setPicking] = useState<string | null>(null);
  const PlusGlyph = reportIcon('plus');
  const NewGlyph = reportIcon('file-plus-2');
  const TemplatesGlyph = reportIcon('layout-template');

  const fail = (error: unknown) => {
    setPicking(null);
    toasts.push({
      variant: 'error',
      title: t('reportBuilder:toast.createFailed', 'Couldn’t create the document'),
      description: error instanceof Error ? error.message : undefined,
    });
  };
  const create = useMutation({
    mutationFn: (starter: string | null) => reportBuilderApi.create({ kind, starter }),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const fromTemplate = useMutation({
    mutationFn: (templateId: string) => reportBuilderApi.fromTemplate(templateId),
    onSuccess: (created) => onCreated(created),
    onError: fail,
  });
  const busy = create.isPending || fromTemplate.isPending;

  const title = kind === 'template' ? t('reportBuilder:new.title.template', 'New template') : t('reportBuilder:new.title.report', 'New report');
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
        icon={<NewGlyph />}
        title={title}
        subtitle={t('reportBuilder:new.subtitle', 'Start from a blank canvas or a ready-made report layout.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="pt-1">
        {starters.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner label={t('common.loading', 'Loading')} />
          </div>
        ) : starters.isError ? (
          <p role="alert" className="py-10 text-center text-body-sm text-danger">
            {t('reportBuilder:new.startersFailed', 'The starters could not be loaded. Start blank, or try again.')}
          </p>
        ) : null}
        <div data-testid="report-new-grid" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <button
            type="button"
            data-testid="report-starter"
            data-starter=""
            disabled={busy}
            onClick={() => {
              setPicking('');
              create.mutate(null);
            }}
            className={cn(TILE, 'items-center justify-center gap-2.5 border-[1.5px] border-dashed border-border-strong bg-surface-2 p-[18px]')}
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-surface-3 text-fg-muted">
              {picking === '' && busy ? <Spinner /> : <PlusGlyph className="size-[22px]" aria-hidden="true" />}
            </div>
            <div className="text-[13px] font-extrabold text-fg">{t('reportBuilder:new.blank.title', 'Blank report')}</div>
            <div className="text-center text-[11px] leading-[1.4] text-fg-subtle">{t('reportBuilder:new.blank.body', 'Start from scratch')}</div>
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
        {kind === 'report' && yourTemplates.length > 0 ? (
          <section data-testid="report-your-templates" className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              <TemplatesGlyph className="size-3.5" aria-hidden="true" />
              {t('reportBuilder:new.yourTemplates', 'Your templates')}
            </h3>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {yourTemplates.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  data-testid="report-from-template"
                  data-template={doc.id}
                  disabled={busy}
                  onClick={() => {
                    setPicking(doc.id);
                    fromTemplate.mutate(doc.id);
                  }}
                  className={cn(TILE, 'border-border bg-surface')}
                >
                  <div className="border-b border-border bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] px-3 pt-3">
                    <ReportMiniPreview summary={doc.summary} />
                  </div>
                  <div className="px-[13px] pb-[13px] pt-[11px]">
                    <div className="truncate text-[12.5px] font-extrabold tracking-[-.01em] text-fg">{doc.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-fg-subtle">{doc.summary.reportTitle}</div>
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
