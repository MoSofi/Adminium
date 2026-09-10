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
 * THE BRIDGE IS ITS OWN STATE. When adminium.dev has handed this instance a
 * connection string, `GET /bridge/seed/:ticket` needs `connections:manage`
 * (`server/src/routes/bridge/index.ts:217`) and cannot be redeemed before the
 * account exists either. Redeeming it silently AFTER the account step would
 * also break the property the bridge's safety argument rests on — the wizard
 * shows you the value and you press Continue. So this step says a string is
 * waiting and the wizard hands off to the Studio's connect wizard at the end,
 * which is exactly what `FirstRunWizard` does today (45 DEP-17).
 */
import { Database, FileCode2, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Alert,
  FormField,
  Input,
  RadioCard,
  RadioGroup,
} from '@adminium/ui';
import {
  dsnPlaceholder,
  dsnValidationCode,
  dsnWithEngine,
  engineForDsn,
  type DsnEngine,
} from '@adminium/widgets';

import { t } from '../../../i18n/t.js';
import { hasPendingBridgeTicket } from '../../../studio/connect/bridgeSeed.js';
import { ONBOARDING_ENGINES } from '../heldAnswers.js';

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
  /** Test seam; defaults to the real per-tab ticket check. */
  bridgePending?: boolean | undefined;
}

export function ConnectStep({ engine, dsn, onChange, bridgePending }: ConnectStepProps) {
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
        className="grid gap-2.5 sm:grid-cols-3"
      >
        {ONBOARDING_ENGINES.map((option) => (
          <RadioCard
            key={option}
            value={option}
            title={engineLabel(option)}
            icon={engineIcon(option)}
          />
        ))}
      </RadioGroup>

      <FormField
        label={t('onboarding:connect.dsn.label', 'Connection string')}
        {...(error === null
          ? {
              helper: t(
                'onboarding:connect.dsn.helper',
                'Nothing leaves this browser until your account exists — then we test it.',
              ),
            }
          : { error })}
      >
        <Input
          className="font-mono"
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
