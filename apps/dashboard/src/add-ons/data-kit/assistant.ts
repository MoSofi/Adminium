// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `host.data.openAssistant`: an add-on page's "Ask Milo" opens the same panel
 * the header's button and ⌘. open, with the page's words in its box. The
 * person sends them, or not: the call itself sends nothing.
 */
import { openDockWith } from '../../assistant/dock/dockStore.js';

export function openAssistantPanel(options?: { prompt?: string }): boolean {
  const prompt = typeof options?.prompt === 'string' ? options.prompt : undefined;
  return openDockWith(prompt);
}
