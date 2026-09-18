// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium check` — check a project without starting anything, for CI.
 *
 * It builds the config when the build is out of date (esbuild permitting),
 * validates the settings the server would boot with, parses every database
 * URL, and compares the Dockerfile's image tag with the version package.json
 * installs. It also checks every page and schema file with no database:
 * their shape, the database keys they name, and that no id from one install
 * slipped into them; a rule that names an option list the project does not
 * carry is an error, because it would enforce nothing there. Built hooks and
 * actions are loaded and checked the same way the server loads them. Pages and widgets are built (which reads their
 * settings), and every page file that names a project widget must name one
 * of the right kind. Problems exit with 2; things that only matter at start
 * time, such as a secret CI does not have, are warnings.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isBuiltinOptionList } from '@adminium/engine/config';

import { parseDsn } from '../../connections/dsn.js';
import { variableSources } from '../../project/boot.js';
import { buildDir, loadProjectConfig, readBuildManifest } from '../../project/build.js';
import { EMPTY_CLIENT_BUILD, WIDGET_ID_PREFIX, type ClientBuild } from '../../project/client-build.js';
import { loadProjectCode } from '../../project/code/load.js';
import {
  configuredDatabases,
  projectEnvironment,
  withDefaults,
  type ProjectConfig,
} from '../../project/config.js';
import { projectDsn } from '../../project/databases.js';
import { loadDotEnv } from '../../project/dotenv.js';
import { diskFileStore } from '../../project/file-store.js';
import { offlineRefs, readProjectFiles, type FolderFile } from '../../project/project-files.js';
import { configFileName, findProject } from '../../project/locate.js';
import { ADMINIUM_PACKAGE, IMAGE } from '../../project/scaffold.js';
import { APP_VERSION } from '../../version.js';
import { parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

const describe = (error: unknown): string => {
  if (error instanceof CliError) return error.hint === null ? error.message : `${error.message}\n${error.hint}`;
  return error instanceof Error ? error.message : String(error);
};

type Finding = { level: 'ok' | 'warn' | 'error'; text: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Where a page file names a project widget: table columns take `cell`
 * widgets, dashboard layout items take `card` widgets.
 */
export function projectWidgetFindings(path: string, portable: Record<string, unknown>, client: ClientBuild): Finding[] {
  const findings: Finding[] = [];
  const kinds = new Map(client.widgets.map((widget) => [`${WIDGET_ID_PREFIX}${widget.name}`, widget.kind]));
  const config = asObject(portable['config']);
  const check = (id: unknown, at: string, wanted: 'cell' | 'card'): void => {
    if (typeof id !== 'string' || !id.startsWith(WIDGET_ID_PREFIX)) return;
    const kind = kinds.get(id);
    if (kind === wanted) return;
    findings.push({
      level: 'error',
      text:
        kind === undefined
          ? `${path}: ${at} names "${id}", and widgets/ has no such widget.`
          : `${path}: ${at} names "${id}", which is a ${kind} widget; this place takes a ${wanted} widget.`,
    });
  };
  const columns = config?.['columns'];
  if (Array.isArray(columns)) {
    columns.forEach((column, index) => {
      check(asObject(column)?.['widget'], `config.columns[${String(index)}].widget`, 'cell');
    });
  }
  const items = asObject(config?.['layout'])?.['items'];
  if (Array.isArray(items)) {
    items.forEach((item, index) => {
      check(asObject(item)?.['widget'], `config.layout.items[${String(index)}].widget`, 'card');
    });
  }
  return findings;
}

/**
 * Rules that name an option list the project does not carry.
 *
 * A `column.options` rule either holds its values or names a key. A named key
 * is either one of the built-ins, which are code and always there, or a
 * `lists/<key>.json` in this project — anything else is a rule pointing at a
 * list that exists only in the workspace it was written in.
 */
export function missingListFindings(files: Iterable<FolderFile>): Finding[] {
  const known = new Set<string>();
  const wanted: { path: string; where: string; key: string }[] = [];
  for (const file of files) {
    if (!file.valid) continue;
    if (file.kind === 'list') known.add(file.key);
    if (file.kind !== 'schema') continue;
    file.rows.forEach((row, index) => {
      if (row.op !== 'column.options') return;
      const key = asObject(row.value)?.['list'];
      if (typeof key !== 'string' || isBuiltinOptionList(key)) return;
      wanted.push({ path: file.path, where: `overrides[${String(index)}]`, key });
    });
  }
  return wanted
    .filter((use) => !known.has(use.key))
    .map((use) => ({
      level: 'error' as const,
      text: `${use.path}: ${use.where} uses the list "${use.key}", and there is no lists/${use.key}.json.`,
    }));
}

/** The Dockerfile's image tag against the version package.json installs. */
export function dockerfileFinding(root: string): Finding | null {
  const dockerfile = join(root, 'Dockerfile');
  if (!existsSync(dockerfile)) return null;
  const escaped = IMAGE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const tag = new RegExp(`^FROM\\s+${escaped}:(\\S+)`, 'm').exec(readFileSync(dockerfile, 'utf8'))?.[1];
  if (tag === undefined) return null;
  let spec: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    spec = pkg.dependencies?.[ADMINIUM_PACKAGE];
  } catch {
    spec = undefined;
  }
  if (spec === undefined) {
    return { level: 'warn', text: `package.json does not depend on ${ADMINIUM_PACKAGE}; the Dockerfile builds on ${tag}.` };
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(spec)) {
    return {
      level: 'warn',
      text: `package.json installs ${ADMINIUM_PACKAGE} "${spec}", not an exact version, so it cannot be compared with the Dockerfile's ${tag}.`,
    };
  }
  return spec === tag
    ? { level: 'ok', text: `the Dockerfile builds on ${ADMINIUM_PACKAGE} ${tag}, the version package.json installs` }
    : { level: 'error', text: `the Dockerfile builds on ${IMAGE}:${tag}, but package.json installs ${spec}. Make them equal.` };
}

export const checkCommand: Command = {
  name: 'check',
  summary: 'Check the project without starting it (for CI)',
  usage: 'adminium check',
  describe:
    'Validates adminium.config.ts, the settings the server would start with, the\n' +
    'database URLs, the page, schema and list files, the hooks and actions, the\n' +
    "pages and widgets, and that the Dockerfile's image matches package.json.\n" +
    'Needs no database. Exits 2 when something is wrong.',
  flags: {},

  async run({ io, deps, argv }) {
    parseFlags(argv, checkCommand.flags, checkCommand.name);
    const project = findProject(deps.cwd, deps.env);
    if (project === null) {
      throw new CliError('adminium check runs inside a project, and this folder is not in one.', {
        hint: 'Create one with  adminium new <name>',
      });
    }
    const findings: Finding[] = [];
    const fromDotEnv = loadDotEnv(project.root, deps.env);

    let config: ProjectConfig | null = null;
    try {
      const loaded = await loadProjectConfig(project, { version: APP_VERSION });
      config = loaded.config;
      findings.push({
        level: 'ok',
        text: `${configFileName(project)} is valid${loaded.from === 'new-build' ? ' (and was built)' : ''}`,
      });
    } catch (error) {
      findings.push({ level: 'error', text: describe(error) });
    }

    if (config !== null) {
      const env = withDefaults(deps.env, projectEnvironment(config, project.root));
      const secretMissing = (env.ADMINIUM_SECRET ?? '') === '';
      try {
        loadCliEnv(
          secretMissing ? { ...env, ADMINIUM_SECRET: 'a-placeholder-for-validation-only' } : env,
          {},
          variableSources(project, config, deps.env, fromDotEnv),
        );
        findings.push({ level: 'ok', text: 'the settings the server starts with are valid' });
      } catch (error) {
        findings.push({ level: 'error', text: describe(error) });
      }
      if (secretMissing) {
        findings.push({ level: 'warn', text: 'ADMINIUM_SECRET is not set; `adminium start` needs it (put it in .env).' });
      }
      const { ready, missing } = configuredDatabases(config);
      for (const [key, url] of ready) {
        try {
          parseDsn(projectDsn(project.root, url));
          findings.push({ level: 'ok', text: `database "${key}" has a usable URL` });
        } catch (error) {
          findings.push({ level: 'error', text: `database "${key}": ${describe(error)}` });
        }
      }
      for (const key of missing) {
        findings.push({ level: 'warn', text: `database "${key}" has no URL yet; set it in .env.` });
      }
    }

    if (config !== null) {
      const manifest = readBuildManifest(project);
      if (manifest !== null && manifest.adminiumVersion !== APP_VERSION) {
        findings.push({
          level: 'error',
          text: `.adminium/build was made by Adminium ${manifest.adminiumVersion}, and this is ${APP_VERSION}. Run the build again.`,
        });
      }

      // The build is current here, pages and widgets included.
      const client = readBuildManifest(project)?.client;
      const files = await readProjectFiles(diskFileStore(project.root), offlineRefs(Object.keys(config.databases ?? {})));
      let pages = 0;
      let schemas = 0;
      let lists = 0;
      let broken = 0;
      for (const file of files.values()) {
        if (!file.valid) {
          broken += 1;
          findings.push({ level: 'error', text: `${file.path}:\n    ${file.problems.join('\n    ')}` });
        } else if (file.kind === 'page') {
          pages += 1;
          const widgetFindings = projectWidgetFindings(file.path, file.doc.portable, client ?? EMPTY_CLIENT_BUILD);
          broken += widgetFindings.length;
          findings.push(...widgetFindings);
        } else if (file.kind === 'list') {
          lists += 1;
        } else {
          schemas += 1;
        }
      }
      // A rule that names a list the project does not carry would enforce
      // nothing in the next install — silently, because the write path treats
      // an unknown list as no list at all. It is a file away from working, so
      // `check` is where it has to be said.
      const listFindings = missingListFindings(files.values());
      broken += listFindings.length;
      findings.push(...listFindings);
      if (client !== undefined && client.pages.length + client.widgets.length > 0) {
        findings.push({
          level: 'ok',
          text: `${String(client.pages.length)} page(s) and ${String(client.widgets.length)} widget(s) build`,
        });
      }
      if (broken === 0) {
        findings.push({
          level: 'ok',
          text: `${String(pages)} page file(s), ${String(schemas)} schema file(s) and ${String(lists)} list file(s) are valid`,
        });
      }

      // The build is current here: loading the config built it when it was not.
      if (manifest?.server !== undefined) {
        try {
          const code = await loadProjectCode(buildDir(project));
          for (const problem of code.problems) {
            findings.push({ level: 'error', text: `${problem.source}: ${problem.message}` });
          }
          const keys = new Set(Object.keys(config.databases ?? {}));
          const named = [
            ...code.hooks.map((hook) => ({ source: hook.source, database: hook.database })),
            ...[...code.actions.values()].map((action) => ({ source: action.source, database: action.database })),
          ];
          for (const { source, database } of named) {
            if (!keys.has(database)) {
              findings.push({
                level: 'error',
                text: `${source} is for database "${database}", which ${configFileName(project)} does not list.`,
              });
            }
          }
          if (code.problems.length === 0 && named.every(({ database }) => keys.has(database))) {
            findings.push({
              level: 'ok',
              text: `${String(code.hooks.length)} hook(s) and ${String(code.actions.size)} action(s) load`,
            });
          }
        } catch (error) {
          findings.push({ level: 'error', text: `the hooks and actions could not be loaded: ${describe(error)}` });
        }
      }
    }

    const docker = dockerfileFinding(project.root);
    if (docker !== null) findings.push(docker);

    const mark = { ok: '✓', warn: '!', error: '✗' } as const;
    for (const finding of findings) {
      const line = `${mark[finding.level]} ${finding.text}`;
      if (finding.level === 'ok') io.out(line);
      else io.err(line);
    }
    return findings.some((finding) => finding.level === 'error') ? EXIT_VALIDATION_FAILED : EXIT_OK;
  },
};
