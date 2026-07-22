/**
 * Shortcuts panel (09-generated-app.md §5.3, Shortcuts Panel.dc.html):
 * a Modal rendering the LIVE registration set from the shortcut manager —
 * never a hardcoded list — as a two-column grid of groups with Kbd clusters
 * ("then" separators for chords) and the "Press ? anytime" footer. Keycaps
 * localize per platform (`⌘` → `Ctrl` off-mac) via the manager's mapping.
 */
import { Keyboard } from 'lucide-react';
import { Kbd, Modal, ModalClose, ModalHeader } from '@adminium/ui';

import { displayKey } from '../app/shortcuts.js';
import { t } from '../i18n/t.js';
import { useShortcutManager } from './ShortcutsProvider.js';

export interface ShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsPanel({ open, onOpenChange }: ShortcutsPanelProps) {
  const manager = useShortcutManager();
  const groups = manager.list();

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg">
      <ModalHeader
        icon={<Keyboard />}
        title={t('shortcuts.title', 'Keyboard shortcuts')}
        subtitle={t('shortcuts.subtitle', 'Work faster across Adminium')}
        closeLabel={t('shortcuts.close', 'Close')}
      />
      <div className="nb-scroll max-h-[60vh] overflow-y-auto">
        <div className="grid grid-cols-1 gap-x-[30px] gap-y-[22px] px-[22px] pb-[22px] pt-[18px] sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.group}>
              <h3 className="mb-[11px] text-micro uppercase text-fg-subtle">{group.group}</h3>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-[7px]">
                    <span className="min-w-0 flex-1 text-[12.5px] text-fg">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-[5px]">
                      {item.keys.map((key, index) =>
                        key === 'then' ? (
                          <span key={index} className="text-[10.5px] font-semibold text-fg-subtle">
                            {t('shortcuts.then', 'then')}
                          </span>
                        ) : (
                          <Kbd key={index}>{displayKey(key, manager.isMac)}</Kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-[22px] py-[13px] text-[11.5px] text-fg-muted">
        <span>
          {t('shortcuts.footerPre', 'Press')} <Kbd>?</Kbd>{' '}
          {t('shortcuts.footerPost', 'anytime to open this panel.')}
        </span>
        <ModalClose className="ms-auto text-[11px] font-bold text-fg-subtle">ESC</ModalClose>
      </div>
    </Modal>
  );
}
