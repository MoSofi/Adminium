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
 *  - Upgrade (only with the operator's address set) opens that address in
 *    the same tab: the operator's page brings the person back here.
 *
 * Loaded only on a trial (`TrialMount.tsx`), its words the deferred `trial`
 * group of `common`: nothing here reaches the entry chunk.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleArrowUp, FlaskConical, Hourglass, Lock } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, DropdownMenuItem, DropdownMenuSeparator } from '@adminium/ui';
import { setWriteLock } from '@adminium/widgets';

import { showsDeployLink, systemInfoQuery, type TrialInfo } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';

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

/** "Read-only" after the page title, once the trial has ended. */
export function ReadOnlyChip(): ReactNode {
  return (
    <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-surface-3 px-[9px] py-0.5 text-[11.5px] font-bold text-fg-muted" data-testid="trial-read-only">
      <Lock aria-hidden="true" className="size-3" />
      {t('trial.readOnlyChip', 'Read-only')}
    </span>
  );
}

/** Beside the title in the Topbar: the chip goes where pages put theirs (the slot the Topbar, drawn first, holds). */
function TitleChip(): ReactNode {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector('[data-part="topbar-title-adornment"]')), []);
  return slot === null ? null : createPortal(<ReadOnlyChip />, slot);
}

export function TrialStrips({ shell = false }: { shell?: boolean }): ReactNode {
  useCommonWords();
  const trial = useQuery(systemInfoQuery()).data?.trial;
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
        {shell ? <TitleChip /> : null}
      </>
    );
  }

  const days = daysLeftAt(trial, now) ?? 1;
  return (
    <>
      <div
        role="note"
        className={`${STRIP} gap-x-[9px] border-[color-mix(in_srgb,var(--warn)_22%,transparent)] bg-warn-soft py-1.5 text-fg sm:py-2`}
        data-testid="trial-test-environment"
      >
        <FlaskConical aria-hidden="true" className="size-[15px] shrink-0 text-warn" />
        {/* The whole sentence on every width: on a phone it wraps rather than shortening. */}
        <span className="min-w-0 flex-1">{t('trial.testEnvironment', 'This is a test environment. Please don’t put real customer data in.')}</span>
      </div>
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
