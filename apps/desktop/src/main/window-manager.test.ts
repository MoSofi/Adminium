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
  title: string | undefined;
  preload: string | undefined;
  /** What the window's handlers do with an address: the manager's rules, as wired. */
  handlers: Map<string, (event: { preventDefault: () => void }, target: string) => void>;
  openHandler: ((details: { url: string }) => { action: string }) | null;
  focused: number;
  partition: string | undefined;
  loaded: string[];
  destroyed: boolean;
  visible: boolean;
  emit: (event: string) => void;
}

const made: FakeWindow[] = [];
const permissionHandlers: unknown[] = [];
const external: string[] = [];
const cleared: string[] = [];
/** How many windows stand at each moment one is made or destroyed: never zero once the first exists. */
const standing: number[] = [];

vi.mock('electron', () => {
  class BrowserWindow {
    readonly record: FakeWindow;
    readonly listeners = new Map<string, Array<() => void>>();
    readonly webContents = {
      on: (event: string, handler: (event: { preventDefault: () => void }, target: string) => void) => void this.record.handlers.set(event, handler),
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => void (this.record.openHandler = handler),
      executeJavaScript: () => Promise.resolve(),
      session: { setPermissionRequestHandler: (handler: unknown) => void permissionHandlers.push(handler), setPermissionCheckHandler: () => undefined, on: () => undefined },
    };
    constructor(options: { title?: string; webPreferences?: { partition?: string; preload?: string } }) {
      this.record = {
        id: made.length + 1,
        title: options.title,
        preload: options.webPreferences?.preload,
        partition: options.webPreferences?.partition,
        handlers: new Map(),
        openHandler: null,
        focused: 0,
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
    loadFile(path: string, options?: { hash?: string }): Promise<void> {
      this.record.loaded.push(`file:${path.split('/renderer/')[1] ?? path}${options?.hash === undefined ? '' : `#${options.hash}`}`);
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
    focus(): void {
      this.record.focused += 1;
    }
    getNormalBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 1280, height: 800 };
    }
  }
  return {
    BrowserWindow,
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    shell: {
      openExternal: (url: string) => {
        external.push(url);
        return Promise.resolve();
      },
    },
    session: { fromPartition: (name: string) => ({ clearStorageData: () => void cleared.push(name) }) },
    dialog: {},
  };
});

const { createWindowManager, projectPartition } = await import('./window.js');
const { guestPartition } = await import('./guest.js');

let dir: string;
beforeEach(() => {
  made.length = 0;
  standing.length = 0;
  external.length = 0;
  cleared.length = 0;
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

  it('shows a shared project’s addresses as a screen of the app’s own document, and reopens on it', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.loadApp(APP, { preview: true });
    await windows.showShared?.();
    expect(made[0]?.loaded).toEqual([APP, 'file:app/index.html#/shared']);
    expect(made[0]?.visible).toBe(true);
    made[0]?.emit('closed');
    await windows.reopen();
    expect(made[1]?.loaded).toEqual(['file:app/index.html#/shared']);
    // Back on the project's page (the dashboard, or the Designer again): that is what a reopen returns to.
    await windows.loadApp(APP);
    made[1]?.emit('closed');
    await windows.reopen();
    expect(made[2]?.loaded).toEqual([APP]);
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

describe('another Adminium, as a guest', () => {
  const ORIGIN = 'http://office-pc.local:4600';

  it('gets a window of its own with NO preload, a cookie jar of its own, and its address as its name', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.showStart?.();
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    expect(made).toHaveLength(2);
    // The app's own window has the bridge's preload; the guest has none, so there is no bridge on its pages.
    expect(made[0]?.preload).toMatch(/preload/);
    expect(made[1]).toMatchObject({ preload: undefined, partition: guestPartition(ORIGIN), title: 'office-pc.local:4600 (not encrypted) — Adminium', loaded: [`${ORIGIN}/`] });
    // The app's own window is left as it was.
    expect(made[0]?.destroyed).toBe(false);
    await windows.openGuest?.({ origin: 'https://admin.example.com', encrypted: true });
    expect(made[2]?.title).toBe('admin.example.com — Adminium');
  });

  it('a second ask for the same address brings its window to the front', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    expect(made).toHaveLength(1);
    expect(made[0]?.focused).toBe(1);
    // Closed, it is opened anew.
    made[0]?.emit('closed');
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    expect(made).toHaveLength(2);
  });

  it('is held to its address: anything else goes to the system’s browser or nowhere, and no second window is made', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    const guest = made[0] as FakeWindow;
    const go = (event: string, target: string): boolean => {
      let stopped = false;
      guest.handlers.get(event)?.({ preventDefault: () => void (stopped = true) }, target);
      return stopped;
    };
    expect(go('will-navigate', `${ORIGIN}/t/orders`)).toBe(false);
    expect(go('will-navigate', 'https://docs.adminium.dev/')).toBe(true);
    expect(go('will-redirect', 'http://office-pc.local:4601/')).toBe(true);
    expect(go('will-navigate', 'file:///etc/passwd')).toBe(true);
    expect(external).toEqual(['https://docs.adminium.dev/']);

    expect(guest.openHandler?.({ url: 'https://docs.adminium.dev/x' })).toEqual({ action: 'deny' });
    expect(guest.openHandler?.({ url: `${ORIGIN}/help` })).toEqual({ action: 'deny' });
    expect(external).toEqual(['https://docs.adminium.dev/', 'https://docs.adminium.dev/x']);
    // Its own address asked for in a new window opens in the window it has.
    expect(guest.loaded).toEqual([`${ORIGIN}/`, `${ORIGIN}/help`]);
    expect(made).toHaveLength(1);
  });

  it('"Forget" closes its window and deletes its cookies', async () => {
    const windows = createWindowManager({ userDataDir: dir });
    await windows.openGuest?.({ origin: ORIGIN, encrypted: false });
    await windows.clearGuest?.(ORIGIN);
    expect(made[0]?.destroyed).toBe(true);
    expect(cleared).toEqual([guestPartition(ORIGIN)]);
    // An address with no window open is cleared all the same.
    await windows.clearGuest?.('https://admin.example.com');
    expect(cleared).toHaveLength(2);
  });
});
