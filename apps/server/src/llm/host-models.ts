// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Model and picture-source keys that a HOST keeps, instead of the project's
 * `.env`. The desktop app keeps a person's keys in its own
 * folder, encrypted by the system's key store, one set for every project; it
 * hands them to the project's server after the server is up, over the message
 * channel the two already have, and takes back what the model screen saves.
 *
 * They live in this module's memory and nowhere else. They are never put into
 * `process.env` (a project's hooks read that, and every program the server
 * starts inherits it), never written to a file, never logged. The one reader
 * of model values (`ai-env.ts`) asks here when a host is on, and then asks
 * nothing else: a project folder from someone else may name an address of
 * their own in its `.env`, and a key that came from this computer must not be
 * sent there.
 */
import { AI_ENV_NAMES, type AiEnvName } from '../project/dotenv.js';

/** The picture sources a project may have a key for. */
export const PICTURE_KEY_NAMES = ['PEXELS_API_KEY', 'UNSPLASH_ACCESS_KEY'] as const;
export type PictureKeyName = (typeof PICTURE_KEY_NAMES)[number];

/** Every name a host keeps: the six of a model, the two of the picture sources. */
export const HOST_KEPT_NAMES: readonly (AiEnvName | PictureKeyName)[] = [...AI_ENV_NAMES, ...PICTURE_KEY_NAMES];
export type HostKeptName = AiEnvName | PictureKeyName;
export type HostKeptValues = Partial<Record<HostKeptName, string>>;

/** How the host keeps them: said on the model screen, in the host's own words. */
export type HostKeeping = 'key-store' | 'plain';

interface Host {
  values: HostKeptValues;
  keeping: HostKeeping;
  keep: (values: Partial<Record<HostKeptName, string | null>>) => void;
}

let host: Host | null = null;

const clean = (values: Readonly<Record<string, unknown>>): HostKeptValues => {
  const out: HostKeptValues = {};
  for (const name of HOST_KEPT_NAMES) {
    const value = values[name];
    if (typeof value === 'string' && value.trim() !== '') out[name] = value;
  }
  return out;
};

/**
 * A host takes over the keeping. `keep` is how a saved model goes back to it
 * (a name with `null` is taken away). Until the host's first word there are no
 * values: a model cannot be called, which is what the page then says.
 */
export function useHostModels(opts: { keep: Host['keep']; keeping?: HostKeeping }): void {
  host = { values: {}, keeping: opts.keeping ?? 'key-store', keep: opts.keep };
}

/** The host's word: all it keeps, replacing what was held. Names it does not keep are dropped. */
export function setHostModels(values: Readonly<Record<string, unknown>>, keeping?: HostKeeping): void {
  if (host === null) return;
  host = { ...host, values: clean(values), ...(keeping === undefined ? {} : { keeping }) };
}

/** For tests, and for a process that serves more than once. */
export function stopHostModels(): void {
  host = null;
}

/** What the reader asks: `null` when no host keeps the keys (a terminal, a server), else the host's own. */
export function hostModels(): { read(): HostKeptValues; keeping: HostKeeping; keep: Host['keep'] } | null {
  if (host === null) return null;
  const held = host;
  return {
    read: () => ({ ...(host ?? held).values }),
    keeping: (host ?? held).keeping,
    keep: (values) => {
      // Taken at once here too, so the page that saved it reads it back without waiting for the host's answer.
      const current = host ?? held;
      const next: Record<string, unknown> = { ...current.values };
      for (const [name, value] of Object.entries(values)) {
        if (value === null) Reflect.deleteProperty(next, name);
        else next[name] = value;
      }
      host = { ...current, values: clean(next) };
      current.keep(values);
    },
  };
}
