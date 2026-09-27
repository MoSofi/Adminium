// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The translator every widget and page template reads its words through:
 * `@adminium/i18n/react`'s `useMaybeT`, after waiting for the widget and
 * template words (`useUiWords`) — en-US loads them on demand, and a widget
 * that painted before they were in would show its inline English and then
 * change to the catalogue's. Outside a provider (bare tests, Storybook,
 * embeds) nothing waits and the inline English is the text, as before.
 */
import { useMaybeT as useProviderT, useUiWords } from '@adminium/i18n/react';

export { useMaybeI18n } from '@adminium/i18n/react';

export function useMaybeT(): ReturnType<typeof useProviderT> {
  useUiWords();
  return useProviderT();
}
