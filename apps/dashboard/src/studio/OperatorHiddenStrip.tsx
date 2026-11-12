// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The strip every Studio page shows while the server's operator has hidden
 * the instance's public pages: what happened, the operator's reason, and what
 * to do about it. Staff pages keep working, so it says nothing about them.
 *
 * It sits in the shell's banner slot, under the top bar, once: never a second
 * copy inside a page. The shell fetches this file only while the pages are
 * hidden (`publicPagesHidden` in the bootstrap), so it costs nobody's first
 * load anything; on a page outside Studio it draws nothing.
 *
 * The Trial Mode comp's view 8 (lines 127-129): danger-soft, `eye-off`,
 * 12.5 px, the first sentence bold.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { EyeOff } from 'lucide-react';
import { use, type ReactNode } from 'react';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { studioMessagesReady } from './studioMessages.js';

/** Whether a path is one of Studio's pages. */
export function isStudioPath(pathname: string): boolean {
  return pathname === '/studio' || pathname.startsWith('/studio/');
}

export default function OperatorHiddenStrip(): ReactNode {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const hidden = bootstrap.publicPagesHidden;
  if (hidden === undefined || !isStudioPath(pathname)) return null;
  // Its words are Studio's, which every Studio page loads: in before it paints.
  use(studioMessagesReady());
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 border-b border-[color-mix(in_srgb,var(--danger)_22%,transparent)] bg-danger-soft px-4 py-2.5 text-[12.5px] leading-normal text-fg sm:px-7"
    >
      <EyeOff aria-hidden="true" className="mt-px size-4 shrink-0 text-danger" />
      <p className="text-pretty">
        <strong>{t('studio:operatorHidden.title', 'Your public pages are hidden by the operator.')}</strong>
        {hidden.reason === null || hidden.reason === '' ? null : <> {t('studio:operatorHidden.reason', 'Reason: {reason}', { reason: hidden.reason })}</>}{' '}
        {t('studio:operatorHidden.reply', 'Reply to the operator’s email if this is a mistake.')}
      </p>
    </div>
  );
}
