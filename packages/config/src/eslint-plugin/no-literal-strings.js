// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rule: adminium/no-literal-strings
 *
 * Reports user-visible English hardcoded into JSX instead of going through
 * `t()`: bare text nodes containing letters, and string literals passed to
 * user-facing attributes (`title`, `placeholder`, `alt`, `aria-label`,
 * `aria-description`, and `*Label`-suffixed props).
 *
 * This is the rule that would have caught the whole `stateMap.ts` class of bug —
 * 49 strings rendering English on the 404/500/offline pages in all 8 locales,
 * invisible because nothing ever asserted their absence.
 *
 * Deliberately NOT reported (10-i18n-theming.md §2.7):
 *  - strings with no letters: '—', '·', '/', numbers, emoji
 *  - technical props: className, id, href, to, key, data-*, variant, role, type
 *  - uppercase-only technical tokens: 'POST', 'UTF-8', 'PK', 'CSV'
 *  - template literals that only interpolate variables
 *  - single characters, which are punctuation or glyphs in practice
 *
 * Escape hatch: `{/* i18n-exempt: reason *​/}` on or above the line. Every
 * exemption needs a stated reason; the §8.3 audits grep for ones without.
 *
 * Spec: 10-i18n-theming.md §2.7.
 */

const DEFAULT_ATTRS = ['title', 'placeholder', 'alt', 'aria-label', 'aria-description'];

/** Props that are machine values, never prose. */
const TECHNICAL_ATTRS = new Set([
  'className', 'class', 'id', 'key', 'href', 'to', 'src', 'type', 'role', 'variant', 'name',
  'htmlFor', 'rel', 'target', 'method', 'action', 'value', 'defaultValue', 'accept', 'autoComplete',
  'data-testid', 'data-part', 'data-state', 'slot', 'form', 'pattern', 'inputMode', 'enterKeyHint',
]);

const EXEMPT = /i18n-exempt:\s*\S/;
const HAS_LETTERS = /\p{L}/u;
/** 'POST', 'UTF-8', 'PK', 'ID' — machine tokens, not prose. */
const TECHNICAL_TOKEN = /^[\p{Lu}\p{N}][\p{Lu}\p{N}._-]*$/u;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow user-visible string literals in JSX — route them through t()',
      url: 'https://github.com/MoSofi/Adminium/blob/main/packages/config/src/eslint-plugin/no-literal-strings.js',
    },
    schema: [
      {
        type: 'object',
        properties: {
          attributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          /** Extra prop names to ignore, per-package. */
          ignoreAttributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      literalText:
        'Hardcoded UI text renders English in all 8 locales — route it through t() with a key in ' +
        'packages/i18n/locales (10-i18n-theming.md §2.7). If it is not user-visible copy, add ' +
        '`{/* i18n-exempt: <reason> */}`.',
      literalAttr:
        "Hardcoded text in the user-visible `{{attr}}` prop renders English in all 8 locales — " +
        'route it through t() (10-i18n-theming.md §2.7), or add `{/* i18n-exempt: <reason> */}`.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const attrs = new Set(options.attributes ?? DEFAULT_ATTRS);
    const ignore = new Set([...TECHNICAL_ATTRS, ...(options.ignoreAttributes ?? [])]);
    const source = context.sourceCode ?? context.getSourceCode();

    const prose = (raw) => {
      const s = raw.trim();
      if (s.length < 2) return false;
      if (!HAS_LETTERS.test(s)) return false;
      if (TECHNICAL_TOKEN.test(s)) return false;
      return true;
    };

    const exempted = (node) => {
      const line = node.loc.start.line;
      return source
        .getAllComments()
        .some(
          (c) =>
            EXEMPT.test(c.value) &&
            c.loc.end.line >= line - 1 &&
            c.loc.start.line <= node.loc.end.line,
        );
    };

    return {
      JSXText(node) {
        if (!prose(node.value) || exempted(node)) return;
        context.report({ node, messageId: 'literalText' });
      },

      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const attr = node.name.name;
        if (ignore.has(attr)) return;
        // Either an explicitly listed attribute, or a `…Label`-suffixed prop.
        if (!attrs.has(attr) && !/Label$/.test(attr)) return;

        const v = node.value;
        if (v === null) return;
        let literal = null;
        if (v.type === 'Literal' && typeof v.value === 'string') literal = v.value;
        else if (
          v.type === 'JSXExpressionContainer' &&
          v.expression.type === 'Literal' &&
          typeof v.expression.value === 'string'
        ) {
          literal = v.expression.value;
        } else if (
          v.type === 'JSXExpressionContainer' &&
          v.expression.type === 'TemplateLiteral' &&
          v.expression.expressions.length === 0
        ) {
          literal = v.expression.quasis.map((q) => q.value.cooked).join('');
        }
        if (literal === null || !prose(literal) || exempted(node)) return;
        context.report({ node, messageId: 'literalAttr', data: { attr } });
      },
    };
  },
};
