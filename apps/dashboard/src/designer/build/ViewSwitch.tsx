// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The switch between the chat and the work area, drawn only when the window
 * is too narrow for both: then each is a view, and this is their tab list.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { AppWindow, MessagesSquare } from 'lucide-react';

import { t } from '../../i18n/t.js';

export type BuildView = 'chat' | 'work';

/** The ids that tie each tab to its panel. */
export const VIEW_IDS = {
  chat: { tab: 'designer-view-chat', panel: 'designer-view-chat-panel' },
  work: { tab: 'designer-view-work', panel: 'designer-view-work-panel' },
} as const;

export function ViewSwitch({ view, onView, chatWaiting = false }: { view: BuildView; onView: (view: BuildView) => void; /** The Designer waits for an answer in the chat: said on its tab, for whoever is looking at the other view. */ chatWaiting?: boolean }): ReactNode {
  const views = [
    ['chat', MessagesSquare, t('designer:build.chat', 'Chat')],
    ['work', AppWindow, t('designer:build.workArea', 'Work area')],
  ] as const;
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const other: BuildView | null = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (view === 'chat' ? 'work' : 'chat') : event.key === 'Home' ? 'chat' : event.key === 'End' ? 'work' : null;
    if (other === null) return;
    event.preventDefault();
    onView(other);
    document.getElementById(VIEW_IDS[other].tab)?.focus();
  };
  return (
    <div role="tablist" aria-label={t('designer:build.views', 'View')} onKeyDown={onKey} className="mx-3 mt-2 flex shrink-0 gap-0.5 rounded-[11px] bg-surface-3 p-[3px] leading-[normal]">
      {views.map(([id, Icon, label]) => (
        <button
          key={id}
          id={VIEW_IDS[id].tab}
          type="button"
          role="tab"
          aria-selected={view === id}
          aria-controls={VIEW_IDS[id].panel}
          tabIndex={view === id ? 0 : -1}
          onClick={() => onView(id)}
          className="inline-flex h-[34px] flex-1 items-center justify-center gap-[7px] rounded-[9px] text-[13px] font-bold text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-selected:bg-surface aria-selected:text-fg aria-selected:shadow-card aria-selected:ring-1 aria-selected:ring-border"
        >
          <Icon aria-hidden="true" className="size-[15px]" />
          {label}
          {id === 'chat' && chatWaiting ? <span role="img" aria-label={t('designer:build.chatWaiting', 'The Designer is waiting for your answer')} className="size-[7px] shrink-0 rounded-full bg-warn" /> : null}
        </button>
      ))}
    </div>
  );
}
