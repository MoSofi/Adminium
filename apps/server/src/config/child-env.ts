// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The environment a program this server starts is given: named, and small.
 *
 * Never `{ ...process.env }`. A program the server starts may be code a model wrote (an app's tests), code that came
 * with a copied app (its build line), or a package manager fetching packages; whatever it is, it runs as this
 * server's user. It is given what it needs to run, by name, and the values its caller passes it on purpose. An
 * operator secret (`config/operator-secrets.ts`) is never one of them, even when a caller passes one.
 *
 * Each profile is a list a reviewer can read:
 *
 * - `program`: where programs are, the user's home and temporary folders, the language, and Windows' own. What
 *   `node --test`, git and a browser need to start.
 * - `build`: `program` and `CI=1`. An app's own build line (`project/apps/own-build.ts`), and so "Start with an app".
 *   Its package manager reads its settings from the user's home, as a person's terminal does.
 * - `packages`: `program`, `NODE_ENV`, the proxy and certificate settings a fetch needs behind a company proxy, and
 *   the package managers' own settings (`npm_config_*`, pnpm's and corepack's folders) less any credential.
 * - `browser`: `program` and what a desktop session needs to open a page (Linux's display and session bus).
 */
import { isOperatorSecretName } from './operator-secrets.js';

export type ChildEnvProfile = 'program' | 'build' | 'packages' | 'browser';

/** What every program needs to start, on every system. */
const PROGRAM_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  // Windows' own: where Windows, its shell and the installed programs are, and what the machine is. A program
  // started without them fails in ways that name none of them (no `cmd.exe`, no Program Files, no CPU count).
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData',
  'CommonProgramFiles',
  'ComSpec',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
] as const;

const PACKAGES_NAMES = [
  'NODE_ENV',
  'LC_ALL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'PNPM_HOME',
  'COREPACK_HOME',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const;

/** npm's, pnpm's and yarn's settings by environment, as a person's terminal has them. */
const PACKAGES_PREFIXES = ['npm_config_', 'NPM_CONFIG_'] as const;

const BROWSER_NAMES = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS', 'DBUS_SESSION_BUS_ADDRESS', 'BROWSER'] as const;

/** A name that holds a credential, whatever program it is for: never copied from this server's environment. */
const CREDENTIAL = /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|_AUTH/i;

/**
 * The name `name` is listed as in `profile`, or null when it is not listed. On Windows names are matched whatever
 * their case, as Windows matches them (it spells PATH `Path`), and the child is given the listed spelling.
 */
function named(profile: ChildEnvProfile, name: string, windows: boolean): string | null {
  const lists: (readonly string[])[] = [PROGRAM_NAMES];
  if (profile === 'packages') lists.push(PACKAGES_NAMES);
  if (profile === 'browser') lists.push(BROWSER_NAMES);
  for (const list of lists) {
    const found = windows ? list.find((listed) => listed.toUpperCase() === name.toUpperCase()) : list.find((listed) => listed === name);
    if (found !== undefined) return found;
  }
  if (profile === 'packages' && PACKAGES_PREFIXES.some((prefix) => (windows ? name.toLowerCase().startsWith(prefix.toLowerCase()) : name.startsWith(prefix)))) {
    return name;
  }
  return null;
}

/** Whether `name` is an operator secret; on Windows in any case, as Windows reads names. */
function secretName(name: string, windows: boolean): boolean {
  return isOperatorSecretName(name) || (windows && isOperatorSecretName(name.toUpperCase()));
}

/**
 * The environment for a child of profile `profile`: the names its profile lists, read from `from` (this process's
 * environment by default), then `add`, the values the caller means it to have. No operator secret is in it, whichever of the two
 * named one; nor is a credential copied from `from`. `platform` decides how names compare: on `win32` without regard
 * to case.
 */
export function childEnvironment(
  profile: ChildEnvProfile,
  add: Readonly<Record<string, string | undefined>> = {},
  from: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const windows = platform === 'win32';
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(from)) {
    if (value === undefined || CREDENTIAL.test(name) || secretName(name, windows)) continue;
    const as = named(profile, name, windows);
    if (as !== null) out[as] = value;
  }
  if (profile === 'build') out['CI'] = '1';
  for (const [name, value] of Object.entries(add)) {
    if (value === undefined || secretName(name, windows)) continue;
    // On Windows a caller's `Path` replaces the copied `PATH`, rather than sitting beside it.
    const same = windows ? Object.keys(out).find((key) => key.toUpperCase() === name.toUpperCase()) : undefined;
    if (same !== undefined) Reflect.deleteProperty(out, same);
    out[name] = value;
  }
  return out;
}
