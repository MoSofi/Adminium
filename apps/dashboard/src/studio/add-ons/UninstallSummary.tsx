// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What removing an add-on takes with it, said BEFORE anybody confirms — and
 * the one deliberate extra: deleting the tables it made.
 *
 * An add-on that keeps tables of its own leaves with its pages, its roles and
 * its rules; its tables stay, with every row, unless the person ticks the box
 * and types its key. While a rule still hands rows to it, it cannot be
 * removed at all, and this says which rule.
 */
import { Alert, Checkbox, FormField, Input } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { UninstallPlan } from './addOnsApi.js';

/** Whether the removal may be confirmed as the form stands. */
export function uninstallAllowed(plan: UninstallPlan | null, drop: boolean, typed: string): boolean {
  if (plan === null) return false;
  if (plan.inUse.postings.length + plan.inUse.features.length > 0) return false;
  return !drop || typed === plan.key;
}

export function UninstallSummary({
  plan,
  drop,
  typed,
  onDrop,
  onTyped,
}: {
  plan: UninstallPlan;
  drop: boolean;
  typed: string;
  onDrop: (next: boolean) => void;
  onTyped: (next: string) => void;
}) {
  const inUse = [
    ...plan.inUse.postings.map((posting) =>
      posting.posting === 'price'
        ? t('studio:addOns.uninstall.inUsePrice', 'The price rule on “{table}” asks it for prices.', { table: posting.table })
        : t('studio:addOns.uninstall.inUsePosting', 'A rule on “{table}” hands rows to it.', { table: posting.table }),
    ),
    ...plan.inUse.features.map((feature) => t('studio:addOns.uninstall.inUseFeature', '{app} uses it for “{feature}”. Switch it off for {app} first.', { app: feature.name, feature: feature.feature })),
  ];
  if (inUse.length > 0) {
    return (
      <Alert tone="danger" title={t('studio:addOns.uninstall.inUseTitle', 'It is still in use')}>
        <ul className="list-disc ps-4">
          {inUse.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Alert>
    );
  }
  if (!plan.likeApp) return null;
  const members = plan.roles.reduce((sum, role) => sum + role.members, 0);
  const droppable = plan.tables.filter((table) => table.droppable).map((table) => table.table);
  const lines = [
    plan.pages.removed.length > 0 ? t('studio:addOns.uninstall.pages', 'Its pages go: {names}.', { names: plan.pages.removed.join(', ') }) : null,
    plan.pages.kept.length > 0 ? t('studio:addOns.uninstall.pagesKept', 'Pages you edited stay, as your own: {names}.', { names: plan.pages.kept.join(', ') }) : null,
    plan.roles.length > 0
      ? t('studio:addOns.uninstall.roles', 'Its roles go: {names}. People who hold one lose it ({count}).', { names: plan.roles.map((role) => role.slug).join(', '), count: members })
      : null,
    plan.tables.length > 0 ? t('studio:addOns.uninstall.tables', 'Its tables stay, with every row: {names}.', { names: plan.tables.map((table) => table.table).join(', ') }) : null,
  ].filter((line): line is string => line !== null);
  return (
    <div className="flex flex-col gap-3" data-part="add-on-uninstall-plan">
      <ul className="list-disc ps-4 text-sm text-fg-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {droppable.length > 0 && (
        <>
          <label className="flex items-start gap-2 text-sm text-fg">
            <Checkbox className="mt-0.5" checked={drop} onCheckedChange={(next) => onDrop(next === true)} />
            <span>{t('studio:addOns.uninstall.drop', 'Also delete its tables and everything in them. This cannot be undone.')}</span>
          </label>
          {drop && (
            <FormField label={t('studio:addOns.uninstall.type', 'Type {key} to delete its tables', { key: plan.key })}>
              <Input value={typed} onChange={(event) => onTyped(event.target.value)} autoComplete="off" />
            </FormField>
          )}
        </>
      )}
    </div>
  );
}
