import { Badge, Button, MonoText, SegmentedControl } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';

import { planPricingCardsConfigSchema, planPricingCardsDemoData } from './domain-ops-config.js';
import type { PlanPricingCardsConfig } from './domain-ops-config.js';
import {
  annualMonthly,
  annualTotal,
  booleanField,
  countField,
  formatMoney,
  interpolate,
  labelField,
  opsRowsOf,
  stringArrayField,
} from './domain-ops-lib.js';
import type { PricingPlan } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `plan-pricing-cards` (annex §13) — tier cards: name, tagline, a large mono
 * price with a computed monthly/annual switch, the billing note, a CTA, and the
 * check-list of features; the promoted tier gets an accent border + a POPULAR
 * pill, and an in-modal `selectable` variant turns the cards into radio targets.
 * Evidence: Pricing, Adminium Pricing, Billing & Usage, Billing Overview.
 *
 * A Cloud/marketing surface (M12/M14 consumers) with NO billing logic: it takes
 * plan rows and a discount and renders them. The annual price is COMPUTED here
 * (`monthly × (1 − discount)`) rather than bound as a second column, because the
 * annex specifies a "monthly/annual computed switch" — two independently-stored
 * prices drift, and a card showing an annual price that does not match the
 * monthly one times twelve is a support ticket, not a design.
 *
 * The CTA emits `drill-through`; picking a plan is a checkout flow the HOST
 * owns. This widget cannot start a subscription, and must not look like it can.
 */

export { planPricingCardsConfigSchema, planPricingCardsDemoData };
export type { PlanPricingCardsConfig };

export interface PlanPricingCardsViewProps {
  plans: readonly PricingPlan[];
  annualDiscount?: number | undefined;
  period?: 'monthly' | 'annual' | undefined;
  selectable?: boolean | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
  ctaLabel?: string | undefined;
  currentLabel?: string | undefined;
  popularLabel?: string | undefined;
  monthlyLabel?: string | undefined;
  annualLabel?: string | undefined;
  perMonthLabel?: string | undefined;
  billedAnnuallyLabel?: string | undefined;
  onSelect?: ((planId: string) => void) | undefined;
  testId?: string | undefined;
}

export function PlanPricingCardsView({
  plans,
  annualDiscount = 0.2,
  period = 'monthly',
  selectable = false,
  currency,
  locale,
  ctaLabel,
  currentLabel,
  popularLabel,
  monthlyLabel,
  annualLabel,
  perMonthLabel,
  billedAnnuallyLabel,
  onSelect,
  testId,
}: PlanPricingCardsViewProps) {
  const t = useMaybeT();
  // Period is component state seeded from config — the reader's toggle must
  // survive re-renders (a stored config pins the START, not the state).
  const [active, setActive] = useState<string>(period);
  const [selected, setSelected] = useState<string | null>(null);
  const annual = active === 'annual';

  return (
    <div
      data-widget="plan-pricing-cards"
      data-testid={testId}
      data-period={active}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div className="flex justify-center">
        <SegmentedControl
          value={active}
          onValueChange={setActive}
          data-testid="pricing-period-toggle"
          options={[
            { value: 'monthly', label: monthlyLabel ?? t('ui:widgets.domain.planPricingCards.monthlyLabel', 'Monthly') },
            { value: 'annual', label: annualLabel ?? t('ui:widgets.domain.planPricingCards.annualLabel', 'Annual') },
          ]}
        />
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const monthly = annual ? annualMonthly(plan.monthly, annualDiscount) : plan.monthly;
          const isSelected = selected === plan.id;
          const chosen = selectable && isSelected;
          return (
            <div
              key={plan.id}
              data-part="plan-card"
              data-plan={plan.id}
              {...(plan.promoted ? { 'data-promoted': '' } : {})}
              {...(plan.current ? { 'data-current': '' } : {})}
              {...(chosen ? { 'data-selected': '' } : {})}
              className={[
                'relative flex flex-col gap-3 rounded-xl border bg-surface p-4 transition-shadow',
                plan.promoted || chosen ? 'border-accent shadow-glow' : 'border-border shadow-sm',
              ].join(' ')}
            >
              {plan.promoted ? (
                <Badge tone="accent" data-part="plan-popular" className="absolute -top-2 start-4">
                  {popularLabel ?? t('ui:widgets.domain.planPricingCards.popularLabel', 'POPULAR')}
                </Badge>
              ) : null}

              <div>
                <p className="text-body font-bold text-fg">{plan.name}</p>
                {plan.tagline === undefined ? null : (
                  <p className="text-caption text-fg-subtle">{plan.tagline}</p>
                )}
              </div>

              <div>
                <MonoText className="text-h1 font-black tabular-nums text-fg" data-part="plan-price">
                  {formatMoney(monthly, currency, locale)}
                </MonoText>
                <span className="ms-1 text-caption text-fg-subtle">{perMonthLabel ?? t('ui:widgets.domain.planPricingCards.perMonthLabel', '/ month')}</span>
                {/*
                  The note only makes sense under the annual toggle AND for a
                  paid tier: "Billed $0.00 yearly" on the Free card is noise.
                */}
                {annual && plan.monthly > 0 ? (
                  <p className="text-caption text-fg-subtle" data-part="plan-billing-note">
                    {billedAnnuallyLabel !== undefined
                      ? interpolate(billedAnnuallyLabel, {
                          total: formatMoney(annualTotal(plan.monthly, annualDiscount), currency, locale),
                        })
                      : t('ui:widgets.domain.planPricingCards.billedAnnuallyLabel', 'Billed {total} yearly', {
                          total: formatMoney(annualTotal(plan.monthly, annualDiscount), currency, locale),
                        })}
                  </p>
                ) : null}
              </div>

              <ul className="flex flex-1 flex-col gap-1.5">
                {plan.features.map((feature, index) => (
                  <li key={`${plan.id}-f${index}`} className="flex items-start gap-1.5 text-caption text-fg-muted">
                    <Check className="mt-px size-3.5 shrink-0 text-pos" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.current ? 'secondary' : plan.promoted ? 'primary' : 'outline'}
                size="sm"
                disabled={plan.current}
                data-part="plan-cta"
                onClick={() => {
                  if (selectable) setSelected(plan.id);
                  onSelect?.(plan.id);
                }}
              >
                {plan.current
                  ? (currentLabel ?? t('ui:widgets.domain.planPricingCards.currentLabel', 'Current plan'))
                  : (ctaLabel ?? t('ui:widgets.domain.planPricingCards.ctaLabel', 'Choose plan'))}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Project the bound `record-list` onto the plan model. */
function plansOf(config: PlanPricingCardsConfig, data: unknown): PricingPlan[] {
  const rows = opsRowsOf(data);
  return rows.map((row, index) => {
    const id = labelField(row, config.idField, `plan-${index}`);
    const name = labelField(row, config.nameField, `Plan ${index + 1}`);
    return {
      id,
      name,
      tagline: row[config.taglineField] === undefined ? undefined : labelField(row, config.taglineField, ''),
      monthly: countField(row, config.priceField, 0),
      features: stringArrayField(row, config.featuresField),
      // `promotedTier` overrides the column, and matches on id OR name so a host
      // can promote by either without knowing the table's key strategy.
      promoted:
        config.promotedTier === undefined
          ? (booleanField(row, config.promotedField) ?? false)
          : config.promotedTier === id || config.promotedTier === name,
      current: booleanField(row, config.currentField) ?? false,
    };
  });
}

export function PlanPricingCardsWidget({ config, data, onEvent }: WidgetProps<PlanPricingCardsConfig>) {
  const t = useMaybeT();
  const plans = useMemo(() => plansOf(config, data), [config, data]);

  if (plans.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.planPricingCards.emptyTitle', 'No plans')}
        body={config.emptyBody ?? t('ui:widgets.domain.planPricingCards.emptyBody', 'Bind a plans table with a name and a monthly price.')}
      />
    );
  }

  return (
    <PlanPricingCardsView
      plans={plans}
      annualDiscount={config.annualDiscount}
      period={config.period}
      selectable={config.selectable}
      {...(config.format?.currency === undefined ? {} : { currency: config.format.currency })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.ctaLabel === undefined ? {} : { ctaLabel: config.ctaLabel })}
      {...(config.currentLabel === undefined ? {} : { currentLabel: config.currentLabel })}
      {...(config.popularLabel === undefined ? {} : { popularLabel: config.popularLabel })}
      {...(config.monthlyLabel === undefined ? {} : { monthlyLabel: config.monthlyLabel })}
      {...(config.annualLabel === undefined ? {} : { annualLabel: config.annualLabel })}
      {...(config.perMonthLabel === undefined ? {} : { perMonthLabel: config.perMonthLabel })}
      {...(config.billedAnnuallyLabel === undefined ? {} : { billedAnnuallyLabel: config.billedAnnuallyLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // Checkout is the host's; the CTA is a navigation intent, never a purchase.
      {...(config.href === undefined
        ? {}
        : {
            onSelect: (planId: string) => {
              void onEvent({ type: 'drill-through', href: `${config.href as string}?plan=${encodeURIComponent(planId)}` });
            },
          })}
    />
  );
}
