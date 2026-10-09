// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { versionLabel, versionName } from './versionName.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());

describe('a version’s name', () => {
  it('is its own part without the number, and nothing when it is the number alone', () => {
    expect(versionLabel('v3 · Cart and pickup times')).toBe('Cart and pickup times');
    expect(versionLabel('v3')).toBeNull();
    expect(versionLabel('Something the Designer wrote')).toBe('Something the Designer wrote');
  });

  it('words the three names the server gives by itself, from their shape', () => {
    expect(versionName('v14 · Your edit to Menu.tsx')).toBe('v14 · Your edit to Menu.tsx');
    expect(versionName('v15 · Your edit to 3 files')).toBe('v15 · Your edit to 3 files');
    expect(versionName('v5 · Back to v2')).toBe('v5 · Back to v2');
    expect(versionName('v1')).toBe('v1');
    // A file really called "3 files" is still one file's name; a name that only starts alike is left alone.
    expect(versionLabel('v2 · Your edits to the menu')).toBe('Your edits to the menu');
    expect(versionLabel('v2 · Back to basics')).toBe('Back to basics');
  });
});
