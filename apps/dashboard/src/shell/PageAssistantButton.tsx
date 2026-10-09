// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Ask button of a page that told the shell what it is.
 *
 * Drawn by the SHELL from what the page published (`PageActions`'
 * `assistant`), so the thirteen page templates bound to data do not each
 * mount a button, and a page that publishes nothing has none. It sits after
 * the page's own actions, as the comp draws it (Milo Panel, artboards 2–4).
 *
 * A page of rows drafts nothing, so there is no preview to draw and nothing
 * to open after a save: both are the empty answer here.
 */
import { AskAssistant } from '../assistant/AskAssistant.js';
import type { AssistantContext } from '../assistant/api.js';
import type { AssistantHostContext } from '../assistant/hostContext.js';
import { usePageAssistant } from './PageActionsProvider.js';

const NO_PREVIEW = () => null;
const NOTHING_CREATED = () => undefined;

export function PageAssistantButton() {
  const page = usePageAssistant();
  if (page === null) return null;
  const host: AssistantHostContext = {
    context: page.context as AssistantContext,
    host: page.host,
    renderPreview: NO_PREVIEW,
    onCreated: NOTHING_CREATED,
  };
  return <AskAssistant host={host} slot="manager" />;
}
