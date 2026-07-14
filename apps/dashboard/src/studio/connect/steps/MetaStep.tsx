/**
 * Step 5 — meta-storage placement (M5-T03, 01-architecture.md §3.1):
 * same-DB (`adminium_*` tables beside your source tables) vs separate-DB
 * (second DSN + probe requiring canWrite ∧ canDDL). A read-only or DDL-less
 * source disables the same-DB card with the META_PLACEMENT_INVALID
 * explanation — and the server manager independently enforces the same rule
 * (409 on bypass, connections/manager.ts).
 *
 * v1 honesty: the meta store itself was chosen at first boot (01 §3.1) and
 * is never moved by this wizard — this step VALIDATES placement
 * compatibility for the new connection and records the choice; relocating
 * the meta store is an M10 ops task.
 */
import { Database, DatabaseZap } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, FormField, Input, RadioGroup, RadioCard } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { studioApi } from '../../api.js';
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
}

export function MetaStep({ state, onPatch }: MetaStepProps) {
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
          setTestError(probe.error?.message ?? t('studio.meta.testFailed', 'Connection failed.'));
          onPatch({ separateMetaTested: false });
          return;
        }
        if (probe.privileges !== null && (!probe.privileges.canWrite || !probe.privileges.canDDL)) {
          setTestError(
            t(
              'studio.meta.separate.insufficient',
              'This role cannot host the meta store — Adminium needs write and CREATE TABLE privileges there.',
            ),
          );
          onPatch({ separateMetaTested: false });
          return;
        }
        onPatch({ separateMetaTested: true });
      })
      .catch(() => {
        setTestError(t('studio.meta.testFailed', 'Connection failed.'));
        onPatch({ separateMetaTested: false });
      })
      .finally(() => setTesting(false));
  };

  return (
    <section aria-label={t('studio.meta.title', 'Where should Adminium keep its own tables?')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">
          {t('studio.meta.title', 'Where should Adminium keep its own tables?')}
        </h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t(
            'studio.meta.subtitle',
            'Pages, roles, audit log and settings live in adminium_-prefixed tables — never mixed into your data.',
          )}
        </p>
      </div>

      <RadioGroup
        aria-label={t('studio.meta.title', 'Where should Adminium keep its own tables?')}
        value={state.metaPlacement ?? ''}
        onValueChange={(value) => onPatch({ metaPlacement: value as MetaPlacement })}
        className="grid gap-2.5"
      >
        <RadioCard
          value="same-db"
          disabled={disabledReason !== null}
          title={t('studio.meta.sameDb.title', 'Same database')}
          description={
            disabledReason ??
            t(
              'studio.meta.sameDb.description',
              'adminium_* tables are created beside your source tables. Simplest setup — needs a role with write and CREATE TABLE privileges.',
            )
          }
          icon={<Database />}
        />
        <RadioCard
          value="separate-db"
          title={t('studio.meta.separate.title', 'Separate database')}
          description={t(
            'studio.meta.separate.description',
            'Adminium keeps its tables in a different database. Your source stays untouched — required for read-only sources.',
          )}
          icon={<DatabaseZap />}
        />
      </RadioGroup>

      {state.metaPlacement === 'separate-db' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3.5">
          <FormField
            label={t('studio.meta.separate.dsn', 'Meta database connection string')}
            required
            {...(separateDsnError === null ? {} : { error: separateDsnError })}
            helper={
              separateDsnError === null
                ? t('studio.meta.separate.helper', 'Needs write + DDL privileges — Adminium runs its own migrations there.')
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
              {t('studio.meta.separate.test', 'Test connection')}
            </Button>
            {state.separateMetaTested ? (
              <span className="text-body-sm font-semibold text-pos">
                {t('studio.meta.separate.ok', 'Compatible — write ✓ · DDL ✓')}
              </span>
            ) : null}
          </div>
          {testError !== null ? (
            <Alert tone="danger" role="alert" title={t('studio.meta.separate.errorTitle', 'Meta store not compatible')} body={testError} />
          ) : null}
        </div>
      ) : null}

      <Alert
        tone="info"
        title={t('studio.meta.v1Note.title', 'About this install')}
        body={t(
          'studio.meta.v1Note.body',
          'This server chose its meta store at first boot. This step validates that your choice is compatible with this connection and records it — the server enforces the same rule independently (409 META_PLACEMENT_INVALID). Moving an existing meta store is an ops task (M10).',
        )}
      />
    </section>
  );
}
