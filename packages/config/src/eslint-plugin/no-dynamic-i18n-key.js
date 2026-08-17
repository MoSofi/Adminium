// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rule: adminium/no-dynamic-i18n-key
 *
 * Reports `t()` calls whose key is FABRICATED at the call site: a template
 * literal with expressions (`` t(`status.${s}`) ``) or a string concatenation
 * (`t('prefix.' + s)`).
 *
 * Deliberately NOT reported: an identifier or member expression, e.g.
 * `t(K[operator])` or `t(spec.titleKey)`. ESLint cannot tell a lookup into a
 * const map of literal keys from an arbitrary `string` without type
 * information — and that distinction is the TYPE system's job. Typing the
 * carrier as `MessageKey` makes a bad key a compile error, which is strictly
 * stronger than anything this rule could assert. Lint catches fabrication;
 * types catch validity.
 *
 * Why this matters more than it looks: a key that only exists at runtime cannot
 * be checked against the bundles, cannot be found by the extractor, and cannot
 * be counted by the review-status tracker (10-i18n-theming.md §3.1). When it
 * misses, i18next returns the key itself — so the user sees a raw dotted string
 * like `widgets.forms.ruleBuilder.op.between` sitting in the middle of the UI.
 * Every such site is invisible until someone opens that exact screen in that
 * exact locale.
 *
 * The fix is an exhaustive map from the runtime value to literal keys:
 *
 *   const OP_KEY = { eq: 'ui:…op.eq', neq: 'ui:…op.neq' } as const;
 *   t(OP_KEY[operator])
 *
 * which also makes a new enum member a type error instead of a silent miss.
 *
 * Template literals with NO expressions are fine — they are just literals.
 *
 * Escape hatch: `// i18n-dynamic-key: <reason>` on the line above, audited by
 * grep during the §8.3 audits. Every exemption needs a stated reason.
 *
 * Spec: 10-i18n-theming.md §2.5.
 */

/** Call targets treated as translators. */
const DEFAULT_CALLEES = ['t', 'tOr', 'useT'];

const EXEMPT = /i18n-dynamic-key:\s*\S/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require translation keys to be statically analyzable string literals',
      url: 'https://github.com/MoSofi/Adminium/blob/main/packages/config/src/eslint-plugin/no-dynamic-i18n-key.js',
    },
    schema: [
      {
        type: 'object',
        properties: {
          callees: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      dynamicKey:
        'Translation key passed to `{{callee}}()` is assembled from parts, so it cannot be verified ' +
        'against the 8 bundles and renders as a raw dotted key when it misses ' +
        '(10-i18n-theming.md §2.5). Use an exhaustive map of literal keys and index into it — ' +
        "`t(KEYS[value])` — so the type checker proves the key exists. If it is genuinely " +
        'unavoidable, add `// i18n-dynamic-key: <reason>` above the line.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    const source = context.sourceCode ?? context.getSourceCode();

    /**
     * Fabrication: the key text is assembled here, so no type can vouch for the
     * result. A template literal with no `${}` is just a literal, and so is fine.
     */
    const isFabricated = (node) => {
      if (node.type === 'TemplateLiteral') return node.expressions.length > 0;
      if (node.type === 'BinaryExpression' && node.operator === '+') return true;
      return false;
    };

    const calleeName = (node) => {
      if (node.type === 'Identifier') return node.name;
      // `i18n.t(...)`, `this.t(...)` — match on the property.
      if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
        return node.property.name;
      }
      return null;
    };

    const exempted = (node) => {
      const before = source.getCommentsBefore(node);
      if (before.some((c) => EXEMPT.test(c.value))) return true;
      // Also accept the marker as a trailing comment on the previous line.
      const line = node.loc.start.line;
      return source
        .getAllComments()
        .some((c) => EXEMPT.test(c.value) && (c.loc.end.line === line - 1 || c.loc.end.line === line));
    };

    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === null || !callees.has(name)) return;
        const [key] = node.arguments;
        if (key === undefined || !isFabricated(key)) return;
        if (exempted(node)) return;
        context.report({ node: key, messageId: 'dynamicKey', data: { callee: name } });
      },
    };
  },
};
