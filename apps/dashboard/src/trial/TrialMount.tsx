// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where trial mode shows: the shell's strips after the Topbar (`shell`, which
 * also locks the page's writes once the trial has ended), the user menu's
 * Upgrade (`menu`), and the sign-in and setup pages, whose page (`frame`) is
 * drawn below the strips. On a trial only (`/system/info` `trial.on`, which
 * needs no sign-in) the code and words are fetched (`TrialStrips.tsx`); on any
 * other server this draws what it was given and fetches nothing.
 */
import { useQuery } from '@tanstack/react-query';
import { cloneElement, lazy, Suspense, type ReactNode } from 'react';

import { systemInfoQuery } from '../app/capabilities.js';
import type { TrialPartProps } from './TrialStrips.js';

const TrialPart = lazy(async () => ({ default: (await import('./TrialStrips.js')).TrialPart }));

export function TrialMount({ frame, ...props }: TrialPartProps): ReactNode {
  const on = useQuery(systemInfoQuery()).data?.trial?.on === true;
  const part = on ? (
    <Suspense fallback={null}>
      <TrialPart {...props} />
    </Suspense>
  ) : null;
  // The page keeps its place in the tree as the answer and the strips arrive: a field typed into stays as it is.
  return frame === undefined ? (
    part
  ) : (
    <div className={on ? 'flex min-h-dvh flex-col' : 'contents'}>
      {part}
      {on ? cloneElement(frame, { className: 'min-h-0 flex-1' }) : frame}
    </div>
  );
}
