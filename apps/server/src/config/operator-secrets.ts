// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's secrets, kept out of `process.env` once the server has read them.
 *
 * Everything in `process.env` is readable by a project's hooks and actions (they load in this process) and is
 * inherited by every program the server starts. So the server reads the instance secret, the setup token, the
 * model keys and the operator's own credentials once, when it boots, into the modules that use them (they arrive
 * there through the parsed environment, `config/env.ts`), and then takes them OUT of `process.env`
 * ({@link holdOperatorSecrets}). What is taken out is held here, for the two readers that need it again:
 *
 * - a second boot in the same process (a test, a host that composes twice) whose loader reads `process.env`
 *   ({@link withHeldSecrets});
 * - a module that has no parsed environment to read from ({@link operatorSecret}).
 *
 * Nothing in here hands a value to a child process: `config/child-env.ts` names what a child is given, and it never
 * includes one of these names.
 *
 * Taken out of `process.env` is not out of reach of the operating system: a process's start-up environment stays
 * readable, to code running as the same user, from outside it (`/proc/<pid>/environ` on Linux, `ps eww` on macOS).
 * So each secret can also be given as a file: `<NAME>_FILE=/run/secrets/…` ({@link readSecretFiles}), the way Docker
 * and Kubernetes hand secrets over. Then the value is never in any environment at all; the path is, and it is taken
 * out of `process.env` too.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/**
 * The names taken out of `process.env` at boot. `ADMINIUM_OPERATOR_TOKEN` and `ADMINIUM_TRIAL_SMTP_URL` are not read
 * by anything yet: they are named here so that the day they are, they are already out of reach. A new operator
 * credential is added here, and is then gone from `process.env` and from every child with no other change.
 */
export const OPERATOR_SECRET_NAMES: readonly string[] = [
  'ADMINIUM_SECRET',
  'ADMINIUM_SETUP_TOKEN',
  // The key that signs an instance archive (`adminium archive`); its reader takes it from here.
  'ADMINIUM_ARCHIVE_KEY',
  'ADMINIUM_OPERATOR_TOKEN',
  'ADMINIUM_TRIAL_SMTP_URL',
  // The project owner's Figma token under `adminium design`, read late by the Designer (`compose.ts`).
  'ADMINIUM_FIGMA_TOKEN',
  // The picture sites' keys (`llm/host-models.ts` PICTURE_KEY_NAMES), read late by the picture dialog (`compose.ts`).
  'PEXELS_API_KEY',
  'UNSPLASH_ACCESS_KEY',
  'PIXABAY_API_KEY',
];

/** Every model key and model address: the operator's, and a provider bills them for each call. */
export const OPERATOR_SECRET_PREFIX = 'ADMINIUM_AI_';

/** Whether `name` is one of the operator's secrets, or the file one is read from (`<NAME>_FILE`). Names are matched as written: the environment is case-sensitive. */
export function isOperatorSecretName(name: string): boolean {
  const base = secretOfFileVariable(name) ?? name;
  return OPERATOR_SECRET_NAMES.includes(base) || base.startsWith(OPERATOR_SECRET_PREFIX);
}

/** `<NAME>_FILE`: the variable that names the file a secret is read from. */
export const SECRET_FILE_SUFFIX = '_FILE';

/** The largest secret file read. A key or a token is far smaller; anything bigger is the wrong file. */
export const SECRET_FILE_MAX_BYTES = 64 * 1024;

/** The secret a `<NAME>_FILE` variable is for, or null when `name` is not one. */
function secretOfFileVariable(name: string): string | null {
  if (!name.endsWith(SECRET_FILE_SUFFIX) || name.length === SECRET_FILE_SUFFIX.length) return null;
  const base = name.slice(0, -SECRET_FILE_SUFFIX.length);
  return OPERATOR_SECRET_NAMES.includes(base) || base.startsWith(OPERATOR_SECRET_PREFIX) ? base : null;
}

/** One `<NAME>_FILE` that could not be used, as the boot's problem table names it. */
export interface SecretFileProblem {
  variable: string;
  problem: string;
}

type SecretFileRead = { ok: true; value: string } | { ok: false; problem: string };

/** The value in `path`: one trailing newline taken off, nothing else changed. */
function readSecretFile(path: string): SecretFileRead {
  if (path.trim() === '') return { ok: false, problem: 'names no file' };
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, problem: code === 'ENOENT' ? `${path} does not exist` : `${path} cannot be read (${code ?? 'error'})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, problem: `${path} is not a file` };
    if (stat.size > SECRET_FILE_MAX_BYTES) return { ok: false, problem: `${path} is larger than ${String(SECRET_FILE_MAX_BYTES / 1024)} KiB; a secret file holds the value alone` };
    // One byte past the limit, so a file that grew since the stat is caught too.
    const buffer = Buffer.alloc(SECRET_FILE_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
      if (length > SECRET_FILE_MAX_BYTES) return { ok: false, problem: `${path} is larger than ${String(SECRET_FILE_MAX_BYTES / 1024)} KiB; a secret file holds the value alone` };
    }
    const value = buffer.subarray(0, length).toString('utf8').replace(/\r?\n$/, '');
    if (value === '') return { ok: false, problem: `${path} is empty` };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, problem: `${path} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
  } finally {
    closeSync(fd);
  }
}

/**
 * `env` with each `<NAME>_FILE` replaced by `<NAME>`, read from that file (one trailing newline taken off), as if the
 * value had been set in `<NAME>` itself. A copy: `env` is not changed. What cannot be used is a problem, and the
 * `<NAME>` it was for is left unset: a file that is missing, unreadable, empty or over
 * {@link SECRET_FILE_MAX_BYTES}, or a secret given both ways.
 */
export function readSecretFiles(env: Readonly<Record<string, string | undefined>>): {
  env: Record<string, string | undefined>;
  problems: SecretFileProblem[];
} {
  const out: Record<string, string | undefined> = { ...env };
  const problems: SecretFileProblem[] = [];
  for (const [name, path] of Object.entries(env)) {
    const base = secretOfFileVariable(name);
    if (base === null || path === undefined || path === '') continue;
    Reflect.deleteProperty(out, name);
    if ((env[base] ?? '') !== '') {
      problems.push({ variable: name, problem: `${base} is set as well: give the secret one way, the value or the file` });
      continue;
    }
    const read = readSecretFile(path);
    if (read.ok) out[base] = read.value;
    else problems.push({ variable: name, problem: read.problem });
  }
  return { env: out, problems };
}

const held = new Map<string, string>();

/**
 * Move every operator secret out of `env` (by default `process.env`) into this module. A value found again later (a
 * test that sets one, a host that boots twice) replaces the held one. An empty value is taken out and forgets the
 * held one: set to nothing is unset.
 * Returns the names it took out. Safe to call any number of times.
 */
export function holdOperatorSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const moved: string[] = [];
  const before: Readonly<Record<string, string | undefined>> = { ...env };
  for (const name of Object.keys(env)) {
    if (!isOperatorSecretName(name)) continue;
    const value = env[name];
    const base = secretOfFileVariable(name);
    if (base !== null) {
      // The value, read from its file, is held under the secret's own name; the path is not kept. The boot's
      // loader has already refused a file it cannot read, or a secret given both ways (the value wins here).
      if (value !== undefined && value !== '' && (before[base] ?? '') === '') {
        const read = readSecretFile(value);
        if (read.ok) held.set(base, read.value);
      }
    } else if (value === '') held.delete(name);
    else if (value !== undefined) held.set(name, value);
    // `delete` and not `= undefined`: on `process.env` an assignment stores the string "undefined".
    delete env[name];
    moved.push(name);
  }
  return moved;
}

/**
 * `env` as a boot reads it. For `process.env` after a boot has taken the secrets out, that is `process.env` with the
 * held values put back where it has none of its own (a value set since wins); any other object is the caller's own
 * and is returned as it is, so a test that leaves a secret out still sees it missing.
 */
export function withHeldSecrets(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env !== process.env || held.size === 0) return env;
  const out: Record<string, string | undefined> = { ...env };
  for (const [name, value] of held) {
    // A secret set again since, by value or by file, is the one that counts.
    if ((out[name] === undefined || out[name] === '') && (out[`${name}${SECRET_FILE_SUFFIX}`] ?? '') === '') out[name] = value;
  }
  return out;
}

/**
 * One operator secret, for a module that has no parsed environment to read it from. Anything set in `process.env`
 * since the boot is taken out first, so asking never leaves a value behind there.
 */
export function operatorSecret(name: string): string | undefined {
  holdOperatorSecrets();
  return held.get(name);
}
