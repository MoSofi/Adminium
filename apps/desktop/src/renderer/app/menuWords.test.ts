// SPDX-License-Identifier: AGPL-3.0-only
import { localeFromTag } from '@adminium/i18n';
import { describe, expect, it, vi } from 'vitest';

import { menuWords, pushMenuWords } from './menuWords.js';
import { PAGE_LANGUAGES, initWords } from './words.js';

describe('the menu words of the app’s own pages', () => {
  it('are translated, with the placeholders kept for the shell', async () => {
    const warn = vi.spyOn(console, 'warn');
    const words = menuWords(await initWords('de_DE'));
    expect(words.file).toBe('Datei');
    expect(words['update.none.detail']).toBe('Adminium {version} ist die neueste Version.');
    expect(words['update.available.detail']).toBe('Installiert ist Version {current}.');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('ICU'));
    warn.mockRestore();
  });

  it('are in each language these pages are drawn in, not English', async () => {
    for (const tag of PAGE_LANGUAGES) {
      if (tag === 'en-US') continue;
      const words = menuWords(await initWords(localeFromTag(tag)));
      expect(words['update.later'], tag).not.toBe('Later');
    }
  });

  it('are sent to the shell', async () => {
    const setMenuLabels = vi.fn(() => Promise.resolve());
    pushMenuWords(await initWords('fr_FR'), { setMenuLabels });
    expect(setMenuLabels).toHaveBeenCalledOnce();
    expect((setMenuLabels.mock.calls[0] as unknown[])[0]).toMatchObject({ file: 'Fichier' });
  });
});
