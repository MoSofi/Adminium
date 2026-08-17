// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TanStack Query client + the API-error → system-state mapping consumed by
 * route `errorComponent`s (09-generated-app.md §2.3, §6.1).
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api.js';

/** The 12 system states (09-generated-app.md §6.1, incl. the new `suspended`). */
export const SYSTEM_STATE_IDS = [
  'not-found',
  'forbidden',
  'error',
  'db-unreachable',
  'maintenance',
  'rate-limited',
  'offline',
  'expired-link',
  'expired-session',
  'empty-no-sources',
  'read-only',
  'suspended',
] as const;
export type SystemStateId = (typeof SYSTEM_STATE_IDS)[number];

export function isSystemStateId(value: string): value is SystemStateId {
  return (SYSTEM_STATE_IDS as readonly string[]).includes(value);
}

/**
 * Maps a thrown query/loader error to the system state that should render
 * (§6.1 trigger column). Detection order: browser offline signal, canonical
 * API codes, then network-level failures (fetch rejects with TypeError).
 */
export function stateIdForError(error: unknown): SystemStateId {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'expired-session';
      case 402:
        return 'suspended';
      case 403:
        return 'forbidden';
      case 404:
        return 'not-found';
      case 429:
        return 'rate-limited';
      case 503:
        if (error.code === 'MAINTENANCE') return 'maintenance';
        if (
          error.code === 'DB_UNREACHABLE' ||
          error.code === 'SOURCE_DB_UNREACHABLE' ||
          error.code === 'META_NOT_CONFIGURED'
        ) {
          return 'db-unreachable';
        }
        return 'error';
      default:
        return 'error';
    }
  }

  if (error instanceof TypeError) return 'offline';
  return 'error';
}

/** Extracts the `req_…` id for the state-page footer, when the error has one. */
export function requestIdForError(error: unknown): string | null {
  return error instanceof ApiError ? error.requestId : null;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 4xx are decisions, not flakes; retry only transient failures.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}
