import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-t-result-replace.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-t-result-replace', rule, {
  valid: [
    // The sanctioned form: the argument goes to the translator, so
    // `format()` never throws and an override may restyle the placeholder.
    "t('k', '{count} changes', { count: String(n) });",
    "t('k', 'Nothing to do');",
    // `.replace` on a value that is not a translator call. The widgets
    // contract: the template is a caller-supplied prop and interpolating it is
    // the documented i18n-agnostic component behaviour (10 §2.4).
    "labels.shiftCount.replace('{n}', String(count));",
    "template.replace('{name}', user.name);",
    "'{n} items'.replace('{n}', String(n));",
    // A translator result IS `.replace`d, but not of a literal placeholder
    // token — that is ordinary string surgery, not a hand-rolled ICU arg.
    "t('k', 'a-b').replace('-', ' ');",
    "t('k', 'x').replace('{ n }', y);",
    "t('k', 'x').replace('{n', y);",
    // A regex pattern is not the literal-token shape either.
    "t('k', '{count} changes').replace(/\\{count\\}/g, String(n));",
    // Not `.replace` at all.
    "t('k', ' {n} ').trim();",
    // Not a translator name, even though the shape matches exactly.
    "format('k').replace('{n}', String(n));",
    "buildUrl(base).replace('{id}', id);",
    // A locally renamed translator is out of reach of a name-based rule: the
    // callee list is matched syntactically, with no scope analysis. Flagging
    // `t`/`tOr` (bare or as `x.t`) is the rule's whole surface — this case
    // documents that boundary rather than a bug.
    "const tr = t; tr('k', '{n} left').replace('{n}', String(n));",
    // Explicit, reasoned escape hatch.
    [
      '// i18n-literal-token: the token is re-inserted by the print pipeline',
      "t('k', '{n} left').replace('{n}', String(n));",
    ].join('\n'),
    // The hatch is attachment-based (`getCommentsBefore`), not strictly the
    // line above: a blank line between the two does not detach it. Worth
    // pinning because the rule's own header says "on the line above", and the
    // narrower `source.lines` probe next to it reads like the whole test.
    [
      '// i18n-literal-token: the token is re-inserted by the print pipeline',
      '',
      "t('k', '{n} left').replace('{n}', String(n));",
    ].join('\n'),
  ],
  invalid: [
    {
      code: "t('k', '{count} changes').replace('{count}', String(n));",
      errors: [{ messageId: 'literalToken', data: { token: '{count}', name: 'count' } }],
    },
    // Member-expression callee — the `i18n.t(…)` / `ctx.t(…)` form.
    {
      code: "i18n.t('k', '{n} left').replace('{n}', String(n));",
      errors: [{ messageId: 'literalToken', data: { token: '{n}', name: 'n' } }],
    },
    // `tOr` is a translator too (DEFAULT_CALLEES).
    {
      code: "tOr('k', '{total} rows').replace('{total}', String(total));",
      errors: [{ messageId: 'literalToken' }],
    },
    // A chain reports once per hand-substituted token: fixing only the outer
    // one would leave the call still relying on the swallowed format() throw.
    {
      code: "t('k', '{a} of {b}').replace('{a}', x).replace('{b}', y);",
      errors: [{ messageId: 'literalToken' }, { messageId: 'literalToken' }],
    },
    // Underscored/numeric argument names are valid ICU identifiers.
    {
      code: "t('k', '{item_1} moved').replace('{item_1}', label);",
      errors: [{ messageId: 'literalToken', data: { token: '{item_1}', name: 'item_1' } }],
    },
    // The shape is reported wherever it appears, not just as a statement.
    {
      code: "const label = t('k', '{n} left').replace('{n}', String(n));",
      errors: [{ messageId: 'literalToken' }],
    },
    {
      code: "<span>{t('k', '{n} left').replace('{n}', String(n))}</span>;",
      errors: [{ messageId: 'literalToken' }],
    },
    // An exemption comment with no reason does not count.
    {
      code: ['// i18n-literal-token:', "t('k', '{n} left').replace('{n}', String(n));"].join('\n'),
      errors: [{ messageId: 'literalToken' }],
    },
    // …nor does one that belongs to an earlier statement: an intervening token
    // detaches it, so the hatch cannot leak down the file.
    {
      code: [
        '// i18n-literal-token: this one exempts the line under it, not the file',
        'const first = 1;',
        "t('k', '{n} left').replace('{n}', String(n));",
      ].join('\n'),
      errors: [{ messageId: 'literalToken' }],
    },
    // Custom callee list.
    {
      code: "translate('k', '{n} left').replace('{n}', String(n));",
      options: [{ callees: ['translate'] }],
      errors: [{ messageId: 'literalToken' }],
    },
    // …which REPLACES the defaults rather than extending them.
    {
      code: "t('k', '{n} left').replace('{n}', String(n));",
      options: [{ callees: ['t'] }],
      errors: [{ messageId: 'literalToken' }],
    },
  ],
});
