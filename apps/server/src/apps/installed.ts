// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installed apps, projected into the surfaces the rest of the server already
 * knows how to serve (47-app-installation.md D2, D4).
 *
 * An installed package holds one directory per side:
 *
 *   <dataDir>/apps/<key>/<version>/staff/index.html
 *   <dataDir>/apps/<key>/<version>/customer/index.html
 *
 * — the same `<side>/` split `npm run build:surface` writes into
 * `dist-surface/<key>/`, carried through `npm pack`'s `package/` root, which
 * the unpack strips. So one installed app produces the same
 * {@link HostedSurface} records `cli/surfaces-root.ts` produces for a directory
 * the operator pointed at, and everything downstream — the staff gate, the
 * placement settings, the domain map, `/bootstrap`'s nav, Studio's list —
 * works on both sources without knowing there are two.
 *
 * ─── Why this is a registry and not a boot-time read ────────────────────────
 *
 * Boot-time discovery is right for `ADMINIUM_SURFACES_DIR`: those files arrive
 * by deploy, so a restart is already in the loop. An INSTALL happens while the
 * server is running, and "now restart your server" is not an install. So the
 * installed set is held here, re-read on demand, and served by a hook rather
 * than by routes fixed at boot — which is exactly the argument
 * `plugins/surfaces.ts` already makes for extra instances, for the same reason:
 * a setting that only takes effect after a deploy is one people stop trusting.
 *
 * ─── Absence is never an error ──────────────────────────────────────────────
 *
 * A row whose package directory is gone (a wiped data volume, a half-finished
 * uninstall) contributes no surfaces rather than throwing: the app stops being
 * served, Studio still lists the install, and the operator can uninstall it
 * cleanly. The same defensiveness `parseSurfaceManifest` applies to a
 * half-written `surface.json` applies here to the whole tree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SURFACES_URL_ROOT,
  SURFACE_SIDES,
  parseSurfaceManifest,
  type HostedSurface,
} from '../cli/surfaces-root.js';
import type { AppStore } from './store.js';

/** One installed app, as the meta row names it. */
export interface InstalledAppRef {
  key: string;
  version: string;
}

/**
 * The surfaces one installed package exposes, in `SURFACE_SIDES` order.
 *
 * Never throws: an unsafe key or version is refused by `dirFor`, and a refusal
 * means this package contributes nothing — a row that cannot name a safe path
 * must not be able to take the server down at boot or on a refresh.
 */
export function surfacesOfInstalled(store: AppStore, ref: InstalledAppRef): HostedSurface[] {
  let dir: string;
  try {
    dir = store.dirFor(ref.key, ref.version);
  } catch {
    return [];
  }

  const found: HostedSurface[] = [];
  for (const side of SURFACE_SIDES) {
    const root = join(dir, side);
    // The `index.html` test, not a directory test — the same rule discovery
    // uses: an empty `customer/` must not register a mount that 404s.
    if (!existsSync(join(root, 'index.html'))) continue;

    let manifest = null;
    const manifestPath = join(root, 'surface.json');
    if (existsSync(manifestPath)) {
      try {
        manifest = parseSurfaceManifest(readFileSync(manifestPath, 'utf8'));
      } catch {
        // Unreadable is the same as absent: the surface still serves and only
        // the internal placement is unavailable (29 D7's degradation).
        manifest = null;
      }
    }

    found.push({
      appKey: ref.key,
      side,
      root,
      prefix: `${SURFACES_URL_ROOT}/${ref.key}/${side}`,
      manifest,
    });
  }
  return found;
}

/**
 * The live set of installed-app surfaces.
 *
 * `current()` is synchronous and allocation-free on the hot path because it is
 * read per request by the serve hook; `refresh()` is the only thing that does
 * I/O, and the install and uninstall routes call it.
 */
export interface InstalledApps {
  current(): readonly HostedSurface[];
  refresh(): Promise<readonly HostedSurface[]>;
}

export function createInstalledApps(deps: {
  store: AppStore;
  /** Installed app rows, newest first — `manifestsRepo(...).list('app')`. */
  list: () => Promise<readonly InstalledAppRef[]>;
}): InstalledApps {
  let surfaces: readonly HostedSurface[] = [];

  return {
    current: () => surfaces,
    async refresh() {
      const rows = await deps.list();
      const next: HostedSurface[] = [];
      /*
       * FIRST ROW WINS per `<key>/<side>`. `list('app')` is newest-first, so on
       * the brief overlap an upgrade creates — two rows for one key — the newer
       * package is the one served, and the older one is inert rather than
       * shadowing it by arriving second.
       */
      const seen = new Set<string>();
      for (const row of rows) {
        for (const surface of surfacesOfInstalled(deps.store, row)) {
          const id = `${surface.appKey}/${surface.side}`;
          if (seen.has(id)) continue;
          seen.add(id);
          next.push(surface);
        }
      }
      surfaces = next;
      return surfaces;
    },
  };
}
