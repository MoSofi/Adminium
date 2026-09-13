// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 4 — where Adminium keeps its own data (45-onboarding.md §2, R2).
 *
 * THE QUESTION THE OWNER RAN INTO. A fresh `npx` install creates an embedded
 * SQLite store and never asks; the choice existed only as step 5 of the Studio's
 * connect wizard, behind a source connection (45 §0.3). This is that question,
 * asked where it is asked — with the local file first and selected, so the
 * lowest-friction path is still one Continue.
 *
 * WHAT EACH ANSWER DOES. `local` writes nothing: the store the server booted on
 * stays where it is. The other two are carried out on Continue by the container
 * through `POST /api/v1/meta/relocate`, which copies the store and restarts the
 * server onto it (`server/src/meta/relocate.ts`).
 *
 * `same-db` is offered only when there is a live source that can host the
 * `adminium_*` tables — the rule is `sameDbDisabledCode`, shared with the
 * Studio so the two front doors cannot disagree about the same database, and
 * re-checked by the server (409 META_PLACEMENT_INVALID).
 */
import { Database, DatabaseZap, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, FormField, Input, RadioCard, RadioGroup } from '@adminium/ui';
import { dsnValidationCode } from '@adminium/widgets';

import { t } from '../../../i18n/t.js';
import { studioApi, type ConnectionEngine, type MetaStoreLocation } from '../../../studio/api.js';
import { sameDbDisabledCode } from '../../../studio/connect/metaPlacementRule.js';
import { ONBOARDING_ENGINES } from '../heldAnswers.js';
import type { ExistingStore } from '../heldAnswers.js';
import type { LandedConnection } from '../submitHeldAnswers.js';

export type StorageChoice = 'local' | 'same-db' | 'separate';

/** Non-null ⇒ `same-db` cannot be offered, and this says why. */
export function sameDbBlockedReason(
  connection: LandedConnection | null,
  existing: ExistingStore | null = null,
  park = false,
): string | null {
  // What the connect step found in there, and what the operator decided about
  // it (45-T11). Unparked, the relocation would refuse — so the card says so
  // here rather than failing two screens later, which is how this was found.
  if (existing !== null && existing.occupied.length > 0 && !park) {
    return t(
      'onboarding:meta.sameDb.alreadyAdminium',
      'That database already holds an Adminium instance. Go back a step to keep its tables and start beside them, or sign in to it instead.',
    );
  }
  if (connection === null) {
    return t(
      'onboarding:meta.sameDb.noSource',
      'You have not connected a database yet — connect one first, or keep Adminium’s data in a file.',
    );
  }
  switch (
    sameDbDisabledCode({
      readOnly: connection.readOnly,
      privileges: connection.privileges,
      sourceIsFile: connection.engine === 'sqlite',
    })
  ) {
    case 'file':
      return t(
        'onboarding:meta.sameDb.disabledFile',
        'A SQLite file is not a server Adminium can add its own tables to.',
      );
    case 'read-only':
      return t(
        'onboarding:meta.sameDb.disabledReadOnly',
        'That role is read-only — Adminium never writes to your database. Keep its data in a file, or give it one of its own.',
      );
    case 'no-ddl':
      return t(
        'onboarding:meta.sameDb.disabledNoDdl',
        'That role cannot run CREATE TABLE, which Adminium’s own migrations need.',
      );
    default:
      return null;
  }
}

/** `null` when the string is empty or well-formed. */
export function separateDsnError(dsn: string): string | null {
  const code = dsnValidationCode(dsn, ONBOARDING_ENGINES);
  if (code === null) return null;
  return code === 'invalid-scheme'
    ? t(
        'onboarding:meta.separate.invalidScheme',
        'Unrecognized scheme — expected postgres://, mysql:// or mariadb://',
      )
    : t(
        'onboarding:meta.separate.incomplete',
        'Add the host and database, e.g. postgres://user@host:5432/adminium',
      );
}

export interface StorageStepProps {
  value: StorageChoice;
  onChange: (value: StorageChoice) => void;
  separateDsn: string;
  onSeparateDsnChange: (dsn: string) => void;
  /** `true` once the separate DSN has been probed and accepted. */
  separateTested: boolean;
  onSeparateTested: (tested: boolean) => void;
  /** Where the store lives now; `null` while it loads. */
  placement: MetaStoreLocation | null;
  connection: LandedConnection | null;
  /** What the connect step's probe found in that database, and what was decided. */
  existing: ExistingStore | null;
  park: boolean;
  /** Non-null while Continue is carrying the choice out. */
  relocating: 'copying' | 'restarting' | null;
}

export function StorageStep({
  value,
  onChange,
  separateDsn,
  onSeparateDsnChange,
  separateTested,
  onSeparateTested,
  placement,
  connection,
  existing,
  park,
  relocating,
}: StorageStepProps) {
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // An instance whose store is pinned by ADMINIUM_META_URL or an existing
  // bootstrap file has nothing to choose — and saying so beats offering three
  // cards that would all be refused.
  if (placement !== null && (!placement.embedded || !placement.canRelocate)) {
    return (
      <Alert
        tone="info"
        title={t(
          'onboarding:meta.pinned.title',
          'Adminium’s data already has a home',
        )}
        body={t(
          'onboarding:meta.pinned.body',
          'This instance was started with its meta store configured, so there is nothing to move. You can change it later from Studio settings.',
        )}
      />
    );
  }

  const blocked = sameDbBlockedReason(connection, existing, park);
  const dsnError = separateDsnError(separateDsn);

  function testSeparate(): void {
    const dsn = separateDsn.trim();
    if (dsn === '' || dsnError !== null) return;
    setTesting(true);
    setTestError(null);
    // Only two engines can host the meta store, and the scheme names which.
    const engine: ConnectionEngine =
      dsn.startsWith('mysql') || dsn.startsWith('mariadb') ? 'mysql' : 'postgres';
    void studioApi
      .testDsn(engine, dsn)
      .then((probe) => {
        if (!probe.ok) {
          onSeparateTested(false);
          setTestError(
            probe.error?.message ??
              t('onboarding:meta.separate.failed', 'That database did not answer.'),
          );
          return;
        }
        if (probe.privileges !== null && !probe.privileges.canDDL) {
          onSeparateTested(false);
          setTestError(
            t(
              'onboarding:meta.separate.insufficient',
              'That role cannot run CREATE TABLE — Adminium’s own migrations need it.',
            ),
          );
          return;
        }
        onSeparateTested(true);
      })
      .catch((cause: unknown) => {
        onSeparateTested(false);
        setTestError(
          cause instanceof Error
            ? cause.message
            : t('onboarding:meta.separate.failed', 'That database did not answer.'),
        );
      })
      .finally(() => setTesting(false));
  }

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        aria-label={t('onboarding:meta.title', 'Where Adminium keeps its own data')}
        value={value}
        onValueChange={(next) => onChange(next as StorageChoice)}
        className="flex flex-col gap-3"
      >
        <RadioCard
          layout="tile"
          hideIndicator
          value="local"
          icon={<HardDrive />}
          title={t('onboarding:meta.local.title', 'In a file on this machine')}
          description={t(
            'onboarding:meta.local.body',
            'Nothing to set up. Right for trying Adminium out, or for a single instance.',
          )}
        />
        <RadioCard
          layout="tile"
          hideIndicator
          value="same-db"
          icon={<Database />}
          disabled={blocked !== null}
          title={t('onboarding:meta.sameDb.title', 'In the database you just connected')}
          description={
            blocked ??
            (park
              ? t(
                  'onboarding:meta.sameDb.parked',
                  'The Adminium tables already in there are renamed out of the way first — every row survives — and Adminium starts with fresh ones beside them.',
                )
              : t(
                  'onboarding:meta.sameDb.body',
                  'Adminium adds its own `adminium_` tables beside yours. One database to back up.',
                ))
          }
        />
        <RadioCard
          layout="tile"
          hideIndicator
          value="separate"
          icon={<DatabaseZap />}
          title={t('onboarding:meta.separate.title', 'In a database of its own')}
          description={t(
            'onboarding:meta.separate.body',
            'A PostgreSQL or MySQL database you provide. Right for production, or for several instances.',
          )}
        />
      </RadioGroup>

      {value === 'separate' ? (
        <div className="flex flex-col gap-2">
          <FormField
            label={t('onboarding:meta.separate.label', 'Connection string for Adminium')}
            {...(dsnError === null ? {} : { error: dsnError })}
          >
            <Input
              className="h-auto rounded-[11px] px-[13px] py-[11px] font-mono text-[12.5px]"
              autoComplete="off"
              spellCheck={false}
              value={separateDsn}
              placeholder="postgres://user@host:5432/adminium"
              onChange={(event) => {
                onSeparateTested(false);
                setTestError(null);
                onSeparateDsnChange(event.target.value);
              }}
            />
          </FormField>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-auto rounded-[11px] px-4 py-[11px] text-[13px] font-bold"
              onClick={testSeparate}
              loading={testing}
              disabled={separateDsn.trim() === '' || dsnError !== null}
            >
              {t('onboarding:meta.separate.test', 'Test this database')}
            </Button>
            {separateTested ? (
              <span className="text-body-sm text-pos">
                {t('onboarding:meta.separate.ok', 'Reachable, and it can create tables.')}
              </span>
            ) : null}
          </div>
          {testError === null ? null : <Alert tone="danger" role="alert" title={testError} />}
        </div>
      ) : null}

      {relocating === null ? null : (
        <Alert
          tone="info"
          title={
            relocating === 'copying'
              ? t('onboarding:meta.moving.copying', 'Copying Adminium’s data across…')
              : t(
                  'onboarding:meta.moving.restarting',
                  'Restarting onto the new database…',
                )
          }
        />
      )}
    </div>
  );
}
