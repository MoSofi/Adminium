// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TanStack Query client + the API-error → system-state mapping consumed by
 * route `errorComponent`s (09-generated-app.md §2.3, §6.1).
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api.js';

/**
 * The 13 system states (09-generated-app.md §6.1, incl. `suspended` and
 * `connection-paused`).
 */
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
  /**
   * The source database is PAUSED by an operator (meta wave 0019).
   *
   * Its own state rather than `db-unreachable`: that screen says a database
   * could not be reached and offers "Retry connection", which here would be a
   * button that cannot work in front of a reader who has done nothing wrong.
   * Nothing is broken, nothing is lost, and the fix is a person resuming it.
   */
  'connection-paused',
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
        if (error.code === 'CONNECTION_DISABLED') return 'connection-paused';
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
          // A paused connection is a 5xx by status and a DECISION by nature —
          // it will answer exactly the same way until a human resumes it, so
          // retrying only spends the reader's time before the same screen.
          if (error instanceof ApiError && error.code === 'CONNECTION_DISABLED') return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}
