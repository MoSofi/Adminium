// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 2 — source (09 §8.2 step 1, M9-T04): three input modes behind a
 * SegmentedControl — DSN (mono connection-string field + provider quick-fill
 * chips + live scheme validation), individual fields (composing the DSN),
 * and schema file (dropzone → POST /api/v1/schema-import/parse → preview).
 *
 * M9-T04 additions: an engine picker (postgres / mysql-mariadb / sqlite)
 * that stays in sync with the DSN scheme and swaps the fields form to a
 * file-path input for SQLite (05 §4.3 — file, not host/port); a schema-file
 * format picker over the 8 import formats with auto-detect default, showing
 * what was detected and re-parsing on override; parser warnings surfaced on
 * the preview card.
 *
 * M7 Wave 4: the DSN field itself is no longer built here — it is
 * `@adminium/widgets`' `ConnectionStringField`, the annex §10
 * `connection-string-field` widget's presentational half. This step used to own
 * a copy of the mono input, the provider quick-fill chips, the engine-aware
 * placeholder and the detected-engine tag; the widget registry needed the same
 * field, and two copies would have drifted. This step keeps what is
 * wizard-specific around it: the source-mode switch, the engine picker, the
 * fields form, and the schema-file upload path.
 */
import { FileCode2, FormInput, Link2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ConnectionStringField } from '@adminium/widgets';
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
import { studioApi, type ConnectionEngine, type SchemaTable } from '../../api.js';
import { Dropzone } from '../Dropzone.js';
import {
  FILE_FORMATS,
  SOURCE_ENGINES,
  asConnectionEngine,
  composeDsn,
  dsnErrorText,
  dsnInputPatch,
  engineForDsn,
  engineLabel,
  enginePickPatch,
  fileFormatFromImportFormat,
  fileFormatLabel,
  type FieldsInput,
  type FileFormatChoice,
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

/** Everything the 8 parsers read (05 §5.2) — plus .txt for pasted dumps. */
const FILE_ACCEPT = '.sql,.prisma,.ts,.js,.mjs,.cjs,.rb,.py,.json,.txt';

export function SourceStep({ state, onPatch, onFileTablesCapture }: SourceStepProps) {
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  /** Last uploaded file, kept in memory so a format override can re-parse. */
  const lastFileRef = useRef<{ name: string; content: string } | null>(null);

  const inferredEngine = engineForDsn(state.dsn);
  const pickerEngine: ConnectionEngine = state.mode === 'dsn' ? (inferredEngine ?? state.engine) : state.engine;

  const parseContent = (name: string, content: string, format: FileFormatChoice) => {
    setParsing(true);
    setParseError(null);
    void studioApi
      .parseSchemaFile({ content, fileName: name, ...(format === 'auto' ? {} : { format }) })
      .then((preview) => {
        const model = preview.model as { tables?: SchemaTable[] } | null;
        onFileTablesCapture?.(Array.isArray(model?.tables) ? model.tables : null);
        onPatch({
          filePreview: {
            fileName: name,
            format: preview.format,
            detected: format === 'auto',
            tables: preview.summary.tables,
            columns: preview.summary.columns,
            warnings: preview.warnings,
          },
          ...(state.name.trim().length === 0 ? { name: name.replace(/\.[^.]+$/, '') } : {}),
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
                  'That format is not recognized — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django models and Adminium JSON are supported. Pick one explicitly and retry.',
                )
              : t(
                  'studio.source.file.parseFailed',
                  'We could not parse that file. If auto-detect guessed wrong, pick the format explicitly and retry.',
                ),
          );
        } else {
          setParseError(t('studio.source.file.requestFailed', 'Upload failed — check your connection and try again.'));
        }
      })
      .finally(() => setParsing(false));
  };

  const parseFile = (file: File) => {
    void file.text().then((content) => {
      lastFileRef.current = { name: file.name, content };
      parseContent(file.name, content, state.fileFormat);
    });
  };

  const onFormatChange = (format: FileFormatChoice) => {
    onPatch({ fileFormat: format });
    const last = lastFileRef.current;
    if (last !== null) parseContent(last.name, last.content, format);
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
        // `modeLabel`, not `mode`: the bundles nest `studio.source.mode.*` for
        // the three options, so the group label needs its own leaf key
        // (i18next cannot store a string at an object node).
        aria-label={t('studio.source.modeLabel', 'Source input mode')}
        value={state.mode}
        onValueChange={(mode) => onPatch({ mode: mode as SourceMode })}
        options={[
          { value: 'dsn', label: t('studio.source.mode.dsn', 'Connection string'), icon: <Link2 /> },
          { value: 'fields', label: t('studio.source.mode.fields', 'Individual fields'), icon: <FormInput /> },
          { value: 'file', label: t('studio.source.mode.file', 'Schema file'), icon: <FileCode2 /> },
        ]}
      />

      {state.mode !== 'file' ? (
        <FormField label={t('studio.source.engine.label', 'Database engine')}>
          <SegmentedControl
            aria-label={t('studio.source.engine.label', 'Database engine')}
            value={pickerEngine}
            onValueChange={(engine) => onPatch(enginePickPatch(state, engine as ConnectionEngine))}
            options={SOURCE_ENGINES.map((engine) => ({ value: engine, label: engineLabel(engine) }))}
          />
        </FormField>
      ) : null}

      {state.mode === 'dsn' ? (
        <ConnectionStringField
          value={state.dsn}
          onValueChange={(dsn) => onPatch(dsnInputPatch(dsn, state.engine))}
          // v1 connects to Postgres/MySQL/SQLite only — `protocols` is what keeps
          // `mongodb://` reading as an unrecognised scheme here even though the
          // shared grammar can parse it.
          protocols={SOURCE_ENGINES}
          placeholderEngine={pickerEngine}
          label={t('studio.source.dsn.label', 'Connection string')}
          required
          helper={t(
            'studio.source.dsn.helper',
            'postgres://user:password@host:5432/database — mysql:// and sqlite: work too.',
          )}
          errorText={dsnErrorText()}
          quickFillLabel={t('studio.source.dsn.quickFill', 'Quick fill:')}
          // A chip carries its own engine: moving the picker in the SAME patch is
          // what stops it pointing at Postgres while the DSN now says MySQL.
          onQuickFill={(chip) => {
            const engine = asConnectionEngine(chip.engine);
            onPatch({ dsn: chip.dsn, ...(engine === null ? {} : { engine }) });
          }}
        />
      ) : null}

      {state.mode === 'fields' ? (
        state.engine === 'sqlite' ? (
          <SqliteFileForm fields={state.fields} onChange={(fields) => onPatch({ fields })} />
        ) : (
          <FieldsForm engine={state.engine} fields={state.fields} onChange={(fields) => onPatch({ fields })} />
        )
      ) : null}

      {state.mode === 'file' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio.source.file.pitch',
              'No database connection required — we parse your schema file and build the same dashboards.',
            )}
          </p>
          <FormField
            label={t('studio.source.format.label', 'Schema format')}
            helper={t('studio.source.format.helper', 'Leave on auto-detect unless the detection gets it wrong.')}
          >
            <Select
              value={state.fileFormat}
              onChange={(event) => onFormatChange(event.currentTarget.value as FileFormatChoice)}
              aria-label={t('studio.source.format.label', 'Schema format')}
              disabled={parsing}
            >
              <option value="auto">{t('studio.source.format.auto', 'Auto-detect')}</option>
              {FILE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {fileFormatLabel(format)}
                </option>
              ))}
            </Select>
          </FormField>
          <Dropzone accept={FILE_ACCEPT} onFile={parseFile} disabled={parsing} />
          {parsing ? (
            <div className="flex items-center gap-2 text-body-sm text-fg-muted">
              <Spinner size="sm" />
              {t('studio.source.file.parsing', 'Reading uploaded schema file…')}
            </div>
          ) : null}
          {parseError !== null ? (
            <Alert tone="danger" role="alert" title={t('studio.source.file.errorTitle', 'Could not parse the file')} body={parseError} />
          ) : null}
          {state.filePreview !== null ? <FilePreviewCard preview={state.filePreview} /> : null}
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

function FilePreviewCard({ preview }: { preview: NonNullable<WizardState['filePreview']> }) {
  const shortFormat = fileFormatFromImportFormat(preview.format);
  const formatName = shortFormat === null ? preview.format : fileFormatLabel(shortFormat);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
      <div className="flex items-center gap-2">
        <MonoText className="text-body-sm text-fg">{preview.fileName}</MonoText>
        <Tag>
          {preview.detected
            ? t('studio.source.file.detectedAs', 'Detected: {format}', { format: formatName })
            : formatName}
        </Tag>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="accent">
          {t('studio.source.file.tables', 'tables')} <MonoText>{preview.tables}</MonoText>
        </Badge>
        <Badge tone="neutral">
          {t('studio.source.file.columns', 'columns')} <MonoText>{preview.columns}</MonoText>
        </Badge>
        {preview.warnings.length > 0 ? (
          <Badge tone="warn">
            {t('studio.source.file.warnings', 'warnings')} <MonoText>{preview.warnings.length}</MonoText>
          </Badge>
        ) : null}
      </div>
      {preview.warnings.slice(0, 3).map((warning) => (
        <p key={warning} className="text-caption text-fg-muted">
          {warning}
        </p>
      ))}
      {preview.warnings.length > 3 ? (
        <p className="text-caption text-fg-subtle">
          {t('studio.source.file.moreWarnings', '+{count} more warnings — the full list appears in the analyze step.', { count: String(preview.warnings.length - 3), })}
        </p>
      ) : null}
    </div>
  );
}

function SqliteFileForm({ fields, onChange }: { fields: FieldsInput; onChange: (fields: FieldsInput) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <FormField
        label={t('studio.source.sqlite.file', 'Database file path')}
        required
        helper={t(
          'studio.source.sqlite.helper',
          'SQLite is a file, not a server — give the absolute path on the machine running Adminium.',
        )}
      >
        <Input
          mono
          value={fields.file}
          onChange={(event) => onChange({ ...fields, file: event.currentTarget.value })}
          placeholder="/var/data/app.db"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      <p className="text-caption text-fg-muted">
        {t('studio.source.fields.preview', 'Connection string preview:')}{' '}
        <MonoText>{composeDsn(fields, 'sqlite')}</MonoText>
      </p>
    </div>
  );
}

function FieldsForm({
  engine,
  fields,
  onChange,
}: {
  engine: ConnectionEngine;
  fields: FieldsInput;
  onChange: (fields: FieldsInput) => void;
}) {
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
        {engine === 'postgres' ? (
          <FormField label={t('studio.source.fields.ssl', 'SSL mode')}>
            <Select value={fields.ssl} onChange={(event) => patch({ ssl: event.currentTarget.value as SslMode })}>
              {SSL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
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
        <MonoText>{composeDsn({ ...fields, password: fields.password.length > 0 ? '•••' : '' }, engine)}</MonoText>
      </p>
    </div>
  );
}
