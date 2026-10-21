#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium design` for the pictures e2e (`tests/designer-pictures.spec.ts`): the same start as the
 * command (`startProject`, design mode, in the project folder this runs in), with Openverse and the
 * host its pictures are on answered by a fake in this process.
 *
 * The fake is reached through the safe fetch's own seams, handed to the server in-process
 * (`pictureSeams`): `resolve` gives every name a public address, `connect` answers the request here.
 * There is no flag or variable for this: a server started any other way calls the real sources.
 *
 * Usage, from the project folder: node picture-design.mjs --port <port>
 * Prints "Open this link once to sign in: <link>" as the command does, and stops on SIGTERM/SIGINT.
 */
import { randomBytes } from 'node:crypto';

import { startProject } from '@adminium/server';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('picture-design: give --port <port>');
  process.exit(2);
}

/** A 4×3 PNG: every picture and every small copy the fake hosts serve. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4UWEDRww4OQBiHhHR6R4GfQAAAABJRU5ErkJggg==', 'base64');

/** Calls by kind, printed for the spec: what a search, a small copy and a picked original cost. */
const calls = { search: 0, thumb: 0, original: 0 };

const stream = (status, type, bytes) => ({ status, headers: { 'content-type': type, 'content-length': String(bytes.length) }, body: (async function* () { yield bytes; })(), destroy: () => {} });

/** Openverse's search, and the pictures it names: each with a credit asked (CC BY). */
function answer(url) {
  if (url.hostname === 'api.openverse.org' && url.pathname === '/v1/images/') {
    calls.search += 1;
    const words = url.searchParams.get('q') ?? '';
    const slug = words.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const results = Array.from({ length: 6 }, (_, index) => ({
      title: `${words} ${String(index + 1)}`,
      url: `https://pictures.e2e/${slug}-${String(index)}.png`,
      thumbnail: `https://api.openverse.org/v1/images/${slug}-${String(index)}/thumb/`,
      creator: `Maker ${String(index + 1)}`,
      creator_url: `https://pictures.e2e/people/${String(index)}`,
      license: 'by',
      license_version: '2.0',
      license_url: 'https://creativecommons.org/licenses/by/2.0/',
      foreign_landing_url: `https://pictures.e2e/photos/${slug}-${String(index)}`,
    }));
    return stream(200, 'application/json', Buffer.from(JSON.stringify({ page_count: 1, results })));
  }
  if (url.hostname === 'api.openverse.org' && url.pathname.endsWith('/thumb/')) {
    calls.thumb += 1;
    return stream(200, 'image/png', PNG);
  }
  if (url.hostname === 'pictures.e2e') {
    calls.original += 1;
    return stream(200, 'image/png', PNG);
  }
  return stream(404, 'text/plain', Buffer.from('not here'));
}

const pictureSeams = {
  resolve: async () => [{ address: '151.101.1.1', family: 4 }],
  connect: async (target) => {
    const reply = answer(target.url);
    console.log(`[pictures] ${target.url.hostname}${target.url.pathname} ${JSON.stringify(calls)}`);
    return reply;
  },
};

const token = randomBytes(32).toString('hex');
const started = await startProject({ root: process.cwd(), port, mode: 'design', token, env: process.env, pictureSeams });
console.log(`Open this link once to sign in: http://127.0.0.1:${String(started.port)}/design#designToken=${token}`);

const stop = async () => {
  await started.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
