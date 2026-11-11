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
 */

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

/** Whether `name` is one of the operator's secrets. Names are matched as written: the environment is case-sensitive. */
export function isOperatorSecretName(name: string): boolean {
  return OPERATOR_SECRET_NAMES.includes(name) || name.startsWith(OPERATOR_SECRET_PREFIX);
}

const held = new Map<string, string>();

/**
 * Move every operator secret out of `env` (by default `process.env`) into this module. A value found again later (a
 * test that sets one, a host that boots twice) replaces the held one. An empty value is taken out and not held.
 * Returns the names it took out. Safe to call any number of times.
 */
export function holdOperatorSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const moved: string[] = [];
  for (const name of Object.keys(env)) {
    if (!isOperatorSecretName(name)) continue;
    const value = env[name];
    if (value !== undefined && value !== '') held.set(name, value);
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
    if (out[name] === undefined || out[name] === '') out[name] = value;
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
