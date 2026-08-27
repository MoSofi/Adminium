// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Locating hosted app surfaces (28-public-surface.md successor — the
 * hosted-in-Adminium spike).
 *
 * A "surface" is one built frontend an app manifest declares under
 * `frontends[]`: `{ side: 'staff' | 'customer', kind: 'spa', … }`. Adminium
 * serves them itself, at the same origin as the dashboard, so a micro-SaaS app
 * needs neither its own deployment nor a CORS allowance.
 *
 * ─── Layout ──────────────────────────────────────────────────────────────────
 *
 *   <surfacesDir>/<appKey>/<side>/index.html
 *
 * e.g. `surfaces/clients/staff/index.html` → served at `/apps/clients/staff/`.
 *
 * This resolver is the SPIKE mechanism deliberately: a directory an operator
 * points at, discovered at boot. The real thing installs surfaces from a
 * manifest + tarball, which is the installer (13-T03/T04) and does not exist.
 * Keeping discovery this dumb means the spike measures the serving and auth
 * questions rather than the installer's.
 *
 * A miss degrades to "no surfaces", exactly as `static-root.ts` degrades to an
 * API-only boot — never a crash.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The two sides an app frontend may take.
 *
 * Mirrors `FRONTEND_SIDES` in `@adminium/manifest` (`packages/manifest/src/schema.ts`).
 * Duplicated rather than imported because `apps/server` does not depend on that
 * package and the spike is not the place to add one — if this outlives the
 * spike, take the dependency and delete this.
 */
export const SURFACE_SIDES = ['staff', 'customer'] as const;
export type SurfaceSide = (typeof SURFACE_SIDES)[number];

/**
 * One navigable screen, as the build declared it (29-app-surfaces.md D7).
 *
 * `labels` is keyed by BCP-47 tag and carries every locale the app ships; the
 * server resolves to the session's locale when it puts these in `/bootstrap`,
 * so an operator reading Danish gets Danish sections without a rebuild.
 */
export interface SurfaceNavItem {
  id: string;
  /** Path under the surface's base, no leading slash. */
  path: string;
  /** lucide icon name, kebab-case. */
  icon?: string;
  /** A lens within the side (28-T44) — renders as its own sidebar row. */
  persona?: string;
  labels: Record<string, string>;
}

/** The parsed `surface.json`, when the build wrote one. */
export interface SurfaceManifest {
  v: number;
  appLabels: Record<string, string>;
  nav: SurfaceNavItem[];
}

export interface HostedSurface {
  /** Manifest key of the owning app, e.g. `clients`. */
  appKey: string;
  side: SurfaceSide;
  /** Absolute directory holding this surface's `index.html`. */
  root: string;
  /** URL prefix it is served under, no trailing slash: `/apps/clients/staff`. */
  prefix: string;
  /**
   * The build-emitted nav contract, or null.
   *
   * NULL IS NOT AN ERROR. It means "this surface predates the toolkit, or was
   * built by an older one" — the surface still serves perfectly at
   * `/apps/<key>/<side>/`; only the INTERNAL placement is unavailable, and
   * Studio says exactly that rather than showing an empty section or crashing.
   * That degradation is the same argument `resolveStaticRoot` makes for an
   * API-only boot, and it is why this is parsed defensively rather than with a
   * schema that throws.
   */
  manifest: SurfaceManifest | null;
}

/** The shape version this server understands. A newer file is ignored. */
export const SURFACE_JSON_VERSION = 1;

/**
 * Parse a `surface.json` that a build wrote, or return null.
 *
 * Defensive on purpose, and every rejection below is a real thing a file on
 * disk can be: absent, half-written by an interrupted build, valid JSON of the
 * wrong shape, or emitted by a newer toolkit than this server knows. None of
 * them may take the server down, and none of them may produce a HALF-parsed
 * nav — a section with no path is worse than no section.
 */
export function parseSurfaceManifest(raw: string): SurfaceManifest | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== 'object') return null;
  const obj = doc as Record<string, unknown>;
  if (obj['v'] !== SURFACE_JSON_VERSION) return null;

  const labelsOf = (value: unknown): Record<string, string> | null => {
    if (value === null || typeof value !== 'object') return null;
    const out: Record<string, string> = {};
    for (const [tag, label] of Object.entries(value as Record<string, unknown>)) {
      if (typeof label !== 'string' || label === '') return null;
      out[tag] = label;
    }
    return Object.keys(out).length === 0 ? null : out;
  };

  const appLabels = labelsOf(obj['appLabels']);
  if (appLabels === null) return null;
  if (!Array.isArray(obj['nav'])) return null;

  const nav: SurfaceNavItem[] = [];
  for (const entry of obj['nav'] as unknown[]) {
    if (entry === null || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const id = item['id'];
    const path = item['path'];
    const labels = labelsOf(item['labels']);
    // `path` may be EMPTY (a surface whose only screen is its root) but never
    // absolute — the base differs per placement and is prepended by the reader.
    if (typeof id !== 'string' || id === '') return null;
    if (typeof path !== 'string' || path.startsWith('/')) return null;
    if (labels === null) return null;
    nav.push({
      id,
      path,
      labels,
      ...(typeof item['icon'] === 'string' ? { icon: item['icon'] } : {}),
      ...(typeof item['persona'] === 'string' ? { persona: item['persona'] } : {}),
    });
  }
  return { v: SURFACE_JSON_VERSION, appLabels, nav };
}

/** The one label to show, for a locale, with the en-US fallback D7 requires. */
export function resolveLabel(labels: Record<string, string>, locale: string): string {
  return labels[locale] ?? labels['en-US'] ?? Object.values(labels)[0] ?? '';
}

/** Root of the hosted-surface URL space. Free of any dashboard route. */
export const SURFACES_URL_ROOT = '/apps';

export interface ResolveSurfacesOptions {
  /** Explicit override (`ADMINIUM_SURFACES_DIR`) — wins outright. */
  override?: string | undefined;
  /** Test seam. */
  exists?: (path: string) => boolean;
  /** Test seam. */
  readdir?: (path: string) => string[];
  /** Test seam. Throwing is treated as "no manifest", never as a boot failure. */
  readFile?: (path: string) => string;
}

/**
 * Every surface under `dir`, in a stable order (app key, then side).
 *
 * Order matters for the boot log and for tests: a directory listing is not
 * sorted on every filesystem, and a route table that reorders between boots is
 * the kind of thing that makes an intermittent failure look like a code change.
 */
export function discoverSurfaces(
  dir: string | undefined,
  opts: ResolveSurfacesOptions = {},
): HostedSurface[] {
  if (dir === undefined || dir === '') return [];
  const exists = opts.exists ?? existsSync;
  const readFile = opts.readFile ?? ((path: string): string => readFileSync(path, 'utf8'));
  const readdir =
    opts.readdir ??
    ((path: string): string[] =>
      readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name));

  const base = resolve(dir);
  if (!exists(base)) return [];

  const found: HostedSurface[] = [];
  let appKeys: string[];
  try {
    appKeys = readdir(base);
  } catch {
    return [];
  }

  for (const appKey of [...appKeys].sort()) {
    for (const side of SURFACE_SIDES) {
      const root = join(base, appKey, side);
      // The `index.html` test, not a directory test: an empty `staff/` left
      // behind by a failed build must not register a route that 404s everything.
      if (!exists(join(root, 'index.html'))) continue;
      /*
       * Read ONCE, at boot, alongside discovery — not per request. The file is
       * a build artifact of a bundle already on disk; re-reading it would put a
       * filesystem hit on the bootstrap path for a value that cannot change
       * while the server runs. An operator who rebuilds a surface restarts, the
       * same as adding one.
       */
      let manifest: SurfaceManifest | null = null;
      const manifestPath = join(root, 'surface.json');
      if (exists(manifestPath)) {
        try {
          manifest = parseSurfaceManifest(readFile(manifestPath));
        } catch {
          // Unreadable is the same as absent: the surface still serves, the
          // internal placement is just unavailable.
          manifest = null;
        }
      }

      found.push({
        appKey,
        side,
        root,
        prefix: `${SURFACES_URL_ROOT}/${appKey}/${side}`,
        manifest,
      });
    }
  }
  return found;
}

/**
 * The configured surfaces directory, or `undefined`.
 *
 * Unlike `resolveStaticRoot` there is no candidate list to search: the
 * dashboard ships inside the package and can be looked for in two known
 * places, whereas surfaces belong to the operator and there is nowhere
 * sensible to guess.
 */
export function resolveSurfacesDir(opts: ResolveSurfacesOptions = {}): string | undefined {
  const override = opts.override ?? process.env['ADMINIUM_SURFACES_DIR'];
  if (override === undefined || override === '') return undefined;
  return resolve(override);
}
