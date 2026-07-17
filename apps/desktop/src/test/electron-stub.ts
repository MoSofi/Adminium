/**
 * Inert stand-in for the `electron` module under vitest (aliased in
 * vitest.config.ts — see the rationale there). It exists so importing a main
 * -process module outside Electron resolves; it is NOT a test double. Nothing
 * asserts against these, because nothing calls them: `src/main/index.ts` only
 * touches Electron inside `electronBootDeps()`, which tests never invoke — they
 * pass their own fakes to `createDesktopApp` instead.
 *
 * Every member throws rather than returning a plausible value. A silent stub
 * would let a test appear to exercise Electron and prove nothing; this way, a
 * unit test that reaches real Electron code fails loudly and names the reason.
 */

const unavailable = (member: string): never => {
  throw new Error(
    `electron.${member} was called in a unit test. The desktop suites run in plain Node — ` +
      'inject a fake through createDesktopApp(deps) instead of reaching for the real module ' +
      '(end-to-end shell coverage is 11-T20 Playwright `_electron`).',
  );
};

const port = (member: string): (() => never) => (): never => unavailable(member);

export const app = {
  requestSingleInstanceLock: port('app.requestSingleInstanceLock'),
  whenReady: port('app.whenReady'),
  getPath: port('app.getPath'),
  getVersion: port('app.getVersion'),
  quit: port('app.quit'),
  relaunch: port('app.relaunch'),
  exit: port('app.exit'),
  focus: port('app.focus'),
  on: port('app.on'),
  once: port('app.once'),
  setName: port('app.setName'),
};

export const safeStorage = {
  isEncryptionAvailable: port('safeStorage.isEncryptionAvailable'),
  encryptString: port('safeStorage.encryptString'),
  decryptString: port('safeStorage.decryptString'),
};

export const shell = {
  openExternal: port('shell.openExternal'),
  openPath: port('shell.openPath'),
  showItemInFolder: port('shell.showItemInFolder'),
};

export const dialog = {
  showOpenDialog: port('dialog.showOpenDialog'),
  showSaveDialog: port('dialog.showSaveDialog'),
  showMessageBox: port('dialog.showMessageBox'),
};

export const ipcMain = {
  handle: port('ipcMain.handle'),
  on: port('ipcMain.on'),
  removeHandler: port('ipcMain.removeHandler'),
};

export const ipcRenderer = {
  invoke: port('ipcRenderer.invoke'),
  on: port('ipcRenderer.on'),
  off: port('ipcRenderer.off'),
  send: port('ipcRenderer.send'),
};

export const contextBridge = {
  exposeInMainWorld: port('contextBridge.exposeInMainWorld'),
};

export const utilityProcess = {
  fork: port('utilityProcess.fork'),
};

export const Menu = {
  buildFromTemplate: port('Menu.buildFromTemplate'),
  setApplicationMenu: port('Menu.setApplicationMenu'),
};

export const screen = {
  getAllDisplays: port('screen.getAllDisplays'),
  getPrimaryDisplay: port('screen.getPrimaryDisplay'),
};

export class BrowserWindow {
  constructor() {
    unavailable('BrowserWindow');
  }
  static getAllWindows = port('BrowserWindow.getAllWindows');
}

export const nativeTheme = { shouldUseDarkColors: false };
