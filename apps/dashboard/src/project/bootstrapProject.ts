// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the bootstrap payload says about the project a server runs: its
 * database keys, and its built pages and widgets. Plain reads, with no
 * imports of their own, so the UI kit can use them without reaching the
 * loader that installs it (`client.ts`).
 */

import type {
  BootstrapData,
  BootstrapProject,
  ProjectClientEntry,
  ProjectClientFile,
  ProjectClientPage,
  ProjectClientWidget,
} from '../app/bootstrap.js';

export type { BootstrapProject, ProjectClientEntry, ProjectClientFile, ProjectClientPage, ProjectClientWidget };

/** The project this server runs, or null. */
export function projectOf(bootstrap: BootstrapData | undefined): BootstrapProject | null {
  return bootstrap?.project ?? null;
}

/** The connection a project database key names, or null. */
export function connectionForDatabase(bootstrap: BootstrapData | undefined, database: string): string | null {
  return projectOf(bootstrap)?.databases[database] ?? null;
}

export function projectPageFor(bootstrap: BootstrapData | undefined, slug: string): ProjectClientPage | null {
  return projectOf(bootstrap)?.client?.pages.find((page) => page.slug === slug) ?? null;
}
