// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The *Ask …* button, and the modal behind it.
 *
 * ONE COMPONENT, NOT TWO. Every host slot is the same three things — a
 * button, an open flag, and a modal mounted while it is true — so they live
 * here once instead of being copied into three managers and three editors.
 * A host writes `<AskAssistant host={…} />` in the place its comp draws the
 * button and is done.
 *
 * THE MODAL IS A CHUNK OF ITS OWN, loaded the first time somebody opens it.
 * That is the whole reason the flag is here rather than in the host: the
 * `lazy()` boundary has to sit above the flag, and a host that imported the
 * modal directly would pull it — and everything it draws — into its own
 * route chunk for every visit that never opens it.
 *
 * IT RENDERS NOTHING WITHOUT THE GRANT. `assistant.allowed` is a server
 * answer carried on bootstrap, because the dashboard holds no permission
 * list. A missing PROVIDER is not this decision: the button still renders
 * then, and the modal says what is wrong and who can fix it — a button that
 * vanishes teaches nobody anything.
 */
import { Button, cn } from '@adminium/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';

import { assistantAllowed, assistantName, bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import type { AssistantHostContext } from './hostContext.js';

const AssistantModal = lazy(async () => {
  const mod = await import('./AssistantModal.js');
  return { default: mod.AssistantModal };
});

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
  const navigate = useNavigate();
  // Cache read only: `appRoute`'s `beforeLoad` has already resolved bootstrap
  // before any page that renders this can mount.
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const [open, setOpen] = useState(false);

  if (boot.data === undefined || !assistantAllowed(boot.data)) return null;
  const name = assistantName(boot.data);

  return (
    <>
      <Button
        type="button"
        variant="soft"
        size="topbar"
        data-testid="ask-assistant"
        title={t('assistant:buttonTitle', 'Ask {name} about this page', { name })}
        // The label is hidden below `sm`, so the accessible name has to come
        // from here — see the note above the label itself.
        aria-label={t('assistant:button', 'Ask {name}', { name })}
        onClick={() => setOpen(true)}
        // The comp's 1 px accent border at 30 %, and the editor row's 38 px.
        // `pe-2.5` below `sm` because the label that earns the wider end
        // padding is not there.
        className={cn('border border-accent/30 max-sm:pe-2.5', slot === 'editor' && 'h-[38px]')}
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
      {open ? (
        <Suspense fallback={null}>
          <AssistantModal
            host={host}
            open
            onClose={() => setOpen(false)}
            onOpenSettings={() => {
              setOpen(false);
              void navigate({ to: '/studio/settings/ai' });
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
