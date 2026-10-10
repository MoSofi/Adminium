// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One line on the Designer's Home, inside the desktop app: the names in the
 * project's `.env` the app did not obey, because it decides them itself (where
 * the server listens, what it trusts, which programs it runs). A person who put
 * `PORT=8080` there is told once why nothing listens on 8080; put away, it
 * stays away until the app is opened again.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, X } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { designerStateQuery } from '../api.js';

const PUT_AWAY = 'adminium.designer.ignoredEnv.hidden';

function putAway(): boolean {
  try {
    return window.sessionStorage.getItem(PUT_AWAY) === '1';
  } catch {
    return false;
  }
}

export function IgnoredEnv(): ReactNode {
  const state = useQuery({ ...designerStateQuery(), retry: false, staleTime: 60_000 });
  const [hidden, setHidden] = useState(putAway);
  const names = state.data?.ignoredEnv ?? [];
  if (names.length === 0 || hidden) return null;
  return (
    <div role="note" className="mb-8 flex w-full max-w-[700px] items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-2.5 text-start text-[12.5px] leading-normal text-fg-muted">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        {t('designer:home.ignoredEnv', 'The app decides these itself, so what this project’s .env says of them was ignored:')}{' '}
        <span dir="ltr" className="break-words font-mono text-[12px] font-semibold text-fg [unicode-bidi:isolate]">
          {names.join(', ')}
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          try {
            window.sessionStorage.setItem(PUT_AWAY, '1');
          } catch {
            // Private mode: it is put away until the page is loaded again.
          }
          setHidden(true);
        }}
        aria-label={t('designer:home.ignoredEnvHide', 'Hide this note')}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-surface hover:text-fg"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
