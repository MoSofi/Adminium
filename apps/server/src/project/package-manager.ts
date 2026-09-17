// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which package manager a project uses, and how to spell its commands.
 *
 * `npx`, `pnpm dlx`, `yarn dlx` and `bunx` all set `npm_config_user_agent`
 * (`pnpm/10.28.1 npm/? node/v22…`), so the one that ran `adminium new` is the
 * one the project gets.
 */

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export function detectPackageManager(env: Readonly<Record<string, string | undefined>>): PackageManager {
  const agent = env.npm_config_user_agent ?? '';
  const name = /^([a-z]+)\//.exec(agent)?.[1] ?? '';
  return isPackageManager(name) ? name : 'npm';
}

export function installCommand(pm: PackageManager): { command: string; args: string[] } {
  return { command: pm, args: ['install'] };
}

/**
 * How a person runs a package.json script with this manager. Always `run`,
 * except `npm start`: the shorthand forms collide with built-in commands
 * (`yarn check` is one).
 */
export function runScript(pm: PackageManager, script: string): string {
  if (pm === 'npm' && script === 'start') return 'npm start';
  return `${pm} run ${script}`;
}
