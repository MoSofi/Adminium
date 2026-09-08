// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Add-section modal (comp 71-105, 1645-1655; 34-invoices-add-on.md
 * Appendix E §I8, O19): *Add a section* — *Build your own* (the four custom
 * types, a 2-column grid of tiles with hints) and *Standard blocks* (chips
 * for exactly the sections currently OFF, `offSections`), collapsing to
 * *Every standard block is already on this invoice.* when none remain.
 *
 * This is THE path an off block comes back by: the comp's in-canvas "Add
 * <section>" ghosts are unreachable (§0.4.6 item 1) and are not built.
 * Where the pick lands — the pre-filter index of a between-block chip, or
 * the end — is the editor's (`addOpen.at`), not the modal's.
 */
import { LayoutList } from 'lucide-react';
import { Modal, ModalBody, ModalHeader } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { invoiceIcon } from '../../icons.js';
import { CUSTOM_TYPES, offSections, type OptionalSection } from '../../model/blocks.js';
import type { CustomSectionType, InvoiceBody } from '../../model/envelope.js';
import { customTypeText, optionalSectionLabel } from '../sectionText.js';

export interface AddSectionModalProps {
  body: InvoiceBody;
  onClose: () => void;
  onPickCustom: (type: CustomSectionType) => void;
  onPickBuiltin: (section: OptionalSection) => void;
}

const EYEBROW = 'mb-[9px] text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-subtle';

export function AddSectionModal({ body, onClose, onPickCustom, onPickBuiltin }: AddSectionModalProps) {
  const off = offSections(body);
  return (
    <Modal
      open
      size="md"
      className="max-w-[560px]"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalHeader
        icon={<LayoutList />}
        title={t('invoices:add.title', 'Add a section')}
        subtitle={t('invoices:add.subtitle', 'Build your own, or switch on one of the standard blocks.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody data-testid="invoices-add-modal" className="flex flex-col gap-[18px]">
        <section>
          <div className={EYEBROW}>{t('invoices:add.custom', 'Build your own')}</div>
          <div className="grid grid-cols-2 gap-[9px]">
            {CUSTOM_TYPES.map((entry) => {
              const Icon = invoiceIcon(entry.icon);
              const text = customTypeText(entry.type);
              return (
                <button
                  key={entry.type}
                  type="button"
                  data-testid="invoices-add-custom"
                  data-type={entry.type}
                  onClick={() => onPickCustom(entry.type)}
                  className="nb-ib flex h-full w-full items-start gap-2.5 rounded-[11px] border border-border bg-surface-2 px-3 py-[11px] text-start text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
                    <Icon className="size-[15px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-extrabold">{text.label}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-[1.45] text-fg-subtle">{text.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section>
          <div className={EYEBROW}>{t('invoices:add.standard', 'Standard blocks')}</div>
          {off.length === 0 ? (
            <div data-testid="invoices-add-none" className="text-[11.5px] leading-[1.5] text-fg-subtle">
              {t('invoices:add.allOn', 'Every standard block is already on this invoice.')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-[7px]">
              {off.map((section) => {
                const Icon = invoiceIcon(section.icon);
                return (
                  <button
                    key={section.flag}
                    type="button"
                    data-testid="invoices-add-builtin"
                    data-block={section.block}
                    onClick={() => onPickBuiltin(section)}
                    className="nb-ib flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-[11px] py-2 text-[11.5px] font-bold text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {optionalSectionLabel(section.flag)}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </ModalBody>
    </Modal>
  );
}
