// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE DOOR A SURFACE'S PAGE LEAVES BY.
 *
 * An app's side is a folder of built files, and its page is that folder's
 * `index.html`. Every way the page can be reached (the side's own path, an
 * extra instance's, a mapped host's root, a deep link that falls back to it)
 * sends it through `sendSurfaceIndex`, so there is one place that decides
 * what else goes with it. A test fails when `sendFile('index.html'` for a
 * surface appears anywhere but here.
 *
 * --- What may go with it: the assistant's loader ---------------------------
 *
 * On a STAFF side, to a signed-in person who may use the assistant, the page
 * is sent with one tag before its last `</body>`:
 *
 *   <script type="module" src="/assets/milo/loader.js" data-milo-loader data-app="<key>"></script>
 *
 * The loader is a file of the dashboard's own build, same-origin, so the
 * page's content policy allows it as it stands. Everything else of the page
 * is the file install verified, byte for byte.
 *
 * It is added only when ALL of these hold, and otherwise the file is sent as
 * it always was:
 *
 *  - the side is `staff` (a customer side never gets it, mapped or not);
 *  - the request carries a session, and that person holds
 *    `system:assistant:use`;
 *  - the assistant can exist here (this server was composed with it, and the
 *    workspace has not switched it off for staff addresses); whether a model
 *    is set up is the panel's to say, as it does in the dashboard;
 *  - the loader's file is in the static root this server serves (a build
 *    without it must not point every staff page at a script that is not
 *    there);
 *  - the page is not being loaded into a frame (inside the dashboard the
 *    shell's own button serves);
 *  - the file is UTF-8 text with a `</body>` to stand before.
 *
 * A page that carries the tag is the person's own: `no-store`, and it never
 * reuses the file's validators (a cached copy must not outlive a sign-out or
 * a revoked permission).
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';

/** The permission the assistant's own routes ask for. */
const ASSISTANT_USE = 'system:assistant:use';

/** Where the loader is served from: a file of the dashboard's build. */
export const MILO_LOADER_PATH = '/assets/milo/loader.js';

/** The one tag the server adds: the loader, told which app's page it is on (a key is letters, digits and dashes). */
export function miloLoaderTag(appKey: string): string {
  return `<script type="module" src="${MILO_LOADER_PATH}" data-milo-loader data-app="${appKey.replace(/[^a-z0-9-]/gi, '')}"></script>`;
}

/** What the door needs to know of the assistant on this server. */
export interface SurfaceAssistant {
  /** The loader's file is in the static root that is served. */
  loaderPresent(): boolean;
  /** This server has the assistant at all, and the workspace lets it onto staff addresses (its own switch). */
  on(): Promise<boolean>;
}

interface IndexSurface {
  root: string;
  side: string;
  appKey: string;
}

interface Rewritten {
  mtimeMs: number;
  size: number;
  /** The page with the tag, or null when this file is left alone (not UTF-8, no `</body>`). */
  html: string | null;
}

/** One rewritten page per root, kept while the file is the same file (time and size). */
const pages = new Map<string, Rewritten>();

/** The page with the loader before its last `</body>`, or null when the file is not one this can be said of. */
export function withLoader(bytes: Buffer, appKey: string): string | null {
  let html: string;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const at = html.toLowerCase().lastIndexOf('</body>');
  if (at === -1) return null;
  return `${html.slice(0, at)}${miloLoaderTag(appKey)}${html.slice(at)}`;
}

async function pageWithLoader(root: string, appKey: string): Promise<string | null> {
  const path = join(root, 'index.html');
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const held = pages.get(root);
  if (held !== undefined && held.mtimeMs === info.mtimeMs && held.size === info.size) return held.html;
  const html = withLoader(await readFile(path), appKey);
  pages.set(root, { mtimeMs: info.mtimeMs, size: info.size, html });
  return html;
}

/** Whether this request is the browser filling a frame: the dashboard's own view of an app. */
function intoAFrame(request: FastifyRequest): boolean {
  const dest = request.headers['sec-fetch-dest'];
  return dest === 'iframe' || dest === 'frame' || dest === 'embed' || dest === 'object';
}

/** Whether this person, on this side, is sent the loader. Every reason for "no" is one of the header's. */
export async function loaderGoesWith(request: FastifyRequest, surface: IndexSurface, assistant: SurfaceAssistant | undefined): Promise<boolean> {
  if (assistant === undefined || surface.side !== 'staff') return false;
  if (request.user === null || request.session === null) return false;
  if (intoAFrame(request)) return false;
  if (!assistant.loaderPresent()) return false;
  if (typeof request.can !== 'function' || !(await request.can(ASSISTANT_USE))) return false;
  return await assistant.on();
}

/**
 * Send a surface's page. With `assistant` absent (a server composed without
 * one) this is exactly `reply.sendFile('index.html', surface.root)`.
 */
export async function sendSurfaceIndex(request: FastifyRequest, reply: FastifyReply, surface: IndexSurface, assistant?: SurfaceAssistant): Promise<FastifyReply> {
  if (await loaderGoesWith(request, surface, assistant)) {
    const html = await pageWithLoader(surface.root, surface.appKey);
    if (html !== null) {
      void reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('vary', 'cookie, sec-fetch-dest');
      // A HEAD answers the headers of the page it would send, and no body.
      return reply.send(request.method === 'HEAD' ? '' : html);
    }
  }
  return reply.sendFile('index.html', surface.root);
}
