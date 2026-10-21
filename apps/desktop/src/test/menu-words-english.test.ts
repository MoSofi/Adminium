// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shell's own English for the menu and its dialogs (the boot menu, and the
 * fallback behind every word a page leaves out) is the same English the app's
 * pages send. Two copies of one text, held together here.
 */
import { describe, expect, it } from 'vitest';

import { EN_US_MENU_LABELS } from '../main/menu.js';
import { menuWords } from '../renderer/app/menuWords.js';
import { initWords } from '../renderer/app/words.js';

describe('the menu’s English', () => {
  it('is the same in the shell and on the app’s pages', async () => {
    expect(menuWords(await initWords('en_US'))).toEqual(EN_US_MENU_LABELS);
  });
});
