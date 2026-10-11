// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The phone side's preview: Expo's export for the web, served at
 * `/apps/<key>/mobile/` in a project that is being designed or developed, and
 * nowhere else.
 *
 * It is one route with a build folder of its own. The lists that serve an
 * app's web sides never learn of it, so a server that runs a project
 * (`adminium start`), a packed app and an installed app have no path to it: a
 * phone app is not a second website.
 *
 * It answers on this machine only (`localhost`, `127.0.0.1`, `[::1]`),
 * whatever address the server listens on: `adminium dev` listens on every
 * address by default, and the preview is not for the network. A phone reaches
 * its app through the phone door, which is another thing.
 */
import { readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { NotFoundError } from '../errors.js';
import { PHONE_SIDE, hasPhoneCode, phoneBuildDir } from '../project/apps/phone.js';
import { listAppKeys } from '../project/apps/read-app.js';
import { builtPhone } from '../project/apps/phone-build.js';
import { DEV_BUILD_FILE } from './surfaces.js';

export interface PhonePreviewOptions {
  /** The project's folder. */
  root: string;
  /** The app's own stamp (it moves when the app was applied again), or null. */
  appBuild: (key: string) => string | null;
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether the request came from this machine, to one of this machine's own names. */
export function fromThisMachine(request: Pick<FastifyRequest, 'ip' | 'headers'>): boolean {
  const host = (request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_NAMES.has(host) && LOOPBACK_ADDRESSES.has(request.ip);
}

/** Every file of a built phone preview, by its path inside the build; no dot file, and no link followed. */
function builtFiles(root: string, prefix = '', out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) builtFiles(root, path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** An app's key as a folder may be named: nothing that leaves `apps/`. */
const KEY = /^[a-z][a-z0-9-]{1,79}$/;

export function registerPhonePreview(app: FastifyInstance, opts: PhonePreviewOptions): void {
  const none = (reply: FastifyReply): FastifyReply => reply.code(404).header('cache-control', 'no-store').send({ error: { code: 'NOT_FOUND', message: 'There is no phone preview here.' } });

  const serve = async (request: FastifyRequest<{ Params: { key: string; '*'?: string } }>, reply: FastifyReply): Promise<FastifyReply> => {
    if (!fromThisMachine(request) || !KEY.test(request.params.key)) return none(reply);
    // The app is one of this project's own folders, named as the folder is: what the address said is only looked up among them.
    const key = listAppKeys(opts.root).find((known) => known === request.params.key);
    if (key === undefined || !hasPhoneCode(opts.root, key)) return none(reply);
    const rest = request.params['*'] ?? '';
    void reply.header('referrer-policy', 'no-referrer');

    // What the open preview asks once a second, to reload when the phone side or the app was built again.
    if (rest === DEV_BUILD_FILE) {
      void reply.header('cache-control', 'no-store');
      return reply.send({ build: `${builtPhone(opts.root, key)?.build ?? '-'}:${opts.appBuild(key) ?? '-'}` });
    }
    // The customer's own document: the phone app is a customer of the app, and in the preview it is a page of this origin.
    if (rest === 'surface-config.json') {
      void reply.header('cache-control', 'no-store');
      try {
        const doc = await app.customerSurfaceConfig(key, request);
        return doc === null ? none(reply) : reply.send(doc);
      } catch (error) {
        if (error instanceof NotFoundError) return none(reply);
        throw error;
      }
    }
    if (builtPhone(opts.root, key) === null) return none(reply);
    const root = phoneBuildDir(opts.root, key);
    // A file of the build, named as the build's own folder lists it: what the address said is only looked up in that list.
    const file = rest === 'index.html' ? undefined : builtFiles(root).find((known) => known === rest);
    // Never kept: the next build must be what the next look shows.
    void reply.header('cache-control', 'no-store');
    if (file !== undefined && file !== 'adminium-phone.json') return reply.sendFile(file, root, { cacheControl: false });
    // A file asked for by name that is not there is not the page.
    if (/\.[a-z0-9]{1,8}$/i.test(rest) && rest !== 'index.html') return none(reply);
    return reply.type('text/html; charset=utf-8').sendFile('index.html', join(root), { cacheControl: false });
  };

  app.get(`/apps/:key/${PHONE_SIDE}`, async (request: FastifyRequest<{ Params: { key: string } }>, reply) => {
    if (!fromThisMachine(request) || !KEY.test(request.params.key)) return none(reply);
    return reply.redirect(`/apps/${request.params.key}/${PHONE_SIDE}/`, 302);
  });
  app.get(`/apps/:key/${PHONE_SIDE}/*`, serve);
}
