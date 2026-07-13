// @vitest-environment node
/**
 * index.html carries a LITERAL copy of @adminium/tokens' preHydrationScript
 * (build-time injection would couple vite.config to the tokens build). This
 * test is the sync contract: the copy must match byte-for-byte.
 * (node env: happy-dom rewrites import.meta.url to http, breaking file reads.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preHydrationScript } from '@adminium/tokens';

describe('pre-hydration inline script', () => {
  it('index.html inlines preHydrationScript verbatim', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`<script>${preHydrationScript}</script>`);
  });
});
