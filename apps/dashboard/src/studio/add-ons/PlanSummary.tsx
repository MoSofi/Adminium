// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's install plan in words — what installing it WILL do — shared by
 * the Add-ons page's consent dialog and the app settings page's Install, which
 * asks the same consent before an add-on is installed for an app.
 */
import { Alert, Checkbox } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InstallMakes, InstallPlan, PublicAccessCheck } from './addOnsApi.js';

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

/**
 * What an install makes beside its tables, and where the tables go — said
 * before consent, by name: the pages somebody will see in the sidebar, the
 * roles that open them, the lists of choices, the rows its tables start with.
 * Nothing for an add-on that makes none of these.
 */
export function MakesSummary({ makes, database }: { makes: InstallMakes | undefined; database: string | null }) {
  const lines: string[] = [];
  if (database !== null) lines.push(t('studio:addOns.plan.database', 'Its tables go in the database “{name}”.', { name: database }));
  if (makes !== undefined) {
    if (makes.pages.length > 0) lines.push(t('studio:addOns.plan.pages', 'Pages: {names}.', { names: makes.pages.map((page) => page.title).join(', ') }));
    if (makes.roles.length > 0) {
      lines.push(t('studio:addOns.plan.roles', 'Roles: {names}. You are given the first one, so you can open its pages.', { names: makes.roles.map((role) => role.name).join(', ') }));
    }
    if (makes.lists.length > 0) lines.push(t('studio:addOns.plan.lists', 'Lists of choices: {names}.', { names: makes.lists.join(', ') }));
    if (makes.documents > 0) lines.push(t('studio:addOns.plan.documents', 'Document layouts: {count}.', { count: makes.documents }));
    if (makes.seeds) lines.push(t('studio:addOns.plan.seeds', 'Its tables start with a few rows of their own, which are yours to change.'));
  }
  if (lines.length === 0) return null;
  return (
    <div data-part="add-on-plan-makes">
      <p className="text-sm font-semibold text-fg">{t('studio:addOns.plan.makesTitle', 'Installing also adds')}</p>
      <ul className="list-disc ps-4 text-sm text-fg-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the add-on would open to the public, and the one tick that opens it.
 * Unticked — the way it starts — nothing is opened: the add-on is installed
 * and its public entries wait. Somebody who may not hand out API keys is told
 * so, and cannot tick it.
 */
export function PublicAccessChoice({
  access,
  allowed,
  onAllowed,
  busy,
}: {
  access: PublicAccessCheck | undefined;
  allowed: boolean;
  onAllowed: (next: boolean) => void;
  busy: boolean;
}) {
  if (access === undefined) return null;
  const through = access.endpoints.filter((entry) => entry.key !== access.linkKey).map((entry) => entry.ref);
  if (through.length === 0 && access.linkKey === undefined) return null;
  return (
    <div className="flex flex-col gap-2" data-part="add-on-public-access">
      <p className="text-sm font-semibold text-fg">{t('studio:addOns.public.title', 'Public access')}</p>
      <ul className="list-disc ps-4 text-sm text-fg-muted">
        {through.length > 0 && (
          <li>{t('studio:addOns.public.through', 'Your customers can reach it through the public key of an app it is attached to: {refs}.', { refs: through.join(', ') })}</li>
        )}
        {access.linkKey !== undefined && (
          <li>{t('studio:addOns.public.link', 'It makes a link key of its own: whoever holds a link opens that one record, and can only read it.')}</li>
        )}
      </ul>
      <label className="flex items-start gap-2 text-sm text-fg">
        <Checkbox className="mt-0.5" checked={allowed} disabled={busy || !access.canGrant} onCheckedChange={(next) => onAllowed(next === true)} />
        <span>{t('studio:addOns.public.allow', 'Allow public access')}</span>
      </label>
      <p className="text-xs text-fg-muted">
        {access.canGrant
          ? t('studio:addOns.public.allowHelp', 'Left unticked, nothing is opened to the public. You can allow it later.')
          : t('studio:addOns.public.cannot', 'Only someone who may manage API keys can allow this.')}
      </p>
    </div>
  );
}
