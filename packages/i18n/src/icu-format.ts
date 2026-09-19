// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ICU i18nFormat module for i18next, built directly on intl-messageformat's
 * NAMED export.
 *
 * Replaces `i18next-icu`, whose ESM build does `import IntlMessageFormat from
 * 'intl-messageformat'` — under Node ESM that default resolves to the CJS
 * namespace object (not the class), the internal `new` throws, the error is
 * swallowed, and every message silently renders raw. Owning these ~40 lines
 * removes the interop landmine and gives us explicit error surfacing.
 */
import { IntlMessageFormat } from 'intl-messageformat';

import { recordFormatFailure } from './format-errors.js';
import { intlTagForLocale, localeFromTag } from './locales.js';

type FormatValues = Record<string, unknown> | undefined;

export class IcuFormat {
  static readonly type = 'i18nFormat';
  readonly type = 'i18nFormat' as const;

  #cache = new Map<string, IntlMessageFormat>();
  #onError: (key: string, error: unknown) => void;
  #resolveIntlTag: (lng: string) => string;
  /** Language of the most recent parse — the error hook has no other source. */
  #lastLng = 'en-US';

  constructor(
    opts: {
      onError?: (key: string, error: unknown) => void;
      /** Override the i18next tag → Intl tag mapping (tests, embedding). */
      resolveIntlTag?: (lng: string) => string;
    } = {},
  ) {
    this.#onError =
      opts.onError ??
      ((key, error) => {
        /*
         * Never throw at render time. The console warning is for developers;
         * the ring is what the Translations editor reads, because the person
         * who broke an admin-authored message is not looking at devtools.
         *
         * THE REASON A STRING IS LOGGED AND NOT THE ERROR. Passing the object
         * kept that promise under node and broke it under vitest: a
         * `MissingValueError` — which is what an unsupplied argument produces,
         * the single most ordinary failure on this path — took vitest's console
         * capture 8 seconds to serialise and then threw `RangeError: Invalid
         * string length` FROM THIS LINE. The object is not large: `node:util`
         * inspects it to 1,189 characters at any depth. Some console
         * implementations walk further than that, and this handler cannot know
         * which one it is talking to.
         *
         * So it hands over something bounded. `recordFormatFailure` below
         * already did exactly this; the two lines now agree, and the handler
         * keeps its promise wherever it runs.
         */
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[adminium/i18n] ICU parse failed for "${key}": ${reason}`);
        recordFormatFailure({
          key,
          lng: this.#lastLng,
          message: reason,
          at: Date.now(),
        });
      });
    this.#resolveIntlTag = opts.resolveIntlTag ?? defaultIntlTag;
  }

  /** i18next module hook (called by i18next during init; extra args ignored). */
  init(): void {
    /* no service wiring needed */
  }

  /** i18next i18nFormat contract: format the resolved resource string (trailing `info` arg unused). */
  parse(res: string, options: FormatValues, lng: string, _ns: string, key: string): string {
    if (typeof res !== 'string' || !res.includes('{')) return res;
    try {
      // The tag handed to ICU is the locale's INTL tag, not i18next's active
      // language. For the compiled eight they are the same string;
      // for an admin-created locale they are not, and using `lng` there means
      // ICU has no plural data for the tag and silently resolves every
      // message to `other` — with nothing thrown and nothing logged. The
      // borrow tag is also part of the cache key, so re-pointing a locale's
      // `intlTag` invalidates its compiled messages.
      this.#lastLng = lng;
      const intlTag = this.#resolveIntlTag(lng);
      const cacheKey = `${intlTag}\x00${key}\x00${res}`;
      let message = this.#cache.get(cacheKey);
      if (message === undefined) {
        message = new IntlMessageFormat(res, intlTag, undefined, { ignoreTag: true });
        this.#cache.set(cacheKey, message);
      }
      return String(message.format(options as Record<string, string | number> | undefined));
    } catch (error) {
      this.#onError(key, error);
      return res;
    }
  }

  /** i18next asks the format plugin whether to add ordinal/plural key suffixes — ICU handles plurals itself. */
  getSuffixes(): string[] {
    return [];
  }

  /** Drop compiled messages — call after a bundle swap so edits take effect. */
  clearCache(): void {
    this.#cache.clear();
  }
}

/**
 * i18next language tag → the tag ICU should format under. Runs through the
 * locale registry so a custom locale gets its admin-chosen borrow tag; falls
 * back to the tag itself for anything the registry does not know.
 */
function defaultIntlTag(lng: string): string {
  const id = localeFromTag(lng);
  const intlTag = intlTagForLocale(id);
  // `localeFromTag` coalesces unknown tags to en_US; don't let that silently
  // re-map a tag ICU would have handled perfectly well on its own.
  return id === 'en_US' && lng !== 'en-US' ? lng : intlTag;
}
