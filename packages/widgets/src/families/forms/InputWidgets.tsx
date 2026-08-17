/**
 * The `forms` family's INPUT widgets (annex §10) — `otp-input`, `chip-input`,
 * `segmented-control`, `password-strength-meter`. Each is a thin registry
 * binding over an @adminium/ui primitive that already owns the interaction
 * model; this file adds the `form-state` binding, the config surface, and the
 * `mutate` intent on change.
 *
 * They live in ONE file because each is ~30 lines of binding over a component
 * that is already built and tested in @adminium/ui — a file apiece would be four
 * headers restating the same three sentences.
 *
 * WRITE MODEL: these widgets are CONTROLLED by local state and report changes as
 * `mutate` intents (04 §2.1) — they never persist. An unbound (demo) instance
 * has nowhere to send the intent, so it simply keeps local state.
 */

import { ChipInput, FormField, OtpInput, PasswordStrength, SegmentedControl, defaultPasswordScore } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { DEFAULT_SEGMENTS } from './forms-config.js';
import {
  chipInputConfigSchema,
  chipInputDemoData,
  otpInputConfigSchema,
  otpInputDemoData,
  passwordStrengthMeterConfigSchema,
  passwordStrengthMeterDemoData,
  segmentedControlConfigSchema,
  segmentedControlDemoData,
} from './forms-config.js';
import type {
  ChipInputConfig,
  OtpInputConfig,
  PasswordStrengthMeterConfig,
  SegmentedControlConfig,
} from './forms-config.js';
import type { WidgetEvent, WidgetProps } from '../../registry/types.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';

export {
  chipInputConfigSchema,
  chipInputDemoData,
  otpInputConfigSchema,
  otpInputDemoData,
  passwordStrengthMeterConfigSchema,
  passwordStrengthMeterDemoData,
  segmentedControlConfigSchema,
  segmentedControlDemoData,
};
export type { ChipInputConfig, OtpInputConfig, PasswordStrengthMeterConfig, SegmentedControlConfig };

// ── otp-input ───────────────────────────────────────────────────────────────

export function OtpInputWidget({ config, data, onEvent }: WidgetProps<OtpInputConfig>) {
  const t = useMaybeT();
  const values = formValuesOf(data);
  const initial = typeof values['code'] === 'string' ? values['code'] : '';
  const [code, setCode] = useState(initial);
  const target = bindingTargetOf(config.binding);

  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="otp-input" data-testid={config.testId}>
      <OtpInput
        length={config.length}
        value={code}
        onChange={setCode}
        label={config.label ?? config.title ?? t('ui:widgets.forms.otpInput.label', 'One-time code')}
        onComplete={(complete) => {
          // Only a COMPLETE code is worth reporting — an intent per keystroke
          // would have the host verifying partial codes.
          if (target === null) return;
          onEvent({
            type: 'mutate',
            intent: 'update',
            connectionId: target.connectionId,
            table: target.table,
            values: { code: complete },
          } satisfies WidgetEvent);
        }}
      />
      {config.helpText !== undefined && <p className="text-caption text-fg-subtle">{config.helpText}</p>}
    </div>
  );
}

// ── chip-input ──────────────────────────────────────────────────────────────

/**
 * The closed validator vocabulary (annex §10 `validator`). Config names a RULE,
 * never a predicate — see `chipInputConfigSchema`. `email` is the annex's
 * example ("commits on Enter with validation, e.g. contains @").
 */
const CHIP_VALIDATORS: Record<string, (chip: string) => boolean> = {
  none: () => true,
  email: (chip) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chip),
  domain: (chip) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(chip),
};

export function ChipInputWidget({ config, data, onEvent }: WidgetProps<ChipInputConfig>) {
  const t = useMaybeT();
  const values = formValuesOf(data);
  const initial = Array.isArray(values['chips']) ? (values['chips'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
  const [chips, setChips] = useState<string[]>(initial);
  const target = bindingTargetOf(config.binding);

  const field = (
    <ChipInput
      value={chips}
      onValueChange={(next) => {
        setChips(next);
        if (target === null) return;
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: target.connectionId,
          table: target.table,
          values: { chips: next },
        });
      }}
      validate={CHIP_VALIDATORS[config.validator] ?? CHIP_VALIDATORS['none']}
      removeLabel={(chip) => `${config.removeLabel ?? t('ui:widgets.forms.chipInput.remove', 'Remove')} ${chip}`}
      placeholder={config.placeholder ?? ''}
      inputClassName={config.mono ? 'font-mono' : undefined}
    />
  );

  return (
    <div className="flex h-full flex-col justify-center px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chip-input" data-testid={config.testId}>
      {config.label === undefined ? (
        field
      ) : (
        <FormField label={config.label} {...(config.helpText === undefined ? {} : { hint: config.helpText })}>
          {field}
        </FormField>
      )}
    </div>
  );
}

// ── segmented-control ───────────────────────────────────────────────────────

export function SegmentedControlWidget({ config, data, onEvent }: WidgetProps<SegmentedControlConfig>) {
  const t = useMaybeT();
  const values = formValuesOf(data);
  const options = config.options ?? DEFAULT_SEGMENTS;
  const fallback = config.value ?? (typeof values['value'] === 'string' ? (values['value'] as string) : options[0]?.key);
  const [value, setValue] = useState<string>(fallback ?? '');
  const target = bindingTargetOf(config.binding);

  if (options.length === 0) return null;

  return (
    <div
      className="flex h-full items-center px-[var(--widget-pad)] pb-[var(--widget-pad)]"
      data-widget="segmented-control"
      data-style={config.style}
      data-testid={config.testId}
    >
      <SegmentedControl
        aria-label={config.a11yLabel ?? config.title ?? t('ui:widgets.forms.segmentedControl.a11yLabel', 'Select an option')}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          if (target === null) return;
          onEvent({
            type: 'mutate',
            intent: 'update',
            connectionId: target.connectionId,
            table: target.table,
            values: { value: next },
          });
        }}
        options={options.map((option) => ({
          value: option.key,
          label: option.label ?? option.key,
          ...('dot' in option && option.dot !== undefined ? { dot: option.dot } : {}),
        }))}
      />
    </div>
  );
}

// ── password-strength-meter ─────────────────────────────────────────────────

/**
 * `password-strength-meter` (annex §10) — 4-segment bar filled by score.
 *
 * Scoring is @adminium/ui's `defaultPasswordScore`, NOT a second rule of our
 * own: the auth screens already meter passwords with it, and two scorers would
 * eventually disagree about the same password.
 *
 * The password never leaves the widget — no binding, no `mutate` intent. It is a
 * pure projection of a value the host's form owns.
 */
export function PasswordStrengthMeterWidget({ config, data }: WidgetProps<PasswordStrengthMeterConfig>) {
  const t = useMaybeT();
  const values = formValuesOf(data);
  const password = typeof values['password'] === 'string' ? values['password'] : '';
  const labels = config.labels ?? [
    t('ui:widgets.forms.passwordStrengthMeter.weak', 'Weak'),
    t('ui:widgets.forms.passwordStrengthMeter.fair', 'Fair'),
    t('ui:widgets.forms.passwordStrengthMeter.good', 'Good'),
    t('ui:widgets.forms.passwordStrengthMeter.strong', 'Strong'),
  ];

  return (
    <div
      className="flex h-full flex-col justify-center px-[var(--widget-pad)] pb-[var(--widget-pad)]"
      data-widget="password-strength-meter"
      data-score={defaultPasswordScore(password)}
      data-testid={config.testId}
    >
      <PasswordStrength
        value={password}
        label={config.label ?? config.title ?? t('ui:widgets.forms.passwordStrengthMeter.label', 'Password strength')}
        labels={labels as [string, string, string, string]}
      />
    </div>
  );
}
