// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The *Ask …* button of a page that drafts documents, and what makes the
 * page's drafts usable in the panel.
 *
 * ONE COMPONENT PER HOST SLOT. A host writes `<AskAssistant host={…} />` in
 * the place its comp draws the button and is done. It does three things:
 *
 *  - tells the shell which page this is (the page channel), so the panel asks
 *    its questions here and knows a draft made here is at home;
 *  - hands the panel what only the page can do with a draft: draw it with the
 *    page's own renderer, put it on screen, follow a save;
 *  - draws the button, which opens the same panel the bubble opens.
 *
 * THE PANEL IMPORTS NO HOST and a host imports no panel: the channel is the
 * seam, so a preview is drawn by the same component the editor draws it with.
 *
 * IT RENDERS NOTHING WITHOUT THE GRANT. `assistant.allowed` is a server
 * answer carried on bootstrap. A missing PROVIDER is not this decision: the
 * button still renders then, and the panel says what is wrong and who can fix
 * it; a button that vanishes teaches nobody anything.
 */
import { Button, cn } from '@adminium/ui';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { assistantAllowed, assistantName, bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { PageActions, usePageAssistantHandlers } from '../shell/PageActionsProvider.js';
import { setDockOpen, useDockOpen } from './dock/dockStore.js';
import type { AssistantHostContext } from './hostContext.js';

export interface AskAssistantProps {
  /** Built by the page's own `assistant.tsx` — see `hostContext.ts`. */
  host: AssistantHostContext;
  /**
   * Which header this sits in. A manager's topbar is the house 34 px, level
   * with the primary beside it; an editor header's row is 38, level with the
   * Duplicate and Delete buttons there.
   */
  slot: 'manager' | 'editor';
}

export function AskAssistant({ host, slot }: AskAssistantProps) {
  // Cache read only: `appRoute`'s `beforeLoad` has already resolved bootstrap
  // before any page that renders this can mount.
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const open = useDockOpen();
  // Handed over whether or not the button is drawn: hooks do not come and go.
  usePageAssistantHandlers<AssistantHostContext>(host);

  if (boot.data === undefined || !assistantAllowed(boot.data)) return null;
  const name = assistantName(boot.data);

  return (
    <>
      {/* Which page this is, for the panel. The document it has open is part of that: a draft
          made for one document is not at home on another. */}
      <PageActions assistant={{ context: host.context, host: host.host, ownButton: true }} />
      <Button
        type="button"
        variant="soft"
        size="topbar"
        data-testid="ask-assistant"
        title={t('assistant:buttonTitle', 'Ask {name} about this page', { name })}
        // The label is hidden below `sm`, so the accessible name has to come
        // from here — see the note above the label itself.
        aria-label={t('assistant:button', 'Ask {name}', { name })}
        aria-expanded={open}
        onClick={() => setDockOpen(true)}
        // The comp's 1 px accent border at 30 %, and the editor row's 38 px.
        // `pe-2.5` below `sm` because the label that earns the wider end
        // padding is not there.
        //
        // `bg-accent-soft-solid` OVER THE VARIANT'S TRANSLUCENT `bg-accent-soft`,
        // which is the same reason `Tag` and `Badge` use it: this button lives in
        // a STICKY, 82 %-opaque header, and every host page under it renders a
        // white document sheet. Scroll that sheet beneath the header and the
        // tint composites over it instead of over the surface — measured
        // 3.77:1 in dark mode, against the 4.5:1 floor, and only once a block
        // was selected and the canvas had scrolled. The pre-composed token
        // makes the contrast a property of the token rather than of the scroll
        // position: 6.60:1 dark, 4.99:1 light.
        className={cn('border border-accent/30 bg-accent-soft-solid max-sm:pe-2.5', slot === 'editor' && 'h-[38px]')}
        iconLeft={<Sparkles className="size-[15px]" />}
      >
        {/*
         * ICON-ONLY BELOW `sm`. The label is 68 of this button's 100 px, and
         * the email manager's topbar already carries two other actions: at
         * 390 px the three of them pushed the shell's own cluster 31 px past
         * the viewport and the WHOLE PAGE scrolled sideways. The glyph plus
         * the accessible name says the same thing in the space there is.
         */}
        <span className="hidden sm:inline">{t('assistant:button', 'Ask {name}', { name })}</span>
      </Button>
    </>
  );
}
