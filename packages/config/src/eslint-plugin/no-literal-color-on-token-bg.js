// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rule: adminium/no-literal-color-on-token-bg
 *
 * THE BUG THIS EXISTS FOR. `@adminium/tokens` guarantees a readable pair for
 * every themed background: `--accent-fg` on `--accent` measures 8.36:1 in the
 * dark theme. A component that writes `bg-accent text-white` opts out of that
 * guarantee — it pins one side of the pair to a literal colour while the other
 * side keeps flipping with `data-theme`. When the dark accent was re-tuned from
 * #4f46e5 to a light hue, white-on-accent went from 6.29:1 to 2.29:1 (WCAG 2.1
 * AA for normal text is 4.5:1) in five components at once. The token layer was
 * correct the entire time; the components had bypassed it.
 *
 * A token-pair contrast gate (packages/tokens/scripts/contrast-check.mjs)
 * structurally cannot catch this: it measures token against token, and
 * `text-white` is not a token. Hence a lint rule.
 *
 * WHAT IS REPORTED. A literal colour utility co-occurring with a token-driven
 * background utility:
 *   literal colours    text-white  text-black  text-<tailwind-palette>-<n>
 *                      text-[#rrggbb]           (all with optional /opacity
 *                                                and any variant prefixes)
 *   token backgrounds  bg-accent bg-accent-hover bg-pos bg-warn bg-danger
 *                      bg-info  bg-<tone>-soft  bg-surface bg-surface-2
 *                      bg-surface-3  bg-bg
 *
 * THE FIX is the paired foreground token, mirroring `@adminium/ui`'s
 * `lib/tones.ts`:
 *   bg-accent / bg-accent-hover / bg-pos / bg-warn / bg-danger / bg-info
 *                                   ->  text-accent-fg
 *       `--accent-fg` is the theme's ONE inverted foreground (#ffffff light,
 *       #0f0f14 dark — accents.css deliberately keeps a single value per theme
 *       rather than one per accent), and it clears AA on every solid tone:
 *       5.13-5.91:1 light, 6.89-9.58:1 dark.
 *   bg-<tone>-soft                  ->  text-<tone>   (bg-pos-soft text-pos)
 *   bg-bg / bg-surface / bg-surface-2 / bg-surface-3
 *                                   ->  text-fg / text-fg-muted / text-fg-subtle
 *
 * Literal colours on a NON-token background are untouched by design: the fixed
 * avatar gradients (`bg-[linear-gradient(135deg,#6366f1,#a855f7)] text-white`)
 * and the card-brand gradients are frozen brand artwork, not themed surfaces,
 * and there is no token to pair them with.
 *
 * WHAT IT CANNOT SEE — the honest limits. This rule is a syntactic, single-file
 * check over string literals. It resolves NOTHING:
 *   - Composition through a variable. `const bar = 'bg-accent …'` used as
 *     `cn('… text-white', bar)` is NOT reported: the rule never looks up an
 *     identifier's value, in this file or any other. `AuthLayout`'s brand panel
 *     is exactly this shape.
 *   - Composition through a lookup table. `` `… ${TONE_SOLID_BG[tone]}` `` next
 *     to a separate `text-white` (GanttChart's progress label) is invisible for
 *     the same reason.
 *   - cva() variant maps. The base string is scanned, and each variant's string
 *     is scanned, but they are never unioned: `cva('… text-white', { variants:
 *     { tone: { pos: 'bg-pos' } } })` is not reported. Unioning them would pair
 *     mutually-exclusive variants (`primary: 'bg-accent text-accent-fg'` with
 *     `destructive: 'bg-danger text-white'`) and produce false positives, so
 *     the rule stays silent instead of guessing.
 *   - Runtime class merging, `tailwind-merge` conflict resolution, classes
 *     assembled from fragments, and anything reaching the DOM via props.
 *   In other words: clean lint output is NOT proof the app has no literal
 *   colour on a themed background. It only proves no single expression spells
 *   one out. Rendered-DOM contrast auditing (axe) remains the backstop.
 *
 * WHAT IT DOES see beyond one string, because these provably concatenate:
 *   - every quasi of one template literal (`bg-accent ${x} text-white`);
 *   - every argument of a class-merging call (`cn`/`clsx`/`cx`/`classNames`/
 *     `twMerge`/`twJoin` by default, extend via the `functions` option), so
 *     `cn('bg-accent', cond ? 'text-white' : 'text-fg')` is reported.
 *   Pairs are only crossed BETWEEN distinct arguments (and distinct quasis);
 *   two strings inside one argument are alternatives more often than not
 *   (`cn(cond ? 'bg-accent' : 'text-white')`), so they are left alone.
 *
 * No autofix: which foreground is correct depends on what the surface means
 * (solid tone vs. soft tint vs. surface step), and on a soft/surface background
 * the choice between text-fg / text-fg-muted / text-fg-subtle is a design call
 * (02-design-system.md §7 "Porting comps").
 *
 * Spec: 02-design-system.md §1.1 (token pairs), §3.2 (utility
 * conventions), §8 (the shared-config lint surface).
 */

/** Tailwind's built-in palette families — `text-red-500` and friends. */
const TAILWIND_PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** A colour pinned to a literal value: it cannot follow `data-theme`. */
const LITERAL_COLOR_PATTERNS = [
  /^text-(white|black)$/,
  new RegExp(`^text-(${TAILWIND_PALETTE})-\\d{2,3}$`),
  /^text-\[#[0-9a-fA-F]{3,8}\]$/,
];

/**
 * Token-driven backgrounds -> the foreground token they pair with.
 * Mirrors `toneSolidClasses` / `toneSoftClasses` in @adminium/ui lib/tones.ts.
 */
const TOKEN_BACKGROUNDS = new Map([
  ['accent', 'text-accent-fg'],
  ['accent-hover', 'text-accent-fg'],
  ['pos', 'text-accent-fg'],
  ['warn', 'text-accent-fg'],
  ['danger', 'text-accent-fg'],
  ['info', 'text-accent-fg'],
  ['accent-soft', 'text-accent'],
  ['pos-soft', 'text-pos'],
  ['warn-soft', 'text-warn'],
  ['danger-soft', 'text-danger'],
  ['info-soft', 'text-info'],
  ['bg', 'text-fg / text-fg-muted / text-fg-subtle'],
  ['surface', 'text-fg / text-fg-muted / text-fg-subtle'],
  ['surface-2', 'text-fg / text-fg-muted / text-fg-subtle'],
  ['surface-3', 'text-fg / text-fg-muted / text-fg-subtle'],
]);

/** Class-merge helpers whose arguments are concatenated at runtime. */
const DEFAULT_FUNCTIONS = ['cn', 'clsx', 'cx', 'classNames', 'classnames', 'twMerge', 'twJoin'];

/**
 * Strip Tailwind variant prefixes (`hover:`, `group-data-[selected]:`, …) and a
 * trailing opacity modifier (`/80`), leaving the bare utility. Bracketed
 * arbitrary values keep their own `/` and `:`, so the opacity strip only fires
 * when the slash is outside brackets.
 */
function baseOf(token) {
  const afterVariants = token.slice(token.lastIndexOf(':') + 1);
  const slash = afterVariants.lastIndexOf('/');
  if (slash === -1) return afterVariants;
  const tail = afterVariants.slice(slash + 1);
  return /^\d{1,3}$/.test(tail) ? afterVariants.slice(0, slash) : afterVariants;
}

function literalColorOf(token) {
  const base = baseOf(token);
  return LITERAL_COLOR_PATTERNS.some((pattern) => pattern.test(base)) ? base : null;
}

function tokenBackgroundOf(token) {
  const base = baseOf(token);
  if (!base.startsWith('bg-')) return null;
  return TOKEN_BACKGROUNDS.has(base.slice(3)) ? base : null;
}

/** Split a class-name-ish string into its literal colours and token backgrounds. */
function partsOf(value) {
  const literals = [];
  const backgrounds = [];
  if (typeof value !== 'string' || value.length === 0) return { literals, backgrounds };
  for (const token of value.split(/\s+/)) {
    if (token.length === 0) continue;
    const literal = literalColorOf(token);
    if (literal !== null) {
      literals.push(literal);
      continue;
    }
    const background = tokenBackgroundOf(token);
    if (background !== null) backgrounds.push(background);
  }
  return { literals, backgrounds };
}

/** Collect every static string reachable inside an expression (one file, no resolution). */
function collectStrings(node, out) {
  if (node === null || node === undefined || typeof node.type !== 'string') return out;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push(node.value);
      return out;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) out.push(quasi.value.cooked ?? quasi.value.raw);
      for (const expression of node.expressions) collectStrings(expression, out);
      return out;
    case 'ConditionalExpression':
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      return out;
    case 'LogicalExpression':
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      return out;
    case 'ArrayExpression':
      for (const element of node.elements) collectStrings(element, out);
      return out;
    case 'ObjectExpression':
      // clsx({ 'bg-accent': on }) — the KEY carries the classes here.
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        if (!property.computed && property.key.type === 'Literal') {
          collectStrings(property.key, out);
        }
      }
      return out;
    default:
      return out;
  }
}

function calleeName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal color utilities (text-white/text-black/text-<palette>-<n>/text-[#hex]) alongside a token-driven background utility (bg-accent, bg-pos, bg-surface, …); use the paired foreground token so the pair stays readable when the theme flips',
      url: 'https://github.com/MoSofi/Adminium/blob/main/packages/config/src/eslint-plugin/no-literal-color-on-token-bg.js',
    },
    schema: [
      {
        type: 'object',
        properties: {
          functions: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      literalColorOnTokenBg:
        "Literal color '{{literal}}' is painted on the token-driven background '{{background}}' — " +
        'the background follows data-theme and the text does not, so the pair silently loses ' +
        'contrast when the theme flips (measured: white is 2.29:1 on the dark --accent, 2.00:1 on ' +
        'the dark --pos, 2.18:1 on the dark --warn; WCAG 2.1 AA needs 4.5:1). ' +
        'Use the paired foreground token: {{suggestion}} ' +
        '(02-design-system.md §3.2; the pairs live in @adminium/ui lib/tones.ts).',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const functions = new Set(options.functions ?? DEFAULT_FUNCTIONS);

    function report(node, literal, background) {
      context.report({
        node,
        messageId: 'literalColorOnTokenBg',
        data: {
          literal,
          background,
          suggestion: TOKEN_BACKGROUNDS.get(background.slice(3)),
        },
      });
    }

    /** Cross every literal colour in `parts` against every background in it. */
    function reportWithin(node, parts) {
      for (const literal of parts.literals) {
        for (const background of parts.backgrounds) report(node, literal, background);
      }
    }

    /**
     * Cross literal colours against backgrounds coming from a DIFFERENT part.
     * Same-part pairs are left to `reportWithin` so nothing is reported twice.
     */
    function reportAcross(node, partsList) {
      for (let i = 0; i < partsList.length; i++) {
        for (const literal of partsList[i].literals) {
          for (let j = 0; j < partsList.length; j++) {
            if (i === j) continue;
            for (const background of partsList[j].backgrounds) report(node, literal, background);
          }
        }
      }
    }

    return {
      // A single string: `className="bg-accent text-white"`, a cva() variant
      // value, an entry in a Record<Tone, string> map, …
      Literal(node) {
        if (typeof node.value !== 'string') return;
        reportWithin(node, partsOf(node.value));
      },

      // Every quasi of one template literal concatenates, so cross them:
      // `bg-accent ${x} text-white` is one painted className.
      TemplateLiteral(node) {
        const partsList = node.quasis.map((quasi) =>
          partsOf(quasi.value.cooked ?? quasi.value.raw),
        );
        for (const parts of partsList) reportWithin(node, parts);
        reportAcross(node, partsList);
      },

      // Every argument of cn()/clsx()/… concatenates too. Only cross-argument
      // pairs are reported here; within one argument the strings are usually
      // alternatives (`cn(on ? 'bg-accent' : 'text-white')`).
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === null || !functions.has(name)) return;
        const partsList = node.arguments.map((argument) => {
          const strings = collectStrings(argument, []);
          const literals = [];
          const backgrounds = [];
          for (const value of strings) {
            const parts = partsOf(value);
            literals.push(...parts.literals);
            backgrounds.push(...parts.backgrounds);
          }
          return { literals, backgrounds };
        });
        reportAcross(node, partsList);
      },
    };
  },
};
