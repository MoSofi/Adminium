// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing a new app into a project: `apps/<key>/`.
 *
 * The starter is small on purpose. Two tables, a dashboard page for each, one
 * role, six sample rows — and, when asked for, a staff side and a customer side that
 * each do one real thing with that table. Every file is something a person or
 * a coding agent then edits; nothing here is generated again later.
 *
 * The manifest parts are built here, as data, so they are valid by
 * construction and stay in step with the version that writes them. The
 * screens' source is copied from `templates/app/`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_PUBLISHER_ID, RESERVED_KEYS } from '@adminium/manifest';

import { CliError } from '../../cli/exit.js';
import { APP_KEY_PATTERN, APPS_DIR, appDir, appPath, type AppSide } from './read-app.js';

/** React, for the app's own screens. Its types follow the project's existing `@types/react`. */
export const REACT_RANGE = '^19.2.0';
export const PUBLIC_CLIENT_PACKAGE = '@adminiumjs/public-client';

export function appTemplateDir(moduleUrl: string = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..', 'templates', 'app');
}

export interface ScaffoldAppOptions {
  root: string;
  key: string;
  /** The app's name as people read it. */
  name: string;
  sides: readonly AppSide[];
  /** The Adminium writing it: the oldest version the app says it runs on. */
  version: string;
  templates?: string;
  /**
   * Only what every app has: `app.json` and a role that may do nothing yet.
   * No sample table, page or data. The Designer starts an app this way: a
   * model asked for a bike shop would spend its first steps deleting `items`.
   */
  bare?: boolean;
}

/** Why a key cannot be an app's, or null. */
export function appKeyProblem(key: string): string | null {
  if (!APP_KEY_PATTERN.test(key)) return 'use lowercase letters, digits and "-", starting with a letter, 2 to 80 characters';
  if ((RESERVED_KEYS as readonly string[]).includes(key) || key === 'help') return 'that word is reserved';
  return null;
}

/** `repair-desk` → `Repair desk`. */
export function nameFromKey(key: string): string {
  const words = key.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The manifest's parts, as the files' contents. */
export function starterParts(opts: Pick<ScaffoldAppOptions, 'key' | 'name' | 'sides' | 'version'>): Record<string, unknown> {
  const { key, name, sides } = opts;
  const parts: Record<string, unknown> = {
    'manifest/app.json': {
      manifestVersion: 1,
      key,
      name,
      version: '0.1.0',
      // An app made on the install it runs on. It installs from a file, never from a catalogue.
      publisher: { id: LOCAL_PUBLISHER_ID, name: 'Local' },
      license: 'UNLICENSED',
      description: { key: `${key}.description`, fallback: `${name}, made with Adminium.` },
      categories: ['operations'],
      compatibility: { minAdminiumVersion: opts.version },
      // One entry per side with code in this folder. With none, the app is its tables and pages alone.
      frontends: sides.length === 0 ? [{ side: 'staff', kind: 'none' }] : sides.map((side) => ({ side, kind: 'spa' })),
      navGroups: [{ key: 'main', label: { 'en-US': name }, order: 1 }],
      // Its tables are named `<key>_<table>` in the database, so they cannot collide with another app's.
      prefixed: true,
    },
    'manifest/tables/items.json': {
      ref: 'items',
      label: { 'en-US': 'Item' },
      labelPlural: { 'en-US': 'Items' },
      keyField: 'title',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'title', type: 'text', maxLength: 120, default: 'Untitled', label: { 'en-US': 'Title' } },
        { ref: 'status', type: 'enum', enum: ['open', 'done'], default: 'open', label: { 'en-US': 'Status' } },
        { ref: 'notes', type: 'text', maxLength: 1000, nullable: true, label: { 'en-US': 'Notes' } },
        { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
      ],
    },
    // A page's ref is its address in the dashboard, shared by every app: start it with the app's key.
    [`manifest/pages/${key}-items.json`]: {
      ref: `${key}-items`,
      template: 'page-crud',
      title: { key: `${key}.items`, fallback: 'Items' },
      nav: { group: 'main', icon: 'list-checks', order: 1 },
      bindings: { rows: 'items' },
    },
    // What customers send in. Kept apart from `items` on purpose: a table anyone may add to
    // is never also one anyone may read, or every request would be readable by guessing ids.
    'manifest/tables/requests.json': {
      ref: 'requests',
      label: { 'en-US': 'Request' },
      labelPlural: { 'en-US': 'Requests' },
      keyField: 'message',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'message', type: 'text', maxLength: 500, default: '', label: { 'en-US': 'Message' } },
        { ref: 'handled', type: 'bool', default: false, label: { 'en-US': 'Handled' } },
        { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
      ],
    },
    [`manifest/pages/${key}-requests.json`]: {
      ref: `${key}-requests`,
      template: 'page-crud',
      title: { key: `${key}.requests`, fallback: 'Requests' },
      nav: { group: 'main', icon: 'inbox', order: 2 },
      bindings: { rows: 'requests' },
    },
    'manifest/roles.json': [
      {
        // Installed as `<app key>-staff`: the app's key is put in front of a role's own.
        key: 'staff',
        name: `${name} staff`,
        permissions: [
          ...(sides.includes('staff') ? ['app:@:staff'] : []),
          'table:@items:read',
          'table:@items:create',
          'table:@items:update',
          'table:@requests:read',
          'table:@requests:update',
          // A page is in a person's sidebar only with its own grant.
          `page:@${key}-items:view`,
          `page:@${key}-requests:view`,
        ],
      },
    ],
    'manifest/sample.json': { sampleData: { file: 'seeds/sample.json' } },
    'seeds/sample.json': {
      format: 'adminium.sample/1',
      app: key,
      tables: [
        {
          ref: 'items',
          rows: [
            { title: 'Welcome to your app', status: 'open', notes: 'This row is sample data. Remove it from the app’s settings page.' },
            { title: 'Edit manifest/tables/items.json to change this table', status: 'open' },
            { title: 'Add a table: one more file in manifest/tables/', status: 'open' },
            { title: 'Add a page: one more file in manifest/pages/', status: 'open' },
            { title: 'Run the check after every change', status: 'done' },
            { title: 'Pack it and install it by upload', status: 'done' },
          ],
        },
      ],
    },
  };
  if (sides.includes('customer')) {
    // The ONLY thing the customer side can reach. A table not listed here is out of its reach.
    parts['manifest/access.json'] = {
      publicAccess: [
        // Anyone may read the list: three columns of it, and nothing else.
        { table: 'items', methods: ['GET'], select: ['id', 'title', 'status'] },
        // Anyone may send a request, and gets back only the row they just made.
        { table: 'requests', methods: ['POST'], select: ['id'], writable: ['message'] },
      ],
    };
  }
  return parts;
}

/** The parts of an app with nothing in it yet: the starter's `app.json`, and its role with no grants. */
export function bareParts(opts: Pick<ScaffoldAppOptions, 'key' | 'name' | 'sides' | 'version'>): Record<string, unknown> {
  const starter = starterParts(opts);
  return {
    'manifest/app.json': starter['manifest/app.json'],
    'manifest/roles.json': [{ key: 'staff', name: `${opts.name} staff`, permissions: [] }],
  };
}

function readme(opts: Pick<ScaffoldAppOptions, 'key' | 'name' | 'sides'>): string {
  const { key, name, sides } = opts;
  const run = (command: string): string => `npx @adminiumjs/adminium app ${command} ${key}`;
  return [
    `# ${name}`,
    '',
    `An app made with [Adminium](https://adminium.dev), in this project's \`${APPS_DIR}/${key}/\` folder.`,
    '',
    '## Files',
    '',
    '| File | What it is |',
    '|---|---|',
    '| `manifest/app.json` | The app: key, name, version, publisher, which sides it has |',
    '| `manifest/tables/*.json` | One file per table. The file is named after the table\'s `ref` |',
    '| `manifest/pages/*.json` | One file per dashboard page |',
    '| `manifest/roles.json` | The roles the app adds, and what each may do |',
    ...(sides.includes('customer') ? ['| `manifest/access.json` | What the customer side may read and write. Nothing else is in its reach |'] : []),
    '| `manifest/sample.json`, `seeds/sample.json` | Sample data: `adminium dev` adds it once; an install from a file adds it only when asked |',
    ...(sides.includes('staff') ? ['| `staff/src/` | The staff screens: a React app that reads and writes as the signed-in person |'] : []),
    ...(sides.includes('customer') ? ['| `customer/src/` | The customer screens: a public React app that uses the public API |'] : []),
    '| `tests/app.test.mjs` | Checks that need only Node: `node --test ' + `${APPS_DIR}/${key}/tests/app.test.mjs` + '` |',
    '',
    '## Commands',
    '',
    '| Command | What it does |',
    '|---|---|',
    `| \`${run('check')}\` | Validates the manifest as an install would, and lists what the customer side may reach |`,
    ...(sides.length > 0 ? [`| \`${run('build')}\` | Builds the screens into \`.adminium/build/apps/${key}/\` |`] : []),
    `| \`${run('try')}\` | Packs the app and installs it on a throwaway Adminium, to prove it installs and serves |`,
    `| \`${run('pack')}\` | Makes the \`.tgz\` and its fingerprint, to install from Studio → Hosted apps → Install an app |`,
    '',
    'Docs: https://docs.adminium.dev/projects/apps/',
    '',
  ].join('\n');
}

/** Every template file under `dir`, relative to it with `/`. */
function templateFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...templateFiles(join(dir, entry.name), path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

/** Write the starter into `apps/<key>/`. Returns the files created, relative to the project. */
export function scaffoldApp(opts: ScaffoldAppOptions): string[] {
  const templates = opts.templates ?? appTemplateDir();
  if (!existsSync(templates)) throw new CliError(`The app template is missing from this Adminium install (${templates}).`);
  const dir = appDir(opts.root, opts.key);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new CliError(`${appPath(opts.key)} already exists and is not empty.`, { hint: 'Choose another key, or remove that folder first.' });
  }

  const created: string[] = [];
  const write = (file: string, text: string): void => {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    created.push(appPath(opts.key, file));
  };
  const fill = (text: string): string => text.split('__KEY__').join(opts.key).split('__NAME__').join(opts.name);

  for (const [file, value] of Object.entries(opts.bare === true ? bareParts(opts) : starterParts(opts))) write(file, `${JSON.stringify(value, null, 2)}\n`);
  for (const file of templateFiles(templates)) {
    const [top] = file.split('/');
    if ((top === 'staff' || top === 'customer') && !opts.sides.includes(top)) continue;
    // Source templates end in `.tmpl`: they are the person's code once written, not this package's.
    write(file.replace(/\.tmpl$/, ''), fill(readFileSync(join(templates, file), 'utf8')));
  }
  write('README.md', readme(opts));
  return created.sort();
}

/**
 * Give an app that has none the starter's screens for one side: the files
 * under `staff/` or `customer/`, and the side declared in `app.json`. The
 * screens are the starter's own (a working list and a form over tables named
 * `items` and `requests`): a pattern to rewrite for the app's tables. Returns
 * the files written, relative to the project; none when the side is there.
 */
export function addSide(opts: { root: string; key: string; name: string; side: AppSide; templates?: string }): string[] {
  const templates = opts.templates ?? appTemplateDir();
  const dir = appDir(opts.root, opts.key);
  // Read first: an app whose manifest is one file, or does not read, is told so before anything is written.
  const manifestFile = join(dir, 'manifest', 'app.json');
  if (!existsSync(manifestFile)) throw new CliError(`${appPath(opts.key, 'manifest', 'app.json')} is not there: a side is added to an app whose manifest is written as part files.`);
  let app: { frontends?: { side: string; kind: string }[] };
  try {
    app = JSON.parse(readFileSync(manifestFile, 'utf8')) as typeof app;
  } catch (error) {
    throw new CliError(`${appPath(opts.key, 'manifest', 'app.json')} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const created: string[] = [];
  if (!existsSync(join(dir, opts.side, 'src'))) {
    const fill = (text: string): string => text.split('__KEY__').join(opts.key).split('__NAME__').join(opts.name);
    for (const file of templateFiles(join(templates, opts.side))) {
      const target = join(dir, opts.side, file.replace(/\.tmpl$/, ''));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, fill(readFileSync(join(templates, opts.side, file), 'utf8')));
      created.push(appPath(opts.key, opts.side, file.replace(/\.tmpl$/, '')));
    }
    // The staff starter reads the app's sample rows for its demo: an app with none gets an empty file to read.
    const sample = join(dir, 'seeds', 'sample.json');
    if (opts.side === 'staff' && !existsSync(sample)) {
      mkdirSync(dirname(sample), { recursive: true });
      writeFileSync(sample, `${JSON.stringify({ format: 'adminium.sample/1', app: opts.key, tables: [] }, null, 2)}\n`);
      created.push(appPath(opts.key, 'seeds', 'sample.json'));
    }
  }
  // The side, declared: in place of "no side" for it, beside any other. Also for screens written by hand.
  if (!(app.frontends ?? []).some((entry) => entry.side === opts.side && entry.kind !== 'none')) {
    const others = (app.frontends ?? []).filter((entry) => entry.side !== opts.side && entry.kind !== 'none');
    app.frontends = [...others, { side: opts.side, kind: 'spa' }];
    writeFileSync(manifestFile, `${JSON.stringify(app, null, 2)}\n`);
    created.push(appPath(opts.key, 'manifest', 'app.json'));
  }
  // A role opens the staff screens only with `app:@:staff`: every role the app brings gets it.
  const rolesFile = join(dir, 'manifest', 'roles.json');
  if (opts.side === 'staff' && existsSync(rolesFile)) {
    try {
      const roles = JSON.parse(readFileSync(rolesFile, 'utf8')) as { permissions?: string[] }[];
      if (Array.isArray(roles) && roles.some((role) => !(role.permissions ?? []).includes('app:@:staff'))) {
        for (const role of roles) role.permissions = [...new Set(['app:@:staff', ...(role.permissions ?? [])])];
        writeFileSync(rolesFile, `${JSON.stringify(roles, null, 2)}\n`);
        created.push(appPath(opts.key, 'manifest', 'roles.json'));
      }
    } catch {
      // A roles file that does not read is the check's to report.
    }
  }
  return created.sort();
}

type Json = Record<string, unknown>;
const stringRecord = (value: unknown): Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, string>) } : {};

/**
 * What an app with screens needs in the project's `package.json`, added and
 * never changed: React, and the public client for a customer side. Returns
 * the names added.
 */
export function addSideDependencies(root: string, sides: readonly AppSide[], publicClientSpec: string): string[] {
  if (sides.length === 0) return [];
  const file = join(root, 'package.json');
  if (!existsSync(file)) return [];
  let json: Json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8')) as Json;
  } catch (error) {
    throw new CliError(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const dependencies = stringRecord(json['dependencies']);
  const devDependencies = stringRecord(json['devDependencies']);
  const added: string[] = [];
  const want = (name: string, spec: string, dev = false): void => {
    if (dependencies[name] !== undefined || devDependencies[name] !== undefined) return;
    (dev ? devDependencies : dependencies)[name] = spec;
    added.push(name);
  };
  want('react', REACT_RANGE);
  want('react-dom', REACT_RANGE);
  if (sides.includes('customer')) want(PUBLIC_CLIENT_PACKAGE, publicClientSpec);
  want('@types/react-dom', REACT_RANGE, true);
  if (added.length === 0) return [];
  json['dependencies'] = dependencies;
  json['devDependencies'] = devDependencies;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return added;
}
