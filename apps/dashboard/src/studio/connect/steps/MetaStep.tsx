// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 5 — meta-storage placement (M5-T03, 01-architecture.md §3.1):
 * same-DB (`adminium_*` tables beside your source tables) vs separate-DB
 * (second DSN + probe requiring canWrite ∧ canDDL). A read-only or DDL-less
 * source disables the same-DB card with the META_PLACEMENT_INVALID
 * explanation — and the server manager independently enforces the same rule
 * (409 on bypass, connections/manager.ts).
 *
 * ── THIS STEP MOVES THE STORE ───────────────────────────────────────────────
 * It did not always. For as long as the Studio has had a meta step, the meta
 * store was chosen at first boot and never moved: this step validated that a
 * placement was POSSIBLE, recorded the answer in wizard state, and dropped it.
 * Picking "same database" in the browser therefore left the embedded SQLite
 * store exactly where it was, while the TERMINAL wizard — which asks before any
 * store exists — honoured the identical question. Two front doors, two answers,
 * and the browser one silently wrong.
 *
 * What made it fixable is that the copy has somewhere to go: `POST
 * /api/v1/meta/relocate` copies the whole store and the server restarts onto
 * it (`server/src/meta/relocate.ts`). So the choice is now carried out on
 * Continue — but only when there is something to move, which is what
 * `placement` answers. On an instance already using a configured meta store,
 * or one whose store is pinned by ADMINIUM_META_URL, this step goes back to
 * being exactly what it was: a compatibility check, now saying so accurately
 * instead of claiming relocation is an unimplemented ops task.
 */
import { Database, DatabaseZap } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, FormField, Input, RadioGroup, RadioCard } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { studioApi, type MetaStoreLocation } from '../../api.js';
import {
  dsnValidationError,
  engineForDsn,
  sameDbDisabledReason,
  type MetaPlacement,
  type WizardState,
} from '../wizardState.js';

export interface MetaStepProps {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  /** Where the store lives now; null while loading, or when the route is absent. */
  placement: MetaStoreLocation | null;
  /** Non-null while Continue is carrying the choice out. */
  relocating: 'copying' | 'restarting' | null;
}

export function MetaStep({ state, onPatch, placement, relocating }: MetaStepProps) {
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const disabledReason = sameDbDisabledReason({
    readOnly: state.readOnly,
    privileges: state.privileges,
    sourceIsFile: state.mode === 'file',
  });
  const separateDsnError = dsnValidationError(state.separateMetaDsn);

  const testSeparate = () => {
    setTesting(true);
    setTestError(null);
    const engine = engineForDsn(state.separateMetaDsn) ?? 'postgres';
    void studioApi
      .testDsn(engine, state.separateMetaDsn.trim())
      .then((probe) => {
        if (!probe.ok) {
          setTestError(probe.error?.message ?? t('studio:meta.testFailed', 'Connection failed.'));
          onPatch({ separateMetaTested: false });
          return;
        }
        if (probe.privileges !== null && (!probe.privileges.canWrite || !probe.privileges.canDDL)) {
          setTestError(
            t(
              'studio:meta.separate.insufficient',
              'This role cannot host the meta store — Adminium needs write and CREATE TABLE privileges there.',
            ),
          );
          onPatch({ separateMetaTested: false });
          return;
        }
        onPatch({ separateMetaTested: true });
      })
      .catch(() => {
        setTestError(t('studio:meta.testFailed', 'Connection failed.'));
        onPatch({ separateMetaTested: false });
      })
      .finally(() => setTesting(false));
  };

  return (
    <section aria-label={t('studio:meta.title', 'Where should Adminium keep its own tables?')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">
          {t('studio:meta.title', 'Where should Adminium keep its own tables?')}
        </h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t(
            'studio:meta.subtitle',
            'Pages, roles, audit log and settings live in adminium_-prefixed tables — never mixed into your data.',
          )}
        </p>
      </div>

      <RadioGroup
        aria-label={t('studio:meta.title', 'Where should Adminium keep its own tables?')}
        value={state.metaPlacement ?? ''}
        onValueChange={(value) => onPatch({ metaPlacement: value as MetaPlacement })}
        className="grid gap-2.5"
      >
        <RadioCard
          value="same-db"
          disabled={disabledReason !== null}
          title={t('studio:meta.sameDb.title', 'Same database')}
          description={
            disabledReason ??
            t(
              'studio:meta.sameDb.description',
              'adminium_* tables are created beside your source tables. Simplest setup — needs a role with write and CREATE TABLE privileges.',
            )
          }
          icon={<Database />}
        />
        <RadioCard
          value="separate-db"
          title={t('studio:meta.separate.title', 'Separate database')}
          description={t(
            'studio:meta.separate.description',
            'Adminium keeps its tables in a different database. Your source stays untouched — required for read-only sources.',
          )}
          icon={<DatabaseZap />}
        />
      </RadioGroup>

      {state.metaPlacement === 'separate-db' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3.5">
          <FormField
            label={t('studio:meta.separate.dsn', 'Meta database connection string')}
            required
            {...(separateDsnError === null ? {} : { error: separateDsnError })}
            helper={
              separateDsnError === null
                ? t('studio:meta.separate.helper', 'Needs write + DDL privileges — Adminium runs its own migrations there.')
                : undefined
            }
          >
            <Input
              mono
              value={state.separateMetaDsn}
              onChange={(event) => onPatch({ separateMetaDsn: event.currentTarget.value, separateMetaTested: false })}
              placeholder="postgres://adminium:password@host:5432/adminium_meta"
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              disabled={state.separateMetaDsn.trim().length === 0 || separateDsnError !== null}
              onClick={testSeparate}
            >
              {t('studio:meta.separate.test', 'Test connection')}
            </Button>
            {state.separateMetaTested ? (
              <span className="text-body-sm font-semibold text-pos">
                {t('studio:meta.separate.ok', 'Compatible — write ✓ · DDL ✓')}
              </span>
            ) : null}
          </div>
          {testError !== null ? (
            <Alert tone="danger" role="alert" title={t('studio:meta.separate.errorTitle', 'Meta store not compatible')} body={testError} />
          ) : null}
        </div>
      ) : null}

      {/*
        Three different true statements, because three different things are
        actually the case. The old single note asserted the most pessimistic one
        unconditionally ("moving an existing meta store is an ops task"), which
        stopped being true the moment Continue started moving it.
      */}
      {relocating !== null ? (
        <Alert
          tone="info"
          role="status"
          title={t('studio:meta.move.title', 'Moving Adminium’s tables')}
          body={
            relocating === 'copying'
              ? t(
                  'studio:meta.move.copyingBody',
                  'Copying every adminium_ table into the new database. Your source data is not touched, and nothing is switched over until the copy is verified.',
                )
              : t(
                  'studio:meta.move.restartingBody',
                  'The copy is done. Adminium is restarting onto the new database — this page will continue by itself in a few seconds.',
                )
          }
        />
      ) : placement !== null && placement.embedded && placement.canRelocate ? (
        <Alert
          tone="info"
          title={t('studio:meta.willMove.title', 'This will move Adminium’s tables')}
          body={t(
            'studio:meta.willMove.body',
            'Adminium is currently using its built-in SQLite store. Continue copies that store into the database you picked and restarts onto it — accounts, pages and settings come with it, so you stay signed in.',
          )}
        />
      ) : (
        <Alert
          tone="info"
          title={t('studio:meta.v1Note.title', 'About this install')}
          body={
            placement?.reason ??
            t(
              'studio:meta.v1Note.body',
              'This server already keeps its own tables in a configured database, and this step does not move them. It validates that your choice is compatible with this connection — the server enforces the same rule independently (409 META_PLACEMENT_INVALID).',
            )
          }
        />
      )}
    </section>
  );
}
