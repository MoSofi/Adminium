// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the user's own database (`yours`, `ADMINIUM_YOUR_DATABASE`) is doing,
 * for `/system/info` and the trial banner.
 *
 * It is connected off the boot path (`project/your-database.ts`): readiness
 * never waits for a database the operator does not run. So the state moves
 * `connecting` → `ready` (introspected and generated) or `down` (with a coarse
 * reason), and back to `down` and `ready` as later checks find it.
 *
 * The reason is a class, never the server's own message: a driver's error can
 * quote the address or the login, and `/system/info` answers before sign-in.
 */

/** Why the user's database cannot be reached: the same classes `adminium check-source` prints. */
export type YourDatabaseReason =
  | 'auth'
  | 'unreachable'
  | 'dns'
  | 'tls'
  | 'refused-by-us'
  /** Its login was refused too often lately (`SOURCE_LOGIN_LOCKED`): not tried again for up to an hour. */
  | 'locked'
  | 'ipv6-only'
  | 'no-database'
  | 'no-permission'
  | 'empty';

export const YOUR_DATABASE_REASONS: readonly YourDatabaseReason[] = ['auth', 'unreachable', 'dns', 'tls', 'refused-by-us', 'locked', 'ipv6-only', 'no-database', 'no-permission', 'empty'];

export interface YourDatabaseState {
  state: 'connecting' | 'ready' | 'down';
  /** Null unless `down`. */
  reason: YourDatabaseReason | null;
  /** The database's host as the operator gave it (no port, no login): for signed-in screens only. */
  host: string;
  /** The connection's name. */
  label: string;
  /** Opened read-only (chosen, or forced by read-only analytics). */
  readOnly: boolean;
  /** When the state last changed, ms. */
  at: number;
}

export interface YourDatabaseStatus {
  /** Null when this server has no user database. */
  current(): YourDatabaseState | null;
  set(next: Omit<YourDatabaseState, 'at'>, at?: number): void;
  /** Called with the new state whenever it changes (the operator event `source.status-changed`). */
  onChange(listener: (state: YourDatabaseState, previous: YourDatabaseState | null) => void): () => void;
}

export function yourDatabaseStatus(): YourDatabaseStatus {
  let state: YourDatabaseState | null = null;
  const listeners = new Set<(state: YourDatabaseState, previous: YourDatabaseState | null) => void>();
  return {
    current: () => state,
    set(next, at = Date.now()) {
      const previous = state;
      state = { ...next, at };
      if (previous === null || previous.state !== next.state || previous.reason !== next.reason) {
        for (const listener of listeners) {
          try {
            listener(state, previous);
          } catch {
            // A listener's failure never stops the state.
          }
        }
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The status this process holds (one server per process boots it). */
export const YOUR_DATABASE_STATUS: YourDatabaseStatus = yourDatabaseStatus();
