// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model connections an environment gives: who set them, and where they
 * are read from.
 *
 * Two places can name a connection. The OPERATOR's environment (a container's
 * variables, a shell) is how a deployed server is configured, and it wins. A
 * project's `.env` is where a person working in the folder keeps their key,
 * and where the Designer writes one.
 *
 * The file's values are read here, on every look, and go nowhere else. They
 * are never copied into `process.env` (`loadDotEnv` leaves these names out),
 * because everything in `process.env` is readable by a project's hooks and
 * inherited by every child process.
 */
import { AI_ENV_NAMES, readDotEnv, setDotEnv, type AiEnvName } from '../project/dotenv.js';

export { AI_ENV_NAMES, type AiEnvName };

export type AiEnvValues = Partial<Record<AiEnvName, string>>;

export interface AiEnv {
  /** The values as they stand now: the operator's environment first, then the project's `.env`. */
  read(): AiEnvValues;
  /** Names set in both places with different values. The environment's is the one in use. */
  shadowed(): AiEnvName[];
  /** Names the operator's own environment sets: a value written to the file for one of them would not be the one in use. */
  fromOperator(): AiEnvName[];
  /** Whether there is a project `.env` this server may write. */
  readonly writable: boolean;
  /** Write to the project's `.env`; `null` removes a variable. In use from the next `read()`. */
  write(values: Partial<Record<AiEnvName, string | null>>): void;
}

export interface AiEnvOptions {
  /** The project folder, or null outside a project. */
  root: string | null;
  /** What the operator set: the process's own environment, as it was before any `.env` was read. */
  fromEnvironment: Readonly<Partial<Record<AiEnvName, string | undefined>>>;
}

const set = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';

export function createAiEnv(opts: AiEnvOptions): AiEnv {
  const fromFile = (): AiEnvValues => {
    if (opts.root === null) return {};
    let file: Record<string, string> | null;
    try {
      file = readDotEnv(opts.root);
    } catch {
      // A file that cannot be read gives nothing; the environment still does.
      file = null;
    }
    const out: AiEnvValues = {};
    for (const name of AI_ENV_NAMES) {
      const value = file?.[name];
      if (set(value)) out[name] = value;
    }
    return out;
  };

  return {
    read() {
      const out = fromFile();
      for (const name of AI_ENV_NAMES) {
        const value = opts.fromEnvironment[name];
        if (set(value)) out[name] = value;
      }
      return out;
    },
    shadowed() {
      const file = fromFile();
      return AI_ENV_NAMES.filter((name) => {
        const value = opts.fromEnvironment[name];
        return set(value) && file[name] !== undefined && file[name] !== value;
      });
    },
    fromOperator: () => AI_ENV_NAMES.filter((name) => set(opts.fromEnvironment[name])),
    writable: opts.root !== null,
    write(values) {
      if (opts.root === null) throw new Error('There is no project folder to keep a model in.');
      setDotEnv(opts.root, values as Record<string, string | null>, AI_ENV_NAMES);
    },
  };
}

/** An environment that names no connection: a server with no project and nothing set. */
export const NO_AI_ENV: AiEnv = {
  read: () => ({}),
  shadowed: () => [],
  fromOperator: () => [],
  writable: false,
  write: () => {
    throw new Error('There is no project folder to keep a model in.');
  },
};
