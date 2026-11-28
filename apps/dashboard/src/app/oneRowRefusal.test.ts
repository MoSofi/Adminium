// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create in a table an app keeps to one row (409 `ONE_ROW_TABLE`, its
 * settings) reads in the person's language wherever an error's message is
 * shown: a records page's New form, a file brought in, a board. Any other
 * refusal keeps the server's own sentence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { setI18nInstance, type I18nInstance } from '../i18n/t.js';
import { ApiError } from './api.js';

const SERVER = "This table holds the app's settings: it has one row. Edit that row.";

function installCatalogue(tag: string): Record<string, unknown> {
  const errors = JSON.parse(readFileSync(join(process.cwd(), `../../packages/i18n/locales/${tag}/errors.json`), 'utf8')) as Record<string, unknown>;
  setI18nInstance({
    language: tag,
    t: (key: string, options?: Record<string, unknown>) => {
      const name = key.replace(/^errors:/, '');
      const found = errors[name];
      return typeof found === 'string' ? found : String(options?.['defaultValue'] ?? key);
    },
  } as unknown as I18nInstance);
  return errors;
}

afterEach(() => setI18nInstance(null));

describe('the one-row refusal', () => {
  it('reads in English before any words are in', () => {
    expect(new ApiError(409, 'ONE_ROW_TABLE', SERVER, null, { table: 'public.shop_settings' }).message).toBe('This table holds the app’s settings: it has one row. Edit that row.');
  });

  it('reads in every language the dashboard ships', () => {
    for (const tag of ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW']) {
      const errors = installCatalogue(tag);
      expect(typeof errors['ONE_ROW_TABLE'], tag).toBe('string');
      expect(new ApiError(409, 'ONE_ROW_TABLE', SERVER, null).message, tag).toBe(errors['ONE_ROW_TABLE']);
    }
  });

  it("leaves any other refusal in the server's words", () => {
    installCatalogue('de-DE');
    expect(new ApiError(409, 'CONFLICT', 'The row changed.', null).message).toBe('The row changed.');
  });
});
