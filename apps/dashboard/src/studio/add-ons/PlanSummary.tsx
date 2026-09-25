// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's install plan in words — what installing it WILL do — shared by
 * the Add-ons page's consent dialog and the app settings page's Install, which
 * asks the same consent before an add-on is installed for an app.
 */
import { Alert } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InstallPlan } from './addOnsApi.js';

/**
 * The plan, rendered as prose an operator can act on.
 *
 * Every branch says what WILL happen rather than what the API returned, because
 * this is the moment consent is given and a field name is not consent.
 */
export function PlanSummary({ plan }: { plan: InstallPlan }) {
  if (!plan.installable) {
    return (
      <Alert tone="danger" title={t('studio:addOns.plan.blocked', 'This cannot be installed here')}>
        <ul className="list-disc ps-4">
          {plan.problems.map((problem) => (
            <li key={`${problem.table}.${problem.column ?? ''}`}>{problem.message}</li>
          ))}
        </ul>
      </Alert>
    );
  }
  // A table that EXISTS but lacks columns the add-on needs is refused, and this
  // says why rather than offering a button that fails: creating a table an
  // add-on asked for is one thing, altering one the operator already owns is a
  // different one that install will not do on their behalf.
  const incomplete = plan.reuse.filter((table) => table.missingColumns.length > 0);
  if (incomplete.length > 0) {
    return (
      <Alert
        tone="danger"
        title={t('studio:addOns.plan.needsColumns', 'This add-on needs columns you do not have')}
      >
        {t(
          'studio:addOns.plan.needsColumnsBody',
          'Adminium will not add columns to tables you already own. Add them yourself, then install.',
        )}{' '}
        <strong>
          {incomplete
            .map((table) => `${table.ref} (${table.missingColumns.join(', ')})`)
            .join('; ')}
        </strong>
      </Alert>
    );
  }
  if (plan.create.length > 0) {
    // Named, and named BEFORE consent. Installing this writes to the operator's
    // own database, which is the single most consequential thing on this page.
    return (
      <Alert
        tone="warn"
        title={t('studio:addOns.plan.willCreate', 'This will create tables in your database')}
      >
        {t(
          'studio:addOns.plan.willCreateBody',
          'Installing creates these tables. Uninstalling later leaves them, and their data, alone.',
        )}{' '}
        <strong>{plan.create.map((table) => table.ref).join(', ')}</strong>
      </Alert>
    );
  }
  if (!plan.touchesData) {
    return (
      <p className="text-sm text-fg-muted">
        {t('studio:addOns.plan.noData', 'This add-on reads and writes no tables of its own.')}
      </p>
    );
  }
  return (
    <p className="text-sm text-fg-muted">
      {t('studio:addOns.plan.reuse', 'This add-on will use tables you already have:')}{' '}
      <strong>{plan.reuse.map((table) => table.ref).join(', ')}</strong>
    </p>
  );
}
