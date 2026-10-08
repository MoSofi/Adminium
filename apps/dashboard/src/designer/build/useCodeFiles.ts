// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab's files, as the page holds them: the list the server allows,
 * what each opened file held when it was read (its text and its hash), what a
 * person has typed since, and what became of a save.
 *
 * The editor is elsewhere, in a part of the page that is loaded when the tab
 * first opens. It tells this what was typed; this tells it what to show. So
 * the bar, the message box and the question asked before leaving all know of
 * unsaved text without the editor being loaded for them.
 *
 * A save sends every edited file whole, each with the hash it had when read.
 * The server writes all of them or none, applies the app and names a version.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { designerApi, designerKeys, type DesignerFile, type DesignerFileGroup, type DesignerFiles, type FolderHold } from '../api.js';
import { findFile, firstFile } from './fileTree.js';

/** What keeps the files from being changed here: the Designer working or waiting for an answer, or something done from a page. */
export type CodeLock = null | 'turn' | 'waiting' | FolderHold;

/** What a save came to, when it did not simply apply. Shown above the editor until it is put right. */
export type CodeProblem =
  /** Written and not applied: the files are as saved, the app is as it was. */
  | { kind: 'not-applied'; stage: 'check' | 'build' | 'apply'; lines: string[] }
  /** Refused with a reason; nothing was written. */
  | { kind: 'refused'; message: string }
  /** The Designer's last change is half done on disk: a save would apply it under the person's name. */
  | { kind: 'unfinished' };

/** The part of the editor this needs: structural, so the editor's own module is not loaded for it. */
export interface CodeEditorHandle {
  text: (path: string) => string | null;
  replace: (path: string, text: string) => void;
  reset: (path: string, text: string) => void;
  forget: (path: string) => void;
}

interface Loaded {
  /** The file as it was read or last saved, byte for byte. */
  raw: string;
  hash: string;
}
type Content = Loaded | 'loading' | 'error';
const isLoaded = (content: Content | undefined): content is Loaded => typeof content === 'object';

/** The editor holds every line end as `\n`; a file that had `\r\n` gets them back when it is sent. */
const plain = (text: string): string => text.replace(/\r\n?/g, '\n');
const asRead = (text: string, raw: string): string => (/\r\n/.test(raw) ? text.replace(/\n/g, '\r\n') : text);

interface Store {
  active: boolean;
  open: string | null;
  contents: Record<string, Content>;
  /** What the editor holds for a file that was typed in. */
  texts: Map<string, string>;
  edited: Set<string>;
  /** Saved, written, and not applied: sent again with the next save, so the server sees one whole change. */
  unapplied: Set<string>;
  /** Edited here and changed on disk meanwhile: the hash it has there now. */
  changed: Map<string, string>;
  /** Edited here and no longer in the app. */
  gone: Set<string>;
  /** Every opened file as the list last had it: a file that left the app keeps its row and its name while its text is here. */
  known: Map<string, { group: DesignerFileGroup; file: DesignerFile }>;
  problem: CodeProblem | null;
  saving: boolean;
  editor: CodeEditorHandle | null;
}

export interface CodeNotice {
  variant: 'success' | 'info' | 'warning' | 'error';
  title: string;
  description?: string;
}

export interface CodeFiles {
  /** The tab has been opened once: the list is read from then on. */
  active: boolean;
  activate: () => void;
  list: DesignerFiles | undefined;
  listState: 'loading' | 'error' | 'ready';
  retryList: () => void;
  open: string | null;
  setOpen: (path: string) => void;
  /** The open file's text for the editor, once it has been read. */
  content: { state: 'loading' | 'error' | 'ready' | 'none'; text: string };
  retryContent: () => void;
  /** What the editor should show for a file: what was typed, else what was read. */
  textFor: (path: string) => string | null;
  /** Files with a mark in the list: typed in, or saved and not applied. */
  marks: ReadonlySet<string>;
  edited: ReadonlySet<string>;
  changed: ReadonlySet<string>;
  gone: ReadonlySet<string>;
  /** How many files a save would send. */
  count: number;
  /** The lock as the tab shows it: the page's, or this tab's own save. */
  lock: CodeLock;
  saving: boolean;
  problem: CodeProblem | null;
  canSave: boolean;
  canDiscard: boolean;
  /** Resolves true when the save was applied. */
  save: () => Promise<boolean>;
  /** The open file back to what it was read as: one change the person can undo. */
  discard: () => void;
  keepMine: (path: string) => void;
  useChanged: (path: string) => void;
  putBack: () => void;
  dismissProblem: () => void;
  attach: (editor: CodeEditorHandle | null) => void;
  onText: (path: string, text: string) => void;
}

function reasonOf(error: unknown): { reason: string | null; details: Record<string, unknown> } {
  const details = error instanceof ApiError && typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {};
  return { reason: typeof details['reason'] === 'string' ? details['reason'] : null, details };
}

export function useCodeFiles(
  sessionId: string,
  opts: {
    /** What the page knows holds the folder (not this tab's own save). */
    lock: CodeLock;
    onNotice: (notice: CodeNotice) => void;
    /** Put the app's files back as the newest version has them. Resolves when it is done. */
    onPutBack: () => Promise<unknown>;
  },
): CodeFiles {
  const queryClient = useQueryClient();
  const [, touch] = useReducer((count: number) => count + 1, 0);
  const store = useRef<Store>({ active: false, open: null, contents: {}, texts: new Map(), edited: new Set(), unapplied: new Set(), changed: new Map(), gone: new Set(), known: new Map(), problem: null, saving: false, editor: null });
  const st = store.current;
  const now = useRef(opts);
  now.current = opts;

  const list = useQuery({ queryKey: designerKeys.files(sessionId), queryFn: () => designerApi.files(sessionId), enabled: st.active, staleTime: 0 });
  const listNow = useRef(list.data);
  listNow.current = list.data;

  const drop = useCallback(
    (path: string): void => {
      delete st.contents[path];
      st.texts.delete(path);
      st.edited.delete(path);
      st.changed.delete(path);
      st.gone.delete(path);
      st.known.delete(path);
      st.unapplied.delete(path);
      st.editor?.forget(path);
      if (st.open === path) st.open = listNow.current === undefined ? null : (firstFile(listNow.current)?.path ?? null);
    },
    [st],
  );

  /** Read a file from the server. `fresh`: what was typed is dropped and the editor starts the file again. */
  const read = useCallback(
    async (path: string, fresh: boolean): Promise<void> => {
      if (!isLoaded(st.contents[path])) st.contents[path] = 'loading';
      touch();
      try {
        const reply = await designerApi.fileContent(sessionId, path);
        st.contents[path] = { raw: reply.content, hash: reply.hash };
        const listed = findFile(listNow.current, path);
        if (listed !== null) st.known.set(path, listed);
        if (fresh) {
          st.texts.delete(path);
          st.edited.delete(path);
          st.changed.delete(path);
          st.editor?.reset(path, plain(reply.content));
        }
      } catch (error) {
        // Not there any more: the list is asked again, and says so.
        if (error instanceof ApiError && error.status === 404) void queryClient.invalidateQueries({ queryKey: designerKeys.files(sessionId) });
        if (!isLoaded(st.contents[path])) st.contents[path] = 'error';
      }
      touch();
    },
    [queryClient, sessionId, st],
  );

  // The list, read again: every file that was opened is held against what the app has now.
  useEffect(() => {
    const data = list.data;
    if (data === undefined || st.saving) return;
    for (const [path, content] of Object.entries(st.contents)) {
      if (!isLoaded(content)) continue;
      const found = findFile(data, path);
      if (found === null) {
        if (st.edited.has(path)) st.gone.add(path);
        else drop(path);
        continue;
      }
      st.gone.delete(path);
      st.known.set(path, found);
      if (found.file.hash === content.hash) st.changed.delete(path);
      else if (st.edited.has(path)) st.changed.set(path, found.file.hash);
      else void read(path, true);
    }
    if (st.open === null || (findFile(data, st.open) === null && !st.gone.has(st.open))) st.open = firstFile(data)?.path ?? null;
    touch();
    // `st.saving` is read, not watched: the save reads the list again itself when it ends.
  }, [list.data, drop, read, st]);

  // The open file is read the first time it is shown.
  const open = st.open;
  useEffect(() => {
    if (open !== null && st.contents[open] === undefined) void read(open, false);
  }, [open, read, st]);

  // Whatever held the folder has let go: what it changed is read.
  const held = opts.lock !== null;
  useEffect(() => {
    if (!held && st.active) void queryClient.invalidateQueries({ queryKey: designerKeys.files(sessionId) });
  }, [held, queryClient, sessionId, st]);

  const onText = useCallback(
    (path: string, text: string): void => {
      const content = st.contents[path];
      if (!isLoaded(content)) return;
      const was = st.edited.has(path);
      const is = text !== plain(content.raw);
      st.texts.set(path, text);
      if (is) st.edited.add(path);
      else st.edited.delete(path);
      if (was !== is) touch();
    },
    [st],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (st.saving || now.current.lock !== null) return false;
    const paths = [...new Set([...st.edited, ...st.unapplied])].filter((path) => !st.gone.has(path) && isLoaded(st.contents[path]));
    if (paths.length === 0) return true;
    const body = paths.map((path) => {
      const content = st.contents[path] as Loaded;
      // The editor is asked first: it is the truth of what is on the screen.
      const text = st.editor?.text(path) ?? st.texts.get(path) ?? plain(content.raw);
      return { path, content: asRead(text, content.raw), base: content.hash };
    });
    st.saving = true;
    touch();
    try {
      const reply = await designerApi.saveFiles(sessionId, body);
      for (const saved of reply.files) {
        const sent = body.find((file) => file.path === saved.path);
        if (sent === undefined) continue;
        st.contents[saved.path] = { raw: sent.content, hash: saved.hash };
        st.changed.delete(saved.path);
        // Typed on while the save ran: still edited, against what was saved.
        const text = st.editor?.text(saved.path) ?? st.texts.get(saved.path) ?? plain(sent.content);
        if (text === plain(sent.content)) st.edited.delete(saved.path);
        else st.edited.add(saved.path);
        // The server keeps the look's file in its own shape: what it wrote is read back.
        if (/(^|\/)look\.json$/.test(saved.path) && !st.edited.has(saved.path)) void read(saved.path, true);
      }
      if (reply.applied) {
        st.unapplied.clear();
        st.problem = null;
        if (reply.version !== null) now.current.onNotice({ variant: 'success', title: t('designer:code.saved', 'Saved as {version}. The Designer will see your change.', { version: `v${String(reply.version.n)}` }) });
      } else {
        st.unapplied = new Set(paths);
        st.problem = { kind: 'not-applied', stage: reply.problems?.stage ?? 'apply', lines: reply.problems?.lines ?? [] };
      }
      return reply.applied;
    } catch (error) {
      const { reason, details } = reasonOf(error);
      const message = error instanceof Error ? error.message : String(error);
      if (reason === 'FILES_CHANGED' && Array.isArray(details['changed'])) {
        for (const entry of details['changed'] as { path?: unknown; hash?: unknown }[]) if (typeof entry.path === 'string' && typeof entry.hash === 'string') st.changed.set(entry.path, entry.hash);
      } else if (reason === 'UNFINISHED_CHANGE') st.problem = { kind: 'unfinished' };
      else if (reason === 'TURN_RUNNING' || reason === 'DESIGNER_BUSY') now.current.onNotice({ variant: 'info', title: t('designer:code.busy', 'The app is being changed. Try again in a moment.') });
      else if (error instanceof ApiError && error.status === 422) st.problem = { kind: 'refused', message };
      else now.current.onNotice({ variant: 'error', title: t('designer:code.saveFailed', 'Your changes were not saved'), description: message });
      return false;
    } finally {
      st.saving = false;
      touch();
      void queryClient.invalidateQueries({ queryKey: designerKeys.files(sessionId) });
    }
  }, [queryClient, read, sessionId, st]);

  const discard = useCallback((): void => {
    const path = st.open;
    if (path === null) return;
    const content = st.contents[path];
    if (st.gone.has(path) || !isLoaded(content)) {
      drop(path);
      touch();
      return;
    }
    if (st.editor !== null) st.editor.replace(path, plain(content.raw));
    else {
      st.texts.delete(path);
      st.edited.delete(path);
    }
    touch();
  }, [drop, st]);

  const keepMine = useCallback(
    (path: string): void => {
      const content = st.contents[path];
      const hash = st.changed.get(path);
      // Their text stays; the next save is held against the file as it is now, and so goes over it.
      if (isLoaded(content) && hash !== undefined) st.contents[path] = { raw: content.raw, hash };
      st.changed.delete(path);
      touch();
    },
    [st],
  );

  const putBack = useCallback((): void => {
    void now.current
      .onPutBack()
      .then(() => {
        st.unapplied.clear();
        st.problem = null;
        touch();
      })
      .catch(() => undefined)
      .finally(() => void queryClient.invalidateQueries({ queryKey: designerKeys.files(sessionId) }));
  }, [queryClient, sessionId, st]);

  // A file that left the app while it was edited stays in the list, where it was, until its text is discarded.
  const data = list.data;
  let shown = data;
  if (data !== undefined && st.gone.size > 0) {
    const groups = data.groups.map((group) => ({ key: group.key, files: [...group.files] }));
    for (const path of st.gone) {
      const was = st.known.get(path);
      if (was === undefined) continue;
      const group = groups.find((entry) => entry.key === was.group);
      if (group === undefined) groups.push({ key: was.group, files: [was.file] });
      else group.files.push(was.file);
    }
    shown = { ...data, groups };
  }

  const content = open === null ? undefined : st.contents[open];
  const lock: CodeLock = st.saving ? 'save' : opts.lock;
  const count = new Set([...st.edited, ...st.unapplied].filter((path) => !st.gone.has(path))).size;

  // These are handed to effects elsewhere: each must be the same function on every render.
  const activate = useCallback((): void => {
    if (st.active) return;
    st.active = true;
    touch();
  }, [st]);
  const setOpen = useCallback(
    (path: string): void => {
      st.open = path;
      touch();
    },
    [st],
  );
  const attach = useCallback(
    (editor: CodeEditorHandle | null): void => {
      st.editor = editor;
    },
    [st],
  );
  const useChanged = useCallback((path: string): void => void read(path, true), [read]);
  const textFor = useCallback(
    (path: string): string | null => {
      const loaded = st.contents[path];
      return isLoaded(loaded) ? (st.texts.get(path) ?? plain(loaded.raw)) : null;
    },
    [st],
  );

  return {
      active: st.active,
      activate,
      list: shown,
      listState: list.data !== undefined ? 'ready' : list.isError ? 'error' : 'loading',
      retryList: () => void list.refetch(),
      open,
      setOpen,
      content: open === null ? { state: 'none', text: '' } : isLoaded(content) ? { state: 'ready', text: st.texts.get(open) ?? plain(content.raw) } : { state: content === 'error' ? 'error' : 'loading', text: '' },
      retryContent: () => {
        if (open !== null) void read(open, false);
      },
      textFor,
      marks: new Set([...st.edited, ...st.unapplied]),
      edited: new Set(st.edited),
      changed: new Set(st.changed.keys()),
      gone: new Set(st.gone),
      count,
      lock,
      saving: st.saving,
      problem: st.problem,
      canSave: count > 0 && lock === null,
      canDiscard: open !== null && lock === null && (st.edited.has(open) || st.gone.has(open)),
      save,
      discard,
      keepMine,
      useChanged,
      putBack,
      dismissProblem: () => {
        st.problem = null;
        touch();
      },
      attach,
      onText,
  };
}
