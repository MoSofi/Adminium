// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Looking for words in the Code tab: the field both searches are typed in,
 * the bar that looks through the open file, and the list of every place the
 * words are in all the files.
 *
 * The open file is searched by the editor, in the text it holds. All the
 * files are searched by the server, as they are on disk; a file that was
 * typed in and not saved is searched here instead, in what was typed, so the
 * list and the editor never disagree about a file a person is changing.
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CaseSensitive, ChevronDown, ChevronUp, LoaderCircle, Search, WholeWord, X } from 'lucide-react';
import { Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { designerApi, designerKeys, type DesignerFileGroup, type DesignerFileHit } from '../api.js';
import { findHits, type FindSpec } from './code/find.js';
import { crumbsOf, nameOf } from './fileTree.js';
import type { CodeFiles } from './useCodeFiles.js';

export const NO_FIND: FindSpec = { query: '', matchCase: false, wholeWord: false };

const SMALL_ICON = 'flex size-6 shrink-0 items-center justify-center rounded-[6px] text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:bg-accent-soft aria-pressed:text-accent';

/** The words, and the two ways they are held against the text. */
export function FindField({
  spec,
  onSpec,
  label,
  inputRef,
  onKeyDown,
}: {
  spec: FindSpec;
  onSpec: (spec: FindSpec) => void;
  /** What the field is for: its name, and what it says while it is empty. */
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}): ReactNode {
  const toggle = (name: string, on: boolean, flip: () => void, icon: ReactNode): ReactNode => (
    <Tooltip content={name}>
      <button type="button" aria-label={name} aria-pressed={on} onClick={flip} className={SMALL_ICON}>
        {icon}
      </button>
    </Tooltip>
  );
  return (
    <div className="flex h-[30px] min-w-0 flex-1 items-center gap-0.5 rounded-[8px] border border-border bg-surface ps-2 pe-[3px] focus-within:border-accent">
      <Search aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      <input
        ref={inputRef}
        type="text"
        value={spec.query}
        onChange={(event) => onSpec({ ...spec, query: event.target.value })}
        onKeyDown={onKeyDown}
        aria-label={label}
        placeholder={label}
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[12.5px] font-medium text-fg outline-none placeholder:text-fg-subtle"
      />
      {toggle(t('designer:code.matchCase', 'Match case'), spec.matchCase, () => onSpec({ ...spec, matchCase: !spec.matchCase }), <CaseSensitive aria-hidden="true" className="size-[15px]" />)}
      {toggle(t('designer:code.wholeWord', 'Whole word'), spec.wholeWord, () => onSpec({ ...spec, wholeWord: !spec.wholeWord }), <WholeWord aria-hidden="true" className="size-[15px]" />)}
    </div>
  );
}

export interface FoundInFile {
  count: number;
  /** The place the selection is on, from 0; -1 when it is on none. */
  at: number;
  more: boolean;
}

/** The bar above the editor: the open file's own search. */
export function FindBar({
  spec,
  onSpec,
  found,
  inputRef,
  onStep,
  onClose,
}: {
  spec: FindSpec;
  onSpec: (spec: FindSpec) => void;
  found: FoundInFile;
  inputRef: RefObject<HTMLInputElement | null>;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}): ReactNode {
  const none = found.count === 0;
  const count = `${String(found.count)}${found.more ? '+' : ''}`;
  const says =
    spec.query === ''
      ? ''
      : none
        ? t('designer:code.noResults', 'No results')
        : found.at === -1
          ? t('designer:code.findCount', '{count} found', { count })
          : t('designer:code.findAt', '{at} of {count}', { at: found.at + 1, count });
  const step = (name: string, direction: 1 | -1, icon: ReactNode): ReactNode => (
    <Tooltip content={name}>
      <button type="button" aria-label={name} disabled={none} onClick={() => onStep(direction)} className={SMALL_ICON}>
        {icon}
      </button>
    </Tooltip>
  );
  return (
    <div role="search" aria-label={t('designer:code.find', 'Find in this file')} className="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface-2 px-3.5 py-1.5">
      <div className="flex min-w-0 max-w-[340px] flex-1">
        <FindField
          spec={spec}
          onSpec={onSpec}
          label={t('designer:code.find', 'Find in this file')}
          inputRef={inputRef}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      <span role="status" className={`min-w-[64px] shrink-0 whitespace-nowrap text-[12px] font-semibold tabular-nums ${none && spec.query !== '' ? 'text-warn' : 'text-fg-muted'}`}>
        {says}
      </span>
      {step(t('designer:code.findPrevious', 'Previous result'), -1, <ChevronUp aria-hidden="true" className="size-[15px]" />)}
      {step(t('designer:code.findNext', 'Next result'), 1, <ChevronDown aria-hidden="true" className="size-[15px]" />)}
      <Tooltip content={t('designer:code.findClose', 'Close the search')}>
        <button type="button" aria-label={t('designer:code.findClose', 'Close the search')} onClick={onClose} className={`${SMALL_ICON} ms-auto`}>
          <X aria-hidden="true" className="size-[15px]" />
        </button>
      </Tooltip>
    </div>
  );
}

export interface FoundFile {
  path: string;
  group: DesignerFileGroup;
  label: string;
  hits: DesignerFileHit[];
}

export interface FilesSearch {
  /** What was asked for: a moment behind what is typed. */
  spec: FindSpec;
  state: 'idle' | 'loading' | 'error' | 'ready';
  files: FoundFile[];
  count: number;
  more: boolean;
  retry: () => void;
}

/** Every place the words are in all the files, in the list's own order. Asked for a moment after the typing stops. */
export function useFilesSearch(code: CodeFiles, spec: FindSpec): FilesSearch {
  const [asked, setAsked] = useState(spec);
  const { query, matchCase, wholeWord } = spec;
  useEffect(() => {
    const timer = setTimeout(() => setAsked({ query, matchCase, wholeWord }), query === '' ? 0 : 250);
    return () => clearTimeout(timer);
  }, [query, matchCase, wholeWord]);

  const on = asked.query !== '';
  // Under the list's own key: whatever has the list read again (a save, a turn) has the files searched again.
  const reply = useQuery({
    queryKey: [...designerKeys.files(code.sessionId), 'search', asked.query, asked.matchCase, asked.wholeWord],
    queryFn: () => designerApi.searchFiles(code.sessionId, asked),
    enabled: on,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const files: FoundFile[] = [];
  let more = reply.data?.more ?? false;
  if (on && reply.data !== undefined) {
    const disk = new Map(reply.data.files.map((file) => [file.path, file.hits]));
    for (const group of code.list?.groups ?? []) {
      for (const file of group.files) {
        let hits = disk.get(file.path) ?? [];
        // Typed in and not saved: what the editor holds is what is searched.
        const typed = code.edited.has(file.path) ? code.textFor(file.path) : null;
        if (typed !== null) {
          const mine = findHits(typed, asked);
          hits = mine.hits;
          more ||= mine.more;
        }
        if (hits.length > 0) files.push({ path: file.path, group: group.key, label: file.label, hits });
      }
    }
  }
  return {
    spec: asked,
    state: !on ? 'idle' : reply.data !== undefined ? 'ready' : reply.isError ? 'error' : 'loading',
    files,
    count: files.reduce((sum, file) => sum + file.hits.length, 0),
    more,
    retry: () => void reply.refetch(),
  };
}

/** A line with the place in it. The list is narrow: more than a few letters in, the line's start gives way so the place is seen. */
function shown(hit: DesignerFileHit): { before: string; match: string; after: string } {
  const lead = hit.text.slice(0, hit.at).trimStart();
  return { before: lead.length > 14 ? `…${lead.slice(-10).trimStart()}` : lead, match: hit.text.slice(hit.at, hit.at + hit.len), after: hit.text.slice(hit.at + hit.len).trimEnd() };
}

const NOTE = 'm-0 flex items-center gap-2 px-2 py-1 text-[12.5px] font-semibold text-fg-muted';

/** The list of places, in the files' place while something is looked for. */
export function SearchResults({
  search,
  open,
  listRef,
  onGo,
  onKeyDown,
}: {
  search: FilesSearch;
  /** The file the editor shows. */
  open: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  onGo: (path: string, hit: DesignerFileHit) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}): ReactNode {
  const body = (): ReactNode => {
    if (search.state === 'idle' || search.state === 'loading') {
      return (
        <p role="status" className={NOTE}>
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
          {t('designer:code.searching', 'Searching…')}
        </p>
      );
    }
    if (search.state === 'error') {
      return (
        <div className="flex flex-col items-start gap-2 px-2 py-1 text-[12.5px] text-fg-muted">
          <p role="alert" className="m-0 font-semibold">
            {t('designer:code.searchFailed', 'The files could not be searched.')}
          </p>
          <button type="button" onClick={search.retry} className="rounded-[8px] border border-border bg-surface px-2.5 py-1 text-[12.5px] font-bold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
            {t('designer:code.tryAgain', 'Try again')}
          </button>
        </div>
      );
    }
    let nth = 0;
    return (
      <>
        <p role="status" className={NOTE}>
          {search.count === 0
            ? t('designer:code.noResults', 'No results')
            : search.more
              ? t('designer:code.resultsFirst', 'The first {count} results, in {files, plural, one {# file} other {# files}}', { count: search.count, files: search.files.length })
              : t('designer:code.resultCount', '{count, plural, one {# result} other {# results}} in {files, plural, one {# file} other {# files}}', { count: search.count, files: search.files.length })}
        </p>
        {search.files.map((file) => {
          const crumbs = crumbsOf(file.group, file.label);
          const name = nameOf(file.label);
          return (
            <div key={file.path} role="group" aria-label={file.label} className="flex flex-col gap-px">
              <div aria-hidden="true" dir="ltr" className={`flex h-7 items-center gap-1.5 px-2 font-mono text-[12px] ${file.path === open ? 'text-accent' : 'text-fg'}`}>
                <span className="shrink-0 font-bold">{name}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-fg-subtle">{crumbs.slice(0, -1).join('/')}</span>
                <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-[11px] font-bold tabular-nums text-fg-muted">{file.hits.length}</span>
              </div>
              {file.hits.map((hit) => {
                const { before, match, after } = shown(hit);
                const first = nth === 0;
                nth += 1;
                return (
                  <button
                    key={`${String(hit.line)}.${String(hit.col)}`}
                    type="button"
                    data-row=""
                    tabIndex={first ? 0 : -1}
                    onClick={() => onGo(file.path, hit)}
                    aria-label={t('designer:code.resultLine', 'Line {line}: {text}', { line: hit.line, text: hit.text.trim() })}
                    className="flex h-6 w-full items-center gap-2 rounded-[7px] pe-2 ps-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span dir="ltr" className="w-7 shrink-0 text-end font-mono text-[11px] font-medium tabular-nums text-fg-subtle">
                      {hit.line}
                    </span>
                    <span dir="ltr" className="min-w-0 flex-1 truncate whitespace-pre font-mono text-[12px] font-medium text-fg-muted">
                      {before}
                      <mark className="rounded-[3px] bg-accent-soft font-bold text-accent">{match}</mark>
                      {after}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </>
    );
  };
  return (
    <div ref={listRef} role="region" aria-label={t('designer:code.searchResults', 'Search results')} onKeyDown={onKeyDown} className="nb-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-3">
      {body()}
    </div>
  );
}
