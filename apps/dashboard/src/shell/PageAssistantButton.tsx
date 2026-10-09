// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Ask button of a page that told the shell what it is.
 *
 * Drawn by the SHELL from what the page published (`PageActions`'
 * `assistant`), so the page templates bound to data do not each mount a
 * button, and a page that publishes nothing has none. It sits after the
 * page's own actions, as the comp draws it (Milo Panel, artboards 2–4), and
 * opens the same panel the bubble opens: the panel reads the page from the
 * same channel, so the button passes nothing.
 *
 * Its words are in the bundle every page already holds, because it is painted
 * with the top bar: the assistant's own messages are loaded with the panel.
 */
import { Button } from '@adminium/ui';
import { Sparkles } from 'lucide-react';

import { assistantAllowed, assistantName, type BootstrapData } from '../app/bootstrap.js';
import { setDockOpen, useDockOpen } from '../assistant/dock/dockStore.js';
import { t } from '../i18n/t.js';
import { usePageAssistant } from './PageActionsProvider.js';

export function PageAssistantButton({ bootstrap }: { bootstrap: BootstrapData }) {
  const page = usePageAssistant();
  const open = useDockOpen();
  if (page === null || !assistantAllowed(bootstrap)) return null;
  const label = t('shell.assistant.open', 'Ask {name}', { name: assistantName(bootstrap) });
  return (
    <Button
      type="button"
      variant="soft"
      size="topbar"
      data-testid="ask-assistant"
      aria-label={label}
      aria-expanded={open}
      onClick={() => setDockOpen(true)}
      // The pre-composed tint, not the translucent one: this sits in a sticky, part-opaque
      // header, and a translucent tint's contrast would depend on what scrolls under it.
      className="border border-accent/30 bg-accent-soft-solid max-sm:pe-2.5"
      iconLeft={<Sparkles className="size-[15px]" />}
    >
      {/* Icon-only below `sm` (comp 4b): the label is most of the button's width. */}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
