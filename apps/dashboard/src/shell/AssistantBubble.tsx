// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's bubble, and the place its panel mounts (Milo Panel, 02).
 *
 * The bubble is in the entry and the panel is not: nothing of the panel is
 * fetched before the first press, or before a reload that finds it open. The
 * bubble is drawn only for a person who may use the assistant, and never
 * while the panel is open.
 */
import { Sparkles } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';

import { assistantAllowed, assistantName, type BootstrapData } from '../app/bootstrap.js';
import { initDock, setDockOpen, useDockOpen, useDockSignal, type DockSignal } from '../assistant/dock/dockStore.js';
import { t } from '../i18n/t.js';
import { useShortcut } from './ShortcutsProvider.js';

const AssistantDock = lazy(async () => ({ default: (await import('../assistant/dock/AssistantDock.js')).AssistantDock }));

/** How far the toast stack rises to clear the bubble: its 48 px and a 12 px gap. */
const TOAST_LIFT = '60px';

export function AssistantBubble({ bootstrap }: { bootstrap: BootstrapData }) {
  const allowed = assistantAllowed(bootstrap);
  const userId = bootstrap.user.id;
  useEffect(() => {
    if (allowed) initDock(userId);
  }, [allowed, userId]);
  const open = useDockOpen();
  const signal = useDockSignal();
  const shown = allowed && !open;

  // Both want the same corner: the toasts stand above the bubble while it is there.
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.style.setProperty('--toast-lift', TOAST_LIFT);
    return () => {
      root.style.removeProperty('--toast-lift');
    };
  }, [shown]);

  // Loaded on the first open and kept: closed, it draws nothing and still follows a question
  // that is being answered, which is what the bubble's ring and dot are told by.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (open) setLoaded(true);
  }, [open]);

  const name = assistantName(bootstrap);
  // In the registry, so the shortcuts panel lists it: open the panel from anywhere, and close it again.
  useShortcut({
    id: 'assistant',
    group: 'General',
    label: t('shell.assistant.open', 'Ask {name}', { name }),
    keys: ['⌘', '.'],
    when: () => allowed,
    handler: () => setDockOpen(!open),
  });

  if (!allowed) return null;
  const dock =
    loaded || open ? (
      <Suspense fallback={null}>
        <AssistantDock visible={open} />
      </Suspense>
    ) : null;
  if (open) return dock;
  return (
    <>
      {dock}
      <AssistantBubbleButton name={name} signal={signal} />
    </>
  );
}

function AssistantBubbleButton({ name, signal }: { name: string; signal: DockSignal }) {
  return (
    <button
      type="button"
      data-testid="assistant-bubble"
      data-signal={signal}
      onClick={() => setDockOpen(true)}
      aria-label={t('shell.assistant.open', 'Ask {name}', { name })}
      title={t('shell.assistant.open', 'Ask {name}', { name })}
      className="nb-press fixed bottom-4 end-4 z-[25] flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_8px_22px_color-mix(in_srgb,var(--accent)_36%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {signal === 'working' ? (
        <span aria-hidden="true" className="absolute inset-[-5px] animate-[spin_2.4s_linear_infinite] rounded-full border-2 border-transparent border-t-accent motion-reduce:animate-none" />
      ) : null}
      <Sparkles className="size-5" aria-hidden="true" />
      {signal === 'idle' ? null : (
        <span className="sr-only">
          {signal === 'working' ? t('shell.assistant.working', '{name} is working', { name }) : t('shell.assistant.unread', '1 unread answer')}
        </span>
      )}
      {signal === 'unread' ? <span aria-hidden="true" className="absolute end-[-1px] top-[-1px] size-3.5 rounded-full border-[2.5px] border-bg bg-danger" /> : null}
    </button>
  );
}
