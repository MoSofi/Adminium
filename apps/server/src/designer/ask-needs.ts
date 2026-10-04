// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Asking a person for what a design needs, on one card, and adding what they
 * ticked.
 *
 * Whatever asks (a new side, a change of style, the model's own request)
 * comes through here, so there is one card with one list, and never one card
 * per package. What the person leaves out is kept with the app's look: an app
 * that does without Tailwind is not asked about Tailwind again.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { applyLook, missingFonts, readLook, type Look } from '../project/apps/look.js';
import { projectPackageManager } from '../project/package-manager.js';
import { APPS_DIR, type AppSide } from '../project/apps/read-app.js';
import { PUBLIC_CLIENT_PACKAGE } from '../project/apps/scaffold-app.js';
import { runChild } from './child.js';
import { ICONS_PACKAGE, isKnownNeed, needName, planNeeds, TAILWIND_PACKAGE, UI_HELPER_PACKAGES, withoutLine, type NeedItem, type Wanted } from './needs.js';
import type { PictureSites, ToolContext } from './tool-types.js';

/** How long a package install may run. */
const INSTALL_TIMEOUT_MS = 180_000;

export interface NeedsDeps {
  root: string;
  version: string;
  pictureSites?: PictureSites;
  newestVersion?: (name: string, signal?: AbortSignal) => Promise<string | null>;
  stylesDir?: string | null;
  /** Add packages to the project. Null when it worked; else what the manager said. A test gives its own. */
  install?: (specs: readonly { name: string; version: string }[], signal: AbortSignal) => Promise<string | null>;
}

export interface NeedsOutcome {
  /** Whether a card was shown. */
  asked: boolean;
  added: NeedItem[];
  /** What the person left unticked. */
  left: NeedItem[];
  /** What the manager said when the install failed. */
  failed: string | null;
  /** What to tell the model, whole. */
  said: string;
}

export type NeedsAsker = (ctx: Pick<ToolContext, 'ask' | 'signal' | 'handle'>, appKey: string, wanted: readonly Wanted[]) => Promise<NeedsOutcome>;

/** Add packages to the project, exact versions, no install scripts. */
export function installer(root: string): NonNullable<NeedsDeps['install']> {
  return async (specs, signal) => {
    const manager = projectPackageManager(root, {});
    const exact = manager === 'npm' || manager === 'pnpm' ? '--save-exact' : '--exact';
    const args = [manager === 'npm' ? 'install' : 'add', ...specs.map((spec) => `${spec.name}@${spec.version}`), '--ignore-scripts', exact];
    const result = await runChild(manager, args, { cwd: root, timeoutMs: INSTALL_TIMEOUT_MS, signal });
    return result.code === 0 ? null : `${manager} ${args.join(' ')} failed:\n${result.output.split('\n').slice(-30).join('\n')}`;
  };
}

/**
 * What an app with screens of its own needs, all of it, for its first card:
 * what the screens are built with, the styling toolkit, the icon set, the
 * helpers of the made parts, and the fonts of its style. `planNeeds` takes
 * out what the project has; what the app said it does without is taken out here.
 */
export function screenWants(root: string, appKey: string, opts: { side: AppSide; publicToo: boolean; look: Look | null; stylesDir?: string | null }): Wanted[] {
  const without = new Set(opts.look?.without ?? []);
  const customer = opts.side === 'customer' || opts.publicToo || existsSync(join(root, APPS_DIR, appKey, 'customer', 'src'));
  const wants: Wanted[] = [
    { kind: 'package', name: 'react' },
    { kind: 'package', name: 'react-dom' },
    ...(customer ? [{ kind: 'package' as const, name: PUBLIC_CLIENT_PACKAGE }] : []),
    { kind: 'package', name: TAILWIND_PACKAGE },
    { kind: 'package', name: ICONS_PACKAGE },
    // The made parts' helpers are of use only with Tailwind: an app that does without it is not asked for them.
    ...(without.has(TAILWIND_PACKAGE) ? [] : UI_HELPER_PACKAGES.map((name) => ({ kind: 'package' as const, name }))),
    ...(opts.look === null ? [] : missingFonts(root, opts.look, opts.stylesDir === undefined ? undefined : { builtInDir: opts.stylesDir }).map((font) => ({ kind: 'font' as const, family: font.family, use: font.use }))),
  ];
  return wants.filter((want) => !without.has(want.kind === 'package' ? want.name : want.kind === 'font' ? want.family : want.host));
}

export function createNeedsAsker(deps: NeedsDeps): NeedsAsker {
  const install = deps.install ?? installer(deps.root);
  const places = deps.stylesDir === undefined ? undefined : { builtInDir: deps.stylesDir };
  /** What a person left out, by app and turn: asked once a turn, and a no is kept. */
  const leftOut = new Map<string, Set<string>>();
  return async (ctx, appKey, wanted) => {
    const plan = await planNeeds(
      {
        root: deps.root,
        version: deps.version,
        newest: (name) => {
          if (deps.newestVersion === undefined) throw new Error('no registry here');
          return deps.newestVersion(name, ctx.signal);
        },
        covers: (host) => deps.pictureSites?.covers(host) ?? false,
        sitesClosed: () => (deps.pictureSites === undefined ? 'This server cannot allow a picture site from here.' : deps.pictureSites.closed()),
      },
      wanted,
    );
    const lines: string[] = [];
    if (plan.already.length > 0) lines.push(`Already in the project: ${plan.already.join(', ')}.`);
    for (const refusal of plan.refused) lines.push(refusal.why);
    const turnKey = `${appKey}:${String(ctx.handle.turn)}`;
    const before = leftOut.get(turnKey) ?? new Set<string>();
    const again = plan.items.filter((item) => before.has(item.id));
    if (again.length > 0) lines.push(`The person already left these out in this turn. Do not ask again; do without:\n${again.map((item) => `- ${withoutLine(item)}`).join('\n')}`);
    plan.items = plan.items.filter((item) => !before.has(item.id));
    if (plan.items.length === 0) return { asked: false, added: [], left: again, failed: null, said: lines.join('\n') || 'Nothing was asked for.' };

    const answer = await ctx.ask({ type: 'needs', items: plan.items });
    const ticked = new Set(answer.type === 'needs' ? answer.accept : []);
    const added = plan.items.filter((item) => ticked.has(item.id));
    const left = plan.items.filter((item) => !ticked.has(item.id));
    leftOut.set(turnKey, new Set([...before, ...left.map((item) => item.id)]));

    const packages = added.flatMap((item) => (item.kind === 'picture-site' ? [] : [{ name: item.name, version: item.version }]));
    let failed: string | null = null;
    if (packages.length > 0) failed = await install(packages, ctx.signal);
    for (const item of added) {
      if (item.kind !== 'picture-site') continue;
      try {
        deps.pictureSites?.add(item.host, ctx.handle.by);
      } catch (error) {
        lines.push(`The site ${item.host} could not be kept: ${error instanceof Error ? error.message : String(error)} Use no picture from it.`);
      }
    }

    // What the app does without is kept with its look, and what it now carries is written into its sides (a font's files, by fonts.css).
    const look = readLook(deps.root, appKey);
    if (look !== null) {
      const without = new Set(look.without ?? []);
      for (const item of left) if (isKnownNeed(item)) without.add(item.kind === 'font' ? item.family : needName(item));
      for (const item of added) without.delete(item.kind === 'font' ? item.family : needName(item));
      const { without: _before, ...rest } = look;
      applyLook(deps.root, appKey, without.size === 0 ? rest : { ...rest, without: [...without].sort() }, places);
    }

    if (failed !== null) lines.push(`These could not be added:\n${failed}`);
    else if (added.length > 0) lines.push(`Added: ${added.map(needName).join(', ')}.`);
    if (left.length > 0) lines.push(`The person left these out. Do not ask for them again; do without:\n${left.map((item) => `- ${withoutLine(item)}`).join('\n')}`);
    return { asked: true, added: failed === null ? added : added.filter((item) => item.kind === 'picture-site'), left, failed, said: lines.join('\n') };
  };
}
