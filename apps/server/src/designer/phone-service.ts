// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Designer's page does with an app's phone side outside a turn:
 * say how it stands, add it or get its packages on a person's yes, and open
 * the door a real phone comes through.
 *
 * Adding a phone side and installing its packages are a person's yes to
 * running Expo on this computer. In a turn the yes is a card; here it is the
 * button on the Phone tab. It holds the folder as a copied app does (no turn
 * runs beside it, and it is not cut short at a minute): the install is about
 * 350 MB.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPhone, installPhone, phoneInstalled, phoneNow, type PhoneBuild, type PhoneRunner } from '../project/apps/phone-build.js';
import { hasOwnBuild } from '../project/apps/own-build.js';
import { approvePhone, hasPhoneCode, isPhoneApproved, phoneDir, phoneShapeProblems } from '../project/apps/phone.js';
import { appDir } from '../project/apps/read-app.js';
import { addPhoneSide, nameFromKey } from '../project/apps/scaffold-app.js';
import type { PhoneAddress, PhoneDoor, PhoneDoorState } from './phone-door.js';
import type { FolderHold } from './runner.js';
import type { Actor } from './tool-types.js';

/** How the phone side stands, with what is being done to it now. */
export type PhoneStanding = PhoneBuild | { state: 'working'; step: 'adding' | 'installing' | 'building' };

export interface PhoneStatus {
  phone: PhoneStanding;
  door: PhoneDoorState;
  addresses: PhoneAddress[];
}

export interface PhoneServiceOptions {
  root: string;
  /** The Adminium running: the oldest version an app with a phone side says it runs on. */
  version: string;
  door: PhoneDoor;
  /** Take the folder, at once or not at all (409 while a turn runs). */
  hold: () => FolderHold;
  /** Build the project's apps and apply this one; the problems, or none. */
  buildAndApply: (key: string, signal?: AbortSignal) => Promise<string[]>;
  audit: (action: string, by: Actor, detail: Record<string, unknown>) => Promise<void>;
  log: (message: string, error?: unknown) => void;
  run?: PhoneRunner | undefined;
}

export interface PhoneService {
  status: (key: string) => PhoneStatus;
  /**
   * A person's yes: give the app a phone side when it has none, approve it as
   * it reads now, install its packages, build it and apply the app. Answers at
   * once; the page watches `status`.
   */
  add: (key: string, by: Actor) => PhoneStatus;
  open: (key: string, address: string, by: Actor) => Promise<PhoneStatus>;
  stop: () => void;
}

export function createPhoneService(opts: PhoneServiceOptions): PhoneService {
  const working = new Map<string, 'adding' | 'installing' | 'building'>();
  /** What the last "add" ended on, when it did not end well: said until the next one. */
  const failed = new Map<string, string>();

  const status = (key: string): PhoneStatus => {
    const step = working.get(key);
    const disk = phoneNow(opts.root, key);
    // What the last "add" ended on is said only while it is still so: a turn that built the phone app since has the last word.
    if (disk.state === 'built') failed.delete(key);
    const said = failed.get(key);
    const now: PhoneStanding = step !== undefined ? { state: 'working', step } : said !== undefined ? { state: 'failed', words: said } : disk;
    const door = opts.door.state();
    // The door is one for the whole project: another app's is not this app's to show.
    return { phone: now, door: door.state !== 'off' && door.app !== key ? { state: 'off' } : door, addresses: opts.door.addresses() };
  };

  const appName = (key: string): string => {
    try {
      const app = JSON.parse(readFileSync(join(appDir(opts.root, key), 'manifest', 'app.json'), 'utf8')) as { name?: unknown };
      if (typeof app.name === 'string' && app.name.trim() !== '') return app.name;
    } catch {
      // The key's words will do.
    }
    return nameFromKey(key);
  };

  return {
    status,
    add(key, by) {
      if (working.has(key)) return status(key);
      // A copy of a published app builds its own screens: a phone side is not added to it here.
      if (hasOwnBuild(opts.root, key)) {
        failed.set(key, 'This app is a copy of a published one and builds its own screens: a phone app is not added to it here.');
        return status(key);
      }
      // 409 while a turn runs or something else has the folder: said by the route as it is.
      const hold = opts.hold();
      failed.delete(key);
      working.set(key, 'adding');
      void (async () => {
        try {
          if (!hasPhoneCode(opts.root, key) && !existsSync(phoneDir(opts.root, key))) addPhoneSide({ root: opts.root, key, name: appName(key), version: opts.version });
          const shape = phoneShapeProblems(opts.root, key);
          if (shape.length > 0) {
            failed.set(key, shape.map((problem) => `${problem.file} ${problem.message}`).join('\n'));
            return;
          }
          const fresh = !isPhoneApproved(opts.root, key);
          approvePhone(opts.root, key);
          if (fresh) await opts.audit('designer.phone.approved', by, { app: key }).catch((error: unknown) => opts.log('a phone side’s approval was not recorded in the audit log', error));
          if (!phoneInstalled(opts.root, key)) {
            working.set(key, 'installing');
            const installed = await installPhone(opts.root, key, { signal: hold.signal, ...(opts.run === undefined ? {} : { run: opts.run }) });
            if (!installed.ok) {
              failed.set(key, installed.words);
              return;
            }
          }
          working.set(key, 'building');
          const problems = await opts.buildAndApply(key, hold.signal);
          if (problems.length > 0) {
            failed.set(key, problems.slice(0, 4).join('\n'));
            return;
          }
          const built = await buildPhone(opts.root, key, { signal: hold.signal, ...(opts.run === undefined ? {} : { run: opts.run }) });
          if (built.state !== 'built' && built.state !== 'none') failed.set(key, built.words);
        } catch (error) {
          failed.set(key, error instanceof Error ? error.message : String(error));
          opts.log('a phone side could not be added', error);
        } finally {
          working.delete(key);
          hold.release();
        }
      })();
      return status(key);
    },
    async open(key, address, by) {
      const state = await opts.door.open(key, address);
      if (state.state === 'open') await opts.audit('designer.phone.opened', by, { app: key, address }).catch((error: unknown) => opts.log('a phone preview was not recorded in the audit log', error));
      return status(key);
    },
    stop: () => opts.door.stop(),
  };
}
