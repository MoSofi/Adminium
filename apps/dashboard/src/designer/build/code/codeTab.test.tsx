// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab, with the real editor and the real files model, over a server
 * this test plays: the list, one file, and the save with each of its answers.
 */
import { createHash } from 'node:crypto';

import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse } from '../../../test/fixtures.js';
import type { DesignerFileGroup } from '../../api.js';
import { CodeBarEnd } from '../CodeBar.js';
import CodeTab from '../CodeTab.js';
import { useCodeFiles, type CodeLock, type CodeNotice } from '../useCodeFiles.js';

const ID = 'ds_000000000000000000000007';
const BASE = `/api/v1/designer/sessions/${ID}`;
const APP = 'apps/shop/customer/src/App.tsx';
const MENU = 'apps/shop/customer/src/pages/Menu.tsx';
const CSS = 'apps/shop/customer/src/design.css';
const PAGE = 'apps/shop/manifest/pages/shop-items.json';
const BRIEF = 'apps/shop/design.md';
const LOOK = 'apps/shop/look.json';

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');
const LABELS: Record<string, [DesignerFileGroup, string, 'brief'?]> = {
  [APP]: ['customer', 'customer/App.tsx'],
  [CSS]: ['customer', 'customer/design.css'],
  [MENU]: ['customer', 'customer/pages/Menu.tsx'],
  [PAGE]: ['dashboard', 'dashboard/pages/items.json'],
  [BRIEF]: ['settings', 'design.md', 'brief'],
  [LOOK]: ['settings', 'look.json'],
};

interface Call {
  method: string;
  url: string;
  body?: { files: { path: string; content: string; base: string }[] };
}
let disk: Record<string, string>;
let calls: Call[];
let listAnswer: (() => Response) | null;
let contentAnswer: ((path: string) => Response | null) | null;
/** What the server says to the next save; by default it writes the files and names a version. */
let saveAnswer: ((files: { path: string; content: string; base: string }[]) => Response) | null;
let version: number;
let notices: CodeNotice[];
let fixes: string[];
let putBacks: number;
let setLock: (lock: CodeLock) => void;

const refused = (status: number, reason: string, message: string, more: Record<string, unknown> = {}): Response =>
  jsonResponse(status, { error: { code: status === 422 ? 'VALIDATION_FAILED' : 'CONFLICT', message, requestId: 'r', details: { reason, ...more } } });

function listReply(): Response {
  const order: DesignerFileGroup[] = ['customer', 'staff', 'dashboard', 'settings'];
  const groups = order
    .map((key) => ({
      key,
      files: Object.keys(disk)
        .filter((path) => LABELS[path]?.[0] === key)
        .map((path) => ({ path, label: LABELS[path]?.[1] ?? path, hash: hashOf(disk[path] ?? ''), size: (disk[path] ?? '').length, ...(LABELS[path]?.[2] === undefined ? {} : { note: 'brief' as const }) })),
    }))
    .filter((group) => group.files.length > 0);
  return jsonResponse(200, { groups, busy: null, version });
}

beforeEach(() => {
  disk = {
    [APP]: 'export function App() {\n  return <Menu />;\n}\n',
    [CSS]: '.page { color: red; }\n',
    [MENU]: '// the menu\nexport function Menu() {\n  return null;\n}\n',
    [PAGE]: '{\n  "ref": "shop-items"\n}\n',
    [BRIEF]: '# Crispy Bites\n\nWarm and loud.\n',
    [LOOK]: '{ "skill": "warm" }\n',
  };
  calls = [];
  notices = [];
  fixes = [];
  putBacks = 0;
  version = 2;
  listAnswer = null;
  contentAnswer = null;
  saveAnswer = null;
  // This DOM lays nothing out, and an editor whose lines all measure 0 high cannot say which line is at a height: give it lines.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const line = this.classList.contains('cm-line');
    const index = line && this.parentElement !== null ? Array.prototype.indexOf.call(this.parentElement.children, this) : 0;
    const top = line ? index * 20 : 0;
    const height = line ? 20 : 600;
    return { x: 0, y: top, top, left: 0, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) } as DOMRect;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Call['body']) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url === `${BASE}/files` && method === 'GET') return Promise.resolve(listAnswer?.() ?? listReply());
      if (url.startsWith(`${BASE}/files/content?path=`)) {
        const path = decodeURIComponent(url.slice(url.indexOf('=') + 1));
        const scripted = contentAnswer?.(path) ?? null;
        if (scripted !== null) return Promise.resolve(scripted);
        const text = disk[path];
        return Promise.resolve(text === undefined ? jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'There is no such file.', requestId: 'r' } }) : jsonResponse(200, { path, content: text, hash: hashOf(text) }));
      }
      if (url === `${BASE}/files` && method === 'PUT') {
        const files = body?.files ?? [];
        if (saveAnswer !== null) return Promise.resolve(saveAnswer(files));
        for (const file of files) disk[file.path] = file.content;
        version += 1;
        return Promise.resolve(jsonResponse(200, { applied: true, version: { n: version, name: `v${String(version)} · Your edit` }, files: files.map((file) => ({ path: file.path, hash: hashOf(file.content) })) }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route ${url}`, requestId: 'r' } }));
    }),
  );
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({ start }: { start: CodeLock }): ReactNode {
  const [lock, set] = useState<CodeLock>(start);
  setLock = (next) => act(() => set(next));
  const code = useCodeFiles(ID, {
    lock,
    onNotice: (notice) => notices.push(notice),
    onPutBack: () => {
      putBacks += 1;
      return Promise.resolve();
    },
  });
  if (!code.active) code.activate();
  return (
    <div>
      <div data-testid="bar" className="flex">
        <CodeBarEnd code={code} />
      </div>
      <CodeTab code={code} compact={false} onFix={(message) => fixes.push(message)} />
    </div>
  );
}

async function open(lock: CodeLock = null): Promise<void> {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness start={lock} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(editorText()).toContain('export function App'));
}

const view = (): EditorView => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement) as EditorView;
const editorText = (): string => (document.querySelector('.cm-editor') === null ? '' : view().state.doc.toString());
const content = (): HTMLElement => document.querySelector('.cm-content') as HTMLElement;
const type = (text: string): void => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type' }));
const files = (): HTMLElement => screen.getByRole('navigation', { name: 'Files' });
const row = (name: string): HTMLElement => within(files()).getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`) });
const rows = (): string[] => within(files()).getAllByRole('button').map((button) => `${button.textContent ?? ''}${button.getAttribute('aria-current') === 'page' ? ' *' : ''}${button.getAttribute('aria-expanded') === null ? '' : button.getAttribute('aria-expanded') === 'true' ? ' /open' : ' /closed'}`);
const save = (): HTMLElement => within(screen.getByTestId('bar')).getByRole('button', { name: /^Save/ });
const discard = (): HTMLElement => within(screen.getByTestId('bar')).getAllByRole('button', { name: /^Discard changes to / })[0] as HTMLElement;
const saves = (): Call[] => calls.filter((call) => call.method === 'PUT');
const marked = (): string[] => within(files()).getAllByRole('button').filter((button) => within(button).queryByRole('img', { name: 'unsaved' }) !== null).map((button) => (button.textContent ?? '').replace('The design brief', ''));
const openFile = async (name: string, has: string): Promise<void> => {
  await userEvent.click(row(name));
  await waitFor(() => expect(editorText()).toContain(has));
};

describe('the Code tab', () => {
  it('lists the files in their groups, opens the customer side’s App.tsx, and names the editor', async () => {
    await open();
    expect(within(files()).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Customer side', 'Dashboard side', 'Design and settings']);
    expect(rows()).toEqual(['App.tsx *', 'design.css', 'pages /open', 'Menu.tsx', 'pages /open', 'items.json', 'design.mdThe design brief', 'look.json']);
    expect(content().getAttribute('aria-label')).toBe('Editing App.tsx. Press Escape to leave the editor.');
    expect(screen.getByText('Only the files you can safely change are shown here.')).toBeTruthy();
    // The bar says where the file is; nothing is unsaved, and there is nothing to save or discard.
    expect(within(screen.getByTestId('bar')).getByLabelText('Open file').textContent).toBe('customerApp.tsx');
    expect(within(screen.getByTestId('bar')).queryByRole('status')).toBeNull();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect((discard() as HTMLButtonElement).disabled).toBe(true);
    // A folder closes and opens; the list is one tab stop, moved through by the arrow keys.
    await userEvent.click(within(files()).getAllByRole('button', { name: 'pages' })[0] as HTMLElement);
    expect(rows().slice(0, 4)).toEqual(['App.tsx *', 'design.css', 'pages /closed', 'pages /open']);
    expect(within(files()).getAllByRole('button').filter((button) => button.tabIndex === 0)).toHaveLength(1);
    row('App.tsx').focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('design.css');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('look.json');
    expect(within(files()).getAllByRole('button').filter((button) => button.tabIndex === 0).map((button) => button.textContent)).toEqual(['look.json']);
  });

  it('keeps what was typed in each file, marks it, and saves every edited file in one save', async () => {
    await open();
    type('// mine\n');
    expect(within(screen.getByTestId('bar')).getByRole('status').textContent).toBe('Unsaved changes');
    expect(marked()).toEqual(['App.tsx']);
    await openFile('design.css', '.page');
    type('/* also mine */\n');
    expect(marked()).toEqual(['App.tsx', 'design.css']);
    expect(save().textContent).toContain('Save 2 files');
    // Back in the first file, the text is as it was left.
    await openFile('App.tsx', '// mine');
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body?.files).toEqual([
      { path: APP, content: `// mine\n${'export function App() {\n  return <Menu />;\n}\n'}`, base: hashOf('export function App() {\n  return <Menu />;\n}\n') },
      { path: CSS, content: '/* also mine */\n.page { color: red; }\n', base: hashOf('.page { color: red; }\n') },
    ]);
    await waitFor(() => expect(marked()).toEqual([]));
    expect(notices).toEqual([{ variant: 'success', title: 'Saved as v3. The Designer will see your change.' }]);
    expect(within(screen.getByTestId('bar')).queryByRole('status')).toBeNull();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    // Typed and typed back is clean again: nothing is saved by the key.
    type('x');
    expect(marked()).toEqual(['App.tsx']);
    act(() => view().dispatch({ changes: { from: 0, to: 1 }, userEvent: 'delete.backward' }));
    expect(marked()).toEqual([]);
  });

  it('discards the open file’s changes as one step that can be undone, and leaves the other files alone', async () => {
    await open();
    type('// mine\n');
    await openFile('design.css', '.page');
    type('/* css */\n');
    expect(discard().getAttribute('aria-label')).toBe('Discard changes to design.css');
    await userEvent.click(discard());
    expect(editorText()).toBe('.page { color: red; }\n');
    expect(marked()).toEqual(['App.tsx']);
    act(() => void undo(view()));
    expect(editorText()).toBe('/* css */\n.page { color: red; }\n');
    expect(marked()).toEqual(['App.tsx', 'design.css']);
  });

  it('saves from the keyboard anywhere in the tab, and Escape leaves the editor for the open file’s row', async () => {
    await open();
    type('// k\n');
    fireEvent.keyDown(row('design.css'), { key: 's', ctrlKey: true });
    await waitFor(() => expect(saves()).toHaveLength(1));
    await waitFor(() => expect(marked()).toEqual([]));
    content().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row('App.tsx'));
  });

  it('keeps a file’s own line ends: one read with CRLF is sent back with CRLF', async () => {
    disk[CSS] = '.a {}\r\n.b {}\r\n';
    await open();
    await openFile('design.css', '.a {}');
    expect(editorText()).toBe('.a {}\n.b {}\n');
    expect(marked()).toEqual([]);
    type('/* x */\n');
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body?.files).toEqual([{ path: CSS, content: '/* x */\r\n.a {}\r\n.b {}\r\n', base: hashOf('.a {}\r\n.b {}\r\n') }]);
    await waitFor(() => expect(marked()).toEqual([]));
  });

  it('while the Designer works the editor can be read and not changed, and says why', async () => {
    await open('turn');
    expect(screen.getByRole('status').textContent).toBe('The Designer is working. You can edit again when it finishes.');
    expect(content().getAttribute('aria-readonly')).toBe('true');
    expect(content().getAttribute('contenteditable')).toBe('true');
    expect(content().getAttribute('aria-label')).toBe('App.tsx, read only while the Designer works');
    setLock('waiting');
    expect(screen.getByRole('status').textContent).toBe('The Designer is waiting for your answer in the chat.');
    setLock('restore');
    expect(screen.getByRole('status').textContent).toBe('The files are being put back. You can edit again in a moment.');
    expect(content().getAttribute('aria-label')).toBe('App.tsx, read only for now');
    setLock(null);
    expect(content().getAttribute('aria-readonly')).not.toBe('true');
    expect(content().getAttribute('aria-label')).toBe('Editing App.tsx. Press Escape to leave the editor.');
  });

  it('a file the Designer changed is read again when it finishes; one the person was editing asks which to keep', async () => {
    await open();
    await openFile('design.css', '.page');
    await openFile('App.tsx', 'export function App');
    type('// mine\n');
    setLock('turn');
    disk[APP] = 'export function App() {\n  return <Shop />;\n}\n';
    disk[CSS] = '.page { color: blue; }\n';
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    // The save key is as held as the button.
    fireEvent.keyDown(row('design.css'), { key: 's', ctrlKey: true });
    content().dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
    await act(() => Promise.resolve());
    expect(saves()).toHaveLength(0);
    setLock(null);
    // Edited: their text stays, and a line asks.
    const line = await screen.findByText('This file changed while you were editing it.');
    expect(editorText()).toContain('// mine');
    // Not edited: the new text is simply there.
    await openFile('design.css', 'color: blue');
    expect(screen.queryByText('This file changed while you were editing it.')).toBeNull();
    await openFile('App.tsx', '// mine');
    expect(line).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep my changes' }));
    await waitFor(() => expect(screen.queryByText('This file changed while you were editing it.')).toBeNull());
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(1));
    // Held against the file as it is now: the save goes over the Designer's version, as chosen.
    expect(saves()[0]?.body?.files).toEqual([{ path: APP, content: '// mine\nexport function App() {\n  return <Menu />;\n}\n', base: hashOf('export function App() {\n  return <Shop />;\n}\n') }]);
  });

  it('"Use the changed file" drops what was typed, and a save refused for a stale file leads to the same question', async () => {
    await open();
    type('// mine\n');
    disk[APP] = 'export function App() {\n  return <Other />;\n}\n';
    saveAnswer = () => refused(409, 'FILES_CHANGED', 'A file changed.', { changed: [{ path: APP, hash: hashOf(disk[APP] ?? '') }] });
    await userEvent.click(save());
    await screen.findByText('This file changed while you were editing it.');
    expect(marked()).toEqual(['App.tsx']);
    await userEvent.click(screen.getByRole('button', { name: 'Use the changed file' }));
    await waitFor(() => expect(editorText()).toBe('export function App() {\n  return <Other />;\n}\n'));
    expect(marked()).toEqual([]);
    expect(screen.queryByText('This file changed while you were editing it.')).toBeNull();
    // Nothing of the dropped text comes back by undo.
    act(() => void undo(view()));
    expect(editorText()).toBe('export function App() {\n  return <Other />;\n}\n');
  });

  it('a save refused for a file that is not the open one opens that file, so the question is there to see', async () => {
    await open();
    type('// mine\n');
    await openFile('design.css', '.page');
    type('/* also mine */\n');
    await openFile('App.tsx', '// mine');
    disk[CSS] = '.page { color: blue; }\n';
    saveAnswer = () => refused(409, 'FILES_CHANGED', 'A file changed.', { changed: [{ path: CSS, hash: hashOf(disk[CSS] ?? '') }] });
    await userEvent.click(save());
    await screen.findByText('This file changed while you were editing it.');
    expect(rows()).toContain('design.css *');
    expect(editorText()).toBe('/* also mine */\n.page { color: red; }\n');
    // Both are still theirs, and still marked.
    expect(marked()).toEqual(['App.tsx', 'design.css']);
    // The open file is one of the changed ones: it stays open.
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(2));
    await act(() => Promise.resolve());
    expect(rows()).toContain('design.css *');
    // Answered, the save goes: both files, the changed one held against what it is now.
    await userEvent.click(screen.getByRole('button', { name: 'Keep my changes' }));
    await waitFor(() => expect(screen.queryByText('This file changed while you were editing it.')).toBeNull());
    saveAnswer = null;
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(3));
    expect(saves()[2]?.body?.files.find((file) => file.path === CSS)).toEqual({ path: CSS, content: '/* also mine */\n.page { color: red; }\n', base: hashOf('.page { color: blue; }\n') });
    await waitFor(() => expect(marked()).toEqual([]));
  });

  it('discarding a file that changed underneath takes the file as it is now, and the next save is held against it', async () => {
    const theirs = 'export function App() {\n  return <Other />;\n}\n';
    await open();
    type('// mine\n');
    disk[APP] = theirs;
    saveAnswer = () => refused(409, 'FILES_CHANGED', 'A file changed.', { changed: [{ path: APP, hash: hashOf(theirs) }] });
    await userEvent.click(save());
    await screen.findByText('This file changed while you were editing it.');
    await userEvent.click(discard());
    await waitFor(() => expect(editorText()).toBe(theirs));
    expect(screen.queryByText('This file changed while you were editing it.')).toBeNull();
    expect(marked()).toEqual([]);
    saveAnswer = null;
    type('x');
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body?.files).toEqual([{ path: APP, content: `x${theirs}`, base: hashOf(theirs) }]);
  });

  it('"Keep my changes" keeps only changes: a discard after it ends at the file as it is now, and with nothing typed it is not offered', async () => {
    const theirs = 'export function App() {\n  return <Other />;\n}\n';
    await open();
    type('// mine\n');
    disk[APP] = theirs;
    saveAnswer = () => refused(409, 'FILES_CHANGED', 'A file changed.', { changed: [{ path: APP, hash: hashOf(theirs) }] });
    await userEvent.click(save());
    await screen.findByText('This file changed while you were editing it.');
    await userEvent.click(screen.getByRole('button', { name: 'Keep my changes' }));
    await waitFor(() => expect(screen.queryByText('This file changed while you were editing it.')).toBeNull());
    expect(editorText()).toContain('// mine');
    expect(marked()).toEqual(['App.tsx']);
    // The old text is not what the new hash names: discarding does not end there, clean.
    await userEvent.click(discard());
    expect(editorText()).toBe(theirs);
    expect(marked()).toEqual([]);
    expect(saves()).toHaveLength(1);

    // Typed, changed underneath, and typed back: there is nothing of theirs to keep.
    type('// again\n');
    disk[APP] = `// newer\n${theirs}`;
    saveAnswer = () => refused(409, 'FILES_CHANGED', 'A file changed.', { changed: [{ path: APP, hash: hashOf(disk[APP] ?? '') }] });
    await userEvent.click(save());
    await screen.findByText('This file changed while you were editing it.');
    act(() => view().dispatch({ changes: { from: 0, to: '// again\n'.length }, userEvent: 'delete.backward' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep my changes' })).toBeNull());
  });

  it('a save that was written and not applied says so with the words, keeps its marks, and is sent again with the next save', async () => {
    await open();
    await openFile('items.json', 'shop-items');
    type('{');
    saveAnswer = (sent) => {
      for (const file of sent) disk[file.path] = file.content;
      return jsonResponse(200, { applied: false, version: null, files: sent.map((file) => ({ path: file.path, hash: hashOf(file.content) })), problems: { stage: 'check', lines: ['apps/shop/manifest/pages/shop-items.json · not valid JSON'] } });
    };
    await userEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your changes were saved, and the app was not applied. The preview shows the last build that worked.');
    expect(alert.textContent).toContain('apps/shop/manifest/pages/shop-items.json · not valid JSON');
    expect(marked()).toEqual(['items.json']);
    expect(notices).toEqual([]);
    // Another file is edited and saved: the first goes with it, so the server sees one whole change.
    saveAnswer = null;
    await openFile('design.css', '.page');
    type('/* c */\n');
    expect(save().textContent).toContain('Save 2 files');
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body?.files.map((file) => file.path).sort()).toEqual([CSS, PAGE].sort());
    expect(saves()[1]?.body?.files.find((file) => file.path === PAGE)).toEqual({ path: PAGE, content: '{{\n  "ref": "shop-items"\n}\n', base: hashOf('{{\n  "ref": "shop-items"\n}\n') });
    await waitFor(() => expect(marked()).toEqual([]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers the two ways out of a save that was not applied', async () => {
    await open();
    type('x');
    saveAnswer = (sent) => jsonResponse(200, { applied: false, version: null, files: sent.map((file) => ({ path: file.path, hash: hashOf(file.content) })), problems: { stage: 'build', lines: ['customer: Unexpected "x"', 'second', 'third', 'fourth'] } });
    await userEvent.click(save());
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(fixes).toEqual(['I changed some files by hand and the app does not apply any more: customer: Unexpected "x"\nsecond\nthird Please fix it.']);
    await userEvent.click(screen.getByRole('button', { name: 'Put the files back' }));
    await waitFor(() => expect(putBacks).toBe(1));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says each refusal where the person is, and loses nothing typed', async () => {
    await open();
    type('// mine\n');
    saveAnswer = () => refused(409, 'UNFINISHED_CHANGE', 'unfinished');
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was saved: the Designer’s last change was not finished. Ask it to finish, or put the files back.');
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Put the files back' })).toBeTruthy();

    saveAnswer = () => refused(422, 'LOOK', 'There is no style called "wrm".', { path: LOOK });
    await userEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nothing was saved. There is no style called "wrm".'));
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alert')).toBeNull();

    saveAnswer = () => refused(409, 'DESIGNER_BUSY', 'busy', { busy: 'style' });
    await userEvent.click(save());
    await waitFor(() => expect(notices).toEqual([{ variant: 'info', title: 'The app is being changed. Try again in a moment.' }]));

    saveAnswer = () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'It broke.', requestId: 'r' } });
    await userEvent.click(save());
    await waitFor(() => expect(notices.at(-1)).toEqual({ variant: 'error', title: 'Your changes were not saved', description: 'It broke.' }));
    expect(editorText()).toContain('// mine');
    expect(marked()).toEqual(['App.tsx']);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a file that left the app while it was edited stays to be copied from, is left out of the save, and goes when discarded', async () => {
    await open();
    await openFile('Menu.tsx', 'the menu');
    type('// mine\n');
    await openFile('design.css', '.page');
    type('/* c */\n');
    await openFile('Menu.tsx', '// mine');
    setLock('turn');
    delete disk[MENU];
    setLock(null);
    await screen.findByText('This file is no longer in the app. Copy your text if you need it.');
    // Its row is still there, marked, and the bar still names it.
    expect(rows()).toContain('Menu.tsx *');
    expect(marked()).toEqual(['design.css', 'Menu.tsx']);
    expect(discard().getAttribute('aria-label')).toBe('Discard changes to Menu.tsx');
    expect(content().getAttribute('aria-readonly')).toBe('true');
    expect(editorText()).toContain('// mine');
    await userEvent.click(save());
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body?.files.map((file) => file.path)).toEqual([CSS]);
    await userEvent.click(discard());
    await waitFor(() => expect(editorText()).toContain('export function App'));
    expect(screen.queryByText('This file is no longer in the app. Copy your text if you need it.')).toBeNull();
    expect(rows().some((entry) => entry.startsWith('Menu.tsx'))).toBe(false);
  });

  it('a save of the look reads back what the server made of it', async () => {
    await open();
    await openFile('look.json', 'warm');
    type(' ');
    saveAnswer = (sent) => {
      disk[LOOK] = '{\n  "skill": "warm"\n}\n';
      version += 1;
      return jsonResponse(200, { applied: true, version: { n: version, name: 'v3 · Your edit to look.json' }, files: sent.map((file) => ({ path: file.path, hash: hashOf(disk[LOOK] ?? '') })) });
    };
    await userEvent.click(save());
    await waitFor(() => expect(editorText()).toBe('{\n  "skill": "warm"\n}\n'));
    expect(marked()).toEqual([]);
  });

  it('says when the list or a file cannot be read, and reads again when asked', async () => {
    listAnswer = () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'no', requestId: 'r' } });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness start={null} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Opening the files…')).toBeTruthy();
    await screen.findByText('The files could not be read.', undefined, { timeout: 8000 });
    listAnswer = null;
    contentAnswer = () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'no', requestId: 'r' } });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('This file could not be read.');
    contentAnswer = null;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(editorText()).toContain('export function App'));
  }, 15_000);

  it('says so when the app has no file to change', async () => {
    disk = {};
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness start={null} />
      </QueryClientProvider>,
    );
    await screen.findByText('There are no files to change here yet.');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });
});
