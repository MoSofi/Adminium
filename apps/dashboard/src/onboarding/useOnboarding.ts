/**
 * Onboarding query + dismissal (M5-T06). The state is admin-only (the server
 * guards it with `system:connections:manage`), so the query is gated on the
 * caller's roles to avoid a guaranteed 403 for editors/viewers.
 *
 * `staleTime: 0` keeps the reactive checklist honest — every mount/navigation
 * re-derives from live workspace state; the realtime `config-changed` handler
 * (api/realtime.ts) also invalidates `['onboarding']` so connecting a database
 * ticks "Connect a database" without a reload.
 */

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BootstrapData } from '../app/bootstrap.js';
import { onboardingApi, type OnboardingState } from './api.js';

export const ONBOARDING_QUERY_KEY = ['onboarding'] as const;

/** Roles that may see the onboarding surface (mirror of the server guard). */
export function isOnboardingAdmin(roles: readonly string[]): boolean {
  return roles.includes('super-admin') || roles.includes('admin');
}

export function onboardingQuery() {
  return queryOptions({
    queryKey: ONBOARDING_QUERY_KEY,
    staleTime: 0,
    // A 403/401 is terminal ("not an admin"), not a transient failure.
    retry: false,
    queryFn: () => onboardingApi.get(),
  });
}

export interface UseOnboardingResult {
  state: OnboardingState | undefined;
  isLoading: boolean;
  isError: boolean;
  dismiss: (dismissed?: boolean) => void;
  isDismissing: boolean;
}

export function useOnboarding(bootstrap: BootstrapData): UseOnboardingResult {
  const queryClient = useQueryClient();
  const enabled = isOnboardingAdmin(bootstrap.roles);
  const query = useQuery({ ...onboardingQuery(), enabled });

  const mutation = useMutation({
    mutationFn: (dismissed: boolean) => onboardingApi.dismiss(dismissed),
    onSuccess: (state) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, state);
    },
  });

  return {
    state: query.data,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
    dismiss: (dismissed = true) => mutation.mutate(dismissed),
    isDismissing: mutation.isPending,
  };
}
