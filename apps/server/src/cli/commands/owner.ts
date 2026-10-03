// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium owner set` — give the owner `adminium design` made an address and
 * a password.
 *
 * A project made by `design` has an owner with no password: the link `design`
 * opens signs them in on this machine, and nothing else can. Before the
 * project runs anywhere else (`adminium start`, a server) the owner needs a
 * password, and this is the one place it is set: the terminal of the person
 * who owns the folder. No web page sets it — on a server, the first visitor
 * would otherwise be the owner.
 */
import { createInterface } from 'node:readline';

import { settingsRepo, usersRepo } from '@adminium/meta';

import { LocalOwnerError, setLocalOwnerCredentials } from '../../auth/local-owner.js';
import { openMetaStore } from '../../meta/store.js';
import { prepareProject } from '../../project/boot.js';
import { APP_VERSION } from '../../version.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, CliUsageError, EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readStdin(): Promise<string> {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return '';
}

export const ownerCommand: Command = {
  name: 'owner',
  summary: 'Give the owner of a project made by `design` an address and a password',
  usage: 'adminium owner set [--email <address>] [--password-stdin]',
  describe:
    'A project made by `adminium design` has an owner with no password: the link\n' +
    '`design` opens signs them in on this machine. Set an address and a password\n' +
    'before the project runs anywhere else. Asks for both; with --password-stdin\n' +
    'the password is read from the first line of standard input.',
  flags: {
    email: { type: 'string', placeholder: '<address>', describe: 'The owner’s email address' },
    'password-stdin': { type: 'boolean', describe: 'Read the password from standard input' },
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, ownerCommand.flags, ownerCommand.name);
    if (positionals[0] !== 'set' || positionals.length > 1) throw new CliUsageError('Say what to do: adminium owner set', ownerCommand.name);

    const project = await prepareProject({ cwd: deps.cwd, env: deps.env, version: APP_VERSION });
    const env = loadCliEnv(project?.env ?? deps.env, {}, project?.sources);
    const store = await openMetaStore({ metaUrl: env.ADMINIUM_META_URL, dataDir: env.ADMINIUM_DATA_DIR, secret: env.ADMINIUM_SECRET, poolSize: env.ADMINIUM_META_POOL_MAX });
    try {
      const settings = settingsRepo(store.meta);
      const users = usersRepo(store.meta);
      const ownerId = await settings.get('designer.localOwnerId');
      const owner = ownerId === null ? null : await users.findById(ownerId);
      if (owner === null) {
        throw new CliError('This project’s owner was not made by `adminium design`.', { hint: 'Change a password in the dashboard, under your account, or with “Forgot your password?”.' });
      }
      if (owner.passwordHash !== null) {
        throw new CliError('The owner already has a password.', { hint: 'Change it in the dashboard, under your account.' });
      }

      const minLength = await settings.get('auth.passwordMinLength');
      const email = (
        stringFlag(values.email) ??
        (io.isInteractive
          ? await io.ask('Your email address', { validate: (answer) => (EMAIL.test(answer.trim()) ? null : 'That is not an email address.') })
          : '')
      ).trim();
      if (!EMAIL.test(email)) throw new CliUsageError('Give the owner’s email address: --email <address>', ownerCommand.name);
      const taken = await users.findByEmail(email);
      if (taken !== null && taken.id !== owner.id) throw new CliError(`${email} is already somebody else’s address here.`);

      let password: string;
      if (boolFlag(values['password-stdin'])) {
        password = await readStdin();
      } else if (io.isInteractive) {
        password = await io.ask('A password', {
          mask: true,
          validate: (answer) => (answer.length >= minLength ? null : `At least ${String(minLength)} characters.`),
        });
        const again = await io.ask('The same password again', { mask: true });
        if (again !== password) throw new CliError('The two passwords are not the same. Nothing was changed.');
      } else {
        throw new CliUsageError('Give the password on standard input: --password-stdin', ownerCommand.name);
      }
      if (password.length < minLength) throw new CliError(`A password has at least ${String(minLength)} characters. Nothing was changed.`);

      try {
        await setLocalOwnerCredentials(store.meta, { email, password });
      } catch (error) {
        if (error instanceof LocalOwnerError) throw new CliError(`${error.message} Nothing was changed.`);
        throw error;
      }
      io.out(`The owner is now ${email}, with a password. Sign in with them wherever this project runs.`);
      return EXIT_OK;
    } finally {
      await store.close();
    }
  },
};
