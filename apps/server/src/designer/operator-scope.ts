// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's AI builds dashboards only (`ADMINIUM_AI_OPERATOR_SCOPE=dashboard`).
 *
 * While a Designer turn runs on the operator's connection, the limit is held
 * WHERE THINGS TAKE EFFECT, not by leaving tools out of the model's list:
 *
 *   - the jail writes and deletes nothing in a customer side, the phone app or
 *     a site template's folder (`jail.ts`, {@link scopedPathRefusal}), whoever asks it;
 *   - the build and the apply refuse an app that can now reach more of the
 *     public than it could when the turn began: a customer side or a phone
 *     app, a public endpoint or form, mail to customers, a pay page, a site
 *     template, a picture spot (`build_sides`, the pipeline that `apply_app`
 *     and the end of the turn run; {@link reachRefusal});
 *   - `add_side` for customers or the phone, and `use_site`, are refused at
 *     their door, with the same words;
 *   - nothing the server runs is written (the declarative-only rule), as under
 *     trial mode;
 *   - the session's target is forced to `dashboard`, and the prompt's "call
 *     add_side first" is not sent.
 *
 * Every refusal trips the turn: the runner ends it with the fixed card ("needs
 * your own AI key"), never with the model's own words about it. A turn on the
 * person's own key is not scoped at all.
 *
 * One turn runs per project folder (`runner.ts`), so the scope is kept per
 * folder: the jail and the pipeline, which know the folder and not the turn,
 * ask here.
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PHONE_SIDE } from '../project/apps/phone.js';
import { appDir, readAppFolder } from '../project/apps/read-app.js';
import { SITE_DIR } from '../project/apps/site-swap.js';
import { readSpots } from './spots.js';

/** What the model is told when the scope refuses something: the turn then ends with the card. */
export const SCOPE_REFUSAL =
  'Customer-facing screens are not built on this connection: the person is shown a card about it, and this turn ends. Do not explain it, do not try another way.';

/** The same, for the page's step line and the logs. */
export const SCOPE_LABEL = 'Needs your own AI key';

interface ScopeState {
  /** What the app could reach of the public as the turn began, by app key. */
  before: Map<string, ReadonlySet<string>>;
  tripped: boolean;
}

const active = new Map<string, ScopeState>();

const folderKey = (root: string): string => {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
};

/** The scope of the turn that runs in this folder now; null when none is scoped. */
function scopeIn(root: string): ScopeState | null {
  return active.get(folderKey(root)) ?? null;
}

/** Whether a turn on the operator's AI, under the dashboard scope, runs in this folder now. */
export const scopedNow = (root: string): boolean => scopeIn(root) !== null;

export interface ScopeHandle {
  /** Whether something was refused in this turn. */
  tripped(): boolean;
  /** The turn is over: the folder is no longer scoped. */
  end(): void;
}

/** A scoped turn begins in this folder, on this app: what the app can reach now is what it may keep reaching. */
export function enterScope(root: string, appKey: string): ScopeHandle {
  const key = folderKey(root);
  const state: ScopeState = { before: new Map([[appKey, publicReach(root, appKey)]]), tripped: false };
  active.set(key, state);
  return {
    tripped: () => state.tripped,
    end: () => {
      if (active.get(key) === state) active.delete(key);
    },
  };
}

/** Something was refused: the runner ends the turn with the card. */
export function trip(root: string): void {
  const state = scopeIn(root);
  if (state !== null) state.tripped = true;
}

/**
 * Why the jail may not write or delete `normal` (its own spelling, `apps/<key>/…`) in a scoped turn, or null.
 * A customer side, the phone app, and any side's site template are customer-facing, whatever the file.
 */
export function scopedPathRefusal(root: string, normal: string): string | null {
  if (scopeIn(root) === null) return null;
  const parts = normal.normalize('NFC').toLowerCase().split('/');
  if (parts[0] !== 'apps' || parts.length < 4) return null;
  const side = parts[2];
  const customer = side === 'customer' || side === PHONE_SIDE;
  const site = parts[3] === 'src' && parts[4] === SITE_DIR;
  if (!customer && !site) return null;
  trip(root);
  return SCOPE_REFUSAL;
}

/** A refusal at a tool's own door (a customer side, a site template), in a scoped turn; null when not scoped. */
export function scopedDoorRefusal(root: string): string | null {
  if (scopeIn(root) === null) return null;
  trip(root);
  return SCOPE_REFUSAL;
}

type Loose = Record<string, unknown>;
const list = (value: unknown): Loose[] => (Array.isArray(value) ? value.filter((entry): entry is Loose => entry !== null && typeof entry === 'object') : []);
const words = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/**
 * Everything of an app that a stranger can reach, as plain marks, read from its files as they are (an app that does
 * not pass the check yet included): its customer side and phone app, each public entry with its methods and columns,
 * the browser keys beyond its own, mail to customers, pay pages, site templates, picture spots.
 */
export function publicReach(root: string, appKey: string): Set<string> {
  const out = new Set<string>();
  let document: Loose | null = null;
  try {
    const folder = readAppFolder(root, appKey);
    document = folder.document !== null && typeof folder.document === 'object' ? (folder.document as Loose) : null;
  } catch {
    document = null;
  }
  if (document !== null) {
    for (const side of list(document['frontends'])) {
      if (side['side'] !== 'staff' && side['kind'] !== 'none') out.add(`side:${String(side['side'])}`);
    }
    for (const entry of list(document['publicAccess'])) {
      const where = `${typeof entry['key'] === 'string' ? entry['key'] : 'customer'}:${String(entry['table'])}`;
      out.add(`access:${where}`);
      for (const method of words(entry['methods'])) out.add(`access:${where}:${method}`);
      for (const column of [...words(entry['select']), ...words(entry['writable'])]) out.add(`access:${where}:column:${column}`);
      if (entry['claim'] !== undefined) out.add(`access:${where}:claim`);
      if (entry['pictures'] !== undefined) out.add(`access:${where}:pictures`);
    }
    const keys = document['publicKeys'];
    if (keys !== null && typeof keys === 'object') for (const name of Object.keys(keys)) out.add(`key:${name}`);
    if (document['outbox'] !== undefined) out.add('mail:outbox');
    for (const template of list(document['emailTemplates'])) out.add(`mail:template:${String(template['kind'] ?? template['key'] ?? '')}`);
    if (document['payments'] !== undefined) out.add('pay');
  }
  // A site template's folder in any side, and the phone app's folder, whatever the manifest says yet.
  const dir = appDir(root, appKey);
  for (const side of safeList(dir)) {
    if (isFolder(join(dir, side, 'src', SITE_DIR))) out.add(`site:${side}`);
  }
  if (isFolder(join(dir, PHONE_SIDE))) out.add(`side:${PHONE_SIDE}`);
  if (isFolder(join(dir, 'customer', 'src'))) out.add('side:customer');
  for (const spot of readSpots(root, appKey)) out.add(`spot:${spot.id}`);
  return out;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isFolder(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Why the app may not be built or applied in this scoped turn: it reaches more of the public than when the turn
 * began. Null when it does not, and outside a scoped turn. Trips the turn when it refuses.
 */
export function reachRefusal(root: string, appKey: string): string | null {
  const state = scopeIn(root);
  if (state === null) return null;
  // An app named in this turn (its folder moved) began bare: whatever it reaches now is new.
  const before = state.before.get(appKey) ?? new Set<string>();
  const added = [...publicReach(root, appKey)].filter((mark) => !before.has(mark));
  if (added.length === 0) return null;
  state.tripped = true;
  return `${SCOPE_REFUSAL} (It would add: ${added.slice(0, 8).join(', ')}.)`;
}
