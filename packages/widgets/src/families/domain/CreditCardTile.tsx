// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { CreditCard, Plus } from 'lucide-react';
import { useMemo } from 'react';

import { creditCardTileConfigSchema, creditCardTileDemoData } from './domain-ops-config.js';
import type { CreditCardTileConfig } from './domain-ops-config.js';
import {
  booleanField,
  cardBrandOf,
  labelField,
  maskPan,
  opsBindingSourceOf,
  opsRowOf,
} from './domain-ops-lib.js';
import type { CardBrand, PaymentMethod } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetEvent, WidgetProps } from '../../registry/types.js';

/**
 * `credit-card-tile` (annex §13) — the skeuomorphic payment card: brand
 * gradient, masked PAN, holder, expiry, a Default badge / Set-default action and
 * a hover lift; plus the dashed `add-method` ghost card and the compact
 * `payment-method-row`. Evidence: Payments, Billing & Usage, Billing Overview.
 *
 * The three faces are ONE registry id behind `variant` config, per 04 §2.1
 * ("visual variants are config, never new registry ids") — and the annex agrees,
 * naming them under this single heading.
 *
 * A Cloud/marketing + billing surface (M12/M14 consumers): it renders its data
 * contract and holds NO billing logic. It never sees a PAN — the bound table
 * stores `brand` + `last4` and nothing else, and `maskPan` is structurally
 * incapable of printing more than four digits.
 *
 * DIRECTION: the card mirrors whole. The masked PAN is the one exception, and it
 * is not styled as one: `MonoText` + `tabular-nums` in an isolated run keeps the
 * group order stable, because a PAN is a NUMBER, and Unicode bidi already lays
 * digit runs out left-to-right inside RTL text — the same rule that keeps the
 * expiry reading "04/28" and not "28/04" in Arabic.
 */

export { creditCardTileConfigSchema, creditCardTileDemoData };
export type { CreditCardTileConfig };

/**
 * Brand → gradient. Token utilities only — no raw hex (04 hard rule) — so each
 * network reads distinct in both themes without inventing a color.
 */
const BRAND_GRADIENT: Record<CardBrand, string> = {
  visa: 'bg-gradient-to-br from-info to-accent',
  mastercard: 'bg-gradient-to-br from-warn to-danger',
  amex: 'bg-gradient-to-br from-info to-pos',
  discover: 'bg-gradient-to-br from-warn to-accent',
  unknown: 'bg-gradient-to-br from-fg-subtle to-fg-muted',
};

/** Brand → wordmark. Overridable via `brandMeta` (the annex's declared config). */
const BRAND_NAME: Record<CardBrand, string> = {
  visa: 'VISA',
  mastercard: 'Mastercard',
  amex: 'AMEX',
  discover: 'Discover',
  unknown: 'Card',
};

export interface CreditCardTileViewProps {
  method: PaymentMethod;
  variant?: 'tile' | 'row' | 'ghost' | undefined;
  brandMeta?: Record<string, string> | undefined;
  defaultLabel?: string | undefined;
  setDefaultLabel?: string | undefined;
  manageLabel?: string | undefined;
  addLabel?: string | undefined;
  expiresLabel?: string | undefined;
  /** Absent → the write affordances are hidden (an unbound widget cannot mutate). */
  onSetDefault?: (() => void) | undefined;
  onManage?: (() => void) | undefined;
  testId?: string | undefined;
}

function brandNameOf(brand: CardBrand, meta: Record<string, string> | undefined): string {
  return meta?.[brand] ?? BRAND_NAME[brand];
}

export function CreditCardTileView({
  method,
  variant = 'tile',
  brandMeta,
  defaultLabel,
  setDefaultLabel,
  manageLabel,
  addLabel,
  expiresLabel,
  onSetDefault,
  onManage,
  testId,
}: CreditCardTileViewProps) {
  const t = useMaybeT();
  const pan = maskPan(method.last4, method.brand);
  const brandName = brandNameOf(method.brand, brandMeta);
  const resolvedDefaultLabel = defaultLabel ?? t('ui:widgets.domain.creditCardTile.defaultLabel', 'Default');

  if (variant === 'ghost') {
    return (
      <div data-widget="credit-card-tile" data-testid={testId} data-variant="ghost" className="h-full px-[var(--widget-pad)] pb-[var(--widget-pad)]">
        <button
          type="button"
          onClick={onManage}
          data-part="add-method"
          className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border-strong text-fg-muted transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="size-5" aria-hidden="true" />
          <span className="text-body-sm font-semibold">{addLabel ?? t('ui:widgets.domain.creditCardTile.addLabel', 'Add payment method')}</span>
        </button>
      </div>
    );
  }

  if (variant === 'row') {
    return (
      <div
        data-widget="credit-card-tile"
        data-testid={testId}
        data-variant="row"
        className="flex h-full items-center gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
      >
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-md text-white ${BRAND_GRADIENT[method.brand]}`}
        >
          <CreditCard className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <MonoText className="block truncate text-body-sm font-semibold tabular-nums text-fg" data-part="card-pan">
            {pan}
          </MonoText>
          {method.exp === undefined ? null : (
            <MonoText className="text-caption text-fg-subtle" data-part="card-exp">
              {method.exp}
            </MonoText>
          )}
        </div>
        {method.isDefault ? (
          <Badge tone="accent" data-part="card-default">
            {resolvedDefaultLabel}
          </Badge>
        ) : null}
        {onManage === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onManage} data-part="card-manage">
            {manageLabel ?? t('ui:widgets.domain.creditCardTile.manageLabel', 'Manage')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div data-widget="credit-card-tile" data-testid={testId} data-variant="tile" className="h-full px-[var(--widget-pad)] pb-[var(--widget-pad)]">
      <div
        data-part="card-tile"
        className={`group flex h-full min-h-32 flex-col justify-between rounded-xl p-4 text-white shadow-card transition-shadow hover:shadow-lg ${BRAND_GRADIENT[method.brand]}`}
      >
        <div className="flex items-start justify-between gap-2">
          <CreditCard className="size-5 opacity-80" aria-hidden="true" />
          <span className="text-body-sm font-black uppercase tracking-wide" data-part="card-brand">
            {brandName}
          </span>
        </div>

        <MonoText className="text-body font-semibold tabular-nums tracking-widest" data-part="card-pan">
          {pan}
        </MonoText>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            {method.holder === undefined ? null : (
              <p className="truncate text-caption font-semibold uppercase tracking-wide opacity-90" data-part="card-holder">
                {method.holder}
              </p>
            )}
            {method.exp === undefined ? null : (
              <p className="text-caption opacity-75">
                {expiresLabel ?? t('ui:widgets.domain.creditCardTile.expiresLabel', 'Expires')} <MonoText data-part="card-exp">{method.exp}</MonoText>
              </p>
            )}
          </div>
          {method.isDefault ? (
            <Badge tone="neutral" data-part="card-default" className="bg-white/25 text-white">
              {resolvedDefaultLabel}
            </Badge>
          ) : onSetDefault === undefined ? null : (
            // Revealed on hover/focus per the annex, but never hidden from the
            // keyboard: `focus-within` + `focus-visible` keep it reachable, and
            // opacity (not `hidden`) keeps it in the a11y tree throughout.
            <button
              type="button"
              onClick={onSetDefault}
              data-part="card-set-default"
              className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              {setDefaultLabel ?? t('ui:widgets.domain.creditCardTile.setDefaultLabel', 'Set default')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Project the bound `record` onto the payment-method model. */
function methodOf(config: CreditCardTileConfig, data: unknown): PaymentMethod | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  return {
    brand: cardBrandOf(row[config.brandField]),
    last4: labelField(row, config.last4Field, '0000'),
    holder: row[config.holderField] === undefined ? undefined : labelField(row, config.holderField, ''),
    exp: row[config.expField] === undefined ? undefined : labelField(row, config.expField, ''),
    isDefault: booleanField(row, config.defaultField) ?? false,
  };
}

export function CreditCardTileWidget({ config, data, onEvent }: WidgetProps<CreditCardTileConfig>) {
  const t = useMaybeT();
  const method = useMemo(() => methodOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  // The ghost card is an ADD affordance and has no row to render — it must work
  // on an empty payload, which is exactly when a host mounts it.
  if (method === null && config.variant !== 'ghost') {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.creditCardTile.emptyTitle', 'No payment method')}
        body={config.emptyBody ?? t('ui:widgets.domain.creditCardTile.emptyBody', 'Add a card to see it here.')}
      />
    );
  }

  const emit = (event: WidgetEvent): void => {
    void onEvent(event);
  };

  return (
    <CreditCardTileView
      method={method ?? { brand: 'unknown', last4: '0000', isDefault: false }}
      variant={config.variant}
      {...(config.brandMeta === undefined ? {} : { brandMeta: config.brandMeta })}
      {...(config.defaultLabel === undefined ? {} : { defaultLabel: config.defaultLabel })}
      {...(config.setDefaultLabel === undefined ? {} : { setDefaultLabel: config.setDefaultLabel })}
      {...(config.manageLabel === undefined ? {} : { manageLabel: config.manageLabel })}
      {...(config.addLabel === undefined ? {} : { addLabel: config.addLabel })}
      {...(config.expiresLabel === undefined ? {} : { expiresLabel: config.expiresLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // Widgets never write: Set-default describes the change and the host runs
      // it through the CRUD API (permissions + undo + audit). Unbound → no
      // affordance, because there is nowhere to send the intent.
      {...(source === null || method === null
        ? {}
        : {
            onSetDefault: () =>
              emit({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                values: { [config.defaultField]: true },
              }),
          })}
      {...(config.href === undefined
        ? {}
        : { onManage: () => emit({ type: 'drill-through', href: config.href as string }) })}
    />
  );
}
