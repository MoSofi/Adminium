// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The step-3 transition: create the account, then land everything the first two
 * steps held (45-onboarding.md §4, ruling R1).
 *
 * ORDER, AND WHY IT IS THIS ORDER. `POST /setup/super-admin` comes first
 * because it is the only call here that works without a session — it mints one
 * (`server/src/routes/setup/index.ts:145`). Everything after it is an ordinary
 * authenticated call, which is exactly what R1 bought: no pre-auth endpoint had
 * to exist for the connect step to be answerable before the account.
 *
 * THE ACCOUNT IS NOT ROLLED BACK when the connection fails. It cannot be — the
 * server offers no un-create — and it should not be: a person whose DSN had a
 * typo is now signed in, which is what lets them fix it. The caller sends them
 * back to the connect step; `setup.state.required` is already false, so the
 * wizard they are standing in is the only way back to it, and that is why the
 * outcome says which step to return to rather than throwing.
 *
 * NO POLLING. Introspection may answer 202 with a job (`studioApi.introspect`),
 * and this does not wait on it: the summary reads "reading your schema" and the
 * Studio's connect wizard — which owns tables, enrich and generate (45 R4) —
 * picks it up. A table count is reported only when the schema was already there
 * to count (45 DEP-19).
 */
import {
  studioApi,
  type ConnectionEngine,
  type DsnPrivileges,
  type GenerateIntent,
} from '../../studio/api.js';
import { engineForDsn } from '@adminium/widgets';

import { createSuperAdmin, type SetupConsent } from '../setupApi.js';
import type { AccountValues } from '../accountValidation.js';
import { ONBOARDING_ENGINES, type HeldAnswers } from './heldAnswers.js';

/** What the wizard learned by doing it. Every field may be absent. */
export interface LandedConnection {
  connectionId: string;
  engine: ConnectionEngine;
  /** `null` while introspection is still running as a job. */
  tableCount: number | null;
  serverVersion: string | null;
  latencyMs: number;
  readOnly: boolean;
  /**
   * What the probe found the role can do. Step 4 needs it: Adminium's own
   * tables may only live in this database when the role can write and run DDL
   * (`studio/connect/metaPlacementRule.ts`).
   */
  privileges: DsnPrivileges | null;
}

export type SubmitOutcome =
  | { kind: 'ok'; connection: LandedConnection | null }
  /** The account was not created. Nothing else ran. */
  | { kind: 'account-failed'; cause: unknown }
  /** The account EXISTS; the connection did not take. */
  | { kind: 'connection-failed'; cause: unknown };

/** Injected in tests; defaults to the real endpoints. */
export interface SubmitDeps {
  createSuperAdmin: typeof createSuperAdmin;
  testDsn: typeof studioApi.testDsn;
  createConnection: typeof studioApi.createConnection;
  introspect: typeof studioApi.introspect;
  getSchema: typeof studioApi.getSchema;
}

const REAL_DEPS: SubmitDeps = {
  createSuperAdmin,
  testDsn: studioApi.testDsn,
  createConnection: studioApi.createConnection,
  introspect: studioApi.introspect,
  getSchema: studioApi.getSchema,
};

/**
 * A name for a connection nobody was asked to name.
 *
 * The comp has no name field and inventing one would be a fifth question on a
 * screen the owner wanted short. The database's own name is the best answer
 * available and is what an operator would have typed anyway; the Studio can
 * rename it in one click afterwards.
 */
export function connectionNameFromDsn(dsn: string, engine: ConnectionEngine): string {
  const trimmed = dsn.trim();
  if (engine === 'sqlite') {
    const file = trimmed.replace(/^sqlite:(\/\/)?/i, '').split(/[\\/]/).pop() ?? '';
    const base = file.replace(/\.(sqlite3?|db)$/i, '').trim();
    return base === '' ? 'SQLite' : base;
  }
  // Everything after the last `/`, minus a query string. Deliberately not a
  // `new URL()`: a DSN password may hold characters that make one throw, and
  // this must never be the thing that fails a setup.
  const path = trimmed.split('?')[0] ?? '';
  const database = path.split('/').pop() ?? '';
  return database.trim() === '' ? (engine === 'mysql' ? 'MySQL' : 'PostgreSQL') : database.trim();
}

/** `blank` means generate nothing, so it is not an intent to record. */
function intentOf(held: HeldAnswers): GenerateIntent | null {
  return held.start === 'blank' ? null : held.start;
}

export async function submitHeldAnswers(
  input: {
    account: AccountValues;
    consent: SetupConsent;
    held: HeldAnswers;
    /**
     * The account is already there — this is the RETRY after a
     * `connection-failed`, where the DSN was fixed and the account never was
     * the problem. Creating it again would 409 against the instance's own new
     * admin and strand the person inside the wizard, which is the shape the
     * recovery path exists to avoid.
     */
    accountExists?: boolean | undefined;
  },
  deps: SubmitDeps = REAL_DEPS,
): Promise<SubmitOutcome> {
  if (input.accountExists !== true) {
    try {
      await deps.createSuperAdmin({
        email: input.account.email.trim(),
        password: input.account.password,
        name: input.account.name.trim(),
        consent: input.consent,
      });
    } catch (cause) {
      return { kind: 'account-failed', cause };
    }
  }

  const dsn = input.held.dsn.trim();
  if (dsn === '') return { kind: 'ok', connection: null };

  // The DSN's own scheme, falling back to the picked card for a string that
  // parses as nothing (`sqlite:` paths with no scheme, say). The step keeps the
  // two in sync as you type; this is the value that actually creates the
  // connection, so it re-reads the string rather than trusting the sync.
  const engine = (engineForDsn(dsn, ONBOARDING_ENGINES) ?? input.held.engine) as ConnectionEngine;
  try {
    const probe = await deps.testDsn(engine, dsn);
    if (!probe.ok) {
      return { kind: 'connection-failed', cause: probe.error };
    }

    const intent = intentOf(input.held);
    const created = await deps.createConnection({
      name: connectionNameFromDsn(dsn, engine),
      engine,
      dsn,
      ...(intent === null ? {} : { settings: { intent } }),
    });

    let tableCount: number | null = null;
    const introspection = await deps.introspect(created.id);
    if (introspection.kind === 'done') {
      const schema = await deps.getSchema(created.id);
      tableCount = schema.model.tables.length;
    }

    return {
      kind: 'ok',
      connection: {
        connectionId: created.id,
        engine,
        tableCount,
        serverVersion: probe.serverVersion,
        latencyMs: probe.latencyMs,
        readOnly: created.readOnly,
        privileges: probe.privileges,
      },
    };
  } catch (cause) {
    return { kind: 'connection-failed', cause };
  }
}
