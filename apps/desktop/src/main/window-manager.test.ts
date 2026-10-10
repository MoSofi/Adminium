// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The window manager itself, against a stand-in for Electron's window: which
 * page the one window holds, and that there is never a moment with no window
 * while it is moved to another cookie jar (a moment with none quits the app on
 * Windows and Linux). The real windows are the Playwright suite's.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeWindow {
  id: number;
  partition: string | undefined;
  loaded: string[];
  destroyed: boolean;
  visible: boolean;
  emit: (event: string) => void;
}

const made: FakeWindow[] = [];
/** How many windows stand at each moment one is made or destroyed: never zero once the first exists. */
const standing: number[] = [];

vi.mock('electron', () => {
  class BrowserWindow {
    readonly record: FakeWindow;
    readonly listeners = new Map<string, Array<() => void>>();
    readonly webContents = {
      on: () => undefined,
      setWindowOpenHandler: () => undefined,
      executeJavaScript: () => Promise.resolve(),
      session: { setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined },
    };
    constructor(options: { webPreferences?: { partition?: string } }) {
      this.record = {
        id: made.length + 1,
        partition: options.webPreferences?.partition,
        loaded: [],
        destroyed: false,
        visible: false,
        emit: (event) => {
          for (const listener of this.listeners.get(event) ?? []) listener();
        },
      };
      made.push(this.record);
      standing.push(made.filter((window) => !window.destroyed).length);
    }
    on(event: string, listener: () => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }
    once(event: string, listener: () => void): void {
      this.on(event, listener);
    }
    loadFile(path: string): Promise<void> {
      this.record.loaded.push(`file:${path.split('/renderer/')[1] ?? path}`);
      return Promise.resolve();
    }
    loadURL(url: string): Promise<void> {
      this.record.loaded.push(url);
      return Promise.resolve();
    }
    destroy(): void {
      this.record.destroyed = true;
      standing.push(made.filter((window) => !window.destroyed).length);
      this.record.emit('closed');
    }
    isDestroyed(): boolean {
      return this.record.destroyed;
    }
    isVisible(): boolean {
      return this.record.visible;
    }
    show(): void {
      this.record.visible = true;
    }
    maximize(): void {}
    isMaximized(): boolean {
      return false;
    }
    isMinimized(): boolean {
      return false;
    }
    restore(): void {}
    focus(): void {}
    getNormalBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 1280, height: 800 };
    }
  }
  return {
    BrowserWindow,
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    shell: { openExternal: () => Promise.resolve() },
    dialog: {},
  };
});

const { createWindowManager, projectPartition } = await import('./window.js');

let dir: string;
beforeEach(() => {
  made.length = 0;
  standing.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'adminium-window-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ROOT = '/Users/ava/Adminium/juniper';
const APP = 'http://127.0.0.1:4700/design#designToken=abc';

describe('the window manager', () => {
  it('shows Start in the one window, from the disk, and shows it at once', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.showStart?.();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ partition: undefined, loaded: ['file:app/index.html'], visible: true });
    // The same window again: Start after the crash page is not a second window.
    await windows.showCrash({ reason: 'x', canRestart: false });
    await windows.showStart?.();
    expect(made).toHaveLength(1);
    expect(made[0]?.loaded).toEqual(['file:app/index.html', 'file:crash.html', 'file:app/index.html']);
  });

  it('two callers at once share one window', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await Promise.all([windows.showStart?.(), windows.showBoot()]);
    expect(made).toHaveLength(1);
  });

  it('moves to a project’s own cookie jar without a moment with no window', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.showStart?.();
    windows.useProjectSession?.(ROOT);
    // Asked for, and nothing has happened to the window that is open: it goes when its replacement stands.
    expect(made[0]?.destroyed).toBe(false);
    expect(windows.exists()).toBe(false);

    await windows.showBoot();
    expect(made).toHaveLength(2);
    expect(made[1]).toMatchObject({ partition: projectPartition(ROOT), loaded: ['file:boot.html'] });
    expect(made[0]?.destroyed).toBe(true);
    // One, then two, then one: never none.
    expect(standing).toEqual([1, 2, 1]);
    expect(windows.exists()).toBe(true);

    await windows.loadApp(APP, { preview: true });
    expect(made[1]?.loaded).toEqual(['file:boot.html', APP]);
  });

  it('comes back to the app’s own jar and to Start when the project is closed, the same way', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    windows.useProjectSession?.(ROOT);
    await windows.loadApp(APP);
    // The same folder named again changes nothing: no window is retired for it.
    windows.useProjectSession?.(ROOT);
    expect(windows.exists()).toBe(true);

    windows.useProjectSession?.(null);
    await windows.showStart?.();
    expect(made).toHaveLength(2);
    expect(made[1]).toMatchObject({ partition: undefined, loaded: ['file:app/index.html'], visible: true });
    expect(made[0]?.destroyed).toBe(true);
    expect(standing).toEqual([1, 2, 1]);
  });

  it('a window that was closed by hand is not destroyed a second time', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.showStart?.();
    windows.useProjectSession?.(ROOT);
    // The person closed it meanwhile.
    (made[0] as FakeWindow).destroyed = true;
    await windows.showBoot();
    expect(made).toHaveLength(2);
    expect(standing).toEqual([1, 1]);
  });

  it('reopens on what the window held: Start, the project’s page, or the starting screen', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.showStart?.();
    made[0]?.emit('closed');
    await windows.reopen();
    expect(made[1]?.loaded).toEqual(['file:app/index.html']);

    await windows.loadApp(APP);
    made[1]?.emit('closed');
    await windows.reopen();
    expect(made[2]?.loaded).toEqual([APP]);

    // Back on Start, the address of a project that is closed is not gone back to.
    await windows.showStart?.();
    made[2]?.emit('closed');
    await windows.reopen();
    expect(made[3]?.loaded).toEqual(['file:app/index.html']);

    const fresh = createWindowManager({ userDataDir: dir });
    await fresh.reopen();
    expect(made[4]?.loaded).toEqual(['file:boot.html']);
  });
});
