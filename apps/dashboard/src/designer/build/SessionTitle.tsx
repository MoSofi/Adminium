// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The middle of the build page's top bar: the session's name, which a click
 * turns into a field (Enter keeps it, Escape leaves it), and the version in
 * use, whose menu lists every version newest first. Going back to one adds a
 * version on top, so the list only grows; the dialog says so. With no git on
 * this machine versions are off, and the button says why.
 */
import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, GitCommitHorizontal, History } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerVersion } from '../api.js';
import { editedWhen } from '../home/YourApps.js';

function list(items: readonly string[]): string {
  try {
    return new Intl.ListFormat(getI18nInstance()?.language ?? 'en-US', { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
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
          className="h-8 w-[min(240px,40vw)] rounded-lg border border-accent bg-surface px-2 text-sm font-bold text-fg outline-none"
        />
      ) : (
        <button
          ref={nameButton}
          type="button"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          aria-label={t('designer:build.renameApp', 'Rename {name}', { name: title })}
          className="max-w-[min(240px,32vw)] truncate rounded-lg px-2 py-1 text-sm font-extrabold tracking-tight text-fg hover:bg-surface-2"
        >
          {title}
        </button>
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
            aria-label={t('designer:versions.button', 'Version {version}: {name}', { version: `v${String(current.n)}`, name: current.name })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <GitCommitHorizontal aria-hidden="true" className="size-3.5" />
            <span className="font-mono">{`v${String(current.n)}`}</span>
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-[420px] max-w-[calc(100vw-24px)]">
            <DropdownMenuLabel>{t('designer:versions.title', 'Versions')}</DropdownMenuLabel>
            {newestFirst.map((version) => (
              <div key={version.n} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 ${version.current ? 'bg-surface-2' : ''}`}>
                <span className="w-7 shrink-0 font-mono text-[12.5px] font-bold">{`v${String(version.n)}`}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-bold text-fg">{version.name}</span>
                  <span className="text-[11.5px] text-fg-subtle">{editedWhen(version.at)}</span>
                </span>
                {version.current ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold text-accent">{t('designer:versions.current', 'current')}</span>
                ) : (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => setAsking(version)}
                    aria-label={t('designer:versions.goBackTo', 'Go back to {version}: {name}', { version: `v${String(version.n)}`, name: version.name })}
                    className="w-auto shrink-0 px-2 py-1 text-xs font-bold text-accent"
                  >
                    {t('designer:versions.goBack', 'Go back to this')}
                  </DropdownMenuItem>
                )}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Modal open={asking !== null} onOpenChange={(open) => (open ? undefined : setAsking(null))} size="sm">
        <ModalHeader
          icon={<History />}
          title={t('designer:versions.confirmTitle', 'Go back to {version}?', { version: asking === null ? '' : `v${String(asking.n)}` })}
          closeLabel={t('designer:model.close', 'Close')}
        />
        <ModalBody>
          <p className="m-0 text-[13.5px] leading-normal text-fg-muted">
            {later.length === 0
              ? t('designer:versions.confirmBodyNone', 'Your files return to {version}. Data already in the database is kept.', { version: asking === null ? '' : `v${String(asking.n)}` })
              : t('designer:versions.confirmBody', 'Your files return to {version}. {later} stay in the list, so you can come forward again. Data already in the database is kept.', {
                  version: asking === null ? '' : `v${String(asking.n)}`,
                  later: list(later),
                })}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setAsking(null)}>
            {t('designer:versions.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (asking !== null) onGoBack(asking);
              setAsking(null);
            }}
          >
            {t('designer:versions.confirm', 'Go back')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
