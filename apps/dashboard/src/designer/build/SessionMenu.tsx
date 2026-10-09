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
import { Check, ChevronDown, MessageSquare, MessageSquarePlus } from 'lucide-react';
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
    // One box: "New session", and (when the app has more than one) the caret that lists them, a rule between.
    <div className="inline-flex h-[34px] shrink-0 items-stretch rounded-[10px] border border-border-strong bg-surface leading-[normal]">
      <button
        type="button"
        onClick={onNew}
        disabled={disabled}
        title={hint}
        aria-label={t('designer:build.newSession', 'New session')}
        className={`inline-flex items-center gap-[7px] whitespace-nowrap px-[9px] text-[13px] font-bold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 min-[900px]:px-[11px] ${sessions.length > 1 ? 'rounded-s-[9px]' : 'rounded-[9px]'}`}
      >
        <MessageSquarePlus aria-hidden="true" className="size-[15px]" />
        <span className="hidden min-[900px]:inline">{t('designer:build.newSession', 'New session')}</span>
      </button>
      {sessions.length > 1 ? (
        <DropdownMenu modal={false}>
          <span aria-hidden="true" className="w-px bg-border-strong" />
          <DropdownMenuTrigger
            aria-label={t('designer:build.sessions', 'Sessions on this app')}
            title={t('designer:build.sessions', 'Sessions on this app')}
            className="flex w-[26px] items-center justify-center rounded-e-[9px] text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-[280px] overflow-y-auto rounded-[12px] p-[5px] leading-[normal]">
            <DropdownMenuLabel>{t('designer:build.sessions', 'Sessions on this app')}</DropdownMenuLabel>
            {sessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                aria-current={session.id === currentId ? 'page' : undefined}
                onSelect={() => (session.id === currentId ? undefined : onOpen(session.id))}
                icon={<MessageSquare />}
                trailing={session.id === currentId ? <Check aria-hidden="true" className="text-accent" /> : undefined}
                className="gap-2.5 px-2.5 py-2 [&_svg]:size-[15px]"
              >
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="truncate font-bold">{session.title}</span>
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
