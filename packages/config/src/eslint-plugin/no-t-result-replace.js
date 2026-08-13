/**
 * Rule: adminium/no-t-result-replace
 *
 * Reports hand-substituting a placeholder into a translator's RESULT:
 *
 *   t('k', '{count} changes').replace('{count}', String(n))   // ✗
 *   t('k', '{count} changes', { count: String(n) })           // ✓
 *
 * This looks like a style nit and is not. The `.replace` form only works
 * because the `t()` call passes NO ICU arguments: `IntlMessageFormat.format()`
 * throws on the missing variable, the runtime catches it and returns the RAW
 * message, and only then does `.replace` find its literal `{count}` token.
 * Every render of such a string is a thrown-and-swallowed exception, and the
 * rendered text is correct by accident.
 *
 * It also breaks the moment translations become editable at runtime
 * (23-runtime-translations.md §4.6): a perfectly valid override that writes
 * `{count, number}` instead of `{count}` keeps the same argument name, passes
 * every name-based check, and then renders raw ICU source to users — because
 * the literal token the `.replace` looked for is no longer there. The write
 * validator defends this with argument-TYPE parity; this rule keeps new call
 * sites from relying on that defence in the first place.
 *
 * NOT reported: `.replace` on a value that is not a translator call — notably
 * `labels.shiftCount.replace('{n}', …)` inside `@adminium/widgets`, where the
 * template is a caller-supplied prop and interpolating it is the documented
 * i18n-agnostic component contract (10-i18n-theming.md §2.4).
 *
 * Escape hatch: `// i18n-literal-token: <reason>` on the line above.
 *
 * Spec: 23-runtime-translations.md §4.6.
 */

/** Call targets treated as translators. */
const DEFAULT_CALLEES = ['t', 'tOr'];

const EXEMPT = /i18n-literal-token:\s*\S/;

/** `t(…)` or `something.t(…)`? */
function calleeName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return null;
}

/** Walk back through a `.replace(…).replace(…)` chain to its root receiver. */
function chainRoot(node) {
  let current = node;
  while (
    current.type === 'CallExpression' &&
    current.callee.type === 'MemberExpression' &&
    current.callee.property.type === 'Identifier' &&
    current.callee.property.name === 'replace'
  ) {
    current = current.callee.object;
  }
  return current;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Pass ICU arguments to the translator instead of replacing tokens in its result',
      url: 'https://github.com/MoSofi/Adminium/blob/main/packages/config/src/eslint-plugin/no-t-result-replace.js',
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
      literalToken:
        'Pass {{token}} as an ICU argument — t(key, fallback, {{ {{name}}: … }}) — instead of .replace() on the result. The .replace form only works because format() throws and returns the raw message.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    const source = context.sourceCode ?? context.getSourceCode();

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'replace'
        ) {
          return;
        }

        // Only the literal-token shape: .replace('{name}', …)
        const [pattern] = node.arguments;
        if (
          pattern === undefined ||
          pattern.type !== 'Literal' ||
          typeof pattern.value !== 'string' ||
          !/^\{[A-Za-z0-9_]+\}$/.test(pattern.value)
        ) {
          return;
        }

        const root = chainRoot(node);
        if (root.type !== 'CallExpression') return;
        const name = calleeName(root.callee);
        if (name === null || !callees.has(name)) return;

        const comments = source.getCommentsBefore(node);
        const line = source.lines[node.loc.start.line - 2] ?? '';
        if (comments.some((c) => EXEMPT.test(c.value)) || EXEMPT.test(line)) return;

        context.report({
          node,
          messageId: 'literalToken',
          data: { token: pattern.value, name: pattern.value.slice(1, -1) },
        });
      },
    };
  },
};
