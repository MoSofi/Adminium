// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCodeEditor, type CodeEditor } from './editor.js';
import { languageName } from './languages.js';

let editor: CodeEditor | null = null;
let host: HTMLElement;

function mount() {
  host = document.createElement('div');
  document.body.append(host);
  const events = { onChange: vi.fn<(path: string, text: string) => void>(), onSave: vi.fn(), onLeave: vi.fn() };
  editor = createCodeEditor(host, events);
  return { editor, events };
}
/** The view CodeMirror hangs on its own element: what a key press and a typed letter go through. */
const view = (): EditorView => EditorView.findFromDOM(host) as EditorView;
const content = (): HTMLElement => host.querySelector('.cm-content') as HTMLElement;
const type = (text: string, at = 0): void => view().dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });
const press = (key: string, init: KeyboardEventInit = {}): void => {
  content().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

afterEach(() => {
  editor?.destroy();
  editor = null;
  host.remove();
});

describe('the code editor', () => {
  it('keeps each file as it was left: its text and its own undo', () => {
    const { editor, events } = mount();
    editor.open('a.tsx', 'const a = 1;\n');
    type('// mine\n');
    expect(events.onChange).toHaveBeenLastCalledWith('a.tsx', '// mine\nconst a = 1;\n');
    editor.open('b.css', 'body {}\n');
    expect(editor.shown()).toBe('b.css');
    expect(content().textContent).toContain('body {}');
    // The first file is as it was typed, though it is asked for with the text on disk again.
    editor.open('a.tsx', 'const a = 1;\n');
    expect(editor.text('a.tsx')).toBe('// mine\nconst a = 1;\n');
    expect(editor.text('b.css')).toBe('body {}\n');
    undo(view());
    expect(editor.text('a.tsx')).toBe('const a = 1;\n');
    // Its undo never reaches into the other file.
    undo(view());
    expect(editor.text('b.css')).toBe('body {}\n');
    expect(editor.text('never.ts')).toBeNull();
  });

  it('puts the saved text back as a change that can be undone, in the file shown and in one that is not', () => {
    const { editor, events } = mount();
    editor.open('a.tsx', 'saved\n');
    type('typed ');
    editor.replace('a.tsx', 'saved\n');
    expect(editor.text('a.tsx')).toBe('saved\n');
    undo(view());
    expect(editor.text('a.tsx')).toBe('typed saved\n');

    editor.open('b.css', 'x');
    events.onChange.mockClear();
    editor.replace('a.tsx', 'saved\n');
    expect(events.onChange).toHaveBeenCalledWith('a.tsx', 'saved\n');
    editor.open('a.tsx', 'ignored');
    expect(editor.text('a.tsx')).toBe('saved\n');
    undo(view());
    expect(editor.text('a.tsx')).toBe('typed saved\n');
  });

  it('starts a file again when it changed on disk: nothing typed and no way back to it', () => {
    const { editor } = mount();
    editor.open('a.tsx', 'old\n');
    type('typed ');
    editor.reset('a.tsx', 'new\n');
    expect(editor.shown()).toBe('a.tsx');
    expect(editor.text('a.tsx')).toBe('new\n');
    undo(view());
    expect(editor.text('a.tsx')).toBe('new\n');
  });

  it('held, it cannot be typed in and can still be reached; handed back, it can', () => {
    const { editor } = mount();
    editor.open('a.tsx', 'const a = 1;\n');
    editor.setLabel('Editing a.tsx');
    editor.setHeld(true);
    expect(view().state.readOnly).toBe(true);
    expect(content().getAttribute('aria-readonly')).toBe('true');
    // Still a place the keyboard can go and a text that can be selected.
    expect(content().getAttribute('contenteditable')).toBe('true');
    expect(host.querySelector('.cm-editor')?.classList.contains('cm-held')).toBe(true);
    press('Tab');
    expect(editor.text('a.tsx')).toBe('const a = 1;\n');
    // A file opened while held is held too.
    editor.open('b.css', 'body {}\n');
    expect(view().state.readOnly).toBe(true);
    editor.setHeld(false);
    expect(view().state.readOnly).toBe(false);
    expect(host.querySelector('.cm-editor')?.classList.contains('cm-held')).toBe(false);
    editor.open('a.tsx', '');
    expect(view().state.readOnly).toBe(false);
    press('Tab');
    expect(editor.text('a.tsx')).toBe('  const a = 1;\n');
  });

  it('says its name, and each file shown takes the name given last', () => {
    const { editor } = mount();
    editor.open('a.tsx', '');
    editor.setLabel('Editing a.tsx. Press Escape to leave the editor.');
    expect(content().getAttribute('aria-label')).toBe('Editing a.tsx. Press Escape to leave the editor.');
    editor.open('b.css', '');
    editor.setLabel('Editing b.css. Press Escape to leave the editor.');
    editor.open('a.tsx', '');
    expect(content().getAttribute('aria-label')).toBe('Editing b.css. Press Escape to leave the editor.');
  });

  it('asks to save on Ctrl+S and Cmd+S, once each, and to leave on Escape', () => {
    const { editor, events } = mount();
    editor.open('a.tsx', 'x');
    press('s', { ctrlKey: true });
    press('s', { metaKey: true });
    // "Mod" is one of the two on any machine: exactly one of the presses is the save key here.
    expect(events.onSave).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(events.onLeave).toHaveBeenCalledTimes(1);
    expect(editor.text('a.tsx')).toBe('x');
  });

  it('is always left to right in its own text, and knows each kind of file by its ending', () => {
    expect(['Menu.tsx', 'a.jsx', 'a.ts', 'a.js', 'a.mjs', 'design.css', 'look.json', 'design.md', 'notes.txt', 'A.TSX'].map(languageName)).toEqual([
      'typescript',
      'javascript',
      'typescript',
      'javascript',
      'javascript',
      'css',
      'json',
      'markdown',
      null,
      'typescript',
    ]);
  });
});

describe('the packages the editor stands on', () => {
  it('are in the lockfile once each: two copies of one of them and the editor breaks at run time', () => {
    const lock = readFileSync(join(process.cwd(), '..', '..', 'pnpm-lock.yaml'), 'utf8');
    for (const name of ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/common', '@lezer/lr', '@lezer/highlight']) {
      const versions = new Set([...lock.matchAll(new RegExp(`^  '${name.replace('/', '\\/')}@([^'(]+)`, 'gm'))].map((match) => match[1]));
      expect([name, versions.size], `${name}: ${[...versions].join(', ')}`).toEqual([name, 1]);
    }
  });

  it('are imported by this folder alone: a second importer would pull 150 KB into the chunk it is in', () => {
    const src = join(process.cwd(), 'src');
    const own = join('designer', 'build', 'code') + sep;
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && /from\s+['"]@(codemirror|lezer)\//.test(readFileSync(path, 'utf8'))) importers.push(relative(src, path));
      }
    };
    walk(src);
    expect(importers.length).toBeGreaterThan(2);
    expect(importers.filter((path) => !path.startsWith(own))).toEqual([]);
    // And the folder itself is reached by a dynamic import alone: the tab's panel, loaded when the tab first opens.
    const reachers: string[] = [];
    const reach = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) reach(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !relative(src, path).startsWith(own) && /from\s+['"][./]*(\/build)?\/?code\/(editor|theme|languages)\.js['"]/.test(readFileSync(path, 'utf8'))) reachers.push(relative(src, path));
      }
    };
    reach(src);
    expect(reachers.filter((path) => path !== join('designer', 'build', 'CodeTab.tsx'))).toEqual([]);
    // …and that panel is never imported outright.
    const outright = /from\s+['"][^'"]*\/CodeTab\.js['"]/;
    const named: string[] = [];
    const look = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) look(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) && outright.test(readFileSync(path, 'utf8'))) named.push(relative(src, path));
      }
    };
    look(src);
    expect(named).toEqual([]);
  });
});
