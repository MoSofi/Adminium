#!/usr/bin/env node
/**
 * @adminium/tokens — WCAG 2.1 contrast gate.
 *
 * Implements the audit promised twice in the specs:
 *   - 02-design-system.md task 02-T15 — `packages/tokens/scripts/contrast-check.mjs`
 *   - 15-quality.md §7.4        — the 8-accent x 2-theme "contrast matrix"
 * Those two specs describe ONE audit under two names; this file is that audit, placed at the
 * 02-T15 path because it must sit next to (and parse) the token CSS it validates and be wired
 * into this package's own `test` script. §7.4's pair table is implemented in full here.
 *
 * HOW IT WORKS
 *   1. Parses the real CSS in ../src/{tokens,accents,exceptions}.css — no palette is hardcoded,
 *      so the gate can never drift from the tokens. The accent list, the theme list, the
 *      exception scopes and the TOKEN VOCABULARY are all discovered from the CSS.
 *   2. Replays the cascade for each (theme, accent) state against the single root element that
 *      actually carries these attributes (pre-hydration.ts stamps data-theme AND data-accent on
 *      <html>): rules are ordered by specificity, then source order. Each exception scope
 *      (.adm-always-dark / .adm-always-light) is then replayed as a DESCENDANT of that root —
 *      see EXCEPTION SCOPES below.
 *   3. Resolves var() chains and evaluates `color-mix(in srgb, A p%, B)` exactly (alpha-
 *      premultiplied, per css-color-5), so derived tokens such as --accent-soft are measured,
 *      not skipped. Translucent tokens are composited over the surface they are used on before
 *      the ratio is taken.
 *   4. Computes WCAG 2.1 relative luminance (sRGB -> linearise -> L) and (L1+.05)/(L2+.05).
 *
 * AT-RULES — DELIBERATE, LOUD REFUSAL
 *   The parser tracks brace nesting, so `@media (...) { :root { --x: … } }` is recognised as a
 *   CONDITIONAL declaration rather than mistaken for a top-level rule (the previous flat regex
 *   silently promoted such declarations into the unconditional cascade, at the END of source
 *   order, where they won every tie — a false PASS). This gate does not model media/support
 *   conditions: it cannot know which condition a user's device satisfies, and evaluating only
 *   one branch would be a guess. So a token declared inside ANY conditional group rule
 *   (@media/@supports/@container/@layer/@scope) is a hard error naming the file and prelude.
 *   To ship such a token, either lift it out of the at-rule or teach this script to enumerate
 *   the condition as an extra axis (like `theme` and `accent` already are) — both are explicit
 *   decisions; neither is silent. Bodies of non-conditional at-rules (@font-face, @keyframes,
 *   @property) declare nothing on the root element and are skipped. Native CSS nesting is
 *   refused the same way: a nested rule that declares tokens raises rather than being flattened.
 *
 * EXCEPTION SCOPES
 *   src/exceptions.css re-declares the WHOLE token set on .adm-always-dark / .adm-always-light —
 *   genuinely inverted subtrees (a dark code block inside a light page). Those subtrees are
 *   measured as their own states, discovered from the CSS (every class selector that declares
 *   custom properties becomes a scope). A scope is an element BELOW the root, so:
 *     - the scope's own declarations always win over the root's, regardless of specificity;
 *     - a token the scope does NOT re-declare keeps the value COMPUTED ON THE ROOT — including
 *       the root's --accent. That is real CSS semantics (var() in a custom property is
 *       substituted on the element that declares it, then the computed value inherits), and it
 *       is why every scope x root-theme combination is measured separately rather than assumed
 *       identical.
 *
 * TOKEN VOCABULARY — DERIVED, NOT LISTED
 *   Roles are recognised by shape (--bg/--surface*, --fg*, --code-*, <tone>/<tone>-soft, and the
 *   enumerated --accent* roles). Every custom property whose value parses as a colour must land
 *   in a role or in SKIPPED; an unrecognised colour token is a hard error. Adding --fg-faint or
 *   --surface-4 therefore gains full coverage automatically, and adding --brand fails loudly
 *   instead of shipping unmeasured.
 *
 * DELIBERATE SKIPS (see SKIPPED below for the printed rationale)
 *   --shadow*, --accent-glow, --scrim, --border*, viz.css.
 *
 * Usage:  node scripts/contrast-check.mjs [--all] [--strict] [--json]
 *   --all     print every measured pair, not just failures (the §7.4 artifact table)
 *   --strict  promote the documented exemptions (EXEMPT groups below) to hard failures.
 *             `pnpm run contrast` (and therefore CI) passes --strict: the exemption mechanism
 *             exists to DOCUMENT a shortfall, never to downgrade one silently.
 *   --json    emit machine-readable results instead of the table
 * Exits 1 if any GATED pair is below its threshold.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FILES = ['tokens.css', 'accents.css', 'exceptions.css'];

const AA_TEXT = 4.5; // WCAG 1.4.3 — normal-size text
const UI_NONTEXT = 3.0; // WCAG 1.4.11 — non-text contrast (focus ring, control boundary, state fill)

/**
 * What each measured group is, and whether it BLOCKS the build.
 *
 * `gated: true`  — a failure here fails CI. These are the load-bearing pairs: every text
 *                  foreground on every surface and on every tint it can be painted over, the
 *                  focus ring and the hover fill at the 1.4.11 floor, the primary-button label
 *                  in both its resting and hover states, and every semantic tone on its soft
 *                  partner.
 * `gated: false` — the documented exemption list 02-T15 requires this script to carry. Such a
 *                  group is still measured and still printed (as WARN), and `--strict` promotes
 *                  it to a failure — and CI runs `--strict`, so an exemption added here turns
 *                  the build red until someone removes it deliberately. THE LIST IS CURRENTLY
 *                  EMPTY: 02-T15 anticipated exempting --fg-subtle (~2.9:1) and §7.4 anticipated
 *                  exempting the dark black accent, and both were instead fixed in the palette.
 */
const GROUPS = {
  text: {
    gated: true,
    label: 'foreground text on surface (WCAG 1.4.3)',
  },
  'code-ink': {
    gated: true,
    label: 'syntax colours on the code surfaces of an exception scope (WCAG 1.4.3)',
  },
  'focus-ring': {
    gated: true,
    label: 'accent as focus ring / non-text indicator (WCAG 1.4.11)',
  },
  'state-fill': {
    gated: true,
    label: '--accent-hover as a state fill against the resting surface (WCAG 1.4.11)',
  },
  'accent-button': {
    gated: true,
    label: 'primary-button label: --accent-fg on --accent',
  },
  'accent-hover': {
    gated: true,
    label: 'primary-button label in hover state: --accent-fg on --accent-hover',
  },
  semantic: {
    gated: true,
    label: 'semantic tone on its -soft partner',
  },
  'text-on-soft': {
    gated: true,
    label: 'neutral copy on a soft tint (Alert title/body, chip labels, active rows)',
  },
  'accent-text': {
    gated: true,
    label: '--accent used as TEXT on a plain surface (links, Toast action, active ⌘K row)',
  },
  'accent-soft': {
    gated: true,
    label: '--accent on --accent-soft over --surface (Tag, Badge, soft Button, active nav row)',
  },
  /* The same pill re-parented onto a deeper grey: the tint composites over --surface-2 /
     --surface-3 instead of white, costing 3-9%. Gated too — the light accents clear it. */
  'accent-soft-deep': {
    gated: true,
    label: '--accent on --accent-soft over the deeper greys (--surface-2 / --surface-3)',
  },
  'text-on-tint': {
    gated: true,
    label: 'neutral copy on the other translucent accent tints (--accent-selection, --accent-border)',
  },
};

const SKIPPED = [
  ['--shadow, --shadow-md, --shadow-lg', 'elevation, not a text/background pair'],
  ['--accent-glow', 'shadow token; the ring it accompanies is checked via --accent at 3:1'],
  ['--scrim', 'modal dimmer; darkens the backdrop, carries no information'],
  ['--border, --border-strong', 'decorative separators; component state is carried by --accent (checked at 3:1)'],
  ['--accent-light, --accent-dark', 'per-theme INPUTS; the theme selects one into --accent, which is measured'],
  ['viz-1..8 (viz.css)', 'series palette governed by the adjacency rules in 02-design-system.md §1.3'],
  ['density/motion/fonts/tailwind.css', 'declare no colour of their own — enforced by the sweep below, not assumed'],
];

/** The one file allowed to declare colours this gate does not measure (see SKIPPED). */
const UNMEASURED_COLOUR_FILES = new Set(['viz.css']);

/** Custom properties that are colours but carry no text/background obligation (see SKIPPED). */
const SKIP_TOKENS = new Set(['--border', '--border-strong', '--scrim', '--accent-light', '--accent-dark']);

/** Conditional group rules — their contents are scoped to a condition this gate cannot evaluate. */
const CONDITIONAL_AT_RULES = new Set(['media', 'supports', 'container', 'scope', 'layer']);

/* ------------------------------------------------------------------ CSS parsing */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Index of the '}' matching the '{' at `open`, quote-aware. */
function matchBrace(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced braces in token CSS');
}

/** Split a declaration block into prop/value pairs, ignoring any nested block. */
function declarationsOf(body) {
  const decls = new Map();
  for (const raw of body.split(';')) {
    const i = raw.indexOf(':');
    if (i === -1) continue;
    const prop = raw.slice(0, i).trim();
    const value = raw.slice(i + 1).trim();
    if (prop && !prop.includes('{') && !prop.includes('}')) decls.set(prop, value);
  }
  return decls;
}

/**
 * Parse CSS into rules, tracking brace nesting.
 * @returns {{selectors: string[], decls: Map<string,string>, order: number, at: string[],
 *            nested: boolean, file: string}[]}
 */
function parseRules(css, file = '(inline)') {
  const rules = [];
  let order = 0;

  const walk = (text, at) => {
    let i = 0;
    let prelude = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '{') {
        const end = matchBrace(text, i);
        const body = text.slice(i + 1, end);
        const sel = prelude.trim();
        if (sel.startsWith('@')) {
          const name = sel.slice(1).split(/[\s({]/)[0].toLowerCase();
          // Conditional group rules keep their prelude on the stack so a token declared inside
          // one can be reported with its condition; everything else (@font-face, @keyframes,
          // @property) declares nothing on the root element and is skipped wholesale.
          if (CONDITIONAL_AT_RULES.has(name)) walk(body, [...at, sel.replace(/\s+/g, ' ')]);
        } else {
          // Strip (and flag) native-nesting blocks so their contents cannot be mistaken for
          // declarations of the outer rule.
          let flat = '';
          let hadNested = false;
          let j = 0;
          let carry = '';
          while (j < body.length) {
            if (body[j] === '{') {
              hadNested = true;
              j = matchBrace(body, j) + 1;
              carry = '';
              continue;
            }
            if (body[j] === ';') {
              flat += `${carry};`;
              carry = '';
            } else carry += body[j];
            j += 1;
          }
          flat += carry;
          rules.push({
            selectors: sel.split(',').map((s) => s.trim()).filter(Boolean),
            decls: declarationsOf(flat),
            order: (order += 1),
            at,
            nested: hadNested,
            file,
          });
        }
        i = end + 1;
        prelude = '';
      } else if (ch === '}' || ch === ';') {
        // '}' ends a block; ';' ends a STATEMENT at-rule (@import, @charset, @namespace), whose
        // text must not be carried into the next rule's prelude — that would turn the following
        // `:root {…}` into the body of an at-rule and drop every token in it.
        i += 1;
        prelude = '';
      } else {
        prelude += ch;
        i += 1;
      }
    }
  };

  walk(css, []);
  return rules.filter((r) => r.selectors.length && r.decls.size);
}

const declaresTokens = (rule) => [...rule.decls.keys()].some((k) => k.startsWith('--'));

const ATTR_RE = /\[([a-zA-Z-]+)\s*=\s*"([^"]*)"\]/g;
const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * Match a selector against ONE element of the replayed tree: either the root (state.scope ===
 * null), which carries every axis attribute, or an exception-scope element below it
 * (state.scope === '.adm-always-dark'), which carries only that class.
 *
 * Returns null when the selector cannot apply to that element (wrong theme/accent/scope, or a
 * descendant/child combinator, which needs two elements and therefore never matches when the
 * attributes are co-located on <html>). Ignored-but-token-bearing rules are surfaced loudly by
 * the caller so a fix written with an inapplicable selector cannot silently "pass" the gate.
 */
function matchSelector(selector, state) {
  if (/[>+~]/.test(selector)) return { kind: 'combinator' };
  if (/\s/.test(selector.trim())) return { kind: 'combinator' };
  const attrs = [...selector.matchAll(ATTR_RE)];
  const withoutAttrs = selector.replace(ATTR_RE, '');
  const classes = [...withoutAttrs.matchAll(CLASS_RE)].map((m) => `.${m[1]}`);
  const rest = withoutAttrs.replace(CLASS_RE, '');
  // Only :root / html / * are understood as the element itself.
  if (rest.trim() && !/^(:root|html|\*)+$/.test(rest.trim())) return { kind: 'unknown' };
  if (classes.length > 1) return { kind: 'unknown' };
  const scope = state.scope ?? null;
  // A single-class selector describes a scope element; an unclassed selector describes the root.
  if (classes.length === 1 ? classes[0] !== scope : scope !== null) return null;
  for (const [, name, value] of attrs) {
    if (name === 'data-theme' && value !== state.theme) return null;
    if (name === 'data-accent' && value !== state.accent) return null;
    if (name !== 'data-theme' && name !== 'data-accent') return { kind: 'unknown' };
  }
  // Specificity: attribute selectors, classes and pseudo-classes all count in the (a,B,c) B column.
  const pseudo = (rest.match(/:root/g) || []).length;
  return { kind: 'match', specificity: attrs.length + classes.length + pseudo };
}

/** Declarations that apply to one element, in cascade order (specificity, then source order). */
function declaredOn(rules, state) {
  const declared = [];
  const ignored = [];
  for (const rule of rules) {
    let best = null;
    for (const sel of rule.selectors) {
      const r = matchSelector(sel, state);
      if (r === null) continue;
      if (r.kind !== 'match') {
        if (declaresTokens(rule)) ignored.push(`${sel} (${r.kind})`);
        continue;
      }
      if (!best || r.specificity > best.specificity) best = r;
    }
    if (best) declared.push({ specificity: best.specificity, order: rule.order, decls: rule.decls });
  }
  declared.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const map = new Map();
  for (const d of declared) for (const [k, v] of d.decls) if (k.startsWith('--')) map.set(k, v);
  return { map, ignored: [...new Set(ignored)] };
}

/**
 * Substitute every var() in `raw`, looking names up in `own` first and falling back to
 * `inherited` (whose values are ALREADY substituted — that is what inheritance carries).
 */
function resolveAll(own, inherited) {
  const view = {
    has: (n) => own.has(n) || inherited.has(n),
    get: (n) => (own.has(n) ? own.get(n) : inherited.get(n)),
  };
  const out = new Map(inherited);
  for (const [name, raw] of own) out.set(name, expandVars(raw, view, new Set([name])));
  return out;
}

/**
 * Replay the cascade for one (theme, accent[, scope]) state.
 * `tokens` holds the raw declarations that reach the element; `resolved` holds the same tokens
 * with every var() substituted the way the browser would — on the element that DECLARED them.
 */
function resolveState(rules, state) {
  const root = declaredOn(rules, { theme: state.theme, accent: state.accent, scope: null });
  const rootResolved = resolveAll(root.map, new Map());
  if (!state.scope) return { tokens: root.map, resolved: rootResolved, ignored: root.ignored };
  const scope = declaredOn(rules, state);
  return {
    tokens: new Map([...root.map, ...scope.map]),
    resolved: resolveAll(scope.map, rootResolved),
    ignored: [...new Set([...root.ignored, ...scope.ignored])],
  };
}

/* --------------------------------------------------------------- value resolution */

function expandVars(value, tokens, seen = new Set()) {
  let out = value;
  for (let guard = 0; guard < 16 && out.includes('var('); guard += 1) {
    const i = out.indexOf('var(');
    const end = matchParen(out, i + 3);
    const inner = out.slice(i + 4, end);
    const comma = splitTop(inner)[0];
    const name = comma.trim();
    const fallback = splitTop(inner).slice(1).join(',').trim();
    if (seen.has(name)) throw new Error(`circular var() reference on ${name}`);
    const replacement = tokens.has(name) ? tokens.get(name) : fallback;
    if (replacement === undefined || replacement === '') throw new Error(`undefined token ${name}`);
    out = out.slice(0, i) + expandVars(replacement, tokens, new Set([...seen, name])) + out.slice(end + 1);
  }
  return out;
}

/** index of the ')' matching the '(' at or after `from` */
function matchParen(str, from) {
  const open = str.indexOf('(', from);
  let depth = 0;
  for (let i = open; i < str.length; i += 1) {
    if (str[i] === '(') depth += 1;
    else if (str[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parentheses in "${str}"`);
}

/** split on top-level commas */
function splitTop(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const NAMED = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] };

/** @returns {[r,g,b,a]} channels 0-255, alpha 0-1 */
function parseColor(input) {
  const value = input.trim();
  const lower = value.toLowerCase();
  if (lower in NAMED) return [...NAMED[lower]];

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const grab = (s) => parseInt(s.length === 1 ? s + s : s, 16);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = [...hex].map(grab);
      return [r, g, b, hex.length === 4 ? a / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const p = hex.match(/../g).map((h) => parseInt(h, 16));
      return [p[0], p[1], p[2], hex.length === 8 ? p[3] / 255 : 1];
    }
    throw new Error(`bad hex colour "${value}"`);
  }

  if (/^rgba?\(/i.test(value)) {
    const args = splitTop(value.slice(value.indexOf('(') + 1, matchParen(value, 0)))
      .flatMap((s) => s.trim().split(/[\s/]+/))
      .filter(Boolean);
    const num = (s, scale) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
    const [r, g, b] = args.slice(0, 3).map((s) => num(s, 255));
    const a = args.length > 3 ? num(args[3], 1) : 1;
    return [r, g, b, a];
  }

  if (/^color-mix\(/i.test(value)) return parseColorMix(value);

  throw new Error(`unsupported colour syntax "${value}"`);
}

/** color-mix(in srgb, A p%, B q%) — alpha-premultiplied, per css-color-5 §2.1. */
function parseColorMix(value) {
  const args = splitTop(value.slice(value.indexOf('(') + 1, matchParen(value, 0))).map((s) => s.trim());
  const space = args[0].replace(/^in\s+/i, '').trim();
  if (space !== 'srgb') throw new Error(`only "in srgb" color-mix is evaluated; got "${space}"`);
  if (args.length !== 3) throw new Error(`color-mix needs two colours: "${value}"`);

  const operands = args.slice(1).map((arg) => {
    const m = arg.match(/\s([\d.]+)%$/);
    return { color: parseColor(m ? arg.slice(0, m.index) : arg), pct: m ? parseFloat(m[1]) / 100 : null };
  });
  let [p1, p2] = operands.map((o) => o.pct);
  if (p1 === null && p2 === null) [p1, p2] = [0.5, 0.5];
  else if (p1 === null) p1 = 1 - p2;
  else if (p2 === null) p2 = 1 - p1;
  const sum = p1 + p2;
  if (sum === 0) throw new Error(`color-mix percentages sum to 0: "${value}"`);
  [p1, p2] = [p1 / sum, p2 / sum];

  const [c1, c2] = operands.map((o) => o.color);
  const alpha = c1[3] * p1 + c2[3] * p2;
  const chan = (i) =>
    alpha === 0 ? 0 : (c1[i] * c1[3] * p1 + c2[i] * c2[3] * p2) / alpha;
  return [chan(0), chan(1), chan(2), alpha];
}

/* --------------------------------------------------------------------- WCAG maths */

/** Composite a (possibly translucent) colour over an opaque backdrop. */
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]) {
  const lin = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* ------------------------------------------------------- the token vocabulary */

/**
 * The accent roles this gate knows how to measure. Anything else matching --accent* is a colour
 * with no defined obligation, and fails the vocabulary guard rather than shipping unmeasured.
 */
const ACCENT_ROLES = new Set([
  '--accent',
  '--accent-fg',
  '--accent-soft', // also reached through the generic "-soft" role
  '--accent-hover',
  '--accent-selection',
  '--accent-border',
]);
const ACCENT_NON_COLOUR = new Set(['--accent-glow']); // a box-shadow, not a colour

/**
 * Derive the vocabulary from the resolved token map instead of hardcoding names.
 * Every custom property whose value parses as a colour must land in a role here or in
 * SKIP_TOKENS; anything else raises. That is what keeps a NEW token (--fg-faint, --surface-4,
 * --brand) from gaining zero coverage silently.
 */
function vocabulary(resolved, where) {
  const names = [...resolved.keys()];
  const isColour = (n) => {
    try {
      parseColor(resolved.get(n));
      return true;
    } catch {
      return false;
    }
  };

  const surfaces = names.filter((n) => n === '--bg' || /^--surface(-\d+)?$/.test(n));
  const foregrounds = names.filter((n) => /^--fg(-[a-z0-9-]+)?$/.test(n));
  const codeInk = names.filter((n) => /^--code-[a-z0-9-]+$/.test(n));
  const softs = names.filter((n) => n.endsWith('-soft'));
  const tones = softs.map((s) => s.slice(0, -'-soft'.length)).filter((b) => names.includes(b) && b !== '--accent');
  const accentTints = ['--accent-soft', '--accent-selection', '--accent-border'].filter((n) => names.includes(n));

  // INK_ROLE_CANDIDATES are recognised NAMES with an unresolved role: inkRoleFor() raises on them
  // with the more specific message, so the generic guard must not shadow it.
  const covered = new Set([
    ...surfaces,
    ...foregrounds,
    ...codeInk,
    ...softs,
    ...tones,
    ...ACCENT_ROLES,
    ...INK_ROLE_CANDIDATES,
  ]);
  const unclassified = names.filter(
    (n) => !covered.has(n) && !SKIP_TOKENS.has(n) && !ACCENT_NON_COLOUR.has(n) && !/^--viz-/.test(n) && isColour(n)
  );
  if (unclassified.length) {
    throw new Error(
      `unclassified colour token(s) in ${where}: ${unclassified.join(', ')}\n` +
        '  This gate measures roles it recognises by shape (--bg/--surface*, --fg*, --code-*,\n' +
        '  <tone>/<tone>-soft, and the enumerated --accent* roles). Give the token one of those\n' +
        '  shapes, add it to ACCENT_ROLES with a check, or list it in SKIP_TOKENS/SKIPPED with a\n' +
        '  written reason. A colour token must never ship unmeasured.'
    );
  }
  if (!surfaces.length || !foregrounds.length) throw new Error(`no surfaces/foregrounds found in ${where}`);
  return { surfaces, foregrounds, codeInk, softs, tones, accentTints };
}

/* ------------------------------------------------------------------- the matrix */

const round = (n) => Math.round(n * 100) / 100;
const toHex = (c) =>
  '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('') +
  (c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '');

/**
 * 15-quality.md §7.4 anticipates a "documented token override" that splits the accent's
 * text/icon role from its fill role (the dark black accent). If such a token is ever added,
 * point INK_ROLE at it EXPLICITLY and the text/ring groups will measure it instead of --accent.
 * The opt-in is deliberate: an implicit "use it if it exists" hook fails OPEN — merely declaring
 * --accent-ink anywhere would silently move four of the groups off --accent (68 failures -> 8 in
 * the adversarial repro). With INK_ROLE null, the mere PRESENCE of such a token is an error.
 */
const INK_ROLE = null;
const INK_ROLE_CANDIDATES = ['--accent-ink', '--accent-text', '--accent-ring'];

function inkRoleFor(has) {
  if (INK_ROLE === null) {
    const present = INK_ROLE_CANDIDATES.filter(has);
    if (present.length) {
      throw new Error(
        `${present.join(', ')} is declared but INK_ROLE is null.\n` +
          '  A split text/fill accent changes what the focus-ring, accent-text and accent-soft\n' +
          '  groups measure. Set INK_ROLE in scripts/contrast-check.mjs to the token that carries\n' +
          '  the TEXT role (and say so in accents.css) rather than letting the gate infer it.'
      );
    }
    return '--accent';
  }
  if (!has(INK_ROLE)) throw new Error(`INK_ROLE is set to ${INK_ROLE}, which no state declares`);
  return INK_ROLE;
}

function buildChecks(get, has, vocab) {
  const checks = [];
  const inkRole = inkRoleFor(has);
  const { surfaces, foregrounds, codeInk, softs, tones, accentTints } = vocab;
  const push = (group, fgName, bgName, min, opts = {}) => {
    const bgBase = opts.on ? get(opts.on) : [255, 255, 255, 1];
    const bg = over(get(bgName), bgBase);
    const fg = over(get(fgName), bg);
    checks.push({
      group,
      fg: fgName,
      bg: opts.on ? `${bgName} on ${opts.on}` : bgName,
      min,
      actual: ratio(fg, bg),
      fgHex: toHex(get(fgName)),
      bgHex: toHex(bg),
    });
  };

  // 1. Text foregrounds on every surface they are painted on — WCAG 1.4.3.
  for (const fg of foregrounds) for (const s of surfaces) push('text', fg, s, AA_TEXT);

  // 1b. Syntax colours inside an exception scope, on the same surfaces (CodeBlock/JsonViewer).
  for (const fg of codeInk) for (const s of surfaces) push('code-ink', fg, s, AA_TEXT);

  // 2. --accent as a focus ring / non-text indicator on every surface — WCAG 1.4.11.
  //    (`focus-visible:outline-accent` is used on 113 controls across the UI package.)
  for (const s of surfaces) push('focus-ring', inkRole, s, UI_NONTEXT);

  // 2b. The hover FILL must be distinguishable from the resting surface it replaces — the same
  //     1.4.11 floor. This is the check the dark-hover regression (2.22:1 on --surface) needed:
  //     without it, mixing the dark accent toward #000 again produces zero failures.
  if (has('--accent-hover')) for (const s of surfaces) push('state-fill', '--accent-hover', s, UI_NONTEXT);

  // 3. --accent as TEXT (links, active nav, Toast action, soft Button label) — 15-quality §7.4.
  for (const s of surfaces) push('accent-text', inkRole, s, AA_TEXT);

  // 4. Primary-button label at rest and on hover, all accents x themes — 15-quality §7.4.
  push('accent-button', '--accent-fg', '--accent', AA_TEXT);
  if (has('--accent-hover')) push('accent-hover', '--accent-fg', '--accent-hover', AA_TEXT);

  // 5. Soft accent badges/pills/chips: --accent on --accent-soft (translucent -> composited
  //    over each surface it can sit on) — 15-quality §7.4.
  if (has('--accent-soft')) {
    for (const s of surfaces) {
      push(s === '--surface' ? 'accent-soft' : 'accent-soft-deep', inkRole, '--accent-soft', AA_TEXT, { on: s });
    }
  }

  // 6. Semantic tone on its -soft partner, over every surface — 15-quality §7.4.
  for (const tone of tones) for (const s of surfaces) push('semantic', tone, `${tone}-soft`, AA_TEXT, { on: s });

  // 7. Neutral copy ON a tint. Alert/Callout renders `text-fg` title + `text-fg-muted` body
  //    directly on `bg-{tone}-soft`; chips, active rows and sticky headers do the same on
  //    --accent-soft, and the rank bar / ::selection do it on the heavier tints. Same 1.4.3
  //    requirement as (1), different backdrop — and the backdrop is EVERY surface the tint can
  //    composite over, because the token layer cannot know which one a component lands on.
  for (const soft of softs) {
    for (const fg of foregrounds) for (const s of surfaces) push('text-on-soft', fg, soft, AA_TEXT, { on: s });
  }
  for (const tint of accentTints.filter((t) => t !== '--accent-soft')) {
    for (const fg of foregrounds) for (const s of surfaces) push('text-on-tint', fg, tint, AA_TEXT, { on: s });
  }

  return checks;
}

/** Pairs that never touch --accent produce identical numbers for all 8 palettes. */
const isAccentIndependent = (row) =>
  ['text', 'code-ink', 'semantic'].includes(row.group) ||
  (row.group === 'text-on-soft' && !row.bg.includes('accent'));

/* ------------------------------------------------------------------------ audit */

/**
 * Run the whole matrix against the token CSS on disk.
 * @param {{strict?: boolean, css?: string}} [options] `css` overrides the on-disk token files
 *   (tests use it to prove the gate actually catches a regression).
 */
/**
 * The gate parses FILES only. That is a choice about where colour tokens live, so enforce it:
 * a colour declared in a file this script does not read would ship unmeasured, which is the same
 * hole as an unrecognised token name, one directory up.
 */
function assertNoColoursOutsideParsedFiles() {
  const strays = [];
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.css') || FILES.includes(file) || UNMEASURED_COLOUR_FILES.has(file)) continue;
    for (const rule of parseRules(stripComments(readFileSync(join(SRC, file), 'utf8')), file)) {
      for (const [name, value] of rule.decls) {
        if (!name.startsWith('--')) continue;
        try {
          parseColor(value); // literal colour; var() indirection throws and is fine
          strays.push(`${file}: ${name}`);
        } catch {
          /* not a literal colour — nothing to measure */
        }
      }
    }
  }
  if (strays.length) {
    throw new Error(
      `colour token(s) declared in CSS this gate does not parse:\n  ${strays.join('\n  ')}\n` +
        `  Move them into one of ${FILES.join(' / ')}, or add the file to FILES so every state\n` +
        '  measures them. Colours must not live where the contrast gate cannot see them.'
    );
  }
}

export function runAudit({ strict = false, css: cssOverride } = {}) {
  if (cssOverride === undefined) assertNoColoursOutsideParsedFiles();
  const rules =
    cssOverride === undefined
      ? FILES.flatMap((f) => parseRules(stripComments(readFileSync(join(SRC, f), 'utf8')), f))
          .map((r, i) => ({ ...r, order: i }))
      : parseRules(stripComments(cssOverride));

  // At-rule- and nesting-scoped token declarations: refuse to guess (see the header).
  const conditional = rules.filter((r) => r.at.length && declaresTokens(r));
  if (conditional.length) {
    throw new Error(
      'token declarations inside a conditional at-rule are not evaluated:\n' +
        conditional
          .map((r) => `  ${r.file}: ${r.at.join(' > ')} > ${r.selectors.join(', ')}`)
          .join('\n') +
        '\n  This gate replays ONE cascade per (theme, accent[, scope]); it has no way to know\n' +
        '  which media/support condition a user meets, and evaluating a single branch would be a\n' +
        '  guess. Lift the declarations out of the at-rule, or add the condition as an explicit\n' +
        '  axis in resolveState() and measure every branch.'
    );
  }
  const nested = rules.filter((r) => r.nested && declaresTokens(r));
  if (nested.length) {
    throw new Error(
      'token declarations in a rule that also contains nested rules are not evaluated:\n' +
        nested.map((r) => `  ${r.file}: ${r.selectors.join(', ')}`).join('\n') +
        '\n  Native CSS nesting changes which element a declaration lands on; flatten the rule.'
    );
  }

  const css = rules.map((r) => r.selectors.join(',')).join('\n');
  const accents = [...new Set([...css.matchAll(/\[data-accent="([^"]+)"\]/g)].map((m) => m[1]))];
  const themes = ['light', ...new Set([...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1]))]
    .filter((t, i, a) => a.indexOf(t) === i);
  // Every class selector that declares tokens is an inverted subtree (exceptions.css §6).
  const scopes = [
    ...new Set(
      rules
        .filter(declaresTokens)
        .flatMap((r) => r.selectors)
        .flatMap((sel) => [...sel.replace(ATTR_RE, '').matchAll(CLASS_RE)].map((m) => `.${m[1]}`))
    ),
  ];
  if (!accents.length) throw new Error('no [data-accent] palettes found — did accents.css move?');

  const results = [];
  const ignoredRules = new Set();

  for (const theme of themes) {
    for (const accent of accents) {
      for (const scope of [null, ...scopes]) {
        const state = { theme, accent, scope };
        const { resolved, ignored } = resolveState(rules, state);
        ignored.forEach((s) => ignoredRules.add(s));
        const cache = new Map();
        const get = (name) => {
          if (!cache.has(name)) {
            if (!resolved.has(name)) throw new Error(`token ${name} is not defined for ${theme}/${accent}`);
            cache.set(name, parseColor(resolved.get(name)));
          }
          return cache.get(name);
        };
        const has = (name) => resolved.has(name);
        const vocab = vocabulary(resolved, `${theme}/${accent}${scope ? `/${scope}` : ''}`);
        for (const c of buildChecks(get, has, vocab)) {
          results.push({ theme, accent, scope: scope ?? '(root)', ...c, pass: c.actual + 1e-9 >= c.min });
        }
      }
    }
  }

  // Accent-independent checks (text + semantic) are identical for all 8 accents; collapse them
  // so the report shows one row per theme/scope instead of eight.
  const seen = new Set();
  const rows = results.filter((r) => {
    if (!isAccentIndependent(r)) return true;
    const key = `${r.theme}|${r.scope}|${r.group}|${r.fg}|${r.bg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    r.accent = '(any)';
    return true;
  });

  const gated = (r) => strict || GROUPS[r.group].gated;
  for (const r of rows) r.gated = gated(r);
  const failures = rows.filter((r) => !r.pass && r.gated);
  const warnings = rows.filter((r) => !r.pass && !r.gated);

  return { themes, accents, scopes, rows, failures, warnings, ignoredRules: [...ignoredRules] };
}

/* ------------------------------------------------------------------------- CLI */

function main() {
  const argv = process.argv.slice(2);
  const showAll = argv.includes('--all');
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');

  const { themes, accents, scopes, rows, failures, warnings, ignoredRules } = runAudit({ strict });

  if (asJson) {
    console.log(JSON.stringify({ themes, accents, scopes, rows, failures, warnings, ignoredRules }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const header = ['TOKEN', 'ON', 'THEME', 'SCOPE', 'ACCENT', 'ACTUAL', 'NEED', ''];
  const table = (list) => {
    const body = list.map((r) => [
      r.fg,
      r.bg,
      r.theme,
      r.scope,
      r.accent,
      `${round(r.actual).toFixed(2)}:1`,
      `${r.min.toFixed(1)}:1`,
      r.pass ? 'PASS' : 'FAIL',
    ]);
    if (!body.length) return;
    const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
    const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
    console.log(line(header));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of body) console.log(line(r));
    console.log('');
  };

  console.log(
    `\n@adminium/tokens contrast gate — ${themes.length} themes x ${accents.length} accents x ` +
      `${scopes.length + 1} scopes, ${rows.length} distinct pairs ` +
      '(WCAG 2.1 AA; 4.5:1 text / 3:1 non-text)\n'
  );
  if (showAll) table(rows);
  else if (failures.length) {
    console.log(`GATED FAILURES (${failures.length}):`);
    table(failures);
  }

  if (warnings.length) {
    console.log(`Documented exemptions — measured, reported, NOT gated (${warnings.length}); --strict gates them:`);
    table(warnings);
    for (const g of [...new Set(warnings.map((w) => w.group))]) {
      console.log(`  ${g}: ${GROUPS[g].label}`);
      console.log(`    ${(GROUPS[g].reason ?? '(no reason recorded)').replace(/(.{96})\s/g, '$1\n    ')}`);
    }
    console.log('');
  }

  if (ignoredRules.length) {
    console.log('Rules ignored (cannot match <html>, which carries data-theme AND data-accent):');
    for (const s of ignoredRules) console.log(`  ${s}`);
    console.log('');
  }
  if (showAll) {
    console.log('Not checked (no text/background pair):');
    for (const [t, why] of SKIPPED) console.log(`  ${t.padEnd(38)} ${why}`);
    console.log('');
  }

  const gatedCount = rows.filter((r) => r.gated).length;
  console.log(
    failures.length
      ? `FAIL — ${failures.length} of ${gatedCount} gated pairs below threshold.`
      : `OK — all ${gatedCount} gated pairs meet WCAG 2.1 AA` +
          (warnings.length ? ` (${warnings.length} exempt pairs still short; see above).` : '.')
  );

  process.exitCode = failures.length ? 1 : 0;
}

/* Pure helpers are exported so test/contrast-check.test.ts can pin the colour maths and the
   cascade replay — a silently-broken gate is worse than no gate. */
export { parseRules, resolveState, matchSelector, expandVars, parseColor, over, luminance, ratio, vocabulary, GROUPS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`contrast-check: ${err.message}`);
    process.exitCode = 1;
  }
}
