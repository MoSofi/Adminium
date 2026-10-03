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

  const idInFolder = (): string | null => {
    if (deps.root === null) return null;
    try {
      const parsed = JSON.parse(readFileSync(join(deps.root, LIVE_ID_FILE), 'utf8')) as { id?: unknown };
      return typeof parsed.id === 'string' ? parsed.id : null;
    } catch {
      return null;
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
      const stored = await deps.settings.get();
      if (!stored.on || deps.root === null) return false;
      if (stored.id !== null && idInFolder() === stored.id) return false;
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
      const file = join(deps.root, LIVE_ID_FILE);
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ id }, null, 2)}\n`, { mode: 0o600 });
        if (!existsSync(file)) return 'not-writable';
      } catch {
        return 'not-writable';
      }
      lost = false;
      await deps.settings.set({ on: true, id });
      return null;
    },
  };
}
