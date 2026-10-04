// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a design needs from outside the project: npm packages, fonts (which
 * are packages too), and sites pictures are shown from.
 *
 * A model says what it wants; this decides what the person is asked. What the
 * project already has is left out. Each package's version is the server's to
 * find, never the model's to guess. And the things Adminium itself knows
 * (React, Tailwind, the icon set, a font of Google's catalogue) are told
 * apart from a name only the model vouches for: the first are offered ticked
 * and with a plain line of what each is, the second unticked and said to be
 * unknown. A name one or two letters from a known one is not offered at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PUBLIC_CLIENT_PACKAGE } from '../project/apps/scaffold-app.js';
import { fontPackage, FONT_FAMILY } from '../project/apps/theme.js';

/** npm's own rule for a package name, scoped or not. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** An exact version: no range, no tag, no URL. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** A host a picture may come from: names with a dot, no wildcard, no port, no address. */
export const PICTURE_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/** The React an app's screens are built with here. */
export const DESIGNER_REACT_VERSION = '19.2.0';
export const TAILWIND_PACKAGE = 'tailwindcss';
export const ICONS_PACKAGE = 'lucide-react';
/** What the made parts of `src/ui/` are written with. */
export const UI_HELPER_PACKAGES = ['clsx', 'tailwind-merge'] as const;

/** What a known package is for: the page words its line from this, in the person's language. */
export type NeedRole = 'screens' | 'public-client' | 'tailwind' | 'icons' | 'ui' | 'other';

const KNOWN: Readonly<Record<string, NeedRole>> = {
  react: 'screens',
  'react-dom': 'screens',
  [PUBLIC_CLIENT_PACKAGE]: 'public-client',
  [TAILWIND_PACKAGE]: 'tailwind',
  [ICONS_PACKAGE]: 'icons',
  clsx: 'ui',
  'tailwind-merge': 'ui',
};

/** What a known package is for; `other` for a name Adminium does not know. */
export const roleOf = (name: string): NeedRole => KNOWN[name] ?? 'other';

export type NeedItem =
  | { id: string; kind: 'package'; name: string; version: string; role: NeedRole; why?: string }
  | { id: string; kind: 'font'; family: string; name: string; version: string; use: 'heading' | 'body' | 'other'; why?: string }
  | { id: string; kind: 'picture-site'; host: string; why?: string };

/** What is wanted, before anyone is asked. */
export type Wanted =
  | { kind: 'package'; name: string; why?: string }
  | { kind: 'font'; family: string; use: 'heading' | 'body' | 'other'; why?: string }
  | { kind: 'picture-site'; host: string; why?: string };

/** The model's reason, as data: one short line of plain words. */
export function cleanWhy(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = [...value]
    .map((mark) => ((mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f' || '<>`'.includes(mark) ? ' ' : mark))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return line === '' ? undefined : line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/** How many single-letter changes turn `a` into `b`, counted up to 3. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      row[j] = Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1), swap ? (previous[j - 1] as number) : 99);
    }
    previous = row;
  }
  return Math.min(previous[b.length] as number, 3);
}

/** The known package a name is a letter or two away from, without being it; null when it is none. */
export function lookAlikeOf(name: string): string | null {
  if (KNOWN[name] !== undefined) return null;
  const bare = name.replace(/^@[^/]+\//, '');
  for (const known of Object.keys(KNOWN)) {
    const knownBare = known.replace(/^@[^/]+\//, '');
    if (knownBare.length >= 4 && distance(bare, knownBare) <= 2) return known;
  }
  if (/^@fontsourc\w*\//.test(name) && !name.startsWith('@fontsource/') && !name.startsWith('@fontsource-variable/')) return '@fontsource/…';
  return null;
}

/** The packages a project already lists. */
export function listedPackages(root: string): Set<string> {
  try {
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    return new Set([...Object.keys(json.devDependencies ?? {}), ...Object.keys(json.dependencies ?? {})]);
  } catch {
    return new Set();
  }
}

export const hasPackageJson = (root: string): boolean => existsSync(join(root, 'package.json'));

export interface NeedsPlan {
  items: NeedItem[];
  /** What was asked for and is already there: nothing to ask. */
  already: string[];
  /** What cannot be offered, each with the sentence the model is told. */
  refused: { what: string; why: string }[];
}

export interface PlanDeps {
  root: string;
  /** This engine's version: the public client's. */
  version: string;
  /** The newest version of a package the registry has; null when it has no such package. Throws when the registry cannot be asked. */
  newest(name: string): Promise<string | null>;
  /** Whether pictures from a host are already let through. */
  covers(host: string): boolean;
  /** Null where a person's yes can add a picture site; else why not. */
  sitesClosed(): string | null;
}

/** The one version this server knows is right for a package, or null. */
export function fixedVersion(name: string, serverVersion: string): string | null {
  if (name === PUBLIC_CLIENT_PACKAGE) return serverVersion;
  if (name === 'react' || name === 'react-dom') return DESIGNER_REACT_VERSION;
  return null;
}

/**
 * What to put on a card for `wanted`: what is already there taken out, each
 * version filled in, what cannot be offered said. Known things first, in the
 * order they were asked; names only the model vouches for last.
 */
export async function planNeeds(deps: PlanDeps, wanted: readonly Wanted[]): Promise<NeedsPlan> {
  const listed = listedPackages(deps.root);
  const plan: NeedsPlan = { items: [], already: [], refused: [] };
  const seen = new Set<string>();
  const version = async (name: string): Promise<string | null | 'unreachable'> => {
    const fixed = fixedVersion(name, deps.version);
    if (fixed !== null) return fixed;
    try {
      const found = await deps.newest(name);
      return found !== null && EXACT_VERSION.test(found) ? found : null;
    } catch {
      return 'unreachable';
    }
  };
  for (const want of wanted) {
    const why = cleanWhy(want.why);
    if (want.kind === 'picture-site') {
      const host = want.host.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/.*$/, '');
      const id = `site:${host}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!PICTURE_HOST.test(host)) plan.refused.push({ what: host.slice(0, 80), why: `"${host.slice(0, 80)}" is not a site's host. Give the host alone, like images.example.com: no http://, no path, no "*".` });
      else if (deps.covers(host)) plan.already.push(`pictures from ${host}`);
      else if (deps.sitesClosed() !== null) plan.refused.push({ what: host, why: `${deps.sitesClosed() as string} Use no picture from another site, and tell the person in a sentence.` });
      else plan.items.push({ id, kind: 'picture-site', host, ...(why === undefined ? {} : { why }) });
      continue;
    }
    if (want.kind === 'font') {
      const family = want.family.trim().replace(/\s+/g, ' ');
      const name = fontPackage(family);
      const id = `font:${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!FONT_FAMILY.test(family) || family.length > 40) {
        plan.refused.push({ what: family.slice(0, 40), why: `"${family.slice(0, 40)}" is not a font's name. Give a family of Google's catalogue as it is written there, like "Playfair Display".` });
        continue;
      }
      if (listed.has(name)) {
        plan.already.push(family);
        continue;
      }
      const found = await version(name);
      if (found === 'unreachable') plan.refused.push({ what: family, why: `The font "${family}" could not be looked up (the package registry did not answer). The system's own font stands in; go on.` });
      else if (found === null) plan.refused.push({ what: family, why: `There is no font "${family}" in the catalogue. Use the style's own fonts, or name another family of Google's catalogue.` });
      else plan.items.push({ id, kind: 'font', family, name, version: found, use: want.use, ...(why === undefined ? {} : { why }) });
      continue;
    }
    const name = want.name.trim();
    const id = `package:${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!PACKAGE_NAME.test(name) || name.length > 214) {
      plan.refused.push({ what: name.slice(0, 80), why: `"${name.slice(0, 80)}" is not an npm package name.` });
      continue;
    }
    if (listed.has(name)) {
      plan.already.push(name);
      continue;
    }
    const alike = lookAlikeOf(name);
    if (alike !== null) {
      plan.refused.push({ what: name, why: `"${name}" is not offered: it is one or two letters from "${alike}", which is the package people mean. Ask for that one by its exact name.` });
      continue;
    }
    const found = await version(name);
    if (found === 'unreachable') plan.refused.push({ what: name, why: `"${name}" could not be looked up (the package registry did not answer), so it cannot be added now. Do without it.` });
    else if (found === null) plan.refused.push({ what: name, why: `There is no npm package "${name}". Do not guess another name: do without it.` });
    else plan.items.push({ id, kind: 'package', name, version: found, role: roleOf(name), ...(why === undefined ? {} : { why }) });
  }
  // What Adminium knows first (they are offered ticked), then what only the model vouches for.
  const known = (item: NeedItem): boolean => item.kind !== 'package' || item.role !== 'other';
  plan.items = [...plan.items.filter(known), ...plan.items.filter((item) => !known(item))].slice(0, 16);
  return plan;
}

/** Whether a card's item is one Adminium itself knows, and so offers ticked. */
export const isKnownNeed = (item: NeedItem): boolean => item.kind === 'font' || (item.kind === 'package' && item.role !== 'other');

/** What the model is told to do in place of something the person left out. */
export function withoutLine(item: NeedItem): string {
  if (item.kind === 'font') return `${item.family}: the system's own font stands in. Change nothing for it.`;
  if (item.kind === 'picture-site') return `pictures from ${item.host}: take them out, or find pictures with find_pictures.`;
  if (item.role === 'tailwind') return 'Tailwind: style with the made parts of app.css and your own rules in design.css. Use no Tailwind class.';
  if (item.role === 'icons') return `${item.name}: draw each icon as a small inline SVG. Never an emoji.`;
  if (item.role === 'ui') return `${item.name}: write the parts you need as plain components with classes of design.css.`;
  if (item.role === 'screens' || item.role === 'public-client') return `${item.name}: the screens cannot be built without it. Say so, and build what needs no screen.`;
  return `${item.name}: do without it.`;
}

/** A name in an item, for a sentence. */
export const needName = (item: NeedItem): string => (item.kind === 'font' ? item.family : item.kind === 'picture-site' ? `pictures from ${item.host}` : item.name);
