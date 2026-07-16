import { Badge, Button, Checkbox, MonoText } from '@adminium/ui';
import { Award, RefreshCw } from 'lucide-react';

import { BlockCallout, BlockEmpty, fillTemplate } from './BlockShell.js';
import {
  blockBindingSourceOf,
  formatBlockDate,
  formatBlockNumber,
  rowOf,
  rowsOf,
} from './block-lib.js';
import {
  blockApprovalConfigSchema,
  blockApprovalDemoData,
  blockDeliveryStepperConfigSchema,
  blockDeliveryStepperDemoData,
  blockLoyaltyBannerConfigSchema,
  blockLoyaltyBannerDemoData,
  blockRecurringBannerConfigSchema,
  blockRecurringBannerDemoData,
  blockSignatureConfigSchema,
  blockSignatureDemoData,
  blockTermsCheckboxConfigSchema,
  blockTermsCheckboxDemoData,
} from './blocks-config.js';
import type {
  BlockApprovalConfig,
  BlockDeliveryStepperConfig,
  BlockLoyaltyBannerConfig,
  BlockRecurringBannerConfig,
  BlockSignatureConfig,
  BlockTermsCheckboxConfig,
} from './blocks-config.js';
import { stringField } from './domain-lib.js';
import type {
  BlockApproval,
  BlockLoyalty,
  BlockRecurring,
  BlockSignature,
  BlockStep,
  BlockTerms,
} from './block-types.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  blockApprovalConfigSchema,
  blockApprovalDemoData,
  blockDeliveryStepperConfigSchema,
  blockDeliveryStepperDemoData,
  blockLoyaltyBannerConfigSchema,
  blockLoyaltyBannerDemoData,
  blockRecurringBannerConfigSchema,
  blockRecurringBannerDemoData,
  blockSignatureConfigSchema,
  blockSignatureDemoData,
  blockTermsCheckboxConfigSchema,
  blockTermsCheckboxDemoData,
};

/**
 * TRACK BUILDER — the STATUS/APPROVAL half of the annex §13 document-block
 * vocabulary:
 *
 *   `block-loyalty-banner`, `block-recurring-banner`, `block-delivery-stepper`,
 *   `block-signature`, `block-terms-checkbox`, `block-approval`.
 *
 * TEMPLATED COPY: the banners render ONE translated string with `{placeholder}`
 * slots, never concatenated fragments — translators keep control of word order,
 * which is what keeps these correct in RTL and in clause-reordering languages.
 *
 * NEVER WRITES: `block-approval`'s Approve/Reject and `block-terms-checkbox`'s
 * toggle emit `mutate` intents; the host commits them (04 §2.1).
 */

// ── block-loyalty-banner ────────────────────────────────────────────────────

export function BlockLoyaltyBannerWidget({ config, data }: WidgetProps<BlockLoyaltyBannerConfig>) {
  const payload = rowOf<BlockLoyalty>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No loyalty balance'} body={config.emptyBody ?? 'Loyalty points appear once this customer is enrolled.'} />;
  }

  const locale = config.format?.locale;
  const balance = typeof payload.balance === 'number' ? payload.balance : 0;
  const earned = typeof payload.earned === 'number' ? payload.earned : 0;
  const tier = payload.tier ?? '';

  return (
    <BlockCallout block="block-loyalty-banner" tone="accent" testId={config.testId} icon={<Award className="size-4" />}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-fg">
          {fillTemplate(config.balanceLabel ?? '{balance} pts · {tier}', {
            balance: formatBlockNumber(balance, locale),
            tier,
          })}
        </span>
        <MonoText className="text-pos">
          {fillTemplate(config.earnedLabel ?? '+{earned} earned', {
            earned: formatBlockNumber(earned, locale),
          })}
        </MonoText>
      </div>
    </BlockCallout>
  );
}

// ── block-recurring-banner ──────────────────────────────────────────────────

export function BlockRecurringBannerWidget({ config, data }: WidgetProps<BlockRecurringBannerConfig>) {
  const payload = rowOf<BlockRecurring>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'Not recurring'} body={config.emptyBody ?? 'Recurrence details appear once a schedule is set.'} />;
  }

  const locale = config.format?.locale;
  const template = config.template ?? 'Recurring — {freq} · Next on {next} · {count} cycles';

  return (
    <BlockCallout block="block-recurring-banner" tone="info" testId={config.testId} icon={<RefreshCw className="size-4" />}>
      {fillTemplate(template, {
        freq: payload.freq ?? '',
        next: formatBlockDate(payload.next, locale),
        count: formatBlockNumber(typeof payload.count === 'number' ? payload.count : 0, locale),
      })}
    </BlockCallout>
  );
}

// ── block-delivery-stepper ──────────────────────────────────────────────────

const STEP_STATES: ReadonlySet<string> = new Set(['done', 'current', 'todo']);

export function BlockDeliveryStepperWidget({ config, data }: WidgetProps<BlockDeliveryStepperConfig>) {
  const steps: BlockStep[] = rowsOf(data).map((row, index) => {
    const raw = stringField(row, config.stateField);
    return {
      id: stringField(row, config.idField) ?? `step-${index}`,
      label: stringField(row, config.labelField) ?? '',
      state: (raw !== undefined && STEP_STATES.has(raw) ? raw : 'todo') as BlockStep['state'],
    };
  });

  if (steps.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No delivery steps'} body={config.emptyBody ?? 'Fulfilment progress will appear here.'} />;
  }

  return (
    // RTL: the connector rail is a flex row, so the whole stepper mirrors with
    // the writing direction — the steps are a sequence in reading order, not a
    // time axis, so mirroring is correct here (10 §5.5).
    <ol data-widget="block-delivery-stepper" data-testid={config.testId} className="flex w-full items-start">
      {steps.map((step, index) => (
        <li key={step.id} data-part="step" data-state={step.state} className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            {/* Connectors: absent before the first dot and after the last. */}
            <span
              aria-hidden
              className={`h-0.5 flex-1 ${index === 0 ? 'bg-transparent' : step.state === 'todo' ? 'bg-border' : 'bg-accent'}`}
            />
            <span
              className={`size-2.5 shrink-0 rounded-full ${
                step.state === 'done'
                  ? 'bg-accent'
                  : step.state === 'current'
                    ? 'bg-accent ring-2 ring-accent-soft'
                    : 'bg-border-strong'
              }`}
            />
            <span
              aria-hidden
              className={`h-0.5 flex-1 ${
                index === steps.length - 1 ? 'bg-transparent' : steps[index + 1]?.state === 'todo' ? 'bg-border' : 'bg-accent'
              }`}
            />
          </div>
          <span
            className={`mt-1.5 truncate px-1 text-center text-micro ${
              step.state === 'todo' ? 'text-fg-subtle' : 'text-fg'
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── block-signature ─────────────────────────────────────────────────────────

export function BlockSignatureWidget({ config, data }: WidgetProps<BlockSignatureConfig>) {
  const payload = rowOf<BlockSignature>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No signature'} body={config.emptyBody ?? 'A signature line appears once this document requires one.'} />;
  }

  const locale = config.format?.locale;
  const name = payload.sigName ?? '';
  const title = payload.sigTitle ?? '';

  return (
    <div data-widget="block-signature" data-testid={config.testId} className="flex w-full flex-wrap items-end gap-6">
      <div className="min-w-0 flex-1">
        {/* The rule the signature sits on — a border, so it prints. */}
        <div className="border-b border-border-strong pb-1">
          {config.editable ? (
            <input
              defaultValue={name}
              aria-label={config.namePlaceholder ?? 'Signature name'}
              placeholder={config.namePlaceholder ?? 'Name'}
              className="w-full bg-transparent text-section text-fg outline-none placeholder:text-fg-subtle"
            />
          ) : (
            <p className="text-section text-fg">{name}</p>
          )}
        </div>
        <p className="mt-1 text-caption text-fg-subtle">{title}</p>
      </div>
      {config.showDate && (
        <div className="min-w-24">
          <div className="border-b border-border-strong pb-1">
            <MonoText className="text-body-sm text-fg">{formatBlockDate(payload.sigDate, locale)}</MonoText>
          </div>
          <p className="mt-1 text-caption text-fg-subtle">{config.dateLabel ?? 'Date'}</p>
        </div>
      )}
    </div>
  );
}

// ── block-terms-checkbox ────────────────────────────────────────────────────

/**
 * `form-state` (04 §3): the payload IS this control's own state, so it is never
 * "empty" — the shared predicate correctly never routes it to the empty card,
 * and an absent payload just means "unchecked, default label".
 */
export function BlockTermsCheckboxWidget({ config, data, onEvent }: WidgetProps<BlockTermsCheckboxConfig>) {
  const payload = rowOf<BlockTerms>(data);
  const label = payload?.label ?? config.defaultLabel ?? 'I accept the terms';
  const checked = payload?.checked === true;
  const source = blockBindingSourceOf(config.binding);

  return (
    <div data-widget="block-terms-checkbox" data-testid={config.testId} className="flex w-full items-start gap-2.5">
      <Checkbox
        defaultChecked={checked}
        aria-label={label}
        onCheckedChange={(next) => {
          if (source === null) return; // unbound: nothing to write to
          onEvent({
            type: 'mutate',
            intent: 'update',
            connectionId: source.connectionId,
            table: source.table,
            values: { [config.checkedField]: next === true },
          });
        }}
      />
      <span className="text-body-sm text-fg">{label}</span>
    </div>
  );
}

// ── block-approval ──────────────────────────────────────────────────────────

const APPROVAL_TONE: Record<BlockApproval['status'], 'warn' | 'pos' | 'danger'> = {
  pending: 'warn',
  approved: 'pos',
  rejected: 'danger',
};

export function BlockApprovalWidget({ config, data, onEvent }: WidgetProps<BlockApprovalConfig>) {
  const payload = rowOf<BlockApproval>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No approver'} body={config.emptyBody ?? 'The approval chain appears once a reviewer is assigned.'} />;
  }

  const status: BlockApproval['status'] =
    payload.status === 'approved' || payload.status === 'rejected' ? payload.status : 'pending';
  const statusLabel =
    status === 'approved'
      ? (config.approvedLabel ?? 'Approved')
      : status === 'rejected'
        ? (config.rejectedLabel ?? 'Rejected')
        : (config.pendingLabel ?? 'Pending');
  const source = blockBindingSourceOf(config.binding);

  const decide = (next: 'approved' | 'rejected'): void => {
    if (source === null) return;
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: source.connectionId,
      table: source.table,
      values: { [config.statusField]: next },
    });
  };

  return (
    <div
      data-widget="block-approval"
      data-testid={config.testId}
      data-status={status}
      className="flex w-full flex-wrap items-center gap-3 rounded-md border border-border p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-bold text-fg">{payload.name}</p>
        <p className="truncate text-caption text-fg-subtle">{payload.title}</p>
      </div>
      <Badge tone={APPROVAL_TONE[status]} dot data-part="approval-pill">
        {statusLabel}
      </Badge>
      {config.actionable && status === 'pending' && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => decide('approved')}>
            {config.approveLabel ?? 'Approve'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide('rejected')}>
            {config.rejectLabel ?? 'Reject'}
          </Button>
        </div>
      )}
    </div>
  );
}
