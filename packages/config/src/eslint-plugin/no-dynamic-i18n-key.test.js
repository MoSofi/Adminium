// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-dynamic-i18n-key.js';

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

ruleTester.run('no-dynamic-i18n-key', rule, {
  valid: [
    "t('states.notFound.title');",
    "t('states.notFound.title', 'Page not found');",
    // A template literal with no interpolation is just a literal.
    't(`states.notFound.title`);',
    // Namespaced keys are still literals.
    "t('ui:widgets.charts.bar.description');",
    // The sanctioned fix: an exhaustive map, indexed at the call site. Validity
    // here is the type checker's job (`MessageKey`), not this rule's.
    "const K = { eq: 'op.eq', neq: 'op.neq' }; t(K[operator]);",
    // Same reasoning: a carrier typed as MessageKey is already proven.
    't(spec.titleKey);',
    't(keyVariable);',
    // Member-expression callee, static key.
    "i18n.t('common.cancel');",
    // Not a translator.
    'format(`${a}.${b}`);',
    'describe(`renders ${name}`, () => {});',
    // Explicit, reasoned escape hatch.
    ['// i18n-dynamic-key: keys come from the tenant-authored catalogue', 't(`cat.${slug}`);'].join('\n'),
  ],
  invalid: [
    {
      code: 't(`status.${s}`);',
      errors: [{ messageId: 'dynamicKey', data: { callee: 't' } }],
    },
    {
      code: "t('prefix.' + suffix);",
      errors: [{ messageId: 'dynamicKey' }],
    },
    // The real shapes found in the codebase.
    {
      code: 't(`ui:widgets.forms.ruleBuilder.op.${operator}`);',
      errors: [{ messageId: 'dynamicKey' }],
    },
    {
      code: 'i18n.t(`shortcuts.go.${item.slug}`);',
      errors: [{ messageId: 'dynamicKey', data: { callee: 't' } }],
    },
    // An exemption comment with no reason does not count.
    {
      code: ['// i18n-dynamic-key:', 't(`cat.${slug}`);'].join('\n'),
      errors: [{ messageId: 'dynamicKey' }],
    },
    // Custom callee list.
    {
      code: 'translate(`a.${b}`);',
      options: [{ callees: ['translate'] }],
      errors: [{ messageId: 'dynamicKey', data: { callee: 'translate' } }],
    },
  ],
});
