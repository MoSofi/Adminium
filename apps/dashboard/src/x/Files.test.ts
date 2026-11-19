// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A file sent from a landing page's form block goes by the block's own form:
 * its human check and its upload both carry `on=<page key>` (the door binds
 * the check to the form `on` names), and a form's own page sends neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendFile } from './Files.js';

describe('a file sent from a form block', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries the page key on its check and its upload, and only there', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        urls.push(String(input));
        if (String(input).includes('/challenge')) return new Response(JSON.stringify({ id: 'eyJ2IjoxfQ~sig', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 }), { status: 200 });
        return new Response(JSON.stringify({ id: 'upl_1', name: 'plan.pdf', size: 4 }), { status: 200 });
      }),
    );
    const file = Object.assign(new Blob(['%PDF']), { name: 'plan.pdf' });
    expect(await sendFile('showroom-visit', 'qfiles', file, null, '5')).toMatchObject({ state: 'taken', id: 'upl_1' });
    expect(urls).toEqual(['/x/forms/api/showroom-visit/challenge?on=5', '/x/forms/api/showroom-visit/files?q=qfiles&name=plan.pdf&on=5']);
    urls.length = 0;
    await sendFile('showroom-visit', 'qfiles', file, 'tok');
    expect(urls).toEqual(['/x/forms/api/showroom-visit/challenge?t=tok', '/x/forms/api/showroom-visit/files?q=qfiles&name=plan.pdf&t=tok']);
  });
});
