// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block picker (comp 170-196, 1136-1142, Appendix A §E4): *Add a
 * section* with the where-line — *Inserted above {label}* or *Added at the
 * end of the email* — and tiles in groups: *Saved blocks* first when the
 * workspace has any, then Content · Commerce & data · Legal & support.
 */
import { useQuery } from '@tanstack/react-query';
import { Bookmark, LayoutPanelTop } from 'lucide-react';
import { Modal, ModalBody, ModalHeader, cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { emailIcon } from '../../icons.js';
import type { EmailSavedBlock } from '../../api.js';
import { EMAIL_BLOCKS, EMAIL_PICKER_GROUPS, isEmailBlockKind, type EmailBlockKind } from '../../model/blocks.js';
import { emailSavedBlocksQuery } from '../../queries.js';
import { blockHint, blockLabel, pickerGroupLabel } from '../blockText.js';

export interface BlockPickerProps {
  /** The insert index; `null` = the end. */
  index: number | null;
  /** The label of the block the insert lands above, for the where-line. */
  aboveLabel: string | null;
  onClose: () => void;
  onPickKind: (kind: EmailBlockKind) => void;
  onPickSaved: (saved: EmailSavedBlock) => void;
}

function Tile({ icon, label, hint, onClick, testId, kind }: { icon: string; label: string; hint: string; onClick: () => void; testId: string; kind?: string | undefined }) {
  const Icon = emailIcon(icon);
  return (
    <button
      type="button"
      data-testid={testId}
      data-kind={kind}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-[11px] text-start transition-[border-color,box-shadow,transform] duration-150',
        'hover:-translate-y-0.5 hover:border-accent hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon className="size-[15px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-extrabold text-fg">{label}</span>
        <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-fg-subtle">{hint}</span>
      </span>
    </button>
  );
}

export function BlockPicker({ index, aboveLabel, onClose, onPickKind, onPickSaved }: BlockPickerProps) {
  const saved = useQuery(emailSavedBlocksQuery());
  const savedBlocks = saved.data?.blocks ?? [];
  const where =
    index === null || aboveLabel === null
      ? t('email:picker.atEnd', 'Added at the end of the email')
      : t('email:picker.above', 'Inserted above {label}', { label: aboveLabel.toLowerCase() });

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalHeader
        icon={<LayoutPanelTop />}
        title={t('email:picker.title', 'Add a section')}
        subtitle={<span data-testid="email-picker-where">{where}</span>}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-5">
        {savedBlocks.length === 0 ? null : (
          <section data-testid="email-picker-saved">
            <div className="mb-[9px] text-[10px] font-bold uppercase tracking-[.06em] text-fg-subtle">{pickerGroupLabel('saved')}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-2.5">
              {savedBlocks.map((entry) => {
                const kind = typeof entry.block['block'] === 'string' ? entry.block['block'] : '';
                return (
                  <Tile
                    key={entry.id}
                    icon="bookmark"
                    label={entry.name}
                    hint={t('email:picker.savedHint', 'Saved {label}', { label: blockLabel(kind).toLowerCase() })}
                    onClick={() => onPickSaved(entry)}
                    testId="email-picker-saved-tile"
                  />
                );
              })}
            </div>
          </section>
        )}
        {EMAIL_PICKER_GROUPS.map((group) => (
          <section key={group.key} data-testid={`email-picker-${group.key}`}>
            <div className="mb-[9px] text-[10px] font-bold uppercase tracking-[.06em] text-fg-subtle">{pickerGroupLabel(group.key)}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-2.5">
              {group.kinds.filter((kind) => isEmailBlockKind(kind) && EMAIL_BLOCKS[kind].pickable).map((kind) => (
                <Tile
                  key={kind}
                  icon={EMAIL_BLOCKS[kind].icon}
                  label={blockLabel(kind)}
                  hint={blockHint(kind)}
                  onClick={() => onPickKind(kind)}
                  testId="email-picker-tile"
                  kind={kind}
                />
              ))}
            </div>
          </section>
        ))}
      </ModalBody>
    </Modal>
  );
}

// `Bookmark` is what the saved tiles draw; named here so the icon-core scan keeps it.
export const SAVED_TILE_ICON = Bookmark;
