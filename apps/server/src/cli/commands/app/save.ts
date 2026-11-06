// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app save`: a database's configuration made into an app file, from
 * the command line.
 *
 * The same service the dashboard's Save as app calls, with no person: the
 * command runs with host access, which already reads everything, so every
 * right is held. It writes the file where `--out` says, records the save (the
 * next version, the lineage), and keeps no copy in the Files library.
 *
 * What the dashboard asks in its Check step, the command prints. Answers are
 * given in a JSON file (`--answers`), shaped as the save route's body
 * (`include`, `rows`, `answers`); without them, a save that has questions
 * stops and lists them.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SOURCE_ENGINES } from '@adminium/engine';
import { settingsRepo } from '@adminium/meta';

import { createSaveService, type SaveRequest, type SaveRights } from '../../../apps/save/service.js';
import type { SaveDialect } from '../../../apps/save/types.js';
import { APP_VERSION } from '../../../version.js';
import { boolFlag, parseFlags, stringFlag, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { CliError, CliUsageError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { loadCliEnv } from '../../runtime.js';

const flags: FlagSpecs = {
  connection: { type: 'string', short: 'c', placeholder: '<id>', describe: 'The database to save (its connection id)' },
  key: { type: 'string', placeholder: '<key>', describe: 'The app key: lower-case letters, digits and -' },
  name: { type: 'string', placeholder: '<name>', describe: 'The app name', defaultDescription: 'the key' },
  version: { type: 'string', placeholder: '<x.y.z>', describe: 'The version', defaultDescription: 'the last saved version + 1, else 1.0.0' },
  label: { type: 'string', placeholder: '<text>', describe: 'Where it was made, as the target shows it', defaultDescription: 'the display name' },
  answers: { type: 'string', placeholder: '<file>', describe: 'A JSON file with include, rows and answers, as the Check step records them' },
  out: { type: 'string', short: 'o', placeholder: '<file>', describe: 'Where to write the file', defaultDescription: './<key>-<version>.tgz' },
  plan: { type: 'boolean', describe: 'Only print what the file would hold and what Check asks', defaultDescription: 'off' },
  'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory', defaultDescription: 'ADMINIUM_DATA_DIR, else ./data or ~/.adminium' },
  'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
};

/** Host access holds every right. */
const HOST: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true };

export const appSaveCommand: Command = {
  name: 'save',
  summary: "Save a database's tables, pages and rules as an app file",
  usage: 'adminium app save --connection <id> --key <key> [--out <file>] [--answers <file>] [--plan]',
  describe:
    'Makes an app file (publisher local) from what was built on one database:\n' +
    'its tables, pages, views, roles, rules, mails, documents and public access.\n' +
    'Another Adminium installs it through Apps → Install app → Upload file.\n' +
    '\n' +
    'Secrets, people and history never go in. What cannot travel is listed;\n' +
    'questions are answered in an --answers file.',
  flags,

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, flags, 'app save');
    const connectionId = stringFlag(values.connection);
    const key = stringFlag(values.key);
    if (connectionId === undefined || key === undefined) throw new CliUsageError('app save needs --connection and --key.', 'app save');
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);
    const env = loadCliEnv(deps.env, { ...(dataDir === undefined ? {} : { dataDir }), ...(metaUrl === undefined ? {} : { metaUrl }) });

    let extra: Pick<SaveRequest, 'include' | 'rows' | 'answers'> = {};
    const answersFile = stringFlag(values.answers);
    if (answersFile !== undefined) {
      try {
        extra = JSON.parse(await readFile(resolve(deps.cwd, answersFile), 'utf8')) as typeof extra;
      } catch (error) {
        throw new CliError(`${answersFile} could not be read as JSON: ${(error as Error).message}`);
      }
    }
    const version = stringFlag(values.version);
    const label = stringFlag(values.label);
    const request: SaveRequest = {
      connectionId,
      key,
      name: stringFlag(values.name) ?? key,
      ...(version === undefined ? {} : { version }),
      ...(label === undefined ? {} : { label }),
      ...extra,
    };

    const runtime = await deps.openRuntime(env);
    try {
      const meta = runtime.metaStore.meta;
      const service = createSaveService({
        meta,
        storage: null,
        masterSecret: env.ADMINIUM_SECRET,
        adminiumVersion: APP_VERSION,
        projectEnvFile: resolve(deps.cwd, '.env'),
        dialectOf: async (id) => {
          const row = await meta.db.selectFrom('adminium_connections').select('engine').where('id', '=', id).executeTakeFirst();
          return row === undefined || !(SOURCE_ENGINES as readonly string[]).includes(row.engine) ? null : (row.engine as SaveDialect);
        },
        displayName: async () => settingsRepo(meta).get('branding.appName'),
      });

      const plan = await service.plan(request, HOST);
      io.out(`${plan.key} ${plan.version} (${plan.lineage === 'new' ? 'first save' : 'a newer version'}), made at "${plan.label}", needs Adminium ${plan.minAdminiumVersion}.`);
      io.out(
        Object.entries(plan.counts)
          .filter(([, n]) => n > 0)
          .map(([kind, n]) => `${kind}: ${String(n)}`)
          .join(' · '),
      );
      for (const group of ['choice', 'after', 'info'] as const) {
        const items = plan.check.filter((item) => item.group === group);
        if (items.length === 0) continue;
        io.out(group === 'choice' ? '\nNeeds an answer:' : group === 'after' ? '\nAfter you install:' : '\nFor your information:');
        for (const item of items) io.out(`  - ${item.message}${item.answer === undefined ? '' : ` [${item.answer.choices.join(' | ')}: ${item.answer.target}]`}`);
      }
      for (const problem of plan.problems) io.err(`Refused: ${problem.message}${problem.path === undefined ? '' : ` (${problem.path})`}`);
      if (boolFlag(values.plan)) return EXIT_OK;
      if (!plan.ready) {
        io.err('\nNothing was written. Answer the questions above in an --answers file, then save again.');
        return EXIT_VALIDATION_FAILED;
      }

      const saved = await service.save(request, HOST);
      const out = resolve(deps.cwd, stringFlag(values.out) ?? saved.filename);
      await writeFile(out, saved.tarball);
      io.out(`\nWrote ${out}.\nFingerprint: ${saved.integrity}`);
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};
