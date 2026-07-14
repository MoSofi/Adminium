/**
 * Step 2 — source (09 §8.2 step 1): three input modes behind a
 * SegmentedControl — DSN (mono connection-string field + provider quick-fill
 * chips + live scheme validation), individual fields (composing the DSN),
 * and schema file (dropzone → POST /api/v1/schema-import/parse → preview).
 * Carries the comps' read-only-role and trust copy, wired honestly: setup
 * uses the introspect role only; writes never happen before meta placement.
 */
import { FileCode2, FormInput, Link2 } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  FormField,
  Input,
  MonoText,
  SegmentedControl,
  Select,
  Spinner,
  Tag,
} from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { studioApi, type SchemaTable } from '../../api.js';
import { Dropzone } from '../Dropzone.js';
import {
  PROVIDER_CHIPS,
  composeDsn,
  dsnValidationError,
  engineForDsn,
  type FieldsInput,
  type SourceMode,
  type SslMode,
  type WizardState,
} from '../wizardState.js';

export interface SourceStepProps {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  /** Hands the parsed schema-file tables to the wizard (memory-only). */
  onFileTablesCapture?: ((tables: SchemaTable[] | null) => void) | undefined;
}

const SSL_MODES: readonly SslMode[] = ['disable', 'require', 'verify-ca', 'verify-full'];

export function SourceStep({ state, onPatch, onFileTablesCapture }: SourceStepProps) {
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const dsnError = dsnValidationError(state.dsn);
  const engine = engineForDsn(state.dsn);

  const parseFile = (file: File) => {
    setParsing(true);
    setParseError(null);
    const lower = file.name.toLowerCase();
    const format = lower.endsWith('.sql') ? 'sql' : lower.endsWith('.json') ? 'json' : undefined;
    void file
      .text()
      .then((content) =>
        studioApi.parseSchemaFile({ content, fileName: file.name, ...(format === undefined ? {} : { format }) }),
      )
      .then((preview) => {
        const model = preview.model as { tables?: SchemaTable[] } | null;
        onFileTablesCapture?.(Array.isArray(model?.tables) ? model.tables : null);
        onPatch({
          filePreview: {
            fileName: file.name,
            format: preview.format,
            tables: preview.summary.tables,
            columns: preview.summary.columns,
            warnings: preview.warnings,
          },
          ...(state.name.trim().length === 0 ? { name: file.name.replace(/\.[^.]+$/, '') } : {}),
        });
      })
      .catch((cause: unknown) => {
        onFileTablesCapture?.(null);
        onPatch({ filePreview: null });
        if (cause instanceof ApiError && cause.status === 422) {
          const details = cause.details as { reason?: string } | undefined;
          setParseError(
            details?.reason === 'UNSUPPORTED_FORMAT'
              ? t(
                  'studio.source.file.unsupported',
                  "That format isn't supported yet — .sql and .json work today. Prisma, Drizzle, TypeORM, Rails and Django parsers land in M9.",
                )
              : t('studio.source.file.parseFailed', 'We could not parse that file. Check it contains CREATE TABLE statements or an Adminium JSON schema.'),
          );
        } else {
          setParseError(t('studio.source.file.requestFailed', 'Upload failed — check your connection and try again.'));
        }
      })
      .finally(() => setParsing(false));
  };

  return (
    <section aria-label={t('studio.source.title', 'Connect your database')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio.source.title', 'Connect your database')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio.source.subtitle', "Point Adminium at a database and we'll generate an admin dashboard from its schema.")}
        </p>
      </div>

      <FormField label={t('studio.source.name', 'Connection name')} required>
        <Input
          value={state.name}
          onChange={(event) => onPatch({ name: event.currentTarget.value })}
          placeholder={t('studio.source.namePlaceholder', 'Production Postgres')}
        />
      </FormField>

      <SegmentedControl
        aria-label={t('studio.source.mode', 'Source input mode')}
        value={state.mode}
        onValueChange={(mode) => onPatch({ mode: mode as SourceMode })}
        options={[
          { value: 'dsn', label: t('studio.source.mode.dsn', 'Connection string'), icon: <Link2 /> },
          { value: 'fields', label: t('studio.source.mode.fields', 'Individual fields'), icon: <FormInput /> },
          { value: 'file', label: t('studio.source.mode.file', 'Schema file'), icon: <FileCode2 /> },
        ]}
      />

      {state.mode === 'dsn' ? (
        <div className="flex flex-col gap-3">
          <FormField
            label={t('studio.source.dsn.label', 'Connection string')}
            required
            {...(dsnError === null ? {} : { error: dsnError })}
            {...(engine === null ? {} : { tag: <Tag>{engine}</Tag> })}
            helper={
              dsnError === null
                ? t('studio.source.dsn.helper', 'postgres://user:password@host:5432/database — mysql:// and sqlite: work too.')
                : undefined
            }
          >
            <Input
              mono
              value={state.dsn}
              onChange={(event) => onPatch({ dsn: event.currentTarget.value })}
              placeholder="postgres://user:password@host:5432/database"
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-fg-subtle">{t('studio.source.dsn.quickFill', 'Quick fill:')}</span>
            {PROVIDER_CHIPS.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => onPatch({ dsn: chip.dsn })}
                className={
                  'rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-caption font-semibold text-fg-muted ' +
                  'transition-colors duration-150 hover:border-fg-subtle hover:text-fg ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                }
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.mode === 'fields' ? (
        <FieldsForm fields={state.fields} onChange={(fields) => onPatch({ fields })} />
      ) : null}

      {state.mode === 'file' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio.source.file.pitch',
              'No database connection required — we parse your CREATE TABLE statements and build the same dashboards.',
            )}
          </p>
          <Dropzone accept=".sql,.json" onFile={parseFile} disabled={parsing} />
          {parsing ? (
            <div className="flex items-center gap-2 text-body-sm text-fg-muted">
              <Spinner size="sm" />
              {t('studio.source.file.parsing', 'Reading uploaded schema file…')}
            </div>
          ) : null}
          {parseError !== null ? (
            <Alert tone="danger" role="alert" title={t('studio.source.file.errorTitle', 'Could not parse the file')} body={parseError} />
          ) : null}
          {state.filePreview !== null ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="flex items-center gap-2">
                <MonoText className="text-body-sm text-fg">{state.filePreview.fileName}</MonoText>
                <Tag>{state.filePreview.format}</Tag>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="accent">
                  {t('studio.source.file.tables', 'tables')} <MonoText>{state.filePreview.tables}</MonoText>
                </Badge>
                <Badge tone="neutral">
                  {t('studio.source.file.columns', 'columns')} <MonoText>{state.filePreview.columns}</MonoText>
                </Badge>
                {state.filePreview.warnings.length > 0 ? (
                  <Badge tone="warn">
                    {t('studio.source.file.warnings', 'warnings')} <MonoText>{state.filePreview.warnings.length}</MonoText>
                  </Badge>
                ) : null}
              </div>
              {state.filePreview.warnings.slice(0, 3).map((warning) => (
                <p key={warning} className="text-caption text-fg-muted">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.mode !== 'file' ? (
        <Alert
          tone="info"
          title={t('studio.source.readOnlyRole.title', 'Use a read-only role')}
          body={t(
            'studio.source.readOnlyRole.body',
            'Adminium never writes to your database — setup uses schema metadata only. We recommend a dedicated user with SELECT-only grants; you can decide where Adminium keeps its own tables in the meta-storage step.',
          )}
        />
      ) : null}
    </section>
  );
}

function FieldsForm({ fields, onChange }: { fields: FieldsInput; onChange: (fields: FieldsInput) => void }) {
  const patch = (partial: Partial<FieldsInput>) => onChange({ ...fields, ...partial });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <FormField label={t('studio.source.fields.host', 'Host')} required>
          <Input
            mono
            value={fields.host}
            onChange={(event) => patch({ host: event.currentTarget.value })}
            placeholder="db.acme.internal"
            autoComplete="off"
          />
        </FormField>
        <FormField label={t('studio.source.fields.port', 'Port')}>
          <Input
            mono
            inputMode="numeric"
            value={fields.port}
            onChange={(event) => patch({ port: event.currentTarget.value.replace(/[^\d]/g, '') })}
          />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('studio.source.fields.database', 'Database')} required>
          <Input mono value={fields.database} onChange={(event) => patch({ database: event.currentTarget.value })} />
        </FormField>
        <FormField label={t('studio.source.fields.ssl', 'SSL mode')}>
          <Select value={fields.ssl} onChange={(event) => patch({ ssl: event.currentTarget.value as SslMode })}>
            {SSL_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('studio.source.fields.user', 'User')} required>
          <Input mono value={fields.user} onChange={(event) => patch({ user: event.currentTarget.value })} autoComplete="off" />
        </FormField>
        <FormField label={t('studio.source.fields.password', 'Password')}>
          <Input
            type="password"
            value={fields.password}
            onChange={(event) => patch({ password: event.currentTarget.value })}
            autoComplete="new-password"
          />
        </FormField>
      </div>
      <p className="text-caption text-fg-muted">
        {t('studio.source.fields.preview', 'Connection string preview:')}{' '}
        <MonoText>{composeDsn({ ...fields, password: fields.password.length > 0 ? '•••' : '' })}</MonoText>
      </p>
    </div>
  );
}
