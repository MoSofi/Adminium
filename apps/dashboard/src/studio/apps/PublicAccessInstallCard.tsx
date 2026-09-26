// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's "Public access" card: what the app's customer screens
 * will be able to do through the public API, one line per thing, and the
 * operator's say on it — allowed by default, since the app does not work
 * for its guests without it, and narrowed later on the API keys page.
 *
 * Someone who may not manage API keys sees why the box is off: the app
 * installs without public access.
 */
import { Checkbox, MonoText } from '@adminium/ui';
import { AlertTriangle, Dot, Globe } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AppInstallPlan } from './appsApi.js';

type PublicAccessPlan = NonNullable<AppInstallPlan['publicAccess']>;
type PlannedEndpoint = PublicAccessPlan['endpoints'][number];

const CARD = 'rounded-[14px] border border-border bg-surface p-[18px] shadow-sm';

/** `menu_items` → "menu items". */
const human = (table: string) => table.replace(/_/g, ' ');

/** What one endpoint lets a guest do, a line per method. */
function linesOf(endpoint: PlannedEndpoint): string[] {
  const table = human(endpoint.table);
  if (endpoint.kind === 'availability' || endpoint.pending) {
    return [t('studio:appPublicAccess.availability', 'Read free or full times of {table}', { table })];
  }
  return endpoint.methods.map((method) => {
    if (method === 'GET' && endpoint.claim !== null) {
      return t('studio:appPublicAccess.claim', 'Look up their own {table} by {fields}', {
        table,
        fields: endpoint.claim.map(human).join(', '),
      });
    }
    if (method === 'POST') {
      return endpoint.confirms === true
        ? t('studio:appPublicAccess.createConfirmed', 'Add to {table}, and get a confirmation email', { table })
        : t('studio:appPublicAccess.create', 'Add to {table}', { table });
    }
    if (method === 'PATCH') return t('studio:appPublicAccess.update', 'Change {table}', { table });
    return t('studio:appPublicAccess.read', 'Read {table}', { table });
  });
}

function warningText(code: string, message: string): string {
  switch (code) {
    case 'PUBLIC_API_OFF':
      return t('studio:appPublicAccess.warning.apiOff', 'The public API is switched off, so none of this answers until it is on.');
    case 'ORIGIN_SELF_MISSING':
      return t(
        'studio:appPublicAccess.warning.originSelf',
        'The allowed origins do not include “self”, so the app’s own pages on this server cannot call it.',
      );
    case 'NO_EMAIL':
      return t(
        'studio:appPublicAccess.warning.noEmail',
        'Email is not set up, so guests will not be sent a confirmation.',
      );
    case 'NO_EMAIL_SIGN_IN':
      return t(
        'studio:appPublicAccess.warning.noEmailSignIn',
        'Email is not set up, so nobody can be sent a sign-in link.',
      );
    case 'NO_PUBLIC_ADDRESS':
      return t(
        'studio:appPublicAccess.warning.noPublicAddress',
        'This app has no public address, so no sign-in link can be sent. Map a domain to its customer side, or set the server’s public address.',
      );
    case 'NO_TIME_ZONE':
      return t(
        'studio:appPublicAccess.warning.timeZone',
        'This database has no time zone set, which the public API needs for dates and times.',
      );
    default:
      return message;
  }
}

/** Whether the install may make the app's public access: asked for, allowed, and nothing in the way. */
export function publicAccessBlocked(access: PublicAccessPlan): boolean {
  return !access.canGrant || access.endpoints.some((endpoint) => endpoint.issues.length > 0);
}

export function PublicAccessInstallCard({
  access,
  checked,
  onChange,
}: {
  access: PublicAccessPlan;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const blocked = publicAccessBlocked(access);
  const troubled = access.endpoints.filter((endpoint) => endpoint.issues.length > 0);
  return (
    <section className={CARD} data-testid="install-public-access">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <Globe aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">
          {t('studio:appPublicAccess.title', 'Public access')}
        </span>
      </h3>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
        {t('studio:appPublicAccess.intro', 'The app’s customer screens need to:')}
      </p>
      <ul className="mb-[13px] flex flex-col gap-[7px]">
        {access.endpoints.flatMap((endpoint) =>
          linesOf(endpoint).map((line) => (
            <li key={`${endpoint.ref}:${line}`} className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-fg">
              <Dot aria-hidden className="mt-px size-3.5 shrink-0 text-accent" />
              <span>
                {line}
                {endpoint.pending ? (
                  <span className="text-fg-subtle">
                    {' · '}
                    {t('studio:appPublicAccess.later', 'arrives in a later release')}
                  </span>
                ) : null}
              </span>
            </li>
          )),
        )}
      </ul>
      {(access.opensWithoutStaff ?? []).length > 0 ? (
        <ul className="mb-[13px] flex flex-col gap-1.5" data-role="public-access-opens-without-staff">
          {(access.opensWithoutStaff ?? []).map((key) => (
            <li key={key} className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-warn">
              <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                {t(
                  'studio:appPublicAccess.opensWithoutStaff',
                  'Let anyone with a link open what the {key} key reads, with no staff member signed in',
                  { key },
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {troubled.length > 0 ? (
        <ul className="mb-[13px] flex flex-col gap-1.5" data-role="public-access-issues">
          {troubled.map((endpoint) => (
            <li key={endpoint.ref} className="flex items-start gap-2 text-[12px] leading-[1.45] text-danger">
              <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                <MonoText>{endpoint.ref}</MonoText>: {endpoint.issues.join(' ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <label className={`flex items-start gap-2.5 ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <Checkbox checked={checked && !blocked} disabled={blocked} onCheckedChange={(next) => onChange(next === true)} />
        <span className="text-[12.5px] font-bold">{t('studio:appPublicAccess.allow', 'Allow this public access')}</span>
      </label>
      <p className="ms-7 mt-[7px] text-[11.5px] leading-[1.45] text-fg-subtle">
        {!access.canGrant
          ? t(
              'studio:appPublicAccess.cannotGrant',
              'Only someone who may manage API keys can allow it, so the app installs without it.',
            )
          : t('studio:appPublicAccess.helper', 'You can narrow it later on the API keys page.')}
      </p>
      {access.warnings.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5" data-role="public-access-warnings">
          {access.warnings.map((warning) => (
            <li key={warning.code} className="flex items-start gap-2 text-[12px] leading-[1.45] text-warn">
              <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>{warningText(warning.code, warning.message)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
