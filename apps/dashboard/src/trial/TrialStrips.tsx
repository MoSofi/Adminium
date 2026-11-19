// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode on screen: the two strips under the Topbar (and above the
 * sign-in and setup cards), the one strip once the trial has ended, the
 * read-only state, and the Upgrade entry points.
 *
 *  - Running: "This is a test environment. Please don’t put real customer
 *    data in." (`role="note"`, the full sentence on every width, wrapping on
 *    a phone), then "N days left · Export everything [· Upgrade]". Neither
 *    can be closed.
 *  - Ended (from `endsAt`, never a count of 0): one strip, `role="status"`,
 *    "This trial has ended. · Export everything [· Upgrade]". In the shell the
 *    page title gains a "Read-only" chip and every create, edit, delete and
 *    save control the page templates draw is locked with the reason
 *    (`setWriteLock`, @adminium/widgets); the server refuses the write itself.
 *  - On the visitor's own database (an operator project's `yours`): "Using
 *    your database at {host}" in place of the test-environment line (D2), or
 *    "Can’t reach your database at {host}: why" while it is down, with Change
 *    (adminium.app's account page, where it was connected). Before sign-in
 *    the host is not known (`/system/info` never names it): the line says
 *    "your own database".
 *  - Upgrade (only with the operator's address set) opens that address in
 *    the same tab: the operator's page brings the person back here.
 *
 * Loaded only on a trial (`TrialMount.tsx`), its words the deferred `trial`
 * group of `common`: nothing here reaches the entry chunk.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleArrowUp, Database, FlaskConical, Hourglass, Lock } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Button, Card, DropdownMenuItem, DropdownMenuSeparator } from '@adminium/ui';
import { setWriteLock } from '@adminium/widgets';

import { bootstrapQuery } from '../app/bootstrap.js';
import { showsDeployLink, systemInfoQuery, type OwnDatabaseInfo, type OwnDatabaseReason, type TrialInfo } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { TitleReadOnlyChip } from './ReadOnlyChip.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest a browser timer waits. */
const MAX_TIMER_MS = 2_147_483_647;
export const EXPORT_PATH = '/studio/settings/export';

/**
 * Where the trial stands at `now`: `off` (no trial, or an older server),
 * `running`, or `ended` (at or past `endsAt`). Read from the end date, so a
 * reply the page has held for hours still ends on time.
 */
export function trialState(trial: TrialInfo | undefined, now: number = Date.now()): 'off' | 'running' | 'ended' {
  if (trial === undefined || !trial.on) return 'off';
  const end = trial.endsAt === null ? Number.NaN : Date.parse(trial.endsAt);
  return Number.isFinite(end) && now >= end ? 'ended' : 'running';
}

/** Whole days left, a part day counting as one, as the server counts them; null once ended or without a date. */
export function daysLeftAt(trial: TrialInfo, now: number): number | null {
  const end = trial.endsAt === null ? Number.NaN : Date.parse(trial.endsAt);
  if (!Number.isFinite(end) || now >= end) return null;
  return Math.ceil((end - now) / DAY_MS);
}

/** The time, moved on whenever the count of days or the state changes, so an open page ends on time. */
function useTrialNow(trial: TrialInfo | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const end = trial?.endsAt === null || trial?.endsAt === undefined ? Number.NaN : Date.parse(trial.endsAt);
  useEffect(() => {
    if (!Number.isFinite(end) || now >= end) return undefined;
    const untilChange = (end - now) % DAY_MS || DAY_MS;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(untilChange + 50, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [end, now]);
  return now;
}

const STRIP = 'flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b px-3 text-[12px] font-semibold sm:px-7 sm:text-[12.5px]';
const DOT = <span aria-hidden="true">·</span>;

function ExportLink(): ReactNode {
  return (
    <Link to={EXPORT_PATH} className="whitespace-nowrap font-bold text-accent hover:underline" data-testid="trial-export">
      {t('trial.exportEverything', 'Export everything')}
    </Link>
  );
}

/** The strip's Upgrade: a small primary button that leaves for the operator's page in this tab. */
function UpgradeButton({ url }: { url: string }): ReactNode {
  return (
    <a
      href={url}
      className="shrink-0 whitespace-nowrap rounded-[8px] bg-accent px-[11px] py-1 text-[12px] font-bold text-accent-fg hover:bg-accent-hover"
      data-testid="trial-upgrade"
    >
      {t('trial.upgrade', 'Upgrade')}
    </a>
  );
}

/** What the own-database strip shows: the host only from the signed-in bootstrap, the state from either reply. */
export interface OwnDatabaseLine {
  state: OwnDatabaseInfo['state'];
  reason: OwnDatabaseReason | null;
  host: string | null;
  editUrl: string | null;
}

export function ownDatabaseLine(
  signedIn: (OwnDatabaseInfo & { host: string; editUrl: string | null }) | undefined,
  open: OwnDatabaseInfo | null | undefined,
): OwnDatabaseLine | null {
  if (signedIn !== undefined) return { state: signedIn.state, reason: signedIn.reason, host: signedIn.host, editUrl: signedIn.editUrl };
  if (open === undefined || open === null) return null;
  return { state: open.state, reason: open.reason, host: null, editUrl: null };
}

/** A reason class in the person's words. */
export function ownDatabaseReasonWords(reason: OwnDatabaseReason | null): string {
  switch (reason) {
    case 'auth':
      return t('trial.ownDatabaseReason.auth', 'the user name or password was refused');
    case 'dns':
      return t('trial.ownDatabaseReason.dns', 'its address cannot be found');
    case 'tls':
      return t('trial.ownDatabaseReason.tls', 'the secure connection failed');
    case 'refused-by-us':
      return t('trial.ownDatabaseReason.refusedByUs', 'this server does not connect to that address');
    case 'ipv6-only':
      return t('trial.ownDatabaseReason.ipv6Only', 'it can be reached over IPv6 only');
    case 'no-database':
      return t('trial.ownDatabaseReason.noDatabase', 'the database does not exist');
    case 'no-permission':
      return t('trial.ownDatabaseReason.noPermission', 'this login may not read it');
    case 'empty':
      return t('trial.ownDatabaseReason.empty', 'it has no tables');
    case 'unreachable':
    case null:
      return t('trial.ownDatabaseReason.unreachable', 'it does not answer');
  }
}

/** "Using your database at db.example.com", or "Can’t reach your database at …: why", with Change when signed in. */
function OwnDatabaseStrip({ own }: { own: OwnDatabaseLine }): ReactNode {
  const down = own.state === 'down';
  const reason = ownDatabaseReasonWords(own.reason);
  const words = down
    ? own.host === null
      ? t('trial.ownDatabaseDownNoHost', 'Can’t reach your database: {reason}', { reason })
      : t('trial.ownDatabaseDown', 'Can’t reach your database at {host}: {reason}', { host: own.host, reason })
    : own.host === null
      ? t('trial.ownDatabaseNoHost', 'Using your own database')
      : t('trial.ownDatabase', 'Using your database at {host}', { host: own.host });
  return (
    <div
      role={down ? 'status' : 'note'}
      className={`${STRIP} gap-x-[9px] py-1.5 text-fg sm:py-2 ${
        down ? 'border-[color-mix(in_srgb,var(--danger)_22%,transparent)] bg-danger-soft' : 'border-border bg-accent-soft'
      }`}
      data-testid="trial-own-database"
      data-state={own.state}
    >
      <Database aria-hidden="true" className={`size-[15px] shrink-0 ${down ? 'text-danger' : 'text-accent'}`} />
      {/* The host may be long: it wraps on a phone rather than being cut. */}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{words}</span>
      {own.editUrl === null ? null : (
        <a href={own.editUrl} className="whitespace-nowrap font-bold text-accent hover:underline" data-testid="trial-own-database-change">
          {t('trial.ownDatabaseChange', 'Change')}
        </a>
      )}
    </div>
  );
}

export function TrialStrips({ shell = false }: { shell?: boolean }): ReactNode {
  useCommonWords();
  const info = useQuery(systemInfoQuery());
  // Cache read only: signed in, the shell has the bootstrap already; on the sign-in and setup pages there is none.
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const trial = info.data?.trial;
  const now = useTrialNow(trial);
  const state = trialState(trial, now);
  const ended = state === 'ended';

  // The page templates' write controls: locked while the shell shows an ended trial, open again after.
  useEffect(() => {
    if (!shell) return undefined;
    setWriteLock(ended ? t('trial.readOnly', 'Read-only: this trial has ended') : null);
    return () => setWriteLock(null);
  }, [shell, ended]);

  if (trial === undefined || state === 'off') return null;
  const upgrade = trial.upgradeUrl;

  if (ended) {
    return (
      <>
        <div role="status" className={`${STRIP} border-border-strong bg-surface-3 py-[7px] text-fg-muted`} data-testid="trial-ended">
          <Lock aria-hidden="true" className="size-[15px] shrink-0" />
          <span className="font-bold text-fg">{t('trial.ended', 'This trial has ended.')}</span>
          {DOT}
          <ExportLink />
          {upgrade === null ? null : (
            <>
              {DOT}
              <UpgradeButton url={upgrade} />
            </>
          )}
        </div>
        {shell ? <TitleReadOnlyChip /> : null}
      </>
    );
  }

  const days = daysLeftAt(trial, now) ?? 1;
  // A trial on the visitor's own database says so in place of "test environment" (D2): with its host once signed in.
  const own = ownDatabaseLine(boot.data?.ownDatabase, info.data?.ownDatabase);
  return (
    <>
      {own === null ? (
        <div
          role="note"
          className={`${STRIP} gap-x-[9px] border-[color-mix(in_srgb,var(--warn)_22%,transparent)] bg-warn-soft py-1.5 text-fg sm:py-2`}
          data-testid="trial-test-environment"
        >
          <FlaskConical aria-hidden="true" className="size-[15px] shrink-0 text-warn" />
          {/* The whole sentence on every width: on a phone it wraps rather than shortening. */}
          <span className="min-w-0 flex-1">{t('trial.testEnvironment', 'This is a test environment. Please don’t put real customer data in.')}</span>
        </div>
      ) : (
        <OwnDatabaseStrip own={own} />
      )}
      <div role="note" className={`${STRIP} border-border bg-surface-2 py-1.5 text-fg-muted`} data-testid="trial-days">
        <Hourglass aria-hidden="true" className="size-[15px] shrink-0" />
        <span className="whitespace-nowrap text-fg">{t('trial.daysLeft', '{count, plural, one {# day left} other {# days left}}', { count: days })}</span>
        {DOT}
        <ExportLink />
        {upgrade === null ? null : (
          <>
            {DOT}
            <UpgradeButton url={upgrade} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * The Topbar user menu's Upgrade, when the operator set where it goes: first
 * in the group with "Put this online…" (which brings the group's line; alone,
 * it draws its own), accent and bold, same tab.
 */
export function UpgradeMenuItem(): ReactNode {
  useCommonWords();
  const info = useQuery(systemInfoQuery()).data;
  const url = info?.trial?.upgradeUrl ?? null;
  if (url === null) return null;
  return (
    <>
      {showsDeployLink(info) ? null : <DropdownMenuSeparator />}
      <DropdownMenuItem
        icon={<CircleArrowUp className="text-accent" />}
        className="font-bold text-accent"
        onSelect={() => window.location.assign(url)}
        data-testid="topbar-upgrade"
      >
        {t('trial.upgrade', 'Upgrade')}
      </DropdownMenuItem>
    </>
  );
}

export interface TrialPartProps {
  /** The shell's strips: they also lock the page's writes once the trial has ended. */
  shell?: true;
  /** The user menu's Upgrade. */
  menu?: true;
  /** A page outside the shell (sign-in, setup), drawn below the strips. */
  frame?: ReactElement<{ className?: string }>;
}

/** What `TrialMount` draws: the menu's Upgrade, or the strips (the shell's lock the page's writes once ended). */
export function TrialPart({ shell, menu }: Omit<TrialPartProps, 'frame'>): ReactNode {
  return menu === true ? <UpgradeMenuItem /> : <TrialStrips shell={shell === true} />;
}

/** The Export page's Upgrade card: keep this installation as it is. Shown on a trial with the operator's address set. */
export function UpgradeCard({ url }: { url: string }): ReactNode {
  useCommonWords();
  return (
    <Card className="flex flex-wrap items-center gap-3 border-[color-mix(in_srgb,var(--accent)_30%,var(--border))]" data-testid="export-upgrade">
      <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent [&_svg]:size-4">
        <CircleArrowUp />
      </span>
      <div className="min-w-[200px] flex-1">
        <h2 className="text-[14px] font-bold">{t('trial.upgrade', 'Upgrade')}</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('trial.upgradeLine', 'Keep this installation: everything stays as it is.')}</p>
      </div>
      <Button asChild size="md">
        <a href={url}>{t('trial.upgrade', 'Upgrade')}</a>
      </Button>
    </Card>
  );
}
