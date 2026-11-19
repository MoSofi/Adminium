// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site's wish not to be read, as its `robots.txt` says it (RFC 9309).
 *
 * The website reader reads one page of a company's site, and only where the
 * site lets a tool read it. This file holds the parts that need no network:
 * reading a `robots.txt` into the rules for this reader, and judging a path
 * against them; and the small cache that keeps a host's rules for a day.
 *
 * - The group for this reader is the one whose user-agent names `Adminium`
 *   (or `Adminium-LeadFinder`, the full product token), matched without
 *   regard to case; with none, the `*` group; with neither, everything is
 *   allowed. Several groups for the same name are read as one.
 * - The longest matching rule wins; an allow and a disallow of the same length
 *   is an allow. `*` matches any run of characters, a final `$` the end.
 * - `/robots.txt` itself is always allowed.
 * - The work is bounded, whatever the site writes: a rule longer than
 *   {@link ROBOTS_PATTERN_MAX} characters, or more than {@link ROBOTS_RULES_MAX}
 *   rules for this reader, make the file one this reader will not judge by,
 *   and a path longer than {@link ROBOTS_PATH_MAX} is not read; every judgement
 *   stops after {@link ROBOTS_STEPS_MAX} steps of matching. Each of these reads
 *   as "this site asks not to be read": a site that writes such a file, or
 *   sends the reader to such a path, is not read, and the server never spends
 *   long on it.
 *
 * Whether a missing file allows and a failing server blocks is the fetcher's
 * to decide (4xx allows, 5xx blocks): this file sees only text.
 */

/** The product tokens this reader answers to in a `user-agent` line, in lower case. */
export const ROBOTS_TOKENS: readonly string[] = ['adminium', 'adminium-leadfinder'];

/** The most of a `robots.txt` that is read (RFC 9309 asks a reader to take at least 500 KiB). */
export const ROBOTS_MAX_BYTES = 500 * 1024;

export interface RobotsRule {
  allow: boolean;
  /** The path pattern, percent-escapes in upper case. */
  pattern: string;
}

/** The rules that apply to this reader on one host. Empty: everything is allowed. */
export interface RobotsRules {
  rules: RobotsRule[];
  /** A file too large to judge by (a rule too long, too many rules): nothing on the host is read. */
  refused?: true;
}

/** The longest rule this reader judges by (Google's parser keeps lines about this long). */
export const ROBOTS_PATTERN_MAX = 2048;
/** The most rules for this reader it judges by. */
export const ROBOTS_RULES_MAX = 2000;
/** The longest path (with its query) it judges. */
export const ROBOTS_PATH_MAX = 2048;
/** The most steps of matching one judgement takes, across every rule: a few milliseconds. */
export const ROBOTS_STEPS_MAX = 2_000_000;

/** The leading product token of a `user-agent` value: letters, `_` and `-` (the product token rule of RFC 9309). */
const tokenOf = (value: string): string => /^[A-Za-z_-]*/.exec(value.trim())?.[0]?.toLowerCase() ?? '';

/** Percent-escapes in one case, and any character outside ASCII escaped, so a rule and a path compare alike. */
function normalisePath(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7e && code >= 0x21) {
      out += char;
      continue;
    }
    try {
      out += encodeURIComponent(char);
    } catch {
      // A lone surrogate has no escape: it is left out, as a browser would.
    }
  }
  return out.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
}

/** Reads a `robots.txt` into the rules for this reader. */
export function parseRobots(text: string): RobotsRules {
  const named: RobotsRule[] = [];
  const anyone: RobotsRule[] = [];
  let namedSeen = false;
  // The group being read: who it is for, and whether its rules have started (a user-agent line after a rule opens a new group).
  let forUs = false;
  let forAnyone = false;
  let inRules = false;
  let inGroup = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (inRules || !inGroup) {
        forUs = false;
        forAnyone = false;
        inRules = false;
      }
      inGroup = true;
      if (value === '*') forAnyone = true;
      else if (ROBOTS_TOKENS.includes(tokenOf(value))) {
        forUs = true;
        namedSeen = true;
      }
      continue;
    }
    if (key !== 'allow' && key !== 'disallow') continue;
    // A rule before any user-agent line belongs to no group.
    if (!inGroup) continue;
    inRules = true;
    // An empty disallow disallows nothing; an empty allow allows nothing more.
    if (value === '') continue;
    if (!forUs && !forAnyone) continue;
    const rule = { allow: key === 'allow', pattern: normalisePath(value) };
    // A rule too long to judge by: the file is not one to judge by.
    if (rule.pattern.length > ROBOTS_PATTERN_MAX) return { rules: [], refused: true };
    if (forUs) named.push(rule);
    if (forAnyone) anyone.push(rule);
  }
  const rules = namedSeen ? named : anyone;
  return rules.length > ROBOTS_RULES_MAX ? { rules: [], refused: true } : { rules };
}

/** What one judgement may still spend, in steps of matching. */
interface Budget {
  left: number;
}

/** A judgement that ran out of steps. */
class OverBudget extends Error {}

/**
 * Whether `pattern` matches the start of `path`: `*` any run of characters, a final `$` the end of the path.
 * Matched by hand, not by a regular expression; each step is counted against `budget`, so a rule full of `*`
 * against a long path cannot make the match take long (it throws {@link OverBudget} instead).
 */
function matches(pattern: string, path: string, budget: Budget): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  let p = 0;
  let s = 0;
  let star = -1;
  let starAt = 0;
  while (s < path.length) {
    budget.left -= 1;
    if (budget.left < 0) throw new OverBudget();
    if (p < body.length && body[p] !== '*' && body[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (p < body.length && body[p] === '*') {
      star = p;
      starAt = s;
      p += 1;
    } else if (p === body.length && !anchored) {
      // The whole pattern matched a beginning of the path: a prefix is enough.
      return true;
    } else if (star !== -1) {
      p = star + 1;
      starAt += 1;
      s = starAt;
    } else {
      return false;
    }
  }
  while (p < body.length && body[p] === '*') p += 1;
  return p === body.length;
}

/** The length a rule counts for when two match: its pattern's characters, a final `$` not counted. */
const weight = (rule: RobotsRule): number => rule.pattern.replace(/\$$/, '').length;

/** Whether the path (with its query) may be read under these rules (see the header for what is not judged). */
export function robotsAllows(robots: RobotsRules, pathAndQuery: string): boolean {
  const path = normalisePath(pathAndQuery === '' ? '/' : pathAndQuery);
  if (path === '/robots.txt') return true;
  if (robots.refused === true || path.length > ROBOTS_PATH_MAX) return false;
  const budget: Budget = { left: ROBOTS_STEPS_MAX };
  let best: RobotsRule | null = null;
  try {
    for (const rule of robots.rules) {
      if (!matches(rule.pattern, path, budget)) continue;
      if (best === null || weight(rule) > weight(best) || (weight(rule) === weight(best) && rule.allow && !best.allow)) best = rule;
    }
  } catch (error) {
    if (error instanceof OverBudget) return false;
    throw error;
  }
  return best === null || best.allow;
}

/** The size a host's rules take in the cache, roughly: what bounds it is the patterns' text. */
const sizeOf = (robots: RobotsRules): number => robots.rules.reduce((total, rule) => total + rule.pattern.length + 16, 64);

/**
 * A host's rules, kept for at most a day, in memory, bounded both in hosts and in size. Only rules that were
 * read (or a missing file) are kept: a host whose server failed is asked again next time.
 */
export interface RobotsCache {
  get(origin: string): RobotsRules | null;
  set(origin: string, robots: RobotsRules): void;
}

export const ROBOTS_KEEP_MS = 24 * 60 * 60 * 1000;

export function createRobotsCache(opts: { now: () => number; maxHosts?: number; maxSize?: number }): RobotsCache {
  const maxHosts = opts.maxHosts ?? 1000;
  const maxSize = opts.maxSize ?? 4 * 1024 * 1024;
  // A Map keeps insertion order: the first entry is the oldest, and is the one dropped.
  const kept = new Map<string, { robots: RobotsRules; at: number; size: number }>();
  let total = 0;
  const drop = (origin: string): void => {
    const entry = kept.get(origin);
    if (entry === undefined) return;
    kept.delete(origin);
    total -= entry.size;
  };
  return {
    get(origin) {
      const entry = kept.get(origin);
      if (entry === undefined) return null;
      if (opts.now() - entry.at >= ROBOTS_KEEP_MS) {
        drop(origin);
        return null;
      }
      return entry.robots;
    },
    set(origin, robots) {
      drop(origin);
      const size = sizeOf(robots);
      // One host's rules larger than the whole cache are used once and not kept.
      if (size > maxSize) return;
      kept.set(origin, { robots, at: opts.now(), size });
      total += size;
      for (const oldest of kept.keys()) {
        if (kept.size <= maxHosts && total <= maxSize) break;
        drop(oldest);
      }
    },
  };
}
