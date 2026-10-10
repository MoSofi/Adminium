// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The offer to keep versions, inside the desktop app on a computer with no git:
 * the card above Home's heading, the button that brings it back after "Not
 * now", and the same offer in a dialog for the build page's version menu.
 *
 * Nothing here renders anywhere else: in a browser there is no bridge, in the
 * classic workspace and in an app older than the offer the bridge has no
 * `versions`, and with a git on the computer there is nothing to offer.
 *
 * Nothing is fetched until the person presses "Download git".
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, Download, History, RotateCw, ShieldAlert } from 'lucide-react';
import type { DesktopVersionsApi, DesktopVersionsState } from '@adminium/desktop/api';
import { Modal, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';

/** How often the page asks how far a download is. */
const ASK_MS = 500;

export interface DesktopVersions {
  readonly state: DesktopVersionsState;
  download(): void;
  cancel(): void;
  notNow(): void;
  lookAgain(): void;
  appleTools(): void;
}

/**
 * What the app knows of git here, and the offer's buttons; `null` where there
 * is no offer to make (not the app, not a project, not known yet).
 * `onTurnedOn` is called once when versions come on while the page is open.
 */
export function useDesktopVersions(onTurnedOn?: () => void): DesktopVersions | null {
  const api: DesktopVersionsApi | undefined = getDesktopApi()?.project?.versions;
  const [state, setState] = useState<DesktopVersionsState | null>(null);
  const wasOn = useRef<boolean | null>(null);
  const turnedOn = useRef(onTurnedOn);
  turnedOn.current = onTurnedOn;

  const take = useCallback((next: DesktopVersionsState): void => {
    if (wasOn.current === false && next.on) turnedOn.current?.();
    wasOn.current = next.on;
    setState(next);
  }, []);

  useEffect(() => {
    if (api === undefined) return;
    let live = true;
    void api.state().then(
      (next) => {
        if (live) take(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, take]);

  const downloading = state?.download.phase === 'downloading';
  useEffect(() => {
    if (api === undefined || !downloading) return;
    let live = true;
    const timer = setInterval(() => {
      void api.state().then(
        (next) => {
          if (live) take(next);
        },
        () => undefined,
      );
    }, ASK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, downloading, take]);

  if (api === undefined || state === null) return null;
  const run = (call: () => Promise<DesktopVersionsState>) => (): void => {
    void call().then(take, () => undefined);
  };
  return {
    state,
    download: run(() => api.download()),
    cancel: run(() => api.cancel()),
    notNow: run(() => api.notNow()),
    lookAgain: run(() => api.lookAgain()),
    appleTools: run(() => api.appleTools()),
  };
}

const megabytes = (bytes: number): number => Math.round(bytes / 1_000_000);

function failureWords(reason: 'no-connection' | 'wrong-file' | 'failed'): string {
  if (reason === 'wrong-file') return t('designer:versionsOffer.failed.wrongFile', 'The download did not match what Adminium expected and was deleted.');
  if (reason === 'no-connection') return t('designer:versionsOffer.failed.noConnection', 'Could not reach the internet. Check your connection and try again.');
  return t('designer:versionsOffer.failed.other', 'git could not be set up on this computer.');
}

const PRIMARY = 'inline-flex cursor-pointer items-center gap-[7px] rounded-[10px] border-0 bg-accent px-3.5 py-[9px] text-[13px] font-bold leading-[normal] text-accent-fg hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const QUIET = 'cursor-pointer rounded-[10px] border border-border bg-surface px-3.5 py-[9px] text-[13px] font-bold leading-[normal] text-fg-muted hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent';
export const VERSIONS_PILL = 'inline-flex cursor-pointer items-center gap-[7px] rounded-[20px] border border-border bg-surface px-3 py-[7px] text-[12.5px] font-bold leading-[normal] text-fg-muted hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent';

/** The offer's own three forms: the buttons, the download's bar, or why it did not finish. */
function OfferForms({ versions }: { versions: DesktopVersions }): ReactNode {
  const { state } = versions;
  // Apple's installer was asked for: its link becomes "Look again".
  const [apple, setApple] = useState(false);
  const asked = { apple, setApple };
  return (
    <>
        {state.download.phase === 'idle' ? (
          <>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {state.megabytes === null ? (
                <button type="button" className={PRIMARY} onClick={versions.lookAgain}>
                  <RotateCw aria-hidden="true" className="size-3.5" />
                  {t('designer:versionsOffer.lookAgain', 'Look again')}
                </button>
              ) : (
                <button type="button" className={PRIMARY} onClick={versions.download}>
                  <Download aria-hidden="true" className="size-[15px]" />
                  {t('designer:versionsOffer.download', 'Download git ({size} MB)', { size: state.megabytes })}
                </button>
              )}
              {state.declined ? null : (
                <button type="button" className={QUIET} onClick={versions.notNow}>
                  {t('designer:versionsOffer.notNow', 'Not now')}
                </button>
              )}
            </div>
            {state.megabytes === null ? (
              <p className="m-0 mt-3 text-[12px] leading-normal text-fg-subtle">{t('designer:versionsOffer.noDownload', 'There is no git to download for this kind of computer. Install git yourself, then look again.')}</p>
            ) : null}
            {state.appleTools ? (
              <p className="m-0 mt-3 text-[12px] leading-normal text-fg-subtle">
                {t('designer:versionsOffer.apple', 'Or install Apple’s developer tools (about 1 GB), which include it.')}{' '}
                {asked.apple ? (
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-bold text-accent underline-offset-2 hover:underline" onClick={versions.lookAgain}>
                    {t('designer:versionsOffer.lookAgain', 'Look again')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-bold text-accent underline-offset-2 hover:underline"
                    onClick={() => {
                      asked.setApple(true);
                      versions.appleTools();
                    }}
                  >
                    {t('designer:versionsOffer.appleLink', 'Install Apple’s tools')}
                  </button>
                )}
              </p>
            ) : null}
          </>
        ) : null}

        {state.download.phase === 'downloading' ? (
          <div className="mt-3.5 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={t('designer:versionsOffer.downloading', 'Downloading git')}
              aria-valuemin={0}
              aria-valuemax={megabytes(state.download.total)}
              aria-valuenow={megabytes(state.download.received)}
              className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className="h-full w-[var(--adm-progress)] rounded-full bg-accent transition-[width] duration-300"
                style={{ '--adm-progress': `${String(Math.min(100, Math.round((state.download.received / Math.max(1, state.download.total)) * 100)))}%` }}
              />
            </div>
            <span role="status" className="whitespace-nowrap text-[12.5px] font-semibold text-fg-muted">
              {t('designer:versionsOffer.progress', '{received} of {total} MB', { received: megabytes(state.download.received), total: megabytes(state.download.total) })}
            </span>
            <button type="button" className="cursor-pointer rounded-[9px] border border-border bg-surface px-[13px] py-2 text-[12.5px] font-bold leading-[normal] text-fg-muted hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent" onClick={versions.cancel}>
              {t('designer:versionsOffer.cancel', 'Cancel')}
            </button>
          </div>
        ) : null}

        {state.download.phase === 'failed' ? (
          <>
            <div role="alert" className="mt-3 flex items-start gap-[7px] text-[13px] font-semibold leading-normal text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {failureWords(state.download.reason)}
            </div>
            <div className="mt-3 flex">
              <button type="button" className={PRIMARY} onClick={versions.download}>
                <RotateCw aria-hidden="true" className="size-3.5" />
                {t('designer:versionsOffer.tryAgain', 'Try again')}
              </button>
            </div>
          </>
        ) : null}
    </>
  );
}

const TITLE = (): string => t('designer:versionsOffer.title', 'Keep versions of your work?');
const BODY = (): string => t('designer:versionsOffer.body', 'Adminium uses git to keep a version after every change, so you can go back. This computer has none.');


const cardClass = (failed: boolean): string =>
  `flex w-full items-start gap-3.5 rounded-[14px] border px-5 py-[18px] text-start shadow-sm ${failed ? 'border-danger/35 bg-[color-mix(in_srgb,var(--danger)_5%,var(--surface))]' : 'border-border bg-surface'}`;

/**
 * Home, above the heading: the card while the offer is open, nothing once
 * versions are on, and nothing after "Not now" (the button under the lead
 * brings it back: `reopened`).
 */
export function VersionsCard({ versions, reopened }: { versions: DesktopVersions | null; reopened: boolean }): ReactNode {
  const headingId = useId();
  if (versions === null || versions.state.on) return null;
  const { state } = versions;
  if (state.declined && !reopened && state.download.phase === 'idle') return null;
  const failed = state.download.phase === 'failed';
  return (
    <section aria-labelledby={headingId} className={`${cardClass(failed)} mb-11 max-w-[700px]`}>
      <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-[12px] ${failed ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}>
        {failed ? <ShieldAlert className="size-5" /> : <History className="size-5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 id={headingId} className="m-0 text-[15px] font-extrabold leading-[normal] tracking-[-0.015em] text-fg">
          {TITLE()}
        </h2>
        <p className="m-0 mt-[5px] text-pretty text-[13px] leading-[1.55] text-fg-muted">{BODY()}</p>
        <OfferForms versions={versions} />
      </div>
    </section>
  );
}

/** Home, under the lead, after "Not now": the way back to the offer, for good. */
export function TurnVersionsOn({ versions, reopened, onReopen }: { versions: DesktopVersions | null; reopened: boolean; onReopen: () => void }): ReactNode {
  if (versions === null || versions.state.on || !versions.state.declined || reopened || versions.state.download.phase !== 'idle') return null;
  return (
    <button type="button" className={`${VERSIONS_PILL} mt-3.5`} onClick={onReopen}>
      <History aria-hidden="true" className="size-3.5" />
      {t('designer:versionsOffer.turnOn', 'Turn versions on')}
    </button>
  );
}

/** The build page: the same offer in a dialog, opened from the version menu's "Turn versions on". */
export function VersionsOfferDialog({ versions, open, onOpenChange }: { versions: DesktopVersions; open: boolean; onOpenChange: (open: boolean) => void }): ReactNode {
  // Versions came on: there is nothing left to offer, and the menu shows them.
  useEffect(() => {
    if (open && versions.state.on) onOpenChange(false);
  }, [open, versions.state.on, onOpenChange]);
  const failed = versions.state.download.phase === 'failed';
  return (
    <Modal open={open && !versions.state.on} onOpenChange={onOpenChange} size="md" className="max-w-[520px] rounded-[16px] leading-[normal]">
      <ModalHeader
        closeLabel={t('designer:model.close', 'Close')}
        icon={failed ? <ShieldAlert /> : <History />}
        title={TITLE()}
        subtitle={<p className="m-0 mt-1.5 text-pretty text-[13px] leading-[1.6] text-fg-muted">{BODY()}</p>}
        className="gap-[14px] px-[22px] pb-0 pt-[22px] [&>div:first-child]:size-[38px] [&>div:first-child]:rounded-[11px] [&>div:first-child_svg]:size-[19px]"
      />
      <div className="flex flex-col px-[22px] pb-[22px] ps-[74px]">
        <OfferForms versions={versions} />
      </div>
    </Modal>
  );
}
