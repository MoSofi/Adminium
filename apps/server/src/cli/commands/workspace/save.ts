// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium workspace save`: every database of a workspace saved as one
 * workspace file, through the same service the dashboard's Save workspace
 * calls. Like `adminium app save`, it runs with host access (every right
 * held) and keeps no copy in the Files library. A workspace file is installed
 * through the dashboard only: its review asks, per app, where it goes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SOURCE_ENGINES } from '@adminium/engine';
import { settingsRepo, workspacesRepo } from '@adminium/meta';

import { createSaveService, type SaveRights } from '../../../apps/save/service.js';
import type { SaveDialect } from '../../../apps/save/types.js';
import { createWorkspaceSaveService, type WorkspaceSaveRequest } from '../../../apps/save/workspace.js';
import { APP_VERSION } from '../../../version.js';
import { boolFlag, parseFlags, stringFlag, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { CliError, CliUsageError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { envOf, storeFlags } from './shared.js';

/** Host access holds every right. */
const HOST: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };

const saveFlags: FlagSpecs = {
  workspace: { type: 'string', short: 'w', placeholder: '<id|name>', describe: 'The workspace to save, by its id or its name' },
  out: { type: 'string', short: 'o', placeholder: '<file>', describe: 'Where to write the file', defaultDescription: './<workspace>.workspace.tgz' },
  label: { type: 'string', placeholder: '<text>', describe: 'Where it was made, as the target shows it', defaultDescription: 'the display name' },
  answers: { type: 'string', placeholder: '<file>', describe: 'A JSON file with label, instanceFrom and apps, as the save route takes them' },
  plan: { type: 'boolean', describe: 'Only print each app and what its Check asks', defaultDescription: 'off' },
  ...storeFlags,
};

export const workspaceSaveCommand: Command = {
  name: 'save',
  summary: 'Save every database of a workspace as one workspace file',
  usage: 'adminium workspace save --workspace <id|name> [--out <file>] [--answers <file>] [--plan]',
  describe:
    'Makes one app per database of the workspace, each an ordinary app file\n' +
    'with its own next version, and writes them as one workspace file.\n' +
    'Another Adminium installs it through Apps → Install app → Upload file.\n' +
    '\n' +
    "The server settings travel with no app unless --answers names one\n" +
    '(`instanceFrom`). Questions are answered in the --answers file.',
  flags: saveFlags,

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, saveFlags, 'workspace save');
    const asked = stringFlag(values.workspace);
    if (asked === undefined) throw new CliUsageError('workspace save needs --workspace.', 'workspace save');
    let request: WorkspaceSaveRequest = {};
    const answersFile = stringFlag(values.answers);
    if (answersFile !== undefined) {
      try {
        request = JSON.parse(await readFile(resolve(deps.cwd, answersFile), 'utf8')) as WorkspaceSaveRequest;
      } catch (error) {
        throw new CliError(`${answersFile} could not be read as JSON: ${(error as Error).message}`);
      }
    }
    const label = stringFlag(values.label);
    if (label !== undefined) request = { ...request, label };

    const env = envOf(deps, values);
    const runtime = await deps.openRuntime(env);
    try {
      const meta = runtime.metaStore.meta;
      const all = await workspacesRepo(meta).list();
      const workspace = all.find((one) => one.id === asked) ?? all.find((one) => one.name === asked) ?? all.find((one) => one.name.toLowerCase() === asked.toLowerCase());
      if (workspace === undefined) throw new CliError(`There is no workspace "${asked}" here. Run adminium workspace list.`);
      const dialectOf = async (id: string): Promise<SaveDialect | null> => {
        const row = await meta.db.selectFrom('adminium_connections').select('engine').where('id', '=', id).executeTakeFirst();
        return row === undefined || !(SOURCE_ENGINES as readonly string[]).includes(row.engine) ? null : (row.engine as SaveDialect);
      };
      const displayName = async () => settingsRepo(meta).get('branding.appName');
      const save = createSaveService({
        meta,
        storage: null,
        masterSecret: env.ADMINIUM_SECRET,
        adminiumVersion: APP_VERSION,
        projectEnvFile: resolve(deps.cwd, '.env'),
        dialectOf,
        displayName,
        dataDb: async (connectionId) => (await runtime.manager.data(connectionId)).db,
      });
      const service = createWorkspaceSaveService({ meta, save, adminiumVersion: APP_VERSION, masterSecret: env.ADMINIUM_SECRET, projectEnvFile: resolve(deps.cwd, '.env'), dialectOf, displayName });

      const plan = await service.plan(workspace.id, request, HOST);
      io.out(`${plan.name}: ${String(plan.apps.length)} app(s), made at "${plan.label}", needs Adminium ${plan.minAdminiumVersion}.`);
      let refused = false;
      for (const app of plan.apps) {
        io.out(`\n${app.name} (${app.key} ${app.plan.version}, ${app.plan.lineage === 'new' ? 'first save' : 'a newer version'}) from ${app.database.name}`);
        for (const group of ['choice', 'after', 'info'] as const) {
          const items = app.plan.check.filter((item) => item.group === group);
          if (items.length === 0) continue;
          io.out(group === 'choice' ? '  Needs an answer:' : group === 'after' ? '  After you install:' : '  For your information:');
          for (const item of items) io.out(`    - ${item.message}${item.answer === undefined ? '' : ` [${item.answer.choices.join(' | ')}: ${item.answer.target}]`}`);
        }
        for (const problem of app.plan.problems) {
          refused = true;
          io.err(`  Refused: ${problem.message}${problem.path === undefined ? '' : ` (${problem.path})`}`);
        }
      }
      if (plan.workspaces.length > 0) io.out(`\nWorkspaces named in the file: ${plan.workspaces.join(', ')}`);
      if (boolFlag(values.plan)) return EXIT_OK;
      if (!plan.ready) {
        io.err(`\nNothing was written. ${refused ? 'Fix what is refused above' : 'Answer the questions above in an --answers file'}, then save again.`);
        return EXIT_VALIDATION_FAILED;
      }

      const saved = await service.save(workspace.id, request, HOST);
      const out = resolve(deps.cwd, stringFlag(values.out) ?? saved.filename);
      await writeFile(out, saved.tarball);
      io.out(`\nWrote ${out}.\nFingerprint: ${saved.integrity}`);
      for (const app of saved.apps) io.out(`  ${app.key} ${app.version}: ${app.integrity}`);
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};

