// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-literal-strings.js';

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

ruleTester.run('no-literal-strings', rule, {
  valid: [
    // The whole point: copy comes from the bundles.
    "const el = <p>{t('states.notFound.title', 'Page not found')}</p>;",
    "const el = <input placeholder={t('search.placeholder', 'Search')} />;",
    // No letters — separators, punctuation, numbers.
    'const el = <span>—</span>;',
    'const el = <span>·</span>;',
    'const el = <span>{42}</span>;',
    'const el = <span>/</span>;',
    // Machine tokens are not prose.
    'const el = <span>POST</span>;',
    'const el = <span>UTF-8</span>;',
    'const el = <span>PK</span>;',
    // Technical props are never user-visible copy.
    'const el = <div className="bg-surface text-fg" id="main" data-testid="hero" />;',
    'const el = <a href="/docs" rel="noopener" target="_blank" />;',
    'const el = <input type="email" autoComplete="email" name="email" />;',
    // Interpolated values, not hardcoded copy.
    'const el = <p>{value}</p>;',
    'const el = <p title={label} />;',
    // Reasoned escape hatch.
    ['/* i18n-exempt: brand name, never translated */', 'const el = <span>Adminium</span>;'].join('\n'),
  ],
  invalid: [
    {
      code: 'const el = <h1>Page not found</h1>;',
      errors: [{ messageId: 'literalText' }],
    },
    {
      code: 'const el = <p>We could not find that page.</p>;',
      errors: [{ messageId: 'literalText' }],
    },
    {
      code: 'const el = <input placeholder="Search records" />;',
      errors: [{ messageId: 'literalAttr', data: { attr: 'placeholder' } }],
    },
    {
      code: 'const el = <button aria-label="Close dialog" />;',
      errors: [{ messageId: 'literalAttr', data: { attr: 'aria-label' } }],
    },
    {
      code: 'const el = <img alt="A dashboard screenshot" />;',
      errors: [{ messageId: 'literalAttr', data: { attr: 'alt' } }],
    },
    {
      code: 'const el = <div title="Drag to move card" />;',
      errors: [{ messageId: 'literalAttr', data: { attr: 'title' } }],
    },
    // `*Label`-suffixed props are user-visible by convention.
    {
      code: 'const el = <Widget emptyLabel="No results" />;',
      errors: [{ messageId: 'literalAttr', data: { attr: 'emptyLabel' } }],
    },
    // Expression-container literal is the same thing with extra braces.
    {
      code: 'const el = <input placeholder={"Search records"} />;',
      errors: [{ messageId: 'literalAttr' }],
    },
    // An exemption with no stated reason does not count.
    {
      code: ['/* i18n-exempt: */', 'const el = <h1>Page not found</h1>;'].join('\n'),
      errors: [{ messageId: 'literalText' }],
    },
    // Per-package opt-outs.
    {
      code: 'const el = <Widget helpText="Pick a database" />;',
      options: [{ attributes: ['helpText'] }],
      errors: [{ messageId: 'literalAttr', data: { attr: 'helpText' } }],
    },
  ],
});
