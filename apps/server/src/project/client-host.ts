// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a project server tells the dashboard about the project, and the files
 * it serves it:
 *
 * - `bootstrap()`: the database keys, and every built page and widget with the
 *   URLs of its module, chunks and stylesheets and their integrity hashes;
 * - `readFile(path)`: one built file, only when the build lists it and its
 *   bytes still match the hash the build recorded.
 *
 * Decorated on the app as `projectClient` when the server runs a project, and
 * read by `GET /bootstrap` at request time: that route is registered before
 * the project wiring exists.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import type { MetaDb } from '@adminium/meta';

import { CLIENT_DIR, CLIENT_PUBLIC_PATH, WIDGET_ID_PREFIX, type BuiltClientFile } from './client-build.js';
import type { ProjectCodeRuntime } from './code/runtime.js';

export interface ProjectClientFileRef {
  url: string;
  integrity: string;
}

export interface ProjectClientEntryRef {
  module: ProjectClientFileRef;
  imports: ProjectClientFileRef[];
  styles: ProjectClientFileRef[];
}

export interface BootstrapProject {
  databases: Record<string, string>;
  client: {
    digest: string;
    pages: (ProjectClientEntryRef & { slug: string })[];
    widgets: (ProjectClientEntryRef & { id: string; kind: 'cell' | 'card'; title: string | null })[];
  } | null;
}

export type ClientFileRead =
  | { status: 'ok'; bytes: Buffer; contentType: string }
  | { status: 'missing' }
  | { status: 'changed' };

export interface ProjectClientHost {
  bootstrap(): Promise<BootstrapProject>;
  readFile(path: string): Promise<ClientFileRead>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the server runs a project folder. */
    projectClient: ProjectClientHost;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

export function createProjectClientHost(opts: { meta: MetaDb; runtime: ProjectCodeRuntime | null }): ProjectClientHost {
  const { meta, runtime } = opts;
  return {
    async bootstrap() {
      const rows = await meta.db
        .selectFrom('adminium_connections')
        .select(['id', 'projectKey'])
        .where('projectKey', 'is not', null)
        .execute();
      const databases: Record<string, string> = {};
      for (const row of rows) if (row.projectKey !== null) databases[row.projectKey] = row.id;
      if (runtime === null) return { databases, client: null };

      const client = runtime.client();
      const files = new Map<string, BuiltClientFile>(client.files.map((file) => [file.path, file]));
      const ref = (path: string): ProjectClientFileRef => ({
        url: `${CLIENT_PUBLIC_PATH}${path}`,
        integrity: files.get(path)?.integrity ?? '',
      });
      const entry = (built: { module: string; imports: string[]; styles: string[] }): ProjectClientEntryRef => ({
        module: ref(built.module),
        imports: built.imports.map(ref),
        styles: built.styles.map(ref),
      });
      return {
        databases,
        client: {
          digest: client.digest,
          pages: client.pages.map((page) => ({ slug: page.name, ...entry(page) })),
          widgets: client.widgets.map((widget) => ({
            id: `${WIDGET_ID_PREFIX}${widget.name}`,
            kind: widget.kind,
            title: widget.title,
            ...entry(widget),
          })),
        },
      };
    },

    async readFile(path) {
      if (runtime === null) return { status: 'missing' };
      const file = runtime.client().files.find((candidate) => candidate.path === path);
      if (file === undefined) return { status: 'missing' };
      // The build lists the path; containment is checked anyway.
      const base = join(runtime.buildDir, CLIENT_DIR);
      const absolute = resolve(base, ...path.split('/'));
      if (!absolute.startsWith(`${base}${sep}`)) return { status: 'missing' };
      let bytes: Buffer;
      try {
        bytes = await readFile(absolute);
      } catch {
        return { status: 'missing' };
      }
      if (createHash('sha256').update(bytes).digest('hex') !== file.hash) return { status: 'changed' };
      return { status: 'ok', bytes, contentType: contentTypeFor(path) };
    },
  };
}
