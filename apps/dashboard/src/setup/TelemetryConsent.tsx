/**
 * The first-run consent step (M10-T04). Two independent opt-ins, both rendered
 * OFF and both requiring a deliberate flip — nothing here is pre-checked, which
 * is the whole point of "opt-in, off by default" (v0.5 exit criterion).
 *
 * The copy states EXACTLY what leaves the instance, itemized, plus an explicit
 * "never sent" list — mirroring apps/server/src/telemetry/payload.ts, which is
 * the source of truth for both. A consent screen that says "anonymous usage
 * data" and nothing more is not consent.
 *
 * Presentational: state lives in the wizard, so this same component can be
 * reused by the post-setup settings surface.
 */
import { BarChart3, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Label, Switch } from '@adminium/ui';

import { t } from '../i18n/t.js';
import type { SetupConsent } from './setupApi.js';

function ConsentOption(props: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  children?: ReactNode;
}): ReactNode {
  const descriptionId = `${props.id}-description`;
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true">
          {props.icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={props.id} className="text-body font-semibold text-fg">
            {props.title}
          </Label>
          <p id={descriptionId} className="text-body-sm text-fg-muted">
            {props.description}
          </p>
        </div>
        <Switch
          id={props.id}
          checked={props.checked}
          onCheckedChange={props.onChange}
          aria-describedby={descriptionId}
          className="mt-0.5 shrink-0"
        />
      </div>
      {props.children}
    </div>
  );
}

/** The itemized payload — the same fields payload.ts actually builds. */
function PayloadDisclosure(): ReactNode {
  const sent: readonly string[] = [
    t('setup.consent.sent.instanceId', 'A random instance ID (a UUID generated here; not derived from your name, host, or database)'),
    t('setup.consent.sent.version', 'The Adminium version this instance runs'),
    t('setup.consent.sent.engines', 'Which database engine types are connected (e.g. "postgres") — types only'),
  ];
  const never: readonly string[] = [
    t('setup.consent.never.schema', 'Your schema — no table, column, or enum names'),
    t('setup.consent.never.rows', 'Your data — not a single row, ever'),
    t('setup.consent.never.connections', 'Connection strings, hostnames, or credentials'),
    t('setup.consent.never.people', 'User emails, names, or IDs'),
    t('setup.consent.never.llm', 'AI prompts or run contents'),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-surface-2 p-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-body-sm font-semibold text-fg">
          {t('setup.consent.sentTitle', 'Exactly what is sent:')}
        </p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body-sm text-fg-muted">
          {sent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-body-sm font-semibold text-fg">
          {t('setup.consent.neverTitle', 'Never sent:')}
        </p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body-sm text-fg-muted">
          {never.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export interface TelemetryConsentProps {
  value: SetupConsent;
  onChange: (next: SetupConsent) => void;
}

export function TelemetryConsent({ value, onChange }: TelemetryConsentProps): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <ConsentOption
        id="setup-consent-telemetry"
        icon={<BarChart3 className="size-[18px]" />}
        title={t('setup.consent.telemetry.title', 'Share anonymous usage data')}
        description={t(
          'setup.consent.telemetry.description',
          'Helps us see which database engines to prioritize. Off unless you turn it on.',
        )}
        checked={value.telemetry}
        onChange={(telemetry) => onChange({ ...value, telemetry })}
      >
        <PayloadDisclosure />
      </ConsentOption>

      <ConsentOption
        id="setup-consent-updates"
        icon={<RefreshCw className="size-[18px]" />}
        title={t('setup.consent.updates.title', 'Check for new releases')}
        description={t(
          'setup.consent.updates.description',
          'Shows a notice when a new version — including a security fix — is available. This asks GitHub for the latest release, which reveals this instance’s IP address and version to GitHub. Nothing else is sent.',
        )}
        checked={value.updateCheck}
        onChange={(updateCheck) => onChange({ ...value, updateCheck })}
      />

      <p className="text-body-sm text-fg-muted">
        {t('setup.consent.reversible', 'Both are off by default and you can change either one later in Settings.')}
      </p>
    </div>
  );
}
