// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-style-prop.js';

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

ruleTester.run('no-style-prop', rule, {
  valid: [
    // The sanctioned escape hatch: every key is a string-literal CSS custom property.
    "const el = <div style={{ '--x': v }} />;",
    "const el = <div style={{ '--adm-progress': pct + '%', '--adm-delay': d }} />;",
    // A 'style' key in a plain (non-JSX) object is out of scope.
    "const o = { style: { color: 'red' } };",
    // No style prop at all.
    'const el = <div className="bg-surface text-fg" />;',
    // allowVars option: allowlisted var passes.
    {
      code: "const el = <div style={{ '--adm-progress': pct }} />;",
      options: [{ allowVars: ['--adm-progress'] }],
    },
  ],
  invalid: [
    // Plain style object with a regular CSS property.
    {
      code: "const el = <div style={{ color: '#fff' }} />;",
      errors: [{ messageId: 'noStyleProp' }],
    },
    // Non-object value (identifier): the rule cannot see inside — always reported.
    {
      code: 'const el = <div style={styles} />;',
      errors: [{ messageId: 'noStyleProp' }],
    },
    // Mixed custom property + regular property.
    {
      code: "const el = <div style={{ '--x': v, color: 'red' }} />;",
      errors: [{ messageId: 'noStyleProp' }],
    },
    // Spread element inside the object.
    {
      code: 'const el = <div style={{ ...rest }} />;',
      errors: [{ messageId: 'noStyleProp' }],
    },
    // Computed key — even one that would evaluate to a custom property.
    {
      code: "const el = <div style={{ ['--' + name]: v }} />;",
      errors: [{ messageId: 'noStyleProp' }],
    },
    // String-valued style attribute.
    {
      code: 'const el = <div style="color: red" />;',
      errors: [{ messageId: 'noStyleProp' }],
    },
    // allowVars option: a custom property outside the allowlist is reported.
    {
      code: "const el = <div style={{ '--x': v }} />;",
      options: [{ allowVars: ['--adm-progress'] }],
      errors: [{ messageId: 'varNotAllowlisted' }],
    },
  ],
});
