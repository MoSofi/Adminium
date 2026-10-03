// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design link opened in a tab that already shows the Designer: the
 * address changes only after `#`, so the page does not load again and the
 * start-up code that takes the token never runs. The token would sit in the
 * address bar, unspent. The Designer's pages take it themselves: out of the
 * address at once, exchanged, then the session read again.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { bootstrapQuery } from '../app/bootstrap.js';
import { DESIGN_TOKEN_HASH, exchangeDesignToken } from './designToken.js';

export function useLateDesignToken(): void {
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    const take = (): void => {
      if (!window.location.hash.startsWith(DESIGN_TOKEN_HASH)) return;
      void exchangeDesignToken().then(async (outcome) => {
        if (outcome !== 'exchanged') return;
        await queryClient.fetchQuery({ ...bootstrapQuery(), staleTime: 0 }).catch(() => undefined);
        await router.invalidate();
      });
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, [queryClient, router]);
}
