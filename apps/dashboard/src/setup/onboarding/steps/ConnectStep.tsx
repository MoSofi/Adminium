// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 2 — connect your database (45-onboarding.md §2, comp step "Connect your
 * database").
 *
 * WHAT THIS STEP DOES NOT DO: connect. There is no account yet, so there is no
 * session, so there is no endpoint that would take a connection string (45 R1).
 * The DSN is shape-checked here — scheme, host, database, by the SAME grammar
 * the Studio and the `connection-string-field` widget use (`@adminium/widgets`,
 * never a second copy) — and proven at the step-3 transition, the moment
 * `POST /setup/super-admin` mints a session (45 DEP-7). The comp's green
 * "Connected · 14 tables detected" line belongs to that moment and is rendered
 * there, not faked here.
 *
 * IT ALSO ASKS WHAT IS ALREADY IN THERE (45-T11). Point a second install at a
 * database that already runs an Adminium and, until this step asked, nothing
 * noticed until the storage step — after an account had been created — where
 * the relocation refused. `POST /setup/probe` answers it here, from a route
 * that is open only while setup is, and the two ways out are offered on the
 * spot: sign in to the instance that is already there, or keep its tables and
 * start beside them.
 *
 * THE BRIDGE IS ITS OWN STATE. When adminium.dev has handed this instance a
 * connection string, `GET /bridge/seed/:ticket` needs `connections:manage`
 * (`server/src/routes/bridge/index.ts:217`) and cannot be redeemed before the
 * account exists either. Redeeming it silently AFTER the account step would
 * also break the property the bridge's safety argument rests on — the wizard
 * shows you the value and you press Continue. So this step says a string is
 * waiting and the wizard hands off to the Studio's connect wizard at the end,
 * which is exactly what `FirstRunWizard` does today (45 DEP-17).
 */
import { Database, DatabaseZap, FileCode2, Link2, LogIn, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, FormField, InputGroup, RadioCard, RadioGroup, Spinner } from '@adminium/ui';
import {
  dsnPlaceholder,
  dsnValidationCode,
  dsnWithEngine,
  engineForDsn,
  type DsnEngine,
} from '@adminium/widgets';

import { t } from '../../../i18n/t.js';
import { hasPendingBridgeTicket } from '../../../studio/connect/bridgeSeed.js';
import { ONBOARDING_ENGINES, type ExistingStore } from '../heldAnswers.js';

/** `null` when the string is empty or well-formed; translated copy otherwise. */
export function connectDsnError(dsn: string): string | null {
  const code = dsnValidationCode(dsn, ONBOARDING_ENGINES);
  if (code === null) return null;
  return code === 'invalid-scheme'
    ? t(
        'onboarding:connect.dsn.invalidScheme',
        'Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:',
      )
    : t(
        'onboarding:connect.dsn.incomplete',
        'Add the host and database, e.g. postgres://user@host:5432/db',
      );
}

function engineLabel(engine: DsnEngine): string {
  switch (engine) {
    case 'mysql':
      return t('onboarding:connect.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('onboarding:connect.engine.sqlite', 'SQLite');
    default:
      return t('onboarding:connect.engine.postgres', 'PostgreSQL');
  }
}

function engineIcon(engine: DsnEngine): ReactNode {
  switch (engine) {
    case 'mysql':
      return <Server />;
    case 'sqlite':
      return <FileCode2 />;
    default:
      return <Database />;
  }
}

export interface ConnectStepProps {
  engine: DsnEngine;
  dsn: string;
  onChange: (patch: { engine?: DsnEngine; dsn?: string }) => void;
  /** What the probe found in this DSN's database; `null` until it has answered. */
  existing: ExistingStore | null;
  /** The check is still running for what is in the field — Continue is waiting on it. */
  probing: boolean;
  /** The operator chose to keep those tables and start beside them. */
  park: boolean;
  onPark: () => void;
  /** Adopt the store that is already there and go and sign in.  */
  onAdopt: () => void;
  /** Non-null while the adoption is being carried out. */
  adopting: 'writing' | 'restarting' | null;
  /** Test seam; defaults to the real per-tab ticket check. */
  bridgePending?: boolean | undefined;
}

export function ConnectStep({
  engine,
  dsn,
  onChange,
  existing,
  probing,
  park,
  onPark,
  onAdopt,
  adopting,
  bridgePending,
}: ConnectStepProps) {
  const bridge = bridgePending ?? hasPendingBridgeTicket();
  if (bridge) {
    return (
      <Alert
        tone="info"
        title={t(
          'onboarding:connect.bridge.title',
          'A connection string is waiting for this instance',
        )}
        body={t(
          'onboarding:connect.bridge.body',
          'It was handed over from adminium.dev. Create your account and we will open it in the connect wizard, where you can read it before anything uses it.',
        )}
      />
    );
  }

  const error = connectDsnError(dsn);

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        aria-label={t('onboarding:connect.engineLabel', 'Database engine')}
        value={engine}
        onValueChange={(next) => {
          const picked = next as DsnEngine;
          // Rewriting the scheme in the SAME change is what keeps the card and
          // the string from disagreeing. `dsnWithEngine` clears the field where
          // no rewrite is meaningful — a SQLite path is not a URL, and neither
          // is whatever half-typed thing preceded it.
          onChange({ engine: picked, dsn: dsnWithEngine(dsn, picked, ONBOARDING_ENGINES) });
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        {ONBOARDING_ENGINES.map((option) => (
          <RadioCard
            key={option}
            layout="stack"
            hideIndicator
            value={option}
            title={engineLabel(option)}
            icon={engineIcon(option)}
          />
        ))}
      </RadioGroup>

      {existing === null || existing.occupied.length === 0 ? null : (
        <ExistingStorePanel
          existing={existing}
          park={park}
          onPark={onPark}
          onAdopt={onAdopt}
          adopting={adopting}
        />
      )}

      <FormField
        label={t('onboarding:connect.dsn.label', 'Connection string')}
        {...(error !== null
          ? { error }
          : {
              // Said while the check runs, so a person who out-types the probe
              // can see WHY Continue is waiting rather than finding it dead.
              helper: probing ? (
                <span className="flex items-center gap-1.5">
                  <Spinner size="sm" />
                  {t('onboarding:connect.dsn.checking', 'Checking that database…')}
                </span>
              ) : (
                t(
                  'onboarding:connect.dsn.helper',
                  'Nothing leaves this browser until your account exists — then we test it.',
                )
              ),
            })}
      >
        <InputGroup
          // The comp's field (70): a link glyph, 11px/13px padding, an 11px
          // radius and the mono face. The inner input keeps the kit's 13px
          // where the comp sets 12.5 — half a pixel, and not reachable from
          // out here without a new prop on a shared primitive.
          className="h-auto gap-[9px] rounded-[11px] px-[13px] py-[11px] font-mono [&_svg]:size-4"
          iconLeading={<Link2 />}
          autoComplete="off"
          spellCheck={false}
          value={dsn}
          placeholder={dsnPlaceholder(engine)}
          onChange={(event) => {
            const next = event.target.value;
            // THE STRING WINS. The card is a shortcut for typing a scheme, not a
            // second opinion about one: a `sqlite:` path pasted while the card
            // says PostgreSQL is a SQLite connection, and submitting it as
            // postgres is how the e2e first-run walk met
            // `database "…/adminium-e2e-source-sqlite-4610.db" does not exist`.
            // The Studio's source step resolves it the same way round
            // (`pickerEngine = inferredEngine ?? state.engine`).
            const inferred = engineForDsn(next, ONBOARDING_ENGINES);
            onChange(inferred === null ? { dsn: next } : { dsn: next, engine: inferred });
          }}
        />
      </FormField>
    </div>
  );
}

/**
 * What to do about a database that already runs an Adminium.
 *
 * Deliberately NOT a refusal: both ways out are real, and which one is right
 * depends on something only the operator knows — whether the instance already
 * in there is theirs to sign into, or something they want to keep beside.
 */
function ExistingStorePanel({
  existing,
  park,
  onPark,
  onAdopt,
  adopting,
}: {
  existing: ExistingStore;
  park: boolean;
  onPark: () => void;
  onAdopt: () => void;
  adopting: 'writing' | 'restarting' | null;
}) {
  if (park) {
    return (
      <Alert
        tone="info"
        title={t('onboarding:connect.existing.parked.title', 'The tables that are there will be kept')}
        body={t(
          'onboarding:connect.existing.parked.body',
          'They are renamed out of the way — every row survives — and Adminium starts with fresh ones beside them. Nothing happens until you choose to put Adminium’s own data in this database.',
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[13px] border border-warn/40 bg-warn-soft p-[15px]">
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-bold text-fg">
          {t('onboarding:connect.existing.title', 'That database already runs an Adminium')}
        </span>
        <span className="text-[12.5px] leading-[1.5] text-fg-muted">
          {t(
            'onboarding:connect.existing.body',
            'It holds {count, plural, one {# Adminium table} other {# Adminium tables}} with data in them. Two things you can do:',
            { count: existing.occupied.length },
          )}
        </span>
        {existing.secretMatches === false ? (
          <span className="mt-1 text-[12.5px] leading-[1.5] text-warn">
            {t(
              'onboarding:connect.existing.otherSecret',
              'It was set up with a different ADMINIUM_SECRET: signing in there would work, but its saved connection strings cannot be decrypted by this instance.',
            )}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="h-auto gap-[7px] rounded-[11px] px-4 py-[11px] text-[13px] font-bold"
          onClick={onAdopt}
          loading={adopting !== null}
        >
          <LogIn aria-hidden="true" className="size-4" />
          {t('onboarding:connect.existing.adopt', 'Use it and sign in')}
        </Button>
        <Button
          variant="outline"
          className="h-auto gap-[7px] rounded-[11px] px-4 py-[11px] text-[13px] font-bold"
          onClick={onPark}
          disabled={adopting !== null}
        >
          <DatabaseZap aria-hidden="true" className="size-4" />
          {t('onboarding:connect.existing.park', 'Keep them and start fresh')}
        </Button>
      </div>

      {adopting === null ? null : (
        <span className="text-[12.5px] text-fg-muted">
          {adopting === 'writing'
            ? t('onboarding:connect.existing.adopting', 'Pointing this instance at it…')
            : t('onboarding:connect.existing.restarting', 'Restarting onto it…')}
        </span>
      )}
    </div>
  );
}
