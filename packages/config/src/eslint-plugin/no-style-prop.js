/**
 * Rule: adminium/no-style-prop
 *
 * Reports every JSX `style` attribute, with one escape hatch: an inline object
 * expression whose properties are ALL string-literal keys naming CSS custom
 * properties (keys starting with `--`). This exists for truly dynamic values
 * (chart geometry, progress %, stagger index) that cannot be a class.
 *
 * With the `allowVars` option set, the escape hatch is further restricted to
 * exactly the listed custom-property names (02-design-system.md §8 allowlist).
 *
 * Spread elements and computed keys are always reported. No autofix: the fix
 * is a design decision (map the literal to a token utility per §7).
 *
 * Known limitation: the `style` key inside `React.createElement(...)` calls is
 * out of scope — this is a JSX-only rule. `style` keys in plain (non-JSX)
 * objects are untouched.
 *
 * Spec: workplan/02-design-system.md §7–§8.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow the JSX `style` prop unless every property is a string-literal CSS custom property ('--*')",
      url: 'https://github.com/MoSofi/Adminium/blob/main/workplan/02-design-system.md#8-eslint-rule-adminiumno-style-prop',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowVars: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      // NB: no "{{ }}" in this text — ESLint parses double braces in messages as placeholders.
      noStyleProp:
        'The JSX `style` prop is banned — use Tailwind utilities backed by @adminium/tokens ' +
        '(02-design-system.md §7). It is allowed only as an inline object whose every key is a ' +
        "string-literal CSS custom property (a key starting with '--', e.g. '--adm-progress').",
      varNotAllowlisted:
        "CSS custom property '{{name}}' is not on the @adminium/config allowVars allowlist " +
        '(02-design-system.md §8). Extending the allowlist is a reviewed change to @adminium/config.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const allowVars = options.allowVars ? new Set(options.allowVars) : null;

    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') {
          return;
        }

        // style="..." (string value) or bare `style` — never allowed.
        if (node.value === null || node.value.type !== 'JSXExpressionContainer') {
          context.report({ node, messageId: 'noStyleProp' });
          return;
        }

        const expression = node.value.expression;
        if (expression.type !== 'ObjectExpression') {
          // Identifier, call, conditional, spread-carrying variable, … — the
          // rule cannot see inside; always reported.
          context.report({ node, messageId: 'noStyleProp' });
          return;
        }

        for (const property of expression.properties) {
          if (property.type !== 'Property' || property.computed) {
            // SpreadElement, computed key, getter with computed key, …
            context.report({ node, messageId: 'noStyleProp' });
            return;
          }
          const key = property.key;
          const isCustomProperty =
            key.type === 'Literal' && typeof key.value === 'string' && key.value.startsWith('--');
          if (!isCustomProperty) {
            context.report({ node, messageId: 'noStyleProp' });
            return;
          }
          if (allowVars !== null && !allowVars.has(key.value)) {
            context.report({
              node: property,
              messageId: 'varNotAllowlisted',
              data: { name: key.value },
            });
            return;
          }
        }
      },
    };
  },
};
