// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sites pages may load pictures from, as the Designer meets them.
 *
 * Under `adminium design` a person's yes adds one: it is written to the
 * project's `.env` (`ADMINIUM_CSP_IMG_HOSTS`), where the next start reads it,
 * and counts from the next reply. A value the operator's own environment sets
 * wins over the file, so there, and on a live server, the list is the
 * operator's to change and nothing is asked.
 */
import type { PictureHosts } from '../config/picture-hosts.js';
import { readDotEnv, setDotEnv } from '../project/dotenv.js';
import type { PictureSites } from './tool-types.js';

const NAME = 'ADMINIUM_CSP_IMG_HOSTS';

export interface PictureSitesOptions {
  /** The project folder. */
  root: string;
  /** The list the policy is made from. */
  hosts: PictureHosts;
  mode: 'local' | 'live';
  /** The variable as the process has it: the operator's own, or what was read from `.env` at the start. */
  fromEnvironment: string | undefined;
  /** Called once a site is kept. */
  onAdded?: (host: string, by: { id: string | null; label: string }) => void;
}

function inFile(root: string): string {
  try {
    return readDotEnv(root)?.[NAME] ?? '';
  } catch {
    return '';
  }
}

export function createPictureSites(opts: PictureSitesOptions): PictureSites {
  // Set, and not what the file says: the operator's environment named it, and a line in the file would change nothing.
  const fromOperator = (opts.fromEnvironment ?? '').trim() !== '' && opts.fromEnvironment !== inFile(opts.root);
  return {
    covers: (host) => opts.hosts.covers(host),
    closed: () =>
      opts.mode !== 'local'
        ? `On this server the sites pictures may come from are set by whoever runs it (${NAME}), not from here.`
        : fromOperator
          ? `${NAME} is set in this server’s own environment, which wins over the project’s .env: a site is added there, not from here.`
          : null,
    add(host, by) {
      const source = `https://${host}`;
      const kept = inFile(opts.root)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
      if (!kept.includes(source)) setDotEnv(opts.root, { [NAME]: [...kept, source].join(',') }, [NAME]);
      opts.hosts.add(source);
      opts.onAdded?.(host, by);
    },
  };
}
