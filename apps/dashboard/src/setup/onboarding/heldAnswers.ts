// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the first two steps collect before there is anything to save it to
 * (45-onboarding.md §4, ruling R1).
 *
 * `start` and `connect` are answered while the instance still has no account,
 * and therefore no session, and therefore no endpoint that would accept them.
 * The answers wait here — in React state, for the lifetime of the wizard —
 * until `POST /setup/super-admin` mints the session (45 §0.1), and are
 * submitted immediately after.
 *
 * NOT localStorage, and not sessionStorage. A reload restarts the wizard, which
 * is the correct behaviour rather than a limitation: an instance with no
 * account has nothing to resume, and a connection string is the one thing this
 * product will not leave lying in a browser store. The same rule is why nothing
 * here is sent to the server "just to hold it" — a pre-auth draft endpoint on a
 * server that binds 0.0.0.0 is exactly what R1 refused.
 */
import type { DsnEngine } from '@adminium/widgets';

import type { GenerateIntent } from '../../studio/api.js';

/**
 * What to build first. `blank` is deliberately NOT one of the four generation
 * intents: it means "generate nothing", which is a different answer from any
 * shape of generated page set, and it is the default (45 R3).
 */
export type OnboardingStart = 'blank' | GenerateIntent;

/**
 * The engines this build can connect to (`studio/connect/wizardState.ts`
 * `SOURCE_ENGINES`). `DSN_ENGINES` in `@adminium/widgets` is wider — it carries
 * the grammar for `mongodb:` and `mssql:` too — so every call passes this list
 * and a `mongodb://` string is rejected as an unrecognised scheme rather than
 * accepted into an install that has no adapter for it.
 */
export const ONBOARDING_ENGINES: readonly DsnEngine[] = ['postgres', 'mysql', 'sqlite'];

/**
 * What `POST /setup/probe` found in the database the connect step was given
 * (45-T11). `null` until a DSN has been probed; `occupied` empty means the
 * database is either clean or holds only the husk of an abandoned attempt.
 */
export interface ExistingStore {
  occupied: string[];
  /** `false` ⇒ adopting keeps the account but loses that store's saved DSNs. */
  secretMatches: boolean | null;
}

export interface HeldAnswers {
  start: OnboardingStart;
  /** The engine card that is picked — not necessarily what `dsn` parses as. */
  engine: DsnEngine;
  /** Exactly as typed. Shape-checked here, proven only once a session exists. */
  dsn: string;
  /**
   * What is already in there — meaningful only when {@link probedDsn} matches
   * the current `dsn`. `null` reads as "nothing found" and as "not asked yet",
   * which is why the answer needs the question beside it.
   */
  existing: ExistingStore | null;
  /**
   * The exact string `existing` describes, or `null` for "not asked yet".
   *
   * The wizard WAITS on this. An advisory probe was the first shape of this
   * feature and it was wrong: the answer landed after Continue had already been
   * pressed, so the panel appeared on a screen the operator had left and come
   * back to — which reads as the wizard noticing late rather than as them
   * out-running it.
   */
  probedDsn: string | null;
  /**
   * The operator chose "keep the old tables and start fresh": the relocation
   * renames them out of the way instead of refusing. Meaningless unless they
   * also put Adminium's own data in that same database.
   */
  park: boolean;
}

export const DEFAULT_HELD_ANSWERS: HeldAnswers = {
  start: 'blank',
  engine: 'postgres',
  dsn: '',
  existing: null,
  probedDsn: null,
  park: false,
};

/** Nothing was typed — the connect step may be passed without an answer. */
export function hasNoConnection(held: HeldAnswers): boolean {
  return held.dsn.trim() === '';
}
