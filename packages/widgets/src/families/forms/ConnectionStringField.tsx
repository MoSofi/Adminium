/**
 * `connection-string-field` (annex §10) — mono DSN input with a database icon, a
 * keyboard-shortcut badge, host parsing, provider quick-fill chips and an inline
 * success/status line ("14 tables detected").
 * Evidence: Adminium Console, Onboarding, See It In Action.
 *
 * TWO EXPORTS, ONE IMPLEMENTATION:
 *   · `ConnectionStringField` — the presentational field. The Studio connect
 *     wizard (`apps/dashboard/src/studio/connect/steps/SourceStep.tsx`) renders
 *     THIS component; it used to carry its own copy of the field, and the DSN
 *     grammar behind both now lives in the pure `forms-dsn.ts` (see that
 *     module's header for why the wizard became the consumer).
 *   · `ConnectionStringFieldWidget` — the registry binding over it.
 *
 * Composed from @adminium/ui's `InputGroup`, which already owns the leading-icon
 * + `Kbd` chrome and moves the focus ring to the wrapper.
 */

import { FormField, InputGroup, Tag, cn } from '@adminium/ui';
import { Database } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { connectionStringFieldConfigSchema, connectionStringFieldDemoData } from './forms-config.js';
import type { ConnectionStringFieldConfig } from './forms-config.js';
import {
  DSN_ENGINES,
  dsnHost,
  dsnPlaceholder,
  dsnValidationCode,
  engineForDsn,
  providerChipsFor,
} from './forms-dsn.js';
import type { DsnEngine, DsnProviderChip, DsnValidationCode } from './forms-dsn.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';
import type { FormTone } from './forms-lib.js';
import type { WidgetProps } from '../../registry/types.js';

export { connectionStringFieldConfigSchema, connectionStringFieldDemoData };
export type { ConnectionStringFieldConfig };

/**
 * English developer fallbacks for the two validation codes. Deliberately
 * GENERIC about which schemes are expected: the accepted set is `protocols`, so
 * naming Postgres and MySQL here would be wrong for a field configured for
 * Mongo. A caller that knows its own protocol list (the wizard does) passes
 * precise copy through `errorText`.
 */
const DEFAULT_DSN_ERROR: Record<DsnValidationCode, string> = {
  'invalid-scheme': 'Unrecognized connection-string scheme.',
  incomplete: 'Add a host and database to the connection string.',
};

/** Status-line tone → text colour. Tokens only — never a raw hex (04 §7.1). */
const STATUS_TONE_CLASS: Record<FormTone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

export interface ConnectionStringFieldProps {
  value: string;
  onValueChange: (dsn: string) => void;
  /**
   * Fired when the user finishes editing (Enter or blur), NOT on every
   * keystroke — see the widget below for why a DSN is committed and not streamed.
   */
  onCommit?: ((dsn: string) => void) | undefined;
  /** Annex §10 `protocols` — the engines the host can actually connect to. */
  protocols?: readonly DsnEngine[] | undefined;
  /** Whose example DSN to show until the value itself determines the engine. */
  placeholderEngine?: DsnEngine | undefined;
  label: ReactNode;
  required?: boolean | undefined;
  /** Shown only while there is no error — an error replaces the hint. */
  helper?: ReactNode | undefined;
  /** Translated copy per validation code. Widgets never translate (04 §2). */
  errorText?: Partial<Record<DsnValidationCode, string>> | undefined;
  /** Inline success/status line under the field (annex §10 `statusLine`). */
  statusLine?: ReactNode | undefined;
  statusTone?: FormTone | undefined;
  /** Keyboard-shortcut badge rendered inside the field chrome (annex §10). */
  shortcut?: string | undefined;
  showQuickFill?: boolean | undefined;
  quickFillLabel?: string | undefined;
  /**
   * What a quick-fill chip does. Defaults to filling the DSN; the wizard
   * overrides it to move its engine picker in the same patch, so the chip cannot
   * leave the picker pointing at a different engine than the DSN it just wrote.
   */
  onQuickFill?: ((chip: DsnProviderChip) => void) | undefined;
  /** Copy for the parsed-host tag; `{host}` is substituted. */
  hostLabel?: string | undefined;
  className?: string | undefined;
  'data-testid'?: string | undefined;
}

export function ConnectionStringField({
  value,
  onValueChange,
  onCommit,
  protocols = DSN_ENGINES,
  placeholderEngine,
  label,
  required = false,
  helper,
  errorText,
  statusLine,
  statusTone = 'pos',
  shortcut,
  showQuickFill = true,
  quickFillLabel,
  onQuickFill,
  hostLabel,
  className,
  'data-testid': testId,
}: ConnectionStringFieldProps) {
  const detected = engineForDsn(value, protocols);
  const code = dsnValidationCode(value, protocols);
  const host = dsnHost(value);
  // The DSN's own engine wins over the caller's hint: once the user has typed
  // `mysql://`, a Postgres example placeholder is no longer the useful one.
  const exampleEngine: DsnEngine = detected ?? placeholderEngine ?? 'postgres';
  const chips = showQuickFill ? providerChipsFor(exampleEngine, protocols) : [];
  const error = code === null ? undefined : (errorText?.[code] ?? DEFAULT_DSN_ERROR[code]);

  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      data-widget="connection-string-field"
      data-engine={detected ?? undefined}
      data-testid={testId}
    >
      <FormField
        label={label}
        required={required}
        {...(error === undefined ? {} : { error })}
        {...(detected === null ? {} : { tag: <Tag mono>{detected}</Tag> })}
        {...(error === undefined && helper !== undefined ? { helper } : {})}
      >
        <InputGroup
          mono
          iconLeading={<Database />}
          {...(shortcut === undefined ? {} : { kbd: shortcut })}
          error={error !== undefined}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit?.(value);
          }}
          placeholder={dsnPlaceholder(exampleEngine)}
          autoComplete="off"
          spellCheck={false}
          data-part="dsn-input"
        />
      </FormField>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-part="quick-fill">
          {quickFillLabel !== undefined && <span className="text-caption text-fg-subtle">{quickFillLabel}</span>}
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              data-part="quick-fill-chip"
              data-key={chip.key}
              onClick={() => {
                if (onQuickFill !== undefined) onQuickFill(chip);
                else {
                  onValueChange(chip.dsn);
                  onCommit?.(chip.dsn);
                }
              }}
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
      )}

      {/* Gated on exactly what its children are gated on. A caller that parses a
          host but passes no `hostLabel` and no `statusLine` (the Studio connect
          wizard, on the happy path) would otherwise render an empty <div> that
          the parent's `gap-3` still spaces. */}
      {(statusLine !== undefined || (host !== null && hostLabel !== undefined)) && (
        <div className="flex flex-wrap items-center gap-2">
          {host !== null && hostLabel !== undefined && (
            <span data-part="dsn-host" className="text-caption text-fg-muted">
              {hostLabel.replace('{host}', host)}
            </span>
          )}
          {statusLine !== undefined && (
            <span data-part="status-line" className={cn('text-caption font-semibold', STATUS_TONE_CLASS[statusTone])}>
              {statusLine}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The registry binding (annex §10). Binds the §3 `form-state` shape — the DSN is
 * `values.dsn`, which is exactly "field defs + values" with one field.
 *
 * WRITE MODEL: the intent fires on COMMIT (Enter/blur), never per keystroke.
 * Every other input in this family streams its changes, but a DSN carries a
 * password: a keystroke-level intent would write a partial credential into the
 * host's audit log on every character typed. One committed value is also all a
 * connection test can use.
 */
export function ConnectionStringFieldWidget({ config, data, onEvent }: WidgetProps<ConnectionStringFieldConfig>) {
  const values = formValuesOf(data);
  const initial = typeof values['dsn'] === 'string' ? values['dsn'] : '';
  const [dsn, setDsn] = useState(initial);
  const target = bindingTargetOf(config.binding);

  const errorText: Partial<Record<DsnValidationCode, string>> = {};
  if (config.invalidSchemeText !== undefined) errorText['invalid-scheme'] = config.invalidSchemeText;
  if (config.incompleteText !== undefined) errorText['incomplete'] = config.incompleteText;

  return (
    <div className="flex h-full flex-col justify-center px-4 pb-4">
      <ConnectionStringField
        value={dsn}
        onValueChange={setDsn}
        onCommit={(next) => {
          // Unbound (demo/story/palette): keep the local value, emit nothing —
          // there is nowhere to send the intent (04 §5).
          if (target === null) return;
          onEvent({
            type: 'mutate',
            intent: 'update',
            connectionId: target.connectionId,
            table: target.table,
            values: { dsn: next },
          });
        }}
        protocols={config.protocols ?? DSN_ENGINES}
        placeholderEngine={config.placeholderEngine}
        label={config.label ?? config.title ?? 'Connection string'}
        required={config.required}
        helper={config.helpText}
        errorText={errorText}
        statusLine={config.statusLine}
        statusTone={config.statusTone ?? 'pos'}
        shortcut={config.shortcut}
        showQuickFill={config.showQuickFill}
        quickFillLabel={config.quickFillLabel}
        hostLabel={config.hostLabel}
        data-testid={config.testId}
      />
    </div>
  );
}
