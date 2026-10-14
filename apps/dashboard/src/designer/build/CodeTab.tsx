// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab's panel: the files a person may change, and an editor for the
 * one that is open. Loaded when the tab is first opened, and kept after: what
 * was typed lives in the editor.
 *
 * The files are the model's (`useCodeFiles`); this draws them and hosts the
 * editor. Above the editor one line says why it cannot be typed in, or what
 * became of a save, with what can be done about it.
 *
 * Two searches: one of the open file, in a bar above the editor (Ctrl+F or
 * Cmd+F), and one of every file, above the list, whose places take the
 * list's place while something is looked for (`CodeSearch`).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, FileCode, FileJson, FileText, Folder, FolderOpen, LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { Button, Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DesignerFileGroup, DesignerFileHit } from '../api.js';
import { createCodeEditor, type CodeEditor } from './code/editor.js';
import type { FindSpec } from './code/find.js';
import { FindBar, FindField, NO_FIND, SearchResults, useFilesSearch, type FoundInFile } from './CodeSearch.js';
import { findFile, foldersOf, nameOf, treeRows, type TreeRow } from './fileTree.js';
import type { CodeFiles, CodeLock } from './useCodeFiles.js';

function groupTitle(key: DesignerFileGroup): string {
  if (key === 'customer') return t('designer:code.groupCustomer', 'Customer side');
  if (key === 'staff') return t('designer:code.groupStaff', 'Staff side');
  if (key === 'mobile') return t('designer:code.groupMobile', 'Phone app');
  if (key === 'dashboard') return t('designer:code.groupDashboard', 'Dashboard side');
  return t('designer:code.groupSettings', 'Design and settings');
}

/** Why the editor is read-only, in words. */
export function lockLine(lock: Exclude<CodeLock, null>): string {
  if (lock === 'turn') return t('designer:code.lockTurn', 'The Designer is working. You can edit again when it finishes.');
  if (lock === 'waiting') return t('designer:code.lockWaiting', 'The Designer is waiting for your answer in the chat.');
  if (lock === 'save') return t('designer:code.lockSave', 'Saving…');
  if (lock === 'style') return t('designer:code.lockStyle', 'The style is being changed. You can edit again in a moment.');
  if (lock === 'restore') return t('designer:code.lockRestore', 'The files are being put back. You can edit again in a moment.');
  return t('designer:code.lockStart', 'The app is being changed. You can edit again in a moment.');
}

function fileIcon(name: string): ReactNode {
  const Icon = /\.md$/i.test(name) ? FileText : /\.json$/i.test(name) ? FileJson : FileCode;
  return <Icon aria-hidden="true" className="size-3.5" />;
}

/** A row of the list: each level in is 18 px. */
const ROW = 'flex h-7 w-full items-center rounded-[7px] ps-[calc(8px+var(--depth)*18px)] pe-2 text-start focus-visible:outline-2 focus-visible:outline-accent';
const LINE = 'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] font-semibold text-fg-muted';

export default function CodeTab({ code, compact, onFix }: { code: CodeFiles; /** A phone-wide window: the list sits above the editor. */ compact: boolean; onFix: (message: string) => void }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLElement>(null);
  const editor = useRef<CodeEditor | null>(null);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  /** The row the keyboard is on in the list: one tab stop for the whole list. */
  const [at, setAt] = useState<string | null>(null);
  const saving = useRef(code.save);
  saving.current = code.save;

  /** The open file's search: its bar, what is looked for, and what the editor found. */
  const [bar, setBar] = useState<{ open: boolean; spec: FindSpec }>({ open: false, spec: NO_FIND });
  const [places, setPlaces] = useState<FoundInFile>({ count: 0, at: -1, more: false });
  const findInput = useRef<HTMLInputElement>(null);
  /** Every file's search. */
  const [all, setAll] = useState<FindSpec>(NO_FIND);
  const allInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const search = useFilesSearch(code, all);
  const searching = all.query !== '';
  const searchingNow = useRef(searching);
  searchingNow.current = searching;
  /** A place chosen in a file the editor does not show yet: gone to when it does. */
  const pending = useRef<{ path: string; hit: DesignerFileHit } | null>(null);

  const { attach, onText } = code;
  useEffect(() => {
    if (host.current === null) return;
    const made = createCodeEditor(host.current, {
      onChange: onText,
      onSave: () => void saving.current(),
      // Tab types here, so Escape is the keyboard's way out: to the open file's row.
      // While the places of a search have the list's place, the way out is to the search.
      onLeave: () => (searchingNow.current ? allInput.current : (files.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? files.current?.querySelector<HTMLElement>('button')))?.focus(),
      onFound: setPlaces,
    });
    editor.current = made;
    attach(made);
    return () => {
      attach(null);
      editor.current = null;
      made.destroy();
    };
  }, [attach, onText]);

  const open = code.open;
  const found = findFile(code.list, open);
  const name = found === null ? '' : nameOf(found.file.label);
  const ready = open !== null && code.content.state === 'ready';
  const { textFor } = code;
  useEffect(() => {
    if (!ready || open === null) return;
    const text = textFor(open);
    if (text === null) return;
    editor.current?.open(open, text);
    const to = pending.current;
    if (to === null || to.path !== open) return;
    pending.current = null;
    editor.current?.reveal(to.hit.line, to.hit.col, to.hit.len);
  }, [open, ready, textFor]);

  /** Set what the bar holds, have the editor look for it, and (`jump`) go to the nearest place. */
  const look = (next: { open: boolean; spec: FindSpec }, jump: boolean): void => {
    setBar(next);
    const spec = next.open && next.spec.query !== '' ? next.spec : null;
    editor.current?.find(spec);
    if (jump && spec !== null) editor.current?.step(0);
  };
  const [asked, askFind] = useState(0);
  const openFind = (): void => {
    // What is selected is what is looked for, as an editor has it.
    const selected = editor.current?.selected() ?? '';
    look({ open: true, spec: selected === '' ? bar.spec : { ...bar.spec, query: selected } }, true);
    askFind((count) => count + 1);
  };
  const closeFind = (): void => {
    look({ ...bar, open: false }, false);
    editor.current?.focus();
  };
  useEffect(() => {
    if (asked === 0) return;
    findInput.current?.focus();
    findInput.current?.select();
  }, [asked]);

  /** A place chosen from every file's search: its file is opened, the editor looks for the same words, and the place is selected. */
  const go = (path: string, hit: DesignerFileHit): void => {
    look({ open: true, spec: search.spec }, false);
    if (path === open && ready && editor.current?.shown() === path) {
      editor.current.reveal(hit.line, hit.col, hit.len);
      return;
    }
    pending.current = { path, hit };
    code.setOpen(path);
  };

  const gone = open !== null && code.gone.has(open);
  const held = code.lock !== null || gone;
  useEffect(() => {
    editor.current?.setHeld(held);
    editor.current?.setLabel(
      code.lock === 'turn' || code.lock === 'waiting'
        ? t('designer:code.readOnlyDesigner', '{file}, read only while the Designer works', { file: name })
        : held
          ? t('designer:code.readOnly', '{file}, read only for now', { file: name })
          : t('designer:code.editing', 'Editing {file}. Press Escape to leave the editor.', { file: name }),
    );
  }, [held, code.lock, name, ready]);

  // The open file's folders are open: its row is always there to go back to.
  useEffect(() => {
    if (found === null) return;
    const closed = foldersOf(found.group, found.file.label).filter((key, depth) => (depth === 0) === toggled.has(key));
    if (closed.length === 0) return;
    setToggled((was) => {
      const next = new Set(was);
      for (const key of closed) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    // Only when another file is opened: a folder a person closes over the open file stays closed.
  }, [open]);

  const groups = useMemo(() => (code.list?.groups ?? []).map((group) => ({ key: group.key, rows: treeRows(group.key, group.files, toggled) })), [code.list, toggled]);
  const stop = at !== null && groups.some((group) => group.rows.some((row) => row.key === at)) ? at : (open ?? groups[0]?.rows[0]?.key ?? null);

  const onListKey = (event: KeyboardEvent<HTMLElement>): void => {
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('button[data-row]')];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const to = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : -1;
    if (to < 0 || to >= rows.length) return;
    event.preventDefault();
    rows[to]?.focus();
  };

  const row = (entry: TreeRow): ReactNode => {
    const tab = { tabIndex: entry.key === stop ? 0 : -1, onFocus: () => setAt(entry.key), 'data-row': '' };
    if (entry.kind === 'folder') {
      return (
        <button
          key={entry.key}
          type="button"
          {...tab}
          aria-expanded={entry.open}
          onClick={() =>
            setToggled((was) => {
              const next = new Set(was);
              if (next.has(entry.key)) next.delete(entry.key);
              else next.add(entry.key);
              return next;
            })
          }
          style={{ '--depth': String(entry.depth) }}
          className={`${ROW} gap-[5px] font-semibold text-fg hover:bg-surface-2`}
        >
          <ChevronRight aria-hidden="true" className={`-ms-1 size-[13px] shrink-0 text-fg-subtle transition-transform ${entry.open ? 'rotate-90' : 'rtl:-scale-x-100'}`} />
          <span className="flex shrink-0 text-fg-subtle">{entry.open ? <FolderOpen aria-hidden="true" className="size-3.5" /> : <Folder aria-hidden="true" className="size-3.5" />}</span>
          <span dir="ltr" className="truncate font-mono text-[12px]">
            {entry.name}
          </span>
        </button>
      );
    }
    const on = entry.key === open;
    return (
      <button key={entry.key} type="button" {...tab} aria-current={on ? 'page' : undefined} onClick={() => code.setOpen(entry.key)} style={{ '--depth': String(entry.depth) }} className={`${ROW} gap-[7px] ${on ? 'bg-accent-soft font-bold text-accent' : 'font-medium text-fg hover:bg-surface-2'}`}>
        <span className={`flex shrink-0 ${on ? 'text-accent' : 'text-fg-subtle'}`}>{fileIcon(entry.name)}</span>
        <span dir="ltr" className="truncate font-mono text-[12px]">
          {entry.name}
        </span>
        {entry.file.note === 'brief' ? <span className="whitespace-nowrap text-[11.5px] font-medium text-fg-subtle">{t('designer:code.brief', 'The design brief')}</span> : null}
        {code.marks.has(entry.key) ? <span role="img" aria-label={t('designer:code.unsavedMark', 'unsaved')} className="ms-auto size-1.5 shrink-0 rounded-full bg-warn" /> : null}
      </button>
    );
  };

  const small = (label: string, onClick: () => void, primary = false): ReactNode => (
    <Button size="sm" variant={primary ? 'secondary' : 'ghost'} onClick={onClick} className="rounded-[8px] font-bold">
      {label}
    </Button>
  );

  /** One line above the editor: why it is held, else what the open file or the last save needs. */
  const line = (): ReactNode => {
    if (code.lock !== null) {
      return (
        <div role="status" className={LINE}>
          <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-accent" />
          {lockLine(code.lock)}
        </div>
      );
    }
    if (open !== null && gone) {
      return (
        <div role="status" className={LINE}>
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{t('designer:code.gone', 'This file is no longer in the app. Copy your text if you need it.')}</span>
        </div>
      );
    }
    if (open !== null && code.changed.has(open)) {
      return (
        <div role="status" className={LINE}>
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{t('designer:code.changedUnder', 'This file changed while you were editing it.')}</span>
          {code.edited.has(open) ? small(t('designer:code.keepMine', 'Keep my changes'), () => code.keepMine(open)) : null}
          {small(t('designer:code.useChanged', 'Use the changed file'), () => code.useChanged(open), true)}
        </div>
      );
    }
    const problem = code.problem;
    if (problem === null) return null;
    if (problem.kind === 'refused') {
      return (
        <div role="alert" className={LINE}>
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{t('designer:code.refused', 'Nothing was saved. {reason}', { reason: problem.message })}</span>
          {small(t('designer:code.ok', 'OK'), code.dismissProblem, true)}
        </div>
      );
    }
    if (problem.kind === 'unfinished') {
      return (
        <div role="alert" className={LINE}>
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{t('designer:code.unfinished', 'Nothing was saved: the Designer’s last change was not finished. Ask it to finish, or put the files back.')}</span>
          {small(t('designer:code.putBack', 'Put the files back'), code.putBack, true)}
        </div>
      );
    }
    const words = problem.lines.slice(0, 3).join('\n');
    return (
      <div role="alert" className={LINE}>
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
        <span className="min-w-0 flex-1">{t('designer:code.notApplied', 'Your changes were saved, and the app was not applied. The preview shows the last build that worked.')}</span>
        {small(t('designer:code.putBack', 'Put the files back'), code.putBack)}
        {small(t('designer:preview.fix', 'Ask the Designer to fix it'), () => onFix(t('designer:code.fixMessage', 'I changed some files by hand and the app does not apply any more: {error} Please fix it.', { error: words })), true)}
        {words === '' ? null : (
          <pre dir="ltr" className="m-0 max-h-[72px] basis-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] font-medium leading-[1.5] text-fg">
            {words}
          </pre>
        )}
      </div>
    );
  };

  const listBody = (): ReactNode => {
    if (code.listState === 'loading') {
      return (
        <p role="status" className="m-0 flex items-center gap-2 px-2 py-1 text-[12.5px] font-semibold text-fg-muted">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
          {t('designer:code.listLoading', 'Opening the files…')}
        </p>
      );
    }
    if (code.listState === 'error') {
      return (
        <div className="flex flex-col items-start gap-2 px-2 py-1 text-[12.5px] text-fg-muted">
          <p role="alert" className="m-0 font-semibold">
            {t('designer:code.listFailed', 'The files could not be read.')}
          </p>
          {small(t('designer:code.tryAgain', 'Try again'), code.retryList, true)}
        </div>
      );
    }
    if (groups.length === 0) return <p className="m-0 px-2 py-1 text-[12.5px] leading-[1.5] text-fg-muted">{t('designer:code.listEmpty', 'There are no files to change here yet.')}</p>;
    return groups.map((group) => (
      <div key={group.key} role="group" aria-label={groupTitle(group.key)} className="flex flex-col gap-px">
        <div aria-hidden="true" className="px-2 pb-1.5 pt-0.5 text-[12px] font-extrabold text-fg-muted">
          {groupTitle(group.key)}
        </div>
        {group.rows.map(row)}
      </div>
    ));
  };

  return (
    <div
      // The save key works anywhere in the tab; inside the editor it is the editor's own key.
      onKeyDownCapture={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key === 's' && !(event.target instanceof HTMLElement && event.target.closest('.cm-editor') !== null)) {
          event.preventDefault();
          void code.save();
        } else if (key === 'f' && event.shiftKey) {
          event.preventDefault();
          allInput.current?.focus();
          allInput.current?.select();
        } else if (key === 'f' && ready) {
          event.preventDefault();
          openFind();
        }
      }}
      className={`flex min-h-0 flex-1 bg-surface leading-[normal] ${compact ? 'flex-col' : 'flex-row'}`}
    >
      <div className={`flex min-h-0 flex-col bg-surface ${compact ? 'max-h-[260px] w-full shrink-0 border-b border-border' : 'w-60 shrink-0 border-e border-border'}`}>
        <div role="search" aria-label={t('designer:code.searchAll', 'Search in all files')} className="flex shrink-0 border-b border-border p-2">
          <FindField
            spec={all}
            onSpec={setAll}
            label={t('designer:code.searchAll', 'Search in all files')}
            inputRef={allInput}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searching) {
                event.preventDefault();
                setAll({ ...all, query: '' });
              } else if (event.key === 'ArrowDown' && searching) {
                event.preventDefault();
                results.current?.querySelector<HTMLElement>('button[data-row]')?.focus();
              }
            }}
          />
        </div>
        {/* Kept while a search has its place: the folders a person opened are as they left them. */}
        <nav ref={files} aria-label={t('designer:code.files', 'Files')} onKeyDown={onListKey} hidden={searching} className={searching ? 'hidden' : 'nb-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-2 py-3'}>
          {listBody()}
        </nav>
        {searching ? <SearchResults search={search} open={open} listRef={results} onGo={go} onKeyDown={onListKey} /> : null}
        <p className="m-0 border-t border-border px-3.5 pb-3 pt-2.5 text-[11.5px] leading-[1.5] text-fg-subtle">{t('designer:code.foot', 'Only the files you can safely change are shown here.')}</p>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        {line()}
        {open !== null && code.content.state === 'loading' ? (
          <p role="status" className={LINE}>
            <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-accent" />
            {t('designer:code.fileLoading', 'Opening {file}…', { file: name })}
          </p>
        ) : null}
        {open !== null && code.content.state === 'error' ? (
          <div role="alert" className={LINE}>
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
            <span className="min-w-0 flex-1">{t('designer:code.fileFailed', 'This file could not be read.')}</span>
            {small(t('designer:code.tryAgain', 'Try again'), code.retryContent, true)}
          </div>
        ) : null}
        {bar.open && ready ? <FindBar spec={bar.spec} onSpec={(spec) => look({ open: true, spec }, true)} found={places} inputRef={findInput} onStep={(direction) => editor.current?.step(direction)} onClose={closeFind} /> : null}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={host} dir="ltr" data-part="code-editor" className={`min-h-0 flex-1 overflow-hidden ${ready ? '' : 'invisible'}`} />
          {ready && !bar.open ? (
            <Tooltip content={t('designer:code.find', 'Find in this file')}>
              <button
                type="button"
                onClick={openFind}
                aria-label={t('designer:code.find', 'Find in this file')}
                aria-keyshortcuts="Control+F Meta+F"
                className="absolute end-5 top-2 flex size-7 items-center justify-center rounded-[8px] border border-border bg-surface text-fg-muted shadow-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Search aria-hidden="true" className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
