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
 *
 * What a turn may keep reaching is what the app reached at its last APPLY, kept
 * by the server (`.adminium/designer/applied/<key>.reach.json`), never the files
 * as a turn finds them: a refused turn leaves its files for the person to carry
 * on with their own key, and a second turn must not take them as given. The
 * first scoped turn on an app with nothing kept takes the folder as it is. A
 * refusal also HOLDS the app: no build of it (a restart's, a save's) is made
 * until an apply on the person's own key, or one that adds nothing, lets it go
 * (`build-apps.ts`). The person's own actions in a session on the operator's
 * connection (a hand save, a style, pictures, going back) are held to the
 * same kept reach.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PHONE_SIDE } from '../project/apps/phone.js';
import { appDir, readAppFolder } from '../project/apps/read-app.js';
import { SITE_DIR } from '../project/apps/site-swap.js';
import { DESIGNER_DIR } from './session-store.js';
import { readSpots } from './spots.js';

/** What the model is told when the scope refuses something: the turn then ends with the card. */
export const SCOPE_REFUSAL =
  'Customer-facing screens are not built on this connection: the person is shown a card about it, and this turn ends. Do not explain it, do not try another way.';

/** The same, for the page's step line and the logs. */
export const SCOPE_LABEL = 'Needs your own AI key';

/** The same, for a person's own action in a session on the operator's AI (403 `OFF_BY_OPERATOR`). */
export const SCOPE_OFF_MESSAGE = 'This session runs on the AI that comes with this server, which builds dashboards only. Customer-facing screens need your own AI key.';

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

// ── what an app reached at its last apply ───────────────────────────────────

interface KeptReach {
  /** {@link publicReach} of the app as it was last applied. */
  marks: string[];
  /** A scoped turn or action found it reaching more: no build of it until an apply lets it go. */
  held: boolean;
}

const keptFile = (root: string, appKey: string): string => join(root, DESIGNER_DIR, 'applied', `${appKey}.reach.json`);

function readKept(root: string, appKey: string): KeptReach | null {
  try {
    const raw = JSON.parse(readFileSync(keptFile(root, appKey), 'utf8')) as Partial<KeptReach> | null;
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.marks)) return null;
    return { marks: raw.marks.filter((mark): mark is string => typeof mark === 'string'), held: raw.held === true };
  } catch {
    return null;
  }
}

function writeKept(root: string, appKey: string, kept: KeptReach): void {
  const file = keptFile(root, appKey);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(kept), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** The reach a scoped turn or action may keep: what was kept at the last apply; with none kept, `seed` (and kept from now on). */
function keptReach(root: string, appKey: string, seed: () => Set<string>): Set<string> {
  const kept = readKept(root, appKey);
  if (kept !== null) return new Set(kept.marks);
  const seeded = seed();
  writeKept(root, appKey, { marks: [...seeded].sort(), held: false });
  return seeded;
}

/** Holds the app: the build makes nothing of it until an apply lets it go. */
function hold(root: string, appKey: string, before: ReadonlySet<string>): void {
  writeKept(root, appKey, { marks: [...(readKept(root, appKey)?.marks ?? before)].sort(), held: true });
}

/** The app was applied: what it reaches now is what a scoped turn may keep reaching, and any hold is let go. */
export function recordApplied(root: string, appKey: string): void {
  writeKept(root, appKey, { marks: [...publicReach(root, appKey)].sort(), held: false });
}

/** A turn or action on the person's own key: the hold is let go, so its build is made; what is kept stays until it applies. */
export function releaseHold(root: string, appKey: string): void {
  const kept = readKept(root, appKey);
  if (kept?.held === true) writeKept(root, appKey, { ...kept, held: false });
}

/** Why the app is not built (the build's own check): it is held and reaches more than it did at its last apply. Null when not. */
export function heldRefusal(root: string, appKey: string): string | null {
  const kept = readKept(root, appKey);
  if (kept?.held !== true) return null;
  const marks = new Set(kept.marks);
  const added = [...publicReach(root, appKey)].filter((mark) => !marks.has(mark));
  return added.length === 0 ? null : `apps/${appKey} reaches more of the public than when it was last applied, and that was refused on the operator's AI: ${SCOPE_LABEL.toLowerCase()} to apply it.`;
}

/**
 * Why a person's own action in a session on the operator's connection (outside a turn: a hand save, a style, pictures,
 * going back) may not build or apply the app: it reaches more than at its last apply. Holds the app when it refuses.
 */
export function outsideReachRefusal(root: string, appKey: string): string | null {
  const before = keptReach(root, appKey, () => publicReach(root, appKey));
  const added = [...publicReach(root, appKey)].filter((mark) => !before.has(mark));
  if (added.length === 0) return null;
  hold(root, appKey, before);
  return `${SCOPE_LABEL}. (It would add: ${added.slice(0, 8).join(', ')}.)`;
}

/** A scoped turn begins in this folder, on this app: what the app reached at its last apply is what it may keep reaching. */
export function enterScope(root: string, appKey: string): ScopeHandle {
  const key = folderKey(root);
  const state: ScopeState = { before: new Map([[appKey, keptReach(root, appKey, () => publicReach(root, appKey))]]), tripped: false };
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
  if (scopeIn(root) === null || !customerFacingPath(normal)) return null;
  trip(root);
  return SCOPE_REFUSAL;
}

/** Whether a project path (`apps/<key>/…`) is in a customer side, the phone app or any side's site template. */
export function customerFacingPath(path: string): boolean {
  const parts = path
    .normalize('NFC')
    .toLowerCase()
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.');
  if (parts[0] !== 'apps' || parts.length < 4) return false;
  const side = parts[2];
  return side === 'customer' || side === PHONE_SIDE || (parts[3] === 'src' && parts[4] === SITE_DIR);
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
      const methods = words(entry['methods']);
      for (const method of methods) out.add(`access:${where}:${method}`);
      for (const column of [...words(entry['select']), ...words(entry['writable'])]) out.add(`access:${where}:column:${column}`);
      // A GET that names no columns shows them all.
      if (methods.includes('GET') && entry['select'] === undefined) out.add(`access:${where}:column:*`);
      if (entry['claim'] !== undefined) out.add(`access:${where}:claim`);
      if (entry['pictures'] !== undefined) out.add(`access:${where}:pictures`);
      // Everything else an entry says (which rows, uploads, files, a share link, a human check), as it is: a change of
      // any of it is new reach. Columns and methods above may only shrink without a word.
      const { key: _key, table: _table, methods: _methods, select: _select, writable: _writable, ...rest } = entry;
      out.add(`access:${where}:shape:${stable(rest)}`);
    }
    const keys = document['publicKeys'];
    if (keys !== null && typeof keys === 'object') for (const [name, value] of Object.entries(keys)) out.add(`key:${name}:${stable(value)}`);
    if (document['outbox'] !== undefined) out.add('mail:outbox').add(`mail:outbox:${stable(document['outbox'])}`);
    for (const template of list(document['emailTemplates'])) out.add(`mail:template:${String(template['kind'] ?? template['key'] ?? '')}:${stable(template)}`);
    // An automation's email to a record's own address (or any address that is not a staff member's): mail to the public.
    for (const rule of list(document['automations'])) {
      for (const step of emailSteps(rule)) out.add(`mail:automation:${String(rule['key'])}:${stable(step)}`);
    }
    if (document['payments'] !== undefined) out.add('pay').add(`pay:${stable(document['payments'])}`);
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

/** A value as one text whatever the order of its keys. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Loose)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Every email step anywhere in an automation's graph that does not go to staff. */
function emailSteps(rule: Loose): Loose[] {
  const found: Loose[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Loose;
    const to = node['to'] as Loose | undefined;
    if (node['kind'] === 'email' && !(to !== null && typeof to === 'object' && (to['kind'] === 'staff' || to['kind'] === 'listed'))) found.push(node);
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  walk(rule['graph'], 0);
  return found;
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
  let before = state.before.get(appKey);
  if (before === undefined) {
    before = keptReach(root, appKey, () => new Set<string>());
    state.before.set(appKey, before);
  }
  const added = [...publicReach(root, appKey)].filter((mark) => !(before as Set<string>).has(mark));
  if (added.length === 0) return null;
  state.tripped = true;
  hold(root, appKey, before);
  return `${SCOPE_REFUSAL} (It would add: ${added.slice(0, 8).join(', ')}.)`;
}
