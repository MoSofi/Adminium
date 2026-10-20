#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium design` for the Figma e2e (`tests/designer-figma.spec.ts`): the same start as the
 * command (`startProject`, design mode, in the project folder this runs in), with Figma answered by
 * a fake in this process.
 *
 * The fake is reached through the safe fetch's own seams, handed to the server in-process
 * (`figmaSeams`): `resolve` gives every name a public address, `connect` answers the request here.
 * There is no flag or variable for this: a server started any other way calls api.figma.com.
 *
 * Usage, from the project folder: node figma-design.mjs --port <port>
 * Prints "Open this link once to sign in: <link>" as the command does, and stops on SIGTERM/SIGINT.
 */
import { randomBytes } from 'node:crypto';

import { startProject } from '@adminium/server';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('figma-design: give --port <port>');
  process.exit(2);
}

/** A 4×3 PNG: what Figma's storage serves for every render. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4UWEDRww4OQBiHhHR6R4GfQAAAABJRU5ErkJggg==', 'base64');
const KEY = 'CrIsPyBiTeS0123456';
const TOKEN = 'figd_e2e_token_0001';

/** The one frame the fake file holds: a page with a heading, a picture and a button. */
const frame = {
  document: {
    id: '1:2',
    name: 'Home / Desktop',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1024 },
    layoutMode: 'VERTICAL',
    itemSpacing: 24,
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 32,
    paddingRight: 32,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0.98, b: 0.95, a: 1 } }],
    children: [
      { id: '1:3', name: 'Title', type: 'TEXT', characters: 'Crispy Bites', style: { fontFamily: 'Fraunces', fontWeight: 800, fontSize: 48, lineHeightPx: 56 }, fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.1, b: 0.05, a: 1 } }] },
      { id: '1:4', name: 'Hero photo', type: 'RECTANGLE', fills: [{ type: 'IMAGE', scaleMode: 'FILL' }], absoluteBoundingBox: { x: 32, y: 120, width: 1376, height: 480 }, cornerRadius: 20 },
      { id: '1:5', name: 'Order', type: 'FRAME', layoutMode: 'HORIZONTAL', paddingTop: 12, paddingBottom: 12, paddingLeft: 24, paddingRight: 24, cornerRadius: 999, fills: [{ type: 'SOLID', color: { r: 0.85, g: 0.3, b: 0.1, a: 1 } }], absoluteBoundingBox: { x: 32, y: 624, width: 180, height: 48 }, children: [{ id: '1:6', name: 'Label', type: 'TEXT', characters: 'Order ahead', style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 16 } }] },
    ],
  },
  components: {},
  styles: {},
};

/** Calls by kind, printed for the spec: reads Figma counts are `nodes` and `images`. */
const calls = { me: 0, meta: 0, nodes: 0, images: 0, download: 0 };

const json = (status, body) => {
  const bytes = Buffer.from(JSON.stringify(body));
  return { status, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) }, body: (async function* () { yield bytes; })(), destroy: () => {} };
};

/** Figma's REST API and its storage, as far as the Designer reads them. */
function answer(url, headers) {
  if (url.hostname === 'figma-storage.e2e') {
    calls.download += 1;
    return { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) }, body: (async function* () { yield PNG; })(), destroy: () => {} };
  }
  if (url.hostname !== 'api.figma.com') return json(404, {});
  if (headers['x-figma-token'] !== TOKEN) return json(403, { status: 403, err: 'Invalid token' });
  if (url.pathname === '/v1/me') {
    calls.me += 1;
    return json(200, { id: '4242', handle: 'crispy.design', email: 'design@crispy.test' });
  }
  const key = decodeURIComponent(url.pathname.split('/')[3] ?? '');
  if (key !== KEY) return json(404, { status: 404, err: 'Not found' });
  if (url.pathname.endsWith('/meta')) {
    calls.meta += 1;
    return json(200, { file: { name: 'Crispy Bites', version: '7', last_touched_at: '2026-10-20T10:00:00Z' } });
  }
  const ids = (url.searchParams.get('ids') ?? '').split(',');
  if (url.pathname.endsWith('/nodes')) {
    calls.nodes += 1;
    return json(200, { name: 'Crispy Bites', version: '7', lastModified: '2026-10-20T10:00:00Z', nodes: Object.fromEntries(ids.map((id) => [id, id === '1:2' ? frame : null])) });
  }
  calls.images += 1;
  return json(200, { err: null, images: Object.fromEntries(ids.map((id) => [id, `https://figma-storage.e2e/render/${encodeURIComponent(id)}.png`])) });
}

const figmaSeams = {
  resolve: async () => [{ address: '151.101.1.1', family: 4 }],
  connect: async (target, opts) => {
    const reply = answer(target.url, opts.headers);
    console.log(`[figma] ${target.url.pathname} ${JSON.stringify(calls)}`);
    return reply;
  },
};

const token = randomBytes(32).toString('hex');
const started = await startProject({ root: process.cwd(), port, mode: 'design', token, env: process.env, figmaSeams });
console.log(`Open this link once to sign in: http://127.0.0.1:${String(started.port)}/design#designToken=${token}`);

const stop = async () => {
  await started.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
