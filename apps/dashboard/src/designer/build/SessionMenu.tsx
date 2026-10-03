// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "New session" on the build page, and the app's earlier sessions.
 *
 * A session sends its whole conversation to the model at every step, so a
 * long one costs more with each turn. A new session starts from the app's
 * files as they are and an empty conversation; the earlier chats stay where
 * they were, listed here, each still readable and still able to go on.
 */
import type { ReactNode } from 'react';
import { Check, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { YourApp } from '../api.js';
import { editedWhen } from '../home/YourApps.js';

export function SessionMenu({
  sessions,
  currentId,
  onNew,
  onOpen,
  disabled,
  why,
}: {
  sessions: YourApp['sessions'];
  currentId: string;
  onNew: () => void;
  onOpen: (sessionId: string) => void;
  disabled: boolean;
  /** Why a new session cannot be started now, for the button's title. */
  why?: string | undefined;
}): ReactNode {
  const hint = why ?? t('designer:build.newSessionHint', 'Start a new chat on this app. The Designer starts from the app’s files; this chat is kept.');
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onNew}
        disabled={disabled}
        title={hint}
        aria-label={t('designer:build.newSession', 'New session')}
        className={`inline-flex items-center gap-[7px] px-[11px] py-2 text-[13px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 ${sessions.length > 1 ? 'rounded-s-[10px]' : 'rounded-[10px]'}`}
      >
        <MessageSquarePlus aria-hidden="true" className="size-4" />
        <span className="hidden xl:inline">{t('designer:build.newSession', 'New session')}</span>
      </button>
      {sessions.length > 1 ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('designer:build.sessions', 'Sessions on this app')}
            title={t('designer:build.sessions', 'Sessions on this app')}
            className="flex h-[36px] items-center rounded-e-[10px] px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-[280px] overflow-y-auto">
            <DropdownMenuLabel>{t('designer:build.sessions', 'Sessions on this app')}</DropdownMenuLabel>
            {sessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                aria-current={session.id === currentId ? 'page' : undefined}
                onSelect={() => (session.id === currentId ? undefined : onOpen(session.id))}
                trailing={session.id === currentId ? <Check aria-hidden="true" className="text-accent" /> : undefined}
              >
                <span className="flex min-w-0 flex-col py-0.5">
                  <span className="truncate">{session.title}</span>
                  <span className="truncate text-[11.5px] font-normal text-fg-subtle">
                    {editedWhen(session.updatedAt)} · {t('designer:build.sessionTurns', '{count, plural, one {# turn} other {# turns}}', { count: session.turns })}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
