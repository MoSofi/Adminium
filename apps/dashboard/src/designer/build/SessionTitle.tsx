// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The middle of the build page's top bar: the session's name with a pencil
 * after it, which a click turns into a field (Enter keeps it, Escape leaves
 * it), and the version in use, whose menu lists every version newest first. Going back to one adds a
 * version on top, so the list only grows; the dialog says so. With no git on
 * this machine versions are off, and the button says why.
 */
import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, History, Pencil, Undo2 } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Modal,
  ModalHeader,
  Tooltip,
} from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerVersion } from '../api.js';
import { editedWhen } from '../home/YourApps.js';
import { MENU_HEADING } from './MoreMenu.js';
import { versionLabel, versionName } from './versionName.js';

/**
 * A version's name with its number taken off the front: it is kept as "v3 · Cart and pickup", and a row says the
 * number once, in its own column. A version nobody named is its number alone, and stays that.
 */
function ownName(version: DesignerVersion): string {
  // In the person's language where the name is one the server gives by itself ("Your edit to …", "Back to …").
  return versionLabel(version.name) ?? version.name;
}

function list(items: readonly string[]): string {
  try {
    return new Intl.ListFormat(getI18nInstance()?.language ?? 'en-US', { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** A sentence with one part of it drawn its own way: the words come whole from the catalogue, the part is cut out of them. */
function marked(sentence: (mark: string) => string, part: ReactNode): ReactNode {
  const [before, after] = sentence('\u0001').split('\u0001');
  return (
    <>
      {before}
      {part}
      {after}
    </>
  );
}

export function SessionTitle({
  title,
  onRename,
  versions,
  available,
  current,
  onGoBack,
  busy,
}: {
  title: string;
  onRename: (title: string) => void;
  versions: readonly DesignerVersion[];
  available: boolean;
  current: DesignerVersion | null;
  onGoBack: (version: DesignerVersion) => void;
  busy: boolean;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [asking, setAsking] = useState<DesignerVersion | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next !== '' && next !== title) onRename(next.slice(0, 80));
    requestAnimationFrame(() => nameButton.current?.focus());
  };

  const newestFirst = [...versions].sort((a, b) => b.n - a.n);
  const askingName = asking === null ? '' : `v${String(asking.n)}`;
  const later = asking === null ? [] : newestFirst.filter((version) => version.n > asking.n).map((version) => `v${String(version.n)}`).reverse();

  return (
    <>
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={80}
          aria-label={t('designer:build.rename', 'Name of this app')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
              requestAnimationFrame(() => nameButton.current?.focus());
            }
          }}
          spellCheck={false}
          className="h-8 w-[172px] max-w-[40vw] rounded-[9px] border border-border-strong bg-surface-2 px-2.5 text-sm font-extrabold leading-[normal] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
        />
      ) : (
        <Tooltip content={t('designer:build.renameTip', 'Rename')}>
          <button
            ref={nameButton}
            type="button"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            aria-label={t('designer:build.renameApp', 'Rename {name}', { name: title })}
            className="inline-flex min-w-0 cursor-text items-center gap-1.5 rounded-[9px] border border-transparent px-2 py-[5px] text-sm font-extrabold leading-[normal] tracking-tight text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="truncate">{title}</span>
            <Pencil aria-hidden="true" className="size-[13px] shrink-0 text-fg-subtle max-md:hidden" />
          </button>
        </Tooltip>
      )}

      {!available ? (
        <Tooltip content={t('designer:versions.offHint', 'Versions need git on this machine. Install git and start the Designer again.')}>
          <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-fg-subtle">
            <History aria-hidden="true" className="size-3.5" />
            {t('designer:versions.off', 'Versions are off')}
          </span>
        </Tooltip>
      ) : current === null ? null : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('designer:versions.button', 'Version {version}: {name}', { version: `v${String(current.n)}`, name: versionName(current.name) })}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-border bg-surface-2 pe-[7px] ps-[9px] text-[12.5px] font-bold leading-[normal] text-fg hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
          >
            <History aria-hidden="true" className="size-3.5 text-fg-subtle" />
            <span className="font-mono font-semibold">{`v${String(current.n)}`}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="nb-scroll max-h-[70vh] w-[420px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-[14px] p-1.5 leading-[normal]">
            <DropdownMenuLabel className={MENU_HEADING}>{t('designer:versions.title', 'Versions')}</DropdownMenuLabel>
            {newestFirst.map((version) => (
              // The version in use is a row with nothing to press: said as an item that is off, so a list of one is still a menu with an item in it.
              <div key={version.n} {...(version.current ? { role: 'menuitem', 'aria-disabled': true } : {})} className={`flex items-center gap-3 rounded-[9px] px-2.5 py-2.5 ${version.current ? 'bg-surface-2' : ''}`}>
                <span className="w-[30px] shrink-0 font-mono text-[12.5px] font-bold">{`v${String(version.n)}`}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[13px] font-bold text-fg">{ownName(version)}</span>
                  <span className="font-mono text-[11px] text-fg-subtle">{editedWhen(version.at)}</span>
                </span>
                {version.current ? (
                  <span className="rounded-[20px] bg-accent-soft px-[9px] py-[3px] text-[10.5px] font-bold text-accent">{t('designer:versions.current', 'current')}</span>
                ) : (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => setAsking(version)}
                    aria-label={t('designer:versions.goBackTo', 'Go back to {version}: {name}', { version: `v${String(version.n)}`, name: ownName(version) })}
                    icon={<Undo2 className="text-fg rtl:-scale-x-100" />}
                    className="w-auto shrink-0 gap-1.5 whitespace-nowrap rounded-[8px] border border-border bg-surface px-2.5 py-1.5 text-[12px] font-bold text-fg [&_svg]:size-[13px]"
                  >
                    {t('designer:versions.goBack', 'Go back to this')}
                  </DropdownMenuItem>
                )}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* A question with two answers and no third way out drawn: Escape and a press outside still leave it. */}
      <Modal open={asking !== null} onOpenChange={(open) => (open ? undefined : setAsking(null))} size="md" className="max-w-[440px] rounded-[16px] leading-[normal]">
        <ModalHeader
          hideClose
          closeLabel={t('designer:model.close', 'Close')}
          icon={<History />}
          title={marked((mark) => t('designer:versions.confirmTitle', 'Go back to {version}?', { version: mark }), <span className="font-mono">{askingName}</span>)}
          subtitle={
            <p className="m-0 mt-1.5 text-pretty text-[13px] leading-[1.6] text-fg-muted">
              {marked(
                (mark) =>
                  later.length === 0
                    ? t('designer:versions.confirmBodyNone', 'Your files return to {version}. Data already in the database is kept.', { version: mark })
                    : t('designer:versions.confirmBody', 'Your files return to {version}. {later} stay in the list, so you can come forward again. Data already in the database is kept.', { version: mark, later: list(later) }),
                <span className="font-mono font-semibold text-fg">{askingName}</span>,
              )}
            </p>
          }
          className="gap-[14px] px-[22px] pb-0 pt-[22px] [&>div:first-child]:size-[38px] [&>div:first-child]:rounded-[11px] [&>div:first-child_svg]:size-[19px]"
        />
        <div className="flex justify-end gap-2 p-[20px_22px]">
          <Button variant="secondary" size="lg" onClick={() => setAsking(null)} className="rounded-[10px] text-[13px] font-bold">
            {t('designer:versions.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={() => {
              if (asking !== null) onGoBack(asking);
              setAsking(null);
            }}
            className="rounded-[10px] text-[13px] font-bold"
          >
            {t('designer:versions.confirm', 'Go back')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
