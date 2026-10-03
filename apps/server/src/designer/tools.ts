// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's tools: a closed list.
 *
 *   list_files, read_file, write_file, edit_file, delete_file
 *                     the app's folder, hooks/ and actions/ (the jail)
 *   check_app         the engine's check of the app, as `adminium app check`
 *   build_sides       the app's screens, built
 *   apply_app         check, build and apply, as `adminium dev` does on a save
 *   run_tests         the app's own tests, if it has any, once the person says yes
 *   read_reference    one file of the skills
 *   list_add_ons      the add-ons this server has or can get
 *   add_side          the starter's screen for a side, to rewrite
 *   get_add_on        an add-on this server lacks, after the person's yes
 *   build_on_shape    the tables and emails of an add-on's shape, from its manifest
 *   ask_person        a question for the person, and their answer
 *   request_package   an npm package, installed only when the person says yes
 *
 * No shell and no web. What the model writes is still code: the app's tests,
 * and the project's hooks/ and actions/, run as the person. So tests run, and
 * server code is written, only after the person said yes in that turn. A bad
 * input is an answer the model can read and fix, never a crash of the turn.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { checkApp } from '../project/apps/check-app.js';
import { applyLook, cleanLook, directionForBusiness, directionFromWords, DIRECTIONS, isDirection, LOOK_DIRECTIONS, mentionsLook, readLook, sidesWithScreens, type Look } from '../project/apps/look.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { addSide, nameFromKey, PUBLIC_CLIENT_PACKAGE } from '../project/apps/scaffold-app.js';
import type { AppSide } from '../project/apps/read-app.js';
import { buildCodeStems, codeStem, hasOwnBuild } from '../project/apps/own-build.js';
import { shapeParts } from '../project/apps/shape-parts.js';
import { sideCallIssues, sideCallLines } from '../project/apps/side-calls.js';
import { rebuildApps } from '../project/build.js';
import { findProject } from '../project/locate.js';
import { projectPackageManager } from '../project/package-manager.js';
import { runChild } from './child.js';
import type { AddOnGetter } from './get-add-on.js';
import { createJail, JailError, type Jail } from './jail.js';
import type { Designer } from './service.js';
import type { Skills } from './skills.js';
import type { DesignerTool, ToolContext, ToolOutcome } from './tool-types.js';

/** The most a read returns; the rest is said to be there. */
export const MAX_READ_BYTES = 65_536;
/** The most entries a listing gives. */
const MAX_LIST = 400;
/** How long an app's tests may run. */
const TESTS_TIMEOUT_MS = 60_000;
/** How long a package install may run. */
const INSTALL_TIMEOUT_MS = 180_000;

/** An add-on the server has or can get, in one line. */
export interface AddOnLine {
  key: string;
  name: string;
  version: string;
  line: string;
  /** `available`: in this server's store. `listed`: only in the list adminium.dev gave; get_add_on brings it. */
  state: 'installed' | 'available' | 'listed';
  /** The shapes an app can build tables on: `invoice@1`. */
  shapes?: string[];
}

export interface ToolsDeps {
  root: string;
  version: string;
  designer: () => Designer;
  skills: Skills;
  listAddOns: () => Promise<AddOnLine[]>;
  /** An add-on's manifest, installed or in this server's store; null when it is neither. */
  readAddOn?: (key: string) => Promise<unknown>;
  /** Getting an add-on this server does not have, after a person's yes. Absent where nothing can be installed. */
  addOnGetter?: AddOnGetter;
  /** `local` under `adminium design`, where applying an app installs the add-ons it needs that are already in the store. */
  mode?: 'local' | 'live';
}

const text = (content: string, label: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ content, label, ...extra });
const refused = (content: string, label: string): ToolOutcome => ({ content, label, isError: true });

const str = (input: Record<string, unknown>, key: string): string | null => (typeof input[key] === 'string' ? (input[key] as string) : null);
const int = (input: Record<string, unknown>, key: string): number | null =>
  typeof input[key] === 'number' && Number.isInteger(input[key]) && (input[key] as number) >= 0 ? (input[key] as number) : null;

/** npm's own rule for a package name, scoped or not. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** An exact version: no range, no tag, no URL. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The React an app's screens are built with here. */
export const DESIGNER_REACT_VERSION = '19.2.0';

/**
 * The packages a screen needs, at the one version this server knows is right.
 * A model guesses versions (the evaluation saw six for the public client); for
 * these the guess is replaced, so the person is asked once, for the right one.
 */
export function knownPackageVersion(name: string, serverVersion: string): string | null {
  if (name === PUBLIC_CLIENT_PACKAGE) return serverVersion;
  if (name === 'react' || name === 'react-dom') return DESIGNER_REACT_VERSION;
  return null;
}

/** What a side's screens need in the project and do not find there: react, react-dom, and the public client for a customer side. */
export function missingScreenPackages(root: string, side: AppSide, serverVersion: string): { name: string; version: string }[] {
  let listed: Record<string, unknown> = {};
  try {
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    listed = { ...(json.devDependencies ?? {}), ...(json.dependencies ?? {}) };
  } catch {
    // No package.json to read: the build will say what it cannot find.
    return [];
  }
  return ['react', 'react-dom', ...(side === 'customer' ? [PUBLIC_CLIENT_PACKAGE] : [])]
    .filter((name) => listed[name] === undefined)
    .map((name) => ({ name, version: knownPackageVersion(name, serverVersion) ?? '' }));
}

/** The parts a starter screen is drawn with, for whoever rewrites it. */
export const LOOK_PARTS = `The screen is drawn with made parts: class names in src/app.css, coloured by src/theme.css. Use them; do not write inline styles or a stylesheet of your own for what a part already does.
- Page: "page" (add "narrow" for one column), "site-header" with "brand" and "brand-mark", "hero" with "eyebrow", an h1 and "lead", "section" with "section-head", "layout" (a wide column and an "aside" that stays in view), "site-footer".
- Things on offer: "grid" of "card"s, each with "card-media", "card-title", "card-row", "price"; "stepper" for a quantity; "summary" with a "total" line for what was chosen.
- Forms: "form" of "field"s (a label, then the input, then an optional "hint"); "btn btn-primary" for the one main action, "btn" and "btn btn-quiet" for the rest, "btn-small", "btn-block".
- What the page says back: "notice ok" after sending, "notice error" for a problem, "empty" (a strong line and a sentence) where a list has nothing, "badge" with "accent", "good", "warn" or "bad" for a status.
- For staff: "toolbar", "list" of "list-row"s, or a "board" of "column"s holding cards; "row" to put things side by side; "muted", "small".
A page people see has the business's name in its header, a first line that says what the page is for, and one clear main button. Write real words for this business, not placeholders.`;

/** An app manifest's own build command is set by a person (D33): refused when the model writes one. */
function addsBuildCommand(path: string, content: string, appKey: string): boolean {
  const manifestFiles = [`apps/${appKey}/manifest/app.json`, `apps/${appKey}/manifest.json`];
  // Folded: on a disk that ignores case, APP.JSON is app.json.
  if (!manifestFiles.includes(path.normalize('NFC').toLowerCase())) return false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed !== null && typeof parsed === 'object' && 'build' in parsed;
  } catch {
    // Not JSON: the check will say so.
    return false;
  }
}

/**
 * Why a `.json` file's text does not read, or null. Said at the write, a step
 * before the check would. The parser's own sentence names a position and
 * little else, and a model sent the same broken file nine times on it: so the
 * lines around the fault are shown with the place marked, and what is still
 * open there, which is where a missing or extra brace shows.
 */
export function jsonProblem(path: string, content: string): string | null {
  if (!path.endsWith('.json')) return null;
  try {
    JSON.parse(content);
    return null;
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    const found = /position (\d+)/.exec(said);
    if (found === null) return said;
    const at = Math.min(Number(found[1]), content.length);
    const lines = content.split('\n');
    const line = content.slice(0, at).split('\n').length;
    const column = at - content.lastIndexOf('\n', at - 1);
    const from = Math.max(1, line - 3);
    const shown = lines.slice(from - 1, line).map((text, index) => `${from + index === line ? '>' : ' '} ${String(from + index).padStart(3)} | ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`);
    shown.push(`        ${' '.repeat(Math.min(column - 1, 160))}^ here`);
    // What is open at the mark, outside strings: a brace closed once too often, or not at all, shows as a wrong list.
    const open: { mark: string; line: number }[] = [];
    let inString = false;
    let row = 1;
    for (let i = 0; i < at; i += 1) {
      const char = content[i] as string;
      if (char === '\n') row += 1;
      if (inString) {
        if (char === '\\') i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{' || char === '[') open.push({ mark: char, line: row });
      else if (char === '}' || char === ']') open.pop();
    }
    const still = open.length === 0 ? 'Nothing is open there: a closing brace or bracket too many came before it.' : `Still open there: ${open.slice(-6).map((entry) => `"${entry.mark}" from line ${String(entry.line)}`).join(', ')}.`;
    return `${said}\n${shown.join('\n')}\n${still} Look at the lines just above the mark: a brace or bracket closed once too often or not often enough, or a comma missing or left over. Writing one property per line makes the nesting plain`;
  }
}

/** A file this small is shown whole when an edit misses it. */
const SHOWN_ON_MISS = 4000;

/** The pieces of `text` that are `piece` but for their spacing: spaces and line ends may differ anywhere. */
export function looseMatches(text: string, piece: string): string[] {
  const marks = [...piece].filter((mark) => !/\s/.test(mark));
  if (marks.length < 4 || marks.length > 4000) return [];
  const pattern = new RegExp(marks.map((mark) => mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
  return [...text.matchAll(pattern)].map((found) => found[0]);
}

/** How much of an index is handed back for a name that is not there. */
const INDEX_ANSWER_BYTES = 4500;

/** The index of the nearest folder a missing name sits in: `…/references/<area>/INDEX.md`, then the skill's own. */
function nearestIndex(skills: Skills, name: string): { skill: string; text: string } | null {
  const parts = name.split('/').filter((part) => part !== '');
  const skill = parts[0] ?? '';
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) {
    const text = skills.read([...parts.slice(0, depth), 'INDEX.md'].join('/'));
    if (text !== null) return { skill, text: text.slice(0, INDEX_ANSWER_BYTES) };
  }
  return null;
}

export function createDesignerTools(deps: ToolsDeps, appKey: string): DesignerTool[] {
  const jail: Jail = createJail(deps.root, appKey);
  const shown = (path: string): string => {
    try {
      return jail.normalise(path).replace(`apps/${appKey}/`, '');
    } catch {
      return path;
    }
  };
  /** Run a jail step; a refusal becomes an answer, not a crash. */
  const jailed = (label: string, step: () => ToolOutcome): ToolOutcome => {
    try {
      return step();
    } catch (error) {
      // A path that is not there is a miss the model recovers from, not a failure of the step.
      if (error instanceof JailError) return { ...refused(error.message, label), ...(error.message.endsWith(' does not exist.') ? { miss: true } : {}) };
      throw error;
    }
  };

  /** Add packages to the project, exact versions, no install scripts. Null when it worked; else what the manager said. */
  const installPackages = async (specs: readonly { name: string; version: string }[], signal: AbortSignal): Promise<string | null> => {
    const manager = projectPackageManager(deps.root, {});
    const exact = manager === 'npm' || manager === 'pnpm' ? '--save-exact' : '--exact';
    const args = [manager === 'npm' ? 'install' : 'add', ...specs.map((spec) => `${spec.name}@${spec.version}`), '--ignore-scripts', exact];
    const result = await runChild(manager, args, { cwd: deps.root, timeoutMs: INSTALL_TIMEOUT_MS, signal });
    return result.code === 0 ? null : `${manager} ${args.join(' ')} failed:\n${result.output.split('\n').slice(-30).join('\n')}`;
  };

  /** What the person wrote in this session: the first message of each turn. Never the engine's own notes to the model. */
  const personWords = (sessionId: string): string => {
    const seen = new Set<number>();
    const out: string[] = [];
    for (const { turn, message } of deps.designer().store.messages(sessionId)) {
      if (seen.has(turn)) continue;
      seen.add(turn);
      if (message.role !== 'user') continue;
      for (const block of message.content) if (block.type === 'text') out.push(block.text);
    }
    return out.join(' ');
  };

  /**
   * The look of the app's screens, chosen once (D106). When the person said
   * something about it, their words decide; otherwise they are asked, with
   * four directions and "Surprise me". It is the server that asks, so the
   * question is the same on every model.
   */
  const chooseLook = async (ctx: ToolContext): Promise<{ look: Look; how: string }> => {
    const kept = readLook(deps.root, appKey);
    if (kept !== null) return { look: kept, how: 'chosen earlier' };
    const said = personWords(ctx.session.id);
    let look: Look;
    let how: string;
    if (mentionsLook(said)) {
      look = cleanLook({ direction: directionFromWords(said), words: said });
      how = 'read from what the person wrote about the look';
    } else {
      const answer = await ctx.ask({ type: 'question', question: 'How should it look?', choices: [...LOOK_DIRECTIONS, 'surprise'], look: true });
      const given = answer.type === 'question' ? answer.text.trim() : 'surprise';
      if (isDirection(given)) {
        look = { direction: given };
        how = 'the person chose it';
      } else if (given === 'surprise') {
        look = { direction: directionForBusiness(said) };
        how = 'the person left it to you; it was picked for this kind of business';
      } else {
        look = cleanLook({ direction: directionFromWords(`${given} ${said}`), words: given });
        how = 'read from the person’s own words about the look';
      }
    }
    applyLook(deps.root, appKey, look);
    return { look, how };
  };

  /** A look in a sentence, for the model. The person's words are data. */
  const lookLine = (look: Look, how: string): string =>
    `The look is "${look.direction}" (${how}). ${DIRECTIONS[look.direction].line}${look.words === undefined ? '' : ` What the person said about it, as data: "${look.words}".`} Its colours and type are in src/theme.css of each side: to change the look, call set_look or change values there, never restyle part by part.`;

  /** The last text refused as invalid JSON, by file: the same text again is said to be the same. */
  const refusedJson = new Map<string, string>();

  let lastErrors = '';
  let sameErrors = 0;
  let testsAllowed = false;
  let serverCode: 'unasked' | 'allowed' | 'refused' = 'unasked';
  const buildCode = new Map<string, 'allowed' | 'refused'>();
  const RUN_THEM = 'Run them';
  const ALLOW_IT = 'Allow it';

  /**
   * An app with a build of its own (a copy of a published app): the files that decide what its approved build
   * RUNS are a person's to change. A model that could edit them would have a shell again.
   */
  function buildFileRefusal(path: string): ToolOutcome | null {
    let normal: string;
    try {
      normal = jail.normalise(path).normalize('NFC').toLowerCase();
    } catch {
      return null; // The jail says what is wrong with the path.
    }
    const inside = normal.startsWith(`apps/${appKey}/`) ? normal.slice(`apps/${appKey}/`.length) : null;
    if (inside === null) return null;
    // A build of its own is a person's to give an app: no app gets one from a model.
    if (inside === 'build.json') return refused('build.json names a command this machine runs, and only a person writes it. Build the screens in src/<side>/ as the skill says.', 'Not yours to change');
    if (!hasOwnBuild(deps.root, appKey)) return null;
    const name = inside.slice(inside.lastIndexOf('/') + 1);
    const guarded =
      // At any depth: a folder's own package.json says which file an import of the folder runs.
      name === 'package.json' ||
      name === 'package-lock.json' ||
      name === 'npm-shrinkwrap.json' ||
      name === 'pnpm-lock.yaml' ||
      name === 'yarn.lock' ||
      // Every config the build's tools look for and run: Vite's own, and the ones its plugins find by name.
      /^(vite|vitest|postcss|tailwind|babel|rollup|svgo|uno|windi)\.config\.[a-z]+$/.test(inside) ||
      /^[jt]sconfig[a-z.]*\.json$/.test(name) ||
      inside.startsWith('scripts/');
    return guarded
      ? refused(`${inside} decides what this app's build runs, and the person approved that build as it is. It is theirs to change. Do what was asked in the app's manifest and its src/.`, 'Not yours to change')
      : null;
  }

  /**
   * The files a copied app's build runs on this machine (its Vite config imports them) are code with the
   * person's whole account, like server code: the model may change one only once the person said so, asked
   * once a turn.
   */
  async function buildCodeRefusal(path: string, ctx: ToolContext): Promise<ToolOutcome | null> {
    if (!hasOwnBuild(deps.root, appKey)) return null;
    let normal: string;
    try {
      normal = jail.normalise(path);
    } catch {
      return null; // The jail says what is wrong with the path.
    }
    const lead = `apps/${appKey}/`;
    if (!normal.toLowerCase().startsWith(lead)) return null;
    const inside = normal.slice(lead.length);
    if (!buildCodeStems(deps.root, appKey).has(codeStem(inside))) return null;
    /*
     * A yes is for what the question named and nothing wider: one file at the app's top (its build's own
     * plugins live there), or the build's files in one folder (an app's words are a file a language).
     */
    const slash = inside.lastIndexOf('/');
    const folder = slash === -1 ? null : inside.slice(0, slash);
    const scope = (folder ?? inside).normalize('NFC').toLowerCase();
    let answered = buildCode.get(scope);
    if (answered === undefined) {
      const what = folder === null ? inside : `the files in ${folder}/ that this app's build runs (first: ${inside.slice(slash + 1)})`;
      const answer = await ctx.ask({
        type: 'question',
        question: `Let the Designer change ${what}? This app's build runs ${folder === null ? 'that file' : 'them'} on this machine each time it builds (its Vite config imports ${folder === null ? 'it' : 'them'}), with everything your account can reach.`,
        choices: [ALLOW_IT, 'Do not allow it'],
      });
      answered = answer.type === 'question' && answer.text === ALLOW_IT ? 'allowed' : 'refused';
      buildCode.set(scope, answered);
    }
    return answered === 'allowed'
      ? null
      : refused(`The person did not allow changes to files the build runs (${inside}) in this turn. Do it in a file the Vite config does not import, or say what cannot be done without it.`, 'Build code not allowed');
  }

  /**
   * `hooks/` and `actions/` are code the server itself runs. The model may
   * write there only once the person said so, asked once a turn; the answer
   * to a refusal is a sentence the model can act on.
   */
  async function serverCodeRefusal(path: string, ctx: ToolContext): Promise<ToolOutcome | null> {
    let normal: string;
    try {
      normal = jail.normalise(path);
    } catch {
      return null; // The jail says what is wrong with the path.
    }
    if (!/^(hooks|actions)\//i.test(normal)) return null;
    if (serverCode === 'unasked') {
      const answer = await ctx.ask({
        type: 'question',
        question: `Let the Designer write server code (${normal})? Files in hooks/ and actions/ run inside your server, with everything it can reach.`,
        choices: [ALLOW_IT, 'Do not allow it'],
      });
      serverCode = answer.type === 'question' && answer.text === ALLOW_IT ? 'allowed' : 'refused';
    }
    return serverCode === 'allowed' ? null : refused('The person did not allow server code (hooks/, actions/) in this turn. Do it with the manifest, or say what cannot be done without it.', 'Server code not allowed');
  }

  /** What was said to an add-on's card, by turn: one card for an add-on in a turn, and a no is kept (the model cannot ask until the person gives in). */
  const addOnAnswers = new Map<string, 'yes' | 'no'>();

  /**
   * Get an add-on this server does not have, after a card. The model gave a
   * key; everything the card says comes from this server's store or from the
   * list adminium.dev gave it.
   */
  const offerAddOn = async (key: string, ctx: ToolContext): Promise<{ got: true; name: string; version: string; fresh: boolean } | { got: false; outcome: ToolOutcome }> => {
    const none = (content: string, outcome: 'declined' | 'refused' | 'failed', miss = false): { got: false; outcome: ToolOutcome } => ({
      got: false,
      outcome: { content, label: `Did not get ${key}`, isError: true, ...(miss ? { miss: true } : {}), facts: { outcome } },
    });
    const getter = deps.addOnGetter;
    const upload = 'The person can upload it in Studio → Add-ons. Say so, and build the rest of the app meanwhile.';
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(key)) return none(`"${key.slice(0, 80)}" is not an add-on's key. list_add_ons gives the keys.`, 'refused', true);
    if (getter === undefined) return none(`The add-on "${key}" is not on this server, and this Designer cannot get one. ${upload}`, 'refused');
    const found = await getter.look(key);
    if (found.state === 'installed') return { got: true, name: found.name, version: found.version, fresh: false };
    if (found.state === 'unknown') return none(`There is no add-on "${key}", here or in the list of adminium.dev. list_add_ons gives the ones there are; do not ask for this one again.`, 'refused', true);
    if (found.state === 'too-new') return none(`${found.name} needs Adminium ${found.needs} or later, and this server is ${deps.version}. Tell the person; build without it.`, 'refused');
    if (found.state === 'off' && found.vetoed) return none(`The add-on "${key}" is not on this server, and this server is set to ask nothing of adminium.dev. ${upload}`, 'refused');
    if (!(await getter.allowed(ctx.handle.by))) {
      return none(`The add-on "${key}" is not on this server, and the person you are working with may not add one. Someone who manages this server’s add-ons can install it in Studio → Add-ons. Say so, and build the rest meanwhile.`, 'refused');
    }
    const turnKey = `${ctx.session.id}:${String(ctx.turn)}:`;
    const before = addOnAnswers.get(turnKey + key) ?? (found.state === 'off' ? addOnAnswers.get(`${turnKey}*list`) : undefined);
    if (before !== undefined) {
      return none(
        before === 'no'
          ? `The person already said no to ${found.state === 'off' ? 'switching the list of adminium.dev on' : `"${key}"`} in this turn. Do not ask again: build without it, and say what is left out.`
          : `"${key}" was already asked for in this turn and could not be got. Do not ask again.`,
        'declined',
      );
    }
    const answer = await ctx.ask(
      found.state === 'off'
        ? { type: 'add-on', key, name: key, version: null, line: '', listOff: true }
        : { type: 'add-on', key, name: found.name, version: found.version, line: found.line.slice(0, 300), ...(found.state === 'here' ? { here: true as const } : {}) },
    );
    const yes = answer.type === 'add-on' && answer.accept;
    addOnAnswers.set(turnKey + key, yes ? 'yes' : 'no');
    if (found.state === 'off' && !yes) addOnAnswers.set(`${turnKey}*list`, 'no');
    if (!yes) return none(`The person said no to the add-on "${key}". Build without it, and say what is left out.`, 'declined');
    const result = await getter.get(key, ctx.handle.by, ctx.signal, { switchOn: found.state === 'off' });
    if (!result.ok) return none(`${result.why} Tell the person in their own words; build the rest meanwhile.`, 'failed');
    return { got: true, name: result.name, version: result.version, fresh: true };
  };

  const tools: DesignerTool[] = [
    {
      name: 'list_files',
      description: `List the files you may read and write: apps/${appKey}/ (this app), hooks/ and actions/. Give "dir" to list one folder.`,
      inputSchema: { type: 'object', properties: { dir: { type: 'string', description: `A folder, e.g. apps/${appKey}/manifest` } }, additionalProperties: false },
      running: () => 'Listing files',
      run: async (input) =>
        jailed('Listed files', () => {
          const dirs = str(input, 'dir') === null ? jail.roots : [jail.normalise(str(input, 'dir') as string)];
          const lines: string[] = [];
          for (const dir of dirs) {
            const absolute = jail.resolve(dir, 'list');
            if (!existsSync(absolute)) {
              lines.push(`${dir}/ (empty)`);
              continue;
            }
            const walk = (folder: string): void => {
              for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (lines.length >= MAX_LIST) return;
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
                // What a build left at the app's top is not read here, so it is not listed either.
                if (/^dist(-|$)/i.test(entry.name) && relative(deps.root, folder).split(sep).join('/') === `apps/${appKey}`) continue;
                const path = join(folder, entry.name);
                const shownPath = relative(deps.root, path).split(sep).join('/');
                if (entry.isDirectory()) walk(path);
                else if (entry.isFile()) lines.push(`${shownPath} (${String(statSync(path).size)} bytes)`);
              }
            };
            walk(absolute);
          }
          if (lines.length >= MAX_LIST) lines.push(`… more files: list one folder with "dir".`);
          return text(lines.length === 0 ? 'No files yet.' : lines.join('\n'), `Listed ${String(lines.length)} files`);
        }),
    },
    {
      name: 'read_file',
      description: 'Read a text file. Long files are cut; read the rest with "from" (a line number, from 1) and "lines".',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, from: { type: 'integer', minimum: 1 }, lines: { type: 'integer', minimum: 1 } },
        required: ['path'],
        additionalProperties: false,
      },
      running: (input) => `Reading ${shown(String(input['path'] ?? ''))}`,
      run: async (input) => {
        const path = str(input, 'path');
        if (path === null) return refused('Give the "path" of the file to read.', 'Read nothing');
        return jailed(`Could not read ${shown(path)}`, () => {
          const all = readFileSync(jail.resolve(path, 'read'), 'utf8');
          const from = int(input, 'from');
          const count = int(input, 'lines');
          let body = all;
          if (from !== null || count !== null) {
            const lines = all.split('\n');
            const start = Math.max(0, (from ?? 1) - 1);
            body = lines.slice(start, count === null ? undefined : start + count).join('\n');
          }
          if (Buffer.byteLength(body, 'utf8') > MAX_READ_BYTES) {
            const cut = Buffer.from(body, 'utf8').subarray(0, MAX_READ_BYTES).toString('utf8');
            const shownLines = cut.split('\n').length;
            body = `${cut}\n… cut here: the file goes on. Read from line ${String((from ?? 1) + shownLines - 1)} with "from".`;
          }
          return text(body, `Read ${shown(path)}`);
        });
      },
    },
    {
      name: 'write_file',
      description: 'Write a whole text file (made if it does not exist, replaced if it does).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
      running: (input) => `Writing ${shown(String(input['path'] ?? ''))}`,
      run: async (input, ctx) => {
        const path = str(input, 'path');
        const content = str(input, 'content');
        if (path === null || content === null) return refused('Give "path" and "content".', 'Wrote nothing');
        const notAllowed = buildFileRefusal(path) ?? (await serverCodeRefusal(path, ctx)) ?? (await buildCodeRefusal(path, ctx));
        if (notAllowed !== null) return notAllowed;
        return jailed(`Could not write ${shown(path)}`, () => {
          const normal = jail.normalise(path);
          if (addsBuildCommand(normal, content, appKey)) {
            return refused('An app’s own build command is set by a person, never written here. Leave "build" out of app.json.', `Refused ${shown(path)}`);
          }
          const unread = jsonProblem(normal, content);
          if (unread !== null) {
            const again = refusedJson.get(normal) === content;
            refusedJson.set(normal, content);
            return refused(
              `${again ? 'This is the same text as your last try, character for character, so it fails at the same place. Do not send it again: change it where the mark is. ' : ''}That is not valid JSON, and nothing was written: ${unread}. Send the whole file again, corrected.`,
              `Could not write ${shown(path)}`,
            );
          }
          refusedJson.delete(normal);
          const existed = existsSync(jail.resolve(path, 'write'));
          jail.write(path, content);
          return text(`${existed ? 'Replaced' : 'Made'} ${normal} (${String(Buffer.byteLength(content, 'utf8'))} bytes).`, `Wrote ${shown(path)}`);
        });
      },
    },
    {
      name: 'edit_file',
      description: 'Replace one exact piece of a text file with another. "old" must appear exactly once.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
        required: ['path', 'old', 'new'],
        additionalProperties: false,
      },
      running: (input) => `Editing ${shown(String(input['path'] ?? ''))}`,
      run: async (input, ctx) => {
        const path = str(input, 'path');
        const before = str(input, 'old');
        const after = str(input, 'new');
        if (path === null || before === null || after === null || before.length === 0) return refused('Give "path", a non-empty "old", and "new".', 'Edited nothing');
        const notAllowed = buildFileRefusal(path) ?? (await serverCodeRefusal(path, ctx)) ?? (await buildCodeRefusal(path, ctx));
        if (notAllowed !== null) return notAllowed;
        return jailed(`Could not edit ${shown(path)}`, () => {
          const current = readFileSync(jail.resolve(path, 'read'), 'utf8');
          let piece = before;
          let count = current.split(piece).length - 1;
          if (count === 0) {
            // A model rarely copies spaces and line ends exactly: the same words with other spacing are the same piece.
            const loose = looseMatches(current, before);
            if (loose.length === 1) piece = loose[0] as string;
            count = loose.length;
          }
          if (count !== 1) {
            // With the file in the answer, the next call can be right without a read in between.
            const now = current.length <= SHOWN_ON_MISS ? ` The file is now:\n${current}` : ' Read the file and copy the piece exactly.';
            return refused(
              count === 0 ? `"old" is not in ${path}.${now}` : `"old" is in ${path} ${String(count)} times. Give more of it, so it is there once.`,
              `Could not edit ${shown(path)}`,
            );
          }
          // A piece found by its words keeps the spacing it has in the file: what was not matched is not written twice.
          const fitted = piece === before ? after : after.trim();
          const next = current.replace(piece, () => fitted);
          const normal = jail.normalise(path);
          if (addsBuildCommand(normal, next, appKey)) {
            return refused('An app’s own build command is set by a person, never written here. Leave "build" out of app.json.', `Refused ${shown(path)}`);
          }
          const unread = jsonProblem(normal, next);
          if (unread !== null) {
            return refused(`With that change the file is not valid JSON, so it was left as it was: ${unread}. Mind the commas around what you add.`, `Could not edit ${shown(path)}`);
          }
          jail.write(path, next);
          return text(`Edited ${normal}.`, `Edited ${shown(path)}`);
        });
      },
    },
    {
      name: 'delete_file',
      description: 'Delete one file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      running: (input) => `Deleting ${shown(String(input['path'] ?? ''))}`,
      run: async (input, ctx) => {
        const path = str(input, 'path');
        if (path === null) return refused('Give the "path" to delete.', 'Deleted nothing');
        const notAllowed = buildFileRefusal(path) ?? (await serverCodeRefusal(path, ctx)) ?? (await buildCodeRefusal(path, ctx));
        if (notAllowed !== null) return notAllowed;
        return jailed(`Could not delete ${shown(path)}`, () => {
          jail.delete(path);
          return text(`Deleted ${jail.normalise(path)}.`, `Deleted ${shown(path)}`);
        });
      },
    },
    {
      name: 'check_app',
      description: 'Check the app as the engine will: the manifest put together and validated, the sides found. Fix every error before applying.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Checking the app',
      run: async () => {
        const check = checkApp(deps.root, appKey, { version: deps.version });
        const order = { error: 0, warn: 1, note: 2 } as Record<string, number>;
        const findings = [...check.findings].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
        const errors = findings.filter((finding) => finding.level === 'error').length;
        const lines = findings.slice(0, 40).map((finding) => `${finding.level} · ${finding.file}${finding.path === '' ? '' : ` · ${finding.path}`} · ${finding.message}`);
        if (findings.length > 40) lines.push(`… and ${String(findings.length - 40)} more.`);
        const head = errors === 0 ? 'No errors.' : `${String(errors)} error${errors === 1 ? '' : 's'}.`;
        // The same errors, check after check: the model is going round, and is told to stop.
        const said = errors === 0 ? '' : lines.filter((line) => line.startsWith('error')).join('\n');
        sameErrors = said !== '' && said === lastErrors ? sameErrors + 1 : 0;
        lastErrors = said;
        if (sameErrors >= 2) {
          lines.push(
            `These are the same errors as the last ${String(sameErrors)} checks: what you changed did not touch them. Do not check again yet. Read the file the error names, read the reference for that field, and write the whole file again; or ask the person.`,
          );
        }
        // What the screens ask of Adminium that it will refuse: said here, before a person meets it on the page.
        const calls = hasOwnBuild(deps.root, appKey) ? [] : sideCallLines(sideCallIssues(deps.root, appKey, check.manifest));
        if (calls.length > 0) lines.push('', 'The screens build, and these calls will be refused when a person uses the page. Fix them:', ...calls);
        return {
          content: [head, ...lines].join('\n'),
          label: errors === 0 ? 'Checked: no errors' : `Checked: ${String(errors)} error${errors === 1 ? '' : 's'}`,
          facts: { count: errors },
          ...(errors === 0 ? {} : { isError: true, detail: lines.slice(0, 5).join('\n') }),
        };
      },
    },
    {
      name: 'build_sides',
      description: 'Build the app’s screens (its staff and customer sides). Gives the first errors when they do not build.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Building the screens',
      run: async (_input, ctx) => {
        const project = findProject(deps.root, {});
        if (project === null) return refused('The project folder has no adminium.config file.', 'Could not build');
        // Stop ends a copied app's own build half-way, not only the turn after it.
        const built = await rebuildApps(project, { version: deps.version, dev: true, signal: ctx.signal });
        const app = built.apps.find((candidate) => candidate.key === appKey);
        const problems = app?.problems ?? (app === undefined ? ['The app was not found in the build.'] : []);
        if (problems.length > 0) {
          return { content: problems.slice(0, 20).join('\n'), label: 'Screens did not build', isError: true, detail: problems.slice(0, 3).join('\n') };
        }
        const sides = app?.sides ?? [];
        return text(sides.length === 0 ? 'The app has no screens of its own; nothing to build.' : `Built: ${sides.join(', ')}.`, sides.length === 0 ? 'No screens to build' : `Built ${sides.join(' and ')}`, {
          facts: { count: sides.length },
        });
      },
    },
    {
      name: 'apply_app',
      description: 'Check, build and apply the app to this server, as saving a file under `adminium dev` does. Tables are made, pages written. Says where it stopped when it cannot.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Applying the app',
      run: async (_input, ctx: ToolContext) => {
        const before = ctx.handle.events;
        let said = '';
        const watching = {
          ...ctx.handle,
          events: {
            ...before,
            emit: (turn: number, body: Parameters<typeof before.emit>[1]) => {
              if (body.kind === 'check' && !body.ok) said = `The check found errors:\n${body.findings.filter((f) => f.level === 'error').map((f) => `${f.file} · ${f.path} · ${f.message}`).join('\n')}`;
              if (body.kind === 'build' && !body.ok) said = `The screens did not build:\n${body.problems.join('\n')}`;
              if (body.kind === 'apply' && !body.ok) said = `It was not applied (${body.stage ?? body.state}): ${body.message ?? ''}`;
              return before.emit(turn, body);
            },
          },
        };
        const result = await deps.designer().pipeline(ctx.session, watching, { version: false });
        if (result.ok && (result.warnings ?? []).length > 0) {
          // Applied, and a page of it shows nothing: said as a failure, so it is fixed before the turn ends.
          const lines = (result.warnings ?? []).join('\n');
          const rules = [
            /page-board/.test(lines)
              ? 'A page-board needs a choice column (enum) of two to six values, at least two of them words Adminium knows as steps: todo, backlog, open, new, draft, in_progress, doing, review, blocked, on_hold, done, completed, closed, cancelled, archived, active, paused, shipped. Use those as the values and say your own words in rules.enumLabels ({"labels": {"in_progress": "Baking"}}).'
              : '',
            /page-calendar/.test(lines) ? 'A page-calendar needs a date or timestamptz column.' : '',
          ].filter((rule) => rule !== '');
          return {
            content: `Applied, but not all of it is as the files ask:\n${lines}\n${rules.join(' ')} Fix the page or its table (or make the page a "page-crud"), then apply again. Applying again without a change does not fix it.`,
            label: 'Applied, with a page that shows nothing',
            isError: true,
            detail: lines,
          };
        }
        return result.ok
          ? text('Applied. The app on this server is what the folder says.', 'Applied the app')
          : { content: said || 'It was not applied.', label: 'Not applied', isError: true, detail: said.split('\n').slice(0, 3).join('\n') };
      },
    },
    {
      name: 'run_tests',
      description: `Run the app’s own tests (node --test, files under apps/${appKey}/tests/). Gives the end of what they printed.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Running the app’s tests',
      run: async (_input, ctx) => {
        const folder = join(deps.root, APPS_DIR, appKey, 'tests');
        const files = existsSync(folder) ? readdirSync(folder).filter((name) => /\.test\.m?js$/.test(name)).sort() : [];
        if (files.length === 0) return text(`This app has no tests (files named *.test.mjs under apps/${appKey}/tests/).`, 'No tests to run');
        // The tests are code the model wrote, and they run as the person: nothing runs without a yes, asked once a turn.
        if (!testsAllowed) {
          const answer = await ctx.ask({
            type: 'question',
            question: `Run this app’s tests? They are code the Designer wrote (apps/${appKey}/tests/), and they run on this machine with your access.`,
            choices: [RUN_THEM, 'Do not run them'],
          });
          if (answer.type !== 'question' || answer.text !== RUN_THEM) return text('The person said not to run the tests. Go on without them.', 'Tests not run');
          testsAllowed = true;
        }
        const result = await runChild(process.execPath, ['--test', ...files.map((name) => `apps/${appKey}/tests/${name}`)], {
          cwd: deps.root,
          timeoutMs: TESTS_TIMEOUT_MS,
          signal: ctx.signal,
          // The starter's own test calls `adminium app check` through the CLI; check_app is that check, run here.
          env: { ...process.env, ADMINIUM_SKIP_CLI: '1' },
        });
        const tail = result.output.split('\n').slice(-200).join('\n');
        if (result.timedOut) return refused(`The tests ran longer than ${String(TESTS_TIMEOUT_MS / 1000)} s and were stopped.\n${tail}`, 'Tests took too long');
        return result.code === 0 ? text(tail, 'Tests passed') : { content: tail, label: 'Tests failed', isError: true, detail: tail.split('\n').slice(-5).join('\n') };
      },
    },
    {
      name: 'read_reference',
      description: 'Read one file of the skills by its name, as INDEX.md lists it: e.g. "adminium-app/references/manifest/overview.md". Start from a skill’s references/INDEX.md.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
      running: (input) => `Reading ${String(input['name'] ?? '')}`,
      run: async (input) => {
        const name = (str(input, 'name') ?? '').replace(/^skills\//, '').replace(/^references\//, '');
        const found = deps.skills.read(name);
        if (found === null) {
          // A guessed name: answer with the index of the folder it guessed in, so the next call is right.
          const index = nearestIndex(deps.skills, name);
          return {
            ...refused(
              `There is no skill file "${name}".${index === null ? ' Read a skill’s references/INDEX.md for the names.' : ` The files there are listed below; give read_reference one of these names, with "${index.skill}/" in front.\n\n${index.text}`}`,
              'No such reference',
            ),
            miss: true,
          };
        }
        return text(found, `Read ${name}`);
      },
    },
    {
      name: 'list_add_ons',
      description: 'The add-ons this server has, or can get: key, name, version and what each does. An app names the ones it needs in its manifest.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Looking at the add-ons',
      run: async () => {
        const all = await deps.listAddOns();
        if (all.length === 0) {
          return text(
            'This server has no add-ons, and its list of adminium.dev is off, so what is on offer is not known here. If the app needs one (invoices, quotes, receipts: key "invoices"), call get_add_on with its key: the person is asked, and a yes switches the list on and gets it.',
            'No add-ons here',
          );
        }
        return text(
          all
            .map(
              (addOn) =>
                `${addOn.key} ${addOn.version} (${addOn.state === 'listed' ? 'not on this server: get_add_on brings it' : addOn.state}) — ${addOn.name}: ${addOn.line}${(addOn.shapes ?? []).length === 0 ? '' : ` Shapes to build tables on with build_on_shape: ${(addOn.shapes ?? []).join(', ')}.`}`,
            )
            .join('\n'),
          `Found ${String(all.length)} add-ons`,
        );
      },
    },
    {
      name: 'get_add_on',
      description:
        'Get an add-on this server does not have yet, by its key (as list_add_ons gives it). The person is asked first; a yes downloads and installs it, and then build_on_shape can build on it. Only for an add-on the app needs.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'The add-on’s key, e.g. invoices' } }, required: ['key'], additionalProperties: false },
      running: (input) => `Asking to get ${String(input['key'] ?? 'an add-on').slice(0, 80)}`,
      run: async (input, ctx) => {
        const key = str(input, 'key') ?? '';
        const got = await offerAddOn(key, ctx);
        if (!got.got) return got.outcome;
        if (!got.fresh) return text(`${got.name} ${got.version} is already installed here. Build on it with build_on_shape.`, `${got.name} is already here`, { facts: { outcome: 'added' } });
        const shapes = (await deps.listAddOns()).find((addOn) => addOn.key === key)?.shapes ?? [];
        return text(
          `${got.name} ${got.version} is installed.${shapes.length === 0 ? '' : ` Its shapes, for build_on_shape: ${shapes.join(', ')}.`}`,
          `Got ${got.name}`,
          { facts: { outcome: 'added' } },
        );
      },
    },
    {
      name: 'add_side',
      description:
        'Give the app screens of its own for one side: "staff" (people who sign in) or "customer" (public, nobody signed in). Writes a working starter screen (src/main.tsx, src/App.tsx, and its look: src/app.css, src/theme.css) and declares the side in app.json. The first time, the person is asked how it should look unless they already said. The starter screen lists and adds rows of tables named "items" and "requests": rewrite src/App.tsx for this app’s own tables, keeping the way it loads, lists, sends and reports errors. A customer screen reaches only what manifest/access.json grants: write that file too.',
      inputSchema: { type: 'object', properties: { side: { type: 'string', enum: ['staff', 'customer'] } }, required: ['side'], additionalProperties: false },
      running: (input) => `Adding the ${String(input['side'] ?? '')} side`,
      run: async (input, ctx) => {
        const side = str(input, 'side');
        if (side !== 'staff' && side !== 'customer') return refused('Give "side": "staff" or "customer".', 'Added no side');
        if (hasOwnBuild(deps.root, appKey)) return refused(`This app keeps its screens in apps/${appKey}/src/ and builds them itself: edit them there.`, 'Added no side');
        let written: string[];
        try {
          // Through the jail's own door, so the folder is one the Designer may write.
          jail.resolve(`apps/${appKey}/${side}/src/App.tsx`, 'write');
          // The app's own name, as app.json has it: a key loses what a name had ("Bakery's").
          let name = nameFromKey(appKey);
          try {
            const app = JSON.parse(readFileSync(jail.resolve(`apps/${appKey}/manifest/app.json`, 'read'), 'utf8')) as { name?: unknown };
            if (typeof app.name === 'string' && app.name.trim() !== '') name = app.name;
          } catch {
            // The key's words will do.
          }
          written = addSide({ root: deps.root, key: appKey, name, side });
        } catch (error) {
          if (error instanceof JailError || error instanceof Error) return refused(error.message, `Could not add the ${side} side`);
          throw error;
        }
        // The look, once for the app: asked here, where the first screen people see is made.
        const { look, how } = await chooseLook(ctx);
        // What the screens need and the project lacks: one card for all of it.
        const missing = missingScreenPackages(deps.root, side, deps.version);
        let packages = '';
        if (missing.length > 0) {
          const [first, ...rest] = missing as [{ name: string; version: string }, ...{ name: string; version: string }[]];
          const answer = await ctx.ask({ type: 'package', name: first.name, version: first.version, why: 'The app’s own screens are built with these.', ...(rest.length === 0 ? {} : { also: rest }) });
          if (answer.type === 'package' && answer.accept) {
            const failed = await installPackages(missing, ctx.signal);
            packages = failed === null ? `\nAdded to the project: ${missing.map((spec) => spec.name).join(', ')}.` : `\nThe packages the screens need could not be added:\n${failed}`;
          } else {
            packages = `\nThe person said no to ${missing.map((spec) => spec.name).join(', ')}: the screens cannot be built without them. Say so, and build what needs no screen.`;
          }
        }
        if (written.length === 0) return text(`The ${side} side is already there: edit apps/${appKey}/${side}/src/App.tsx.\n${lookLine(look, how)}${packages}`, `The ${side} side is there`);
        return text(
          `Written:\n${written.map((file) => `- ${file}`).join('\n')}\nThe side is declared in app.json${side === 'staff' ? ', and each role may open it (app:@:staff)' : ''}. Now read apps/${appKey}/${side}/src/App.tsx and write it again for this app’s tables${side === 'customer' ? ', and write manifest/access.json with what customers may read and add' : ''}, keeping its parts and its shape. Then build_sides. You need not read app.css or theme.css.\n\n${lookLine(look, how)}\n\n${LOOK_PARTS}${packages}`,
          `Added the ${side} side`,
        );
      },
    },
    {
      name: 'set_look',
      description:
        'Change the look of the app’s own screens to one of four directions: "clean", "warm", "bold" or "calm", with an optional accent colour (#rrggbb). Writes src/theme.css on each side. Use it when the person asks for a different look; for a finer change, edit values in theme.css.',
      inputSchema: {
        type: 'object',
        properties: { direction: { type: 'string', enum: [...LOOK_DIRECTIONS] }, accent: { type: 'string', description: 'A colour as #rrggbb, in place of the direction’s own' } },
        required: ['direction'],
        additionalProperties: false,
      },
      running: () => 'Changing the look',
      run: async (input) => {
        const direction = str(input, 'direction');
        if (!isDirection(direction)) return refused(`Give "direction": one of ${LOOK_DIRECTIONS.join(', ')}.`, 'Look not changed');
        if (hasOwnBuild(deps.root, appKey)) return refused('This app is a copy of a published one and keeps its own styles in src/: change them there.', 'Look not changed');
        if (sidesWithScreens(deps.root, appKey).length === 0) return refused('The app has no screens of its own yet: call add_side first.', 'Look not changed');
        const accent = str(input, 'accent');
        if (accent !== null && !/^#[0-9a-f]{6}$/i.test(accent)) return refused('Give "accent" as #rrggbb, or leave it out.', 'Look not changed');
        const look = cleanLook({ direction, accent: accent ?? undefined, words: readLook(deps.root, appKey)?.words });
        applyLook(deps.root, appKey, look);
        return text(`The look is now "${direction}". ${DIRECTIONS[direction].line} theme.css was written on each side; build_sides shows it.`, `Changed the look to ${direction}`, { facts: { look: direction } });
      },
    },
    {
      name: 'build_on_shape',
      description:
        'Write the tables an app builds on an add-on’s shape (e.g. add_on "invoices", shape "invoice@1"): every part’s table with its exact columns, rules and states, the tables of other shapes it points at, the outbox table and emails.json when the shape sends email, and add-ons.json. Never write these by hand: the install refuses any difference. When the shape sends email, first write the app’s own table of people (with an email column) and give it as "recipient". Afterwards add your own columns, the pages and the role’s grants.',
      inputSchema: {
        type: 'object',
        properties: {
          add_on: { type: 'string', description: 'The add-on’s key, as list_add_ons gives it.' },
          shape: { type: 'string', description: 'The shape and its version: invoice@1' },
          recipient: {
            type: 'object',
            description: 'Who the shape’s emails go to: a table of this app, its email column, and its name column.',
            properties: { table: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
            required: ['table', 'email'],
            additionalProperties: false,
          },
          tables: { type: 'object', description: 'Optional table names by part, e.g. {"invoice@1/payments": "payments"}. The rest are named for you.', additionalProperties: { type: 'string' } },
          outbox_table: { type: 'string', description: 'The name of the table the emails are kept in, when "messages" is taken.' },
        },
        required: ['add_on', 'shape'],
        additionalProperties: false,
      },
      running: (input) => `Building on ${String(input['shape'] ?? 'a shape')}`,
      run: async (input, ctx) => {
        const addOn = str(input, 'add_on');
        const shape = str(input, 'shape');
        if (addOn === null || shape === null) return refused('Give "add_on" and "shape".', 'Built on nothing');
        let document = (await deps.readAddOn?.(addOn)) ?? null;
        if (document === null) {
          // Not on this server: the person is asked for it here, so the model need not know to ask first.
          const got = await offerAddOn(addOn, ctx);
          if (!got.got) return { ...got.outcome, label: `Could not build on ${shape}` };
          document = (await deps.readAddOn?.(addOn)) ?? null;
          if (document === null) return refused(`The add-on "${addOn}" was installed and its shapes do not read. Tell the person, and build the rest meanwhile.`, `Could not build on ${shape}`);
        }
        const given = input['recipient'] as Record<string, unknown> | undefined;
        const recipient =
          given !== undefined && typeof given === 'object' && typeof given['table'] === 'string' && typeof given['email'] === 'string'
            ? { table: given['table'], email: given['email'], ...(typeof given['name'] === 'string' ? { name: given['name'] } : {}) }
            : undefined;
        const names = input['tables'];
        const tablesGiven = names !== null && typeof names === 'object' && !Array.isArray(names) ? Object.fromEntries(Object.entries(names).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined;
        const made = shapeParts({ appKey, addOn, document, shape, recipient, tables: tablesGiven, outboxTable: str(input, 'outbox_table') ?? undefined });
        if (!made.ok) return refused(made.problem, `Could not build on ${shape}`);
        return jailed(`Could not build on ${shape}`, () => {
          const base = `apps/${appKey}/manifest`;
          const read = (file: string): string | null => {
            // Resolved as a write is: a file that is not there yet is no error here.
            const absolute = jail.resolve(`${base}/${file}`, 'write');
            return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
          };
          if (recipient !== undefined && read(`tables/${recipient.table}.json`) === null) {
            return refused(`There is no table "${recipient.table}" yet. Write ${base}/tables/${recipient.table}.json first, with an "${recipient.email}" column, then call this again.`, `Could not build on ${shape}`);
          }
          // What the app already requires is read before anything is written: a file that does not read stops it here.
          let had: { requires?: { key?: string }[] } = {};
          const requiresNow = read('add-ons.json');
          if (requiresNow !== null) {
            try {
              const parsed = JSON.parse(requiresNow) as unknown;
              if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('it is not an object');
              had = parsed as typeof had;
              if (had.requires !== undefined && !Array.isArray(had.requires)) throw new Error('"requires" is not a list');
            } catch (error) {
              return refused(`${base}/add-ons.json does not read (${error instanceof Error ? error.message : String(error)}). Write it again as {"requires": []}, then call this again.`, `Could not build on ${shape}`);
            }
          }
          // Nothing the app already has is replaced: a table it wrote, or emails of its own.
          const taken = Object.keys(made.files).filter((file) => file !== 'add-ons.json' && read(file) !== null);
          if (taken.length > 0) {
            return refused(
              `These files are already there and were left alone: ${taken.map((file) => `${base}/${file}`).join(', ')}. Delete them first if they should be made again, or name other tables in "tables" (and the emails' table in "outbox_table").`,
              `Could not build on ${shape}`,
            );
          }
          for (const [file, value] of Object.entries(made.files)) {
            if (file === 'add-ons.json') {
              // Added to what the app already requires, never in its place.
              const requires = [...(had.requires ?? []).filter((entry) => entry.key !== made.addOn.key), ...((value as { requires: { key: string }[] }).requires ?? [])];
              jail.write(`${base}/${file}`, `${JSON.stringify({ ...had, requires }, null, 2)}\n`);
            } else {
              jail.write(`${base}/${file}`, `${JSON.stringify(value, null, 2)}\n`);
            }
          }
          const lines = made.tables.map((table) => `- ${base}/tables/${table.ref}.json: built on ${table.builtOn}, part ${table.part} (${String(table.columns)} columns)`);
          if (made.outbox !== null) {
            lines.push(`- ${base}/tables/${made.outbox.table}.json: the outbox, where each message is a row`);
            lines.push(`- ${base}/emails.json: sends ${made.outbox.kinds.join(', ')}. The words are plain: reword the templates for this app.`);
          }
          lines.push(`- ${base}/add-ons.json: requires ${made.addOn.key} ${made.addOn.range}`);
          return text(
            `Written:\n${lines.join('\n')}\nLeft to you: a page for each table people work with, the role’s table and page grants for them, and any column of your own (add it to the table’s file; never change a column that is already there).`,
            `Built on ${shape}`,
            { facts: { count: made.tables.length } },
          );
        });
      },
    },
    {
      name: 'ask_person',
      description: 'Ask the person a question, only when the answer changes what you build. Give "choices" when there are a few clear ones.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' }, maxItems: 6 } },
        required: ['question'],
        additionalProperties: false,
      },
      running: () => 'Asking you',
      run: async (input, ctx) => {
        const question = (str(input, 'question') ?? '').trim();
        if (question.length === 0 || question.length > 500) return refused('Ask a question of 1 to 500 characters.', 'Asked nothing');
        const choices = Array.isArray(input['choices']) ? (input['choices'] as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim() !== '').slice(0, 6) : [];
        const answer = await ctx.ask({ type: 'question', question, choices });
        return text(answer.type === 'question' ? `The person answered: ${answer.text}` : 'No answer.', 'You answered');
      },
    },
    {
      name: 'request_package',
      description: 'Ask the person to add an npm package to the project (an exact version). Nothing is installed unless they say yes; install scripts never run.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, version: { type: 'string', description: 'An exact version, e.g. 4.17.21' }, why: { type: 'string' } },
        required: ['name', 'version', 'why'],
        additionalProperties: false,
      },
      running: (input) => `Asking to add ${String(input['name'] ?? '')}`,
      run: async (input, ctx) => {
        const name = str(input, 'name') ?? '';
        const version = knownPackageVersion(name, deps.version) ?? str(input, 'version') ?? '';
        const why = (str(input, 'why') ?? '').slice(0, 300);
        if (!PACKAGE_NAME.test(name) || name.length > 214) return { ...refused(`"${name}" is not an npm package name.`, 'No package added'), facts: { outcome: 'refused' } };
        if (!EXACT_VERSION.test(version)) {
          return { ...refused(`"${version}" is not an exact version. Give one like 1.2.3, not a range or a tag.`, 'No package added'), facts: { outcome: 'refused' } };
        }
        // Already there (a project made by `design` starts with what screens need): nothing to ask.
        try {
          const listed = JSON.parse(readFileSync(join(deps.root, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
          if (listed.dependencies?.[name] !== undefined || listed.devDependencies?.[name] !== undefined) {
            return text(`${name} is already in the project: import it. If the build could not find it, the fault is elsewhere: read the build's own words.`, `${name} is already there`, { facts: { outcome: 'added' } });
          }
        } catch {
          // No package.json to read: ask, and let the install say what is wrong.
        }
        const answer = await ctx.ask({ type: 'package', name, version, why });
        if (answer.type !== 'package' || !answer.accept) return text(`The person said no to ${name}@${version}. Do without it.`, `Did without ${name}`, { facts: { outcome: 'declined' } });
        const failed = await installPackages([{ name, version }], ctx.signal);
        if (failed !== null) return { ...refused(failed, `Could not add ${name}`), facts: { outcome: 'failed' } };
        return text(`Added ${name}@${version} to the project.`, `Added ${name}@${version}`, { facts: { outcome: 'added' } });
      },
    },
  ];
  return tools;
}

/** The names of the tools, in the order the model is told them. */
export const DESIGNER_TOOL_NAMES = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'check_app',
  'build_sides',
  'apply_app',
  'run_tests',
  'read_reference',
  'list_add_ons',
  'get_add_on',
  'add_side',
  'set_look',
  'build_on_shape',
  'ask_person',
  'request_package',
] as const;
