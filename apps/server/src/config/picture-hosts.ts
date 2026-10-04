// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sites this server lets a page load pictures from, as they stand now.
 *
 * The policy's `img-src` names this server, the map tiles and the hosts in
 * `ADMINIUM_CSP_IMG_HOSTS`, and until now it was fixed when the server
 * started. Adminium Designer writes screens while the server runs: a host a
 * person allows there has to count at once, or the answer to "why is the
 * picture broken" is "restart". So the list is held here, and a host added
 * to it is in the header of the next reply.
 *
 * Still named hosts and never a scheme: see `ADMINIUM_CSP_IMG_HOSTS` in
 * `env.ts` for why. Nothing here writes a file; whoever adds a host also
 * keeps it (the Designer writes the project's `.env`).
 */
import { parseImageHostSource } from './env.js';

export interface PictureHosts {
  /** Every source named, the ones the server started with first. */
  list(): readonly string[];
  /** The ones added since the server started: what the header gains. */
  added(): readonly string[];
  /** Whether a picture on this host, over https, is let through. */
  covers(host: string): boolean;
  /** Add a source (`https://images.example.com`). Returns false when it is not one, or is already there. */
  add(source: string): boolean;
}

/** `https://*.cdn.example.com` covers `a.cdn.example.com`; `https://x.com` covers `x.com` alone. */
function sourceCovers(source: string, host: string): boolean {
  const match = /^https:\/\/(\*\.)?([^:/]+)$/.exec(source);
  if (match === null) return false;
  const name = match[2] as string;
  return match[1] === undefined ? host === name : host.endsWith(`.${name}`);
}

export function createPictureHosts(initial: readonly string[]): PictureHosts {
  const started = [...initial];
  const added: string[] = [];
  return {
    list: () => [...started, ...added],
    added: () => added,
    covers(host) {
      const name = host.toLowerCase();
      return [...started, ...added].some((source) => sourceCovers(source, name));
    },
    add(source) {
      const parsed = parseImageHostSource(source);
      if (parsed === null || started.includes(parsed) || added.includes(parsed)) return false;
      added.push(parsed);
      return true;
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The sites pictures may load from. Absent in a harness that does not register the core plugin. */
    pictureHosts: PictureHosts;
  }
}
