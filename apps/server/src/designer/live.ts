// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live Designer's switch: whether Adminium Designer may be used on a
 * server that people reach over a network.
 *
 * It lets a signed-in person have a model write the project's apps and, with
 * a yes each time, its server code. So it is three steps away, each by a
 * different hand: the operator allows it (`ADMINIUM_DESIGNER=live`), a Super
 * Admin switches it on with their password, and whoever uses it holds
 * `system:designer:use`.
 *
 * Two things are checked when it is switched on, and one again at every boot:
 *
 *   a bundler     the Designer builds screens; without esbuild it cannot
 *   a kept disk   switching on writes an id into the project folder and
 *                 keeps the same id in settings. A boot that finds the id in
 *                 settings and not in the folder is a server whose folder
 *                 did not survive a restart: what the Designer built there
 *                 is gone, and would be again. The switch goes off and says
 *                 why.
 *
 * The id is written in two places: beside the Designer's own notes
 * (`.adminium/`), and where the apps it builds are (`apps/`). A host can keep
 * one folder and not the other, and the apps are what must come back.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LiveReason = 'not-allowed' | 'no-project' | 'disk-not-kept' | 'no-bundler' | 'not-writable';

export interface LiveState {
  mode: 'local' | 'live';
  /** The operator allowed it. */
  allowed: boolean;
  /** Switched on, and usable. */
  on: boolean;
  /** Whether this server runs a project folder. */
  project: boolean;
  /** Why it is not on, when something other than the switch stands in the way. */
  reason: LiveReason | null;
}

export interface LiveSettings {
  get(): Promise<{ on: boolean; id: string | null }>;
  set(value: { on: boolean; id: string | null }): Promise<void>;
}

export interface LiveDeps {
  /** The project folder, or null when the server runs without one. */
  root: string | null;
  allowed: boolean;
  settings: LiveSettings;
  /** Whether screens can be built here. */
  hasBundler(): boolean;
  log: (message: string) => void;
}

export const LIVE_ID_FILE = join('.adminium', 'designer', 'live.json');
/** The same id, where the apps are. A name that starts with a dot is no app: nothing that lists `apps/` reads it as one. */
export const LIVE_APPS_ID_FILE = join('apps', '.designer-live.json');

export interface Live {
  state(): Promise<LiveState>;
  /** At boot: a switch left on over a folder that was not kept goes off. True when it did. */
  checkAtBoot(): Promise<boolean>;
  /** Switch it. Returns the reason it cannot be switched on, or null. */
  set(on: boolean): Promise<LiveReason | null>;
}

export function createLive(deps: LiveDeps): Live {
  /** Set when a boot found the folder had not been kept: said until the switch is used again. */
  let lost = false;

  const readId = (file: string): { id: string | null; places: boolean } => {
    if (deps.root === null) return { id: null, places: false };
    try {
      const parsed = JSON.parse(readFileSync(join(deps.root, file), 'utf8')) as { id?: unknown; places?: unknown };
      return { id: typeof parsed.id === 'string' ? parsed.id : null, places: Array.isArray(parsed.places) && parsed.places.includes('apps') };
    } catch {
      return { id: null, places: false };
    }
  };
  /** Both files, the first saying the second was written. Throws when either cannot be. */
  const writeIds = (root: string, id: string): void => {
    for (const [file, body] of [
      [LIVE_APPS_ID_FILE, { id }],
      [LIVE_ID_FILE, { id, places: ['apps'] }],
    ] as const) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      if (!existsSync(path)) throw new Error('not written');
    }
  };

  return {
    async state() {
      const stored = await deps.settings.get();
      const project = deps.root !== null;
      const reason: LiveReason | null = !deps.allowed ? 'not-allowed' : !project ? 'no-project' : lost ? 'disk-not-kept' : null;
      return { mode: 'live', allowed: deps.allowed, on: deps.allowed && project && stored.on, project, reason };
    },
    async checkAtBoot() {
      // Not allowed: it is off whatever the settings hold, and they are not read (a server may boot before its tables exist).
      if (!deps.allowed) return false;
      const stored = await deps.settings.get();
      if (!stored.on || deps.root === null) return false;
      const own = readId(LIVE_ID_FILE);
      if (stored.id !== null && own.id === stored.id) {
        if (!own.places) {
          // Switched on by a version that wrote the one id: the folder it could vouch for is back, so the second is written now.
          try {
            writeIds(deps.root, stored.id);
          } catch {
            // A folder that cannot be written today is found out the next time the switch is used.
          }
          return false;
        }
        if (readId(LIVE_APPS_ID_FILE).id === stored.id) return false;
      }
      lost = true;
      await deps.settings.set({ on: false, id: null });
      deps.log('Adminium Designer was switched off: the project folder did not come back as it was left (it is not on a disk that is kept across restarts).');
      return true;
    },
    async set(on) {
      if (!on) {
        await deps.settings.set({ on: false, id: null });
        return null;
      }
      if (!deps.allowed) return 'not-allowed';
      if (deps.root === null) return 'no-project';
      if (!deps.hasBundler()) return 'no-bundler';
      const id = randomBytes(16).toString('hex');
      try {
        writeIds(deps.root, id);
      } catch {
        return 'not-writable';
      }
      lost = false;
      await deps.settings.set({ on: true, id });
      return null;
    },
  };
}
