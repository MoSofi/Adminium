// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two `adminium archive` commands, and the export-file branch of
 * `adminium import-zip`. The rules live in `src/archive/` (format, policy, MAC,
 * restore); this is flags and reporting.
 */

import { join, resolve } from 'node:path';

import { openMetaStore } from '../../../meta/store.js';
import { createArchive } from '../../../archive/create.js';
import { ArchiveFormatError } from '../../../archive/format.js';
import { archiveSigningKey } from '../../../archive/mac.js';
import { restoreArchive, type RestoreArchiveResult } from '../../../archive/restore.js';
import { dsnCryptoFromSecret } from '../../../connections/crypto.js';
import { prepareProject } from '../../../project/boot.js';
import { APP_VERSION } from '../../../version.js';
import { boolFlag, parseFlags, stringFlag } from '../../args.js';
import type { Command, CommandContext } from '../../command.js';
import { CliError, CliUsageError, EXIT_OK, type ExitCode } from '../../exit.js';
import type { CliIo } from '../../io.js';
import { loadCliEnv } from '../../runtime.js';
import { formatBytes } from '../export-zip.js';

const STORE_FLAGS = {
  'data-dir': {
    type: 'string',
    placeholder: '<path>',
    describe: 'Data directory',
    defaultDescription: 'ADMINIUM_DATA_DIR, else ./data or ~/.adminium',
  },
  'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
} as const;

function asCliError(error: unknown): never {
  if (error instanceof ArchiveFormatError) {
    throw new CliError(error.message, { ...(error.hint === undefined ? {} : { hint: error.hint }), cause: error });
  }
  throw error;
}

function onePath(positionals: readonly string[], command: string): string {
  if (positionals.length !== 1 || positionals[0] === undefined) {
    throw new CliUsageError('Name the archive file.', command);
  }
  return positionals[0];
}

export const archiveCreateCommand: Command = {
  name: 'create',
  summary: 'Write this instance into one archive file',
  usage: 'adminium archive create <file> [--export]',
  describe:
    'Writes the meta store (any engine), uploads kept on this server, local SQLite\n' +
    'databases, the project folder and a list of installed apps and add-ons into\n' +
    'one signed file. Sessions, tokens and add-on trust are left out; secrets stay\n' +
    'encrypted with ADMINIUM_SECRET. Databases on other hosts are not included.\n' +
    '\n' +
    'With --export the file is "Export everything": no password hashes, secrets,\n' +
    'keys or tokens, unsigned, and read back with `adminium import-zip`.',
  flags: {
    export: { type: 'boolean', describe: 'Leave out password hashes, secrets and keys', defaultDescription: 'off' },
    ...STORE_FLAGS,
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, archiveCreateCommand.flags, 'archive create');
    const out = resolve(deps.cwd, onePath(positionals, 'archive create'));
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);
    const project = await prepareProject({ cwd: deps.cwd, env: deps.env, version: APP_VERSION });
    const env = loadCliEnv(
      project?.env ?? deps.env,
      { ...(dataDir === undefined ? {} : { dataDir }), ...(metaUrl === undefined ? {} : { metaUrl }) },
      project?.sources,
    );
    const store = await openMetaStore({ metaUrl: env.ADMINIUM_META_URL, dataDir: env.ADMINIUM_DATA_DIR, secret: env.ADMINIUM_SECRET, poolSize: env.ADMINIUM_META_POOL_MAX });
    try {
      const kind = boolFlag(values.export) ? 'export' : 'full';
      const result = await createArchive({
        meta: store.meta,
        outPath: out,
        dataDir: env.ADMINIUM_DATA_DIR,
        projectRoot: project?.project.root ?? null,
        kind,
        secret: env.ADMINIUM_SECRET,
        dsnCrypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
        signing: archiveSigningKey(env),
      });
      const { manifest } = result;
      io.out(`Wrote ${result.path} (${formatBytes(result.bytes)}).`);
      io.out(
        `${String(manifest.meta.length)} meta tables (${manifest.dialect}), ${String(manifest.files.length)} files, ` +
          `${String(manifest.databases.length)} SQLite databases, ${String(manifest.project?.files.length ?? 0)} project files, ` +
          `${String(manifest.packages.length)} catalog packages listed.`,
      );
      if (manifest.external.length > 0) {
        io.out(`Not included: ${String(manifest.external.length)} database(s) on other hosts; back those up with their own tools.`);
      }
      for (const warning of result.warnings) io.err(warning);
      io.err(
        kind === 'full'
          ? `This file holds people’s password hashes and encrypted secrets: keep it as safe as the server. Signed with ${env.ADMINIUM_ARCHIVE_KEY === undefined ? 'a key made from ADMINIUM_SECRET' : 'ADMINIUM_ARCHIVE_KEY'}.`
          : 'This export holds no password hashes, secrets or keys; people sign in again through a password reset.',
      );
      return EXIT_OK;
    } catch (error) {
      return asCliError(error);
    } finally {
      await store.close();
    }
  },
};

function reportRestore(io: CliIo, result: RestoreArchiveResult, where: { dataDir: string; projectRoot: string | null }): void {
  const { manifest } = result;
  const rows = result.tables.reduce((sum, table) => sum + table.rows, 0);
  io.out(
    `${result.dryRun ? 'Would restore' : 'Restored'} an archive made by Adminium ${manifest.appVersion} on ${new Date(manifest.createdAt).toISOString()} (${manifest.dialect} meta store).`,
  );
  io.out(
    `${String(rows)} rows in ${String(result.tables.length)} tables, ${String(result.files)} files, ${String(result.databases)} SQLite databases, ` +
      `${String(result.projectFiles)} project files into ${where.dataDir}${where.projectRoot === null ? '' : ` and ${where.projectRoot}`}.`,
  );
  if (manifest.packages.length > 0) {
    io.out(
      `${String(manifest.packages.length)} catalog app(s) and add-on(s) to download again: Studio shows them as Missing until then (` +
        manifest.packages.map((pkg) => `${pkg.key}@${pkg.version}`).slice(0, 8).join(', ') +
        (manifest.packages.length > 8 ? ', …' : '') +
        ').',
    );
  }
  if (manifest.external.length > 0) {
    io.out(`${String(manifest.external.length)} database(s) on other hosts were not in the archive; their connections point where they did.`);
  }
  for (const warning of result.warnings) io.err(warning);
}

export const archiveRestoreCommand: Command = {
  name: 'restore',
  summary: 'Restore an archive into a fresh instance',
  usage: 'adminium archive restore <file> [--project-dir <folder>] [--hold] [--keep-api-keys] [--drop-secrets] [--dry-run]',
  describe:
    'Restores an archive made by `adminium archive create` into a FRESH instance:\n' +
    'an empty data dir (and meta database), before its first start. An instance\n' +
    'that already has people in it is refused.\n' +
    '\n' +
    'The archive must be signed with this server’s key (ADMINIUM_ARCHIVE_KEY, or a\n' +
    'key made from ADMINIUM_SECRET) and its secrets encrypted with this server’s\n' +
    'ADMINIUM_SECRET. Connection strings, storage addresses and domains are checked\n' +
    'again; one that fails is switched off and named. Sessions, tokens and add-on\n' +
    'trust never come back; API keys only with --keep-api-keys. Catalog apps and\n' +
    'add-ons show as Missing until they are downloaded again.',
  flags: {
    'project-dir': {
      type: 'string',
      placeholder: '<folder>',
      describe: 'Where the project folder goes (new or empty)',
      defaultDescription: 'ADMINIUM_PROJECT_DIR',
    },
    hold: {
      type: 'boolean',
      describe: 'Restore with public pages hidden, mail off and the Designer off',
      defaultDescription: 'off',
    },
    'keep-api-keys': { type: 'boolean', describe: 'Keep the archive’s API keys', defaultDescription: 'off' },
    'drop-secrets': {
      type: 'boolean',
      describe: 'Restore under a different ADMINIUM_SECRET, without the encrypted secrets',
      defaultDescription: 'off',
    },
    'dry-run': { type: 'boolean', describe: 'Check everything, write nothing', defaultDescription: 'off' },
    ...STORE_FLAGS,
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, archiveRestoreCommand.flags, 'archive restore');
    const file = resolve(deps.cwd, onePath(positionals, 'archive restore'));
    const named = stringFlag(values['project-dir']) ?? deps.env.ADMINIUM_PROJECT_DIR;
    const projectRoot = named === undefined || named.trim() === '' ? null : resolve(deps.cwd, named);
    const dataDirFlag = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);
    // Beside a restored project, its data dir is where the project expects it.
    const dataDir =
      dataDirFlag ?? (projectRoot !== null && (deps.env.ADMINIUM_DATA_DIR ?? '') === '' ? join(projectRoot, 'data') : undefined);
    const env = loadCliEnv(deps.env, { ...(dataDir === undefined ? {} : { dataDir }), ...(metaUrl === undefined ? {} : { metaUrl }) });
    const store = await openMetaStore({ metaUrl: env.ADMINIUM_META_URL, dataDir: env.ADMINIUM_DATA_DIR, secret: env.ADMINIUM_SECRET, poolSize: env.ADMINIUM_META_POOL_MAX });
    try {
      const result = await restoreArchive({
        inPath: file,
        meta: store.meta,
        dataDir: env.ADMINIUM_DATA_DIR,
        projectRoot,
        secret: env.ADMINIUM_SECRET,
        dsnCrypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
        signing: archiveSigningKey(env),
        expect: 'full',
        keepApiKeys: boolFlag(values['keep-api-keys']),
        dropSecrets: boolFlag(values['drop-secrets']),
        hold: boolFlag(values.hold),
        blockLoopback: deps.env.NODE_ENV === 'production',
        dryRun: boolFlag(values['dry-run']),
      });
      reportRestore(io, result, { dataDir: env.ADMINIUM_DATA_DIR, projectRoot });
      if (boolFlag(values.hold)) {
        io.out('Held: mail is off, the public API is off and every app’s customer side is switched off. Forms and /x/ pages have no switch yet: keep this instance off the public internet.');
      }
      io.out(result.dryRun ? 'Dry run — nothing was written.' : 'Restore complete. Start the server as usual.');
      return EXIT_OK;
    } catch (error) {
      return asCliError(error);
    } finally {
      await store.close();
    }
  },
};

/**
 * `adminium import-zip` on an export file: the archive restore with the
 * export's rules. Lives here so import-zip only routes to it.
 */
export async function importExportFile(
  { io, deps }: Pick<CommandContext, 'io' | 'deps'>,
  file: string,
  opts: { dryRun: boolean; dataDir: string | undefined; metaUrl: string | undefined; projectDir: string | undefined },
): Promise<ExitCode> {
  const named = opts.projectDir ?? deps.env.ADMINIUM_PROJECT_DIR;
  const projectRoot = named === undefined || named.trim() === '' ? null : resolve(deps.cwd, named);
  const dataDir = opts.dataDir ?? (projectRoot !== null && (deps.env.ADMINIUM_DATA_DIR ?? '') === '' ? join(projectRoot, 'data') : undefined);
  const env = loadCliEnv(deps.env, { ...(dataDir === undefined ? {} : { dataDir }), ...(opts.metaUrl === undefined ? {} : { metaUrl: opts.metaUrl }) });
  const store = await openMetaStore({ metaUrl: env.ADMINIUM_META_URL, dataDir: env.ADMINIUM_DATA_DIR, secret: env.ADMINIUM_SECRET, poolSize: env.ADMINIUM_META_POOL_MAX });
  try {
    const result = await restoreArchive({
      inPath: file,
      meta: store.meta,
      dataDir: env.ADMINIUM_DATA_DIR,
      projectRoot,
      secret: env.ADMINIUM_SECRET,
      dsnCrypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
      signing: archiveSigningKey(env),
      expect: 'export',
      blockLoopback: deps.env.NODE_ENV === 'production',
      dryRun: opts.dryRun,
    });
    reportRestore(io, result, { dataDir: env.ADMINIUM_DATA_DIR, projectRoot });
    io.out('People came without passwords: each signs in through “Forgot password”. Enter connection strings, mail and AI keys again.');
    io.out(result.dryRun ? 'Dry run — nothing was written.' : 'Import complete.');
    return EXIT_OK;
  } catch (error) {
    return asCliError(error);
  } finally {
    await store.close();
  }
}

