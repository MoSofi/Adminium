import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-physical-direction-classes.js';

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

ruleTester.run('no-physical-direction-classes', rule, {
  valid: [
    // Logical utilities pass.
    'const el = <div className="ms-2 pe-4 start-0 text-end border-s rounded-e-md" />;',
    // Look-alikes that are NOT physical direction utilities.
    'const el = <div className="rounded-lg rounded-full border-2 border-red-500 place-content-center prose" />;',
    // text-* other than left/right.
    'const el = <div className="text-center text-fg text-caption" />;',
    // Empty / non-class strings.
    'const s = "";',
    'const href = "/left/right";', // path-like, but tokens `/left/right` don't match `left-`
    // Allowlisted exact token passes.
    {
      code: 'const el = <div className="text-left" />;',
      options: [{ allow: ['text-left'] }],
    },
  ],
  invalid: [
    // Margin / padding physical.
    {
      code: 'const el = <div className="ml-2 pr-3" />;',
      errors: [{ messageId: 'physical' }, { messageId: 'physical' }],
    },
    // Negative inset + variant prefix are still caught.
    {
      code: 'const el = <div className="-left-4 rtl:mr-2" />;',
      errors: [{ messageId: 'physical' }, { messageId: 'physical' }],
    },
    // Border side + corner radius.
    {
      code: 'const el = <div className="border-l rounded-l-md rounded-tr" />;',
      errors: [{ messageId: 'physical' }, { messageId: 'physical' }, { messageId: 'physical' }],
    },
    // text-left / text-right.
    {
      code: 'const el = <div className="text-left" />;',
      errors: [{ messageId: 'physical' }],
    },
    // Inside a template literal's static chunk.
    {
      code: 'const c = `flex ${x} pl-2`;',
      errors: [{ messageId: 'physical' }],
    },
    // Allowlist is exact: text-right is not covered by an allow of text-left.
    {
      code: 'const el = <div className="text-right" />;',
      options: [{ allow: ['text-left'] }],
      errors: [{ messageId: 'physical' }],
    },
  ],
});
