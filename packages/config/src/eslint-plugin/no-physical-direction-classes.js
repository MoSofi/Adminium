/**
 * Rule: adminium/no-physical-direction-classes
 *
 * RTL is a permanent CI matrix (10-i18n-theming.md §5.2): styling must use
 * Tailwind LOGICAL direction utilities (ms- me- ps- pe- start- end- text-start
 * text-end rounded-s- rounded-e- border-s- border-e-) so every surface mirrors
 * under `dir="rtl"`. This rule flags PHYSICAL direction utilities in class-name
 * string and template literals (arrows below read "physical then logical"):
 *
 *   margin, padding  ml- mr- pl- pr-            ms- me- ps- pe-
 *   inset            left- right-               start- end-
 *   border side      border-l border-r          border-s border-e
 *   corner radius    rounded-l rounded-r         rounded-s rounded-e
 *                    rounded-tl rounded-tr       rounded-ss rounded-se
 *                    rounded-bl rounded-br       rounded-es rounded-ee
 *   text align       text-left text-right        text-start text-end
 *
 * Tokens are matched after stripping Tailwind variant prefixes (`hover:`,
 * `md:`, `rtl:`, …) and a leading negative sign, so `rtl:ml-2` and `-left-4`
 * are both caught. Genuinely-physical exceptions (a color-scale gradient, a
 * document text-align control) go on the `allow` allowlist option, sourced
 * from the reviewed `eslint/physical-direction-allowlist.js` file.
 *
 * No autofix: picking the right logical utility is a judgment call
 * (semantic mirror vs. truly-physical) per §5.1 "Judgment calls".
 *
 * Spec: 10-i18n-theming.md §5.2; 02-design-system.md §3.2, §8.
 */

/** After stripping variants + a leading `-`, does the token name a physical utility? */
const PHYSICAL_PATTERNS = [
  /^(ml|mr|pl|pr)-/, //                       margin / padding, left|right
  /^(left|right)-/, //                        inset
  /^border-(l|r)(-|$)/, //                    border side
  /^rounded-(l|r|tl|tr|bl|br)(-|$)/, //       corner radius (incl. named corners)
  /^text-(left|right)$/, //                   text align
];

/** Strip Tailwind variant prefixes (`a:b:util`) and one leading negative sign. */
function baseOf(token) {
  const afterVariants = token.slice(token.lastIndexOf(':') + 1);
  return afterVariants.startsWith('-') ? afterVariants.slice(1) : afterVariants;
}

function isPhysical(token) {
  const base = baseOf(token);
  return PHYSICAL_PATTERNS.some((pattern) => pattern.test(base));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical-direction Tailwind utilities (ml/mr/pl/pr/left/right/border-l/border-r/rounded-l/rounded-r/text-left/text-right); use the logical equivalents so surfaces mirror under RTL',
      url: 'https://github.com/MoSofi/Adminium/blob/main/packages/config/src/eslint-plugin/no-physical-direction-classes.js',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      physical:
        "Physical-direction Tailwind utility '{{token}}' breaks RTL — use the logical equivalent " +
        '(ms-/me-/ps-/pe-/start-/end-/border-s-/border-e-/rounded-s-/rounded-e-/text-start/text-end) ' +
        'per 10-i18n-theming.md §5.2. Genuinely-physical cases go on the @adminium/config allowlist.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const allow = options.allow ? new Set(options.allow) : null;

    /** Report each physical token found in a class-name-ish string value. */
    function scan(node, value) {
      if (typeof value !== 'string' || value.length === 0) return;
      for (const token of value.split(/\s+/)) {
        if (token.length === 0) continue;
        if (allow !== null && allow.has(token)) continue;
        if (isPhysical(token)) {
          context.report({ node, messageId: 'physical', data: { token } });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') scan(node, node.value);
      },
      // Template-literal static chunks: `flex ${x} ml-2` still leaks `ml-2`.
      TemplateElement(node) {
        scan(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
