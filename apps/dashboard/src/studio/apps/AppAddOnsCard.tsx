// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app settings page's "Add-ons" card (`Installed Apps.dc.html`, settings
 * view): every add-on the app names, whether it is here, and the one thing to
 * do about it — open its settings, connect it, install it, or read how to add
 * one this Adminium cannot have.
 *
 * Installing goes through the add-on's own consent — the tables it creates or
 * reuses, and what stands in its way — exactly as on the Add-ons page: the
 * comp installs in one click, but an add-on runs code against the operator's
 * data and that is said before it can. One only in the catalogue is downloaded
 * first. A feature that waits on an add-on says where its pages went: out of
 * the sidebar until the add-on is installed and connected.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, Spinner } from '@adminium/ui';
import { ArrowRight, Download, Info, Link2, Puzzle, ShieldCheck, TriangleAlert } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { docsUrl } from '../../kb/docsLinks.js';
import {
  ADD_ONS_QUERY_KEY,
  ADD_ON_CATALOG_QUERY_KEY,
  addOnCatalogQuery,
  attachAddOn,
  downloadAddOn,
  fetchInstallPlan,
  getAddOnJob,
  installAddOn,
  type InstallPlan,
} from '../add-ons/addOnsApi.js';
import { PlanSummary } from '../add-ons/PlanSummary.js';
import { appSettingsKey, type AppAddOnRow } from './appsApi.js';
import { NeedPill, featureWords, needsVersion, sourceWords, unavailableSourceWords } from './addOnWords.js';

const CARD = 'rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm';
const ROW_BUTTON = 'h-auto gap-1.5 rounded-[9px] px-3 py-2 text-xs font-bold leading-[normal] whitespace-nowrap';

export function AppAddOnsCard({ appKey, appName, rows }: { appKey: string; appName: string; rows: readonly AppAddOnRow[] }) {
  const queryClient = useQueryClient();
  const catalogue = useQuery({ ...addOnCatalogQuery, enabled: rows.some((row) => row.state === 'unavailable') });
  const [consent, setConsent] = useState<{ row: AppAddOnRow; plan: InstallPlan } | null>(null);
  const [progress, setProgress] = useState<{ key: string; pct: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appSettingsKey(appKey) }),
      queryClient.invalidateQueries({ queryKey: ADD_ONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ADD_ON_CATALOG_QUERY_KEY }),
      // A feature's pages come back to the sidebar once its add-on is here.
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  };

  /** Download first when only the catalogue has it, then read its plan for the consent. */
  const prepare = useMutation({
    mutationFn: async (row: AppAddOnRow) => {
      setDone(null);
      if (!row.staged && row.offeredVersion !== null) {
        setProgress({ key: row.key, pct: 0 });
        const { jobId } = await downloadAddOn(row.key, row.offeredVersion);
        for (;;) {
          const job = await getAddOnJob(jobId);
          setProgress({ key: row.key, pct: job.progress?.pct ?? 0 });
          if (job.status === 'succeeded') break;
          if (job.status === 'failed' || job.status === 'cancelled') {
            throw new Error(job.lastError ?? t('studio:addOns.job.failed', 'The download did not finish. Nothing was installed.'));
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      return { row, plan: await fetchInstallPlan(row.key) };
    },
    onSuccess: (next) => setConsent(next),
    onSettled: () => setProgress(null),
  });

  const install = useMutation({
    mutationFn: (row: AppAddOnRow) => installAddOn({ key: row.key, version: row.offeredVersion ?? '', attachTo: [appKey] }),
    onSuccess: async (_, row) => {
      setConsent(null);
      setDone(t('studio:appAddOns.card.installed', '{addOn} installed and connected to {app}', { addOn: row.name, app: appName }));
      await refresh();
    },
  });

  const connect = useMutation({
    mutationFn: (row: AppAddOnRow) => attachAddOn(row.key, appKey),
    onSuccess: async (_, row) => {
      setDone(t('studio:appAddOns.card.connected', '{addOn} connected to {app}', { addOn: row.name, app: appName }));
      await refresh();
    },
  });

  const busy = prepare.isPending || install.isPending || connect.isPending;
  const failure = prepare.error ?? connect.error;

  return (
    <section className={CARD} data-testid="app-add-ons">
      <h3 className="mb-[13px] flex items-center gap-[9px]">
        <Puzzle aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-extrabold leading-[normal] tracking-[-0.01em]">{t('studio:appAddOns.title', 'Add-ons')}</span>
      </h3>
      <ul className="flex flex-col gap-[9px]">
        {rows.map((row) => (
          <AddOnRow
            key={row.key}
            row={row}
            appName={appName}
            catalogueOn={catalogue.data?.onlineEnabled ?? null}
            busy={busy}
            progress={progress?.key === row.key ? progress.pct : null}
            onInstall={() => prepare.mutate(row)}
            onConnect={() => connect.mutate(row)}
          />
        ))}
      </ul>
      {done === null ? null : (
        <p role="status" className="mt-2.5 text-[12.5px] font-semibold text-pos">
          {done}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {failure.message}
        </p>
      )}
      {consent === null ? null : (
        <Modal open onOpenChange={(next) => !next && !install.isPending && setConsent(null)}>
          <ModalHeader
            icon={<ShieldCheck />}
            title={t('studio:addOns.consent.title', 'Install {name}', { name: consent.row.name })}
            subtitle={t('studio:addOns.consent.subtitle', 'What this add-on will do, before it can do it.')}
            closeLabel={t('studio:addOns.consent.close', 'Close')}
          />
          <ModalBody>
            <div className="flex flex-col gap-3">
              <PlanSummary plan={consent.plan} />
              <p className="text-[12.5px] text-fg-muted">
                {t('studio:appAddOns.card.consentConnect', 'It will be connected to {app}.', { app: appName })}
              </p>
              {install.error === null ? null : (
                <p role="alert" className="text-[12.5px] text-danger">
                  {install.error.message}
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" disabled={install.isPending} onClick={() => setConsent(null)}>
              {t('studio:addOns.consent.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={
                install.isPending ||
                !consent.plan.installable ||
                consent.plan.reuse.some((table) => table.missingColumns.length > 0)
              }
              onClick={() => install.mutate(consent.row)}
            >
              {install.isPending ? <Spinner size="sm" /> : <Download aria-hidden className="size-3.5" />}
              {t('studio:addOns.consent.confirm', 'Install')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}

function AddOnRow({
  row,
  appName,
  catalogueOn,
  busy,
  progress,
  onInstall,
  onConnect,
}: {
  row: AppAddOnRow;
  appName: string;
  catalogueOn: boolean | null;
  busy: boolean;
  progress: number | null;
  onInstall: () => void;
  onConnect: () => void;
}) {
  const here = row.installedVersion !== null;
  // An outdated row's `source` is where the NEWER version would come from, so it is not said of the installed one.
  const meta = here
    ? row.state === 'outdated'
      ? t('studio:appAddOns.card.metaOld', 'Installed · v{version}', { version: row.installedVersion ?? '' })
      : t('studio:appAddOns.card.metaInstalled', 'Installed · v{version} · {source}', {
          version: row.installedVersion ?? '',
          source: sourceWords(row.source),
        })
    : row.state === 'unavailable'
      ? t('studio:appAddOns.card.metaUnavailable', 'Not installed · {source}', { source: unavailableSourceWords(catalogueOn) })
      : t('studio:appAddOns.card.metaAbsent', 'Not installed · v{version} · {source}', {
          version: row.offeredVersion ?? '',
          source: sourceWords(row.source),
        });
  const featureOff = row.need === 'feature' && row.state !== 'attached';

  return (
    <li
      className="flex flex-wrap items-center gap-[11px] rounded-[11px] border border-border bg-surface-2 px-[13px] py-[11px]"
      data-add-on={row.key}
      data-state={row.state}
    >
      <Puzzle aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <div className="min-w-[150px] flex-1">
        <div className="flex flex-wrap items-center gap-[7px]">
          <span className="text-[12.5px] font-bold">{row.name}</span>
          <NeedPill need={row.need} features={row.features} />
        </div>
        <p className="mt-[3px] text-[11.5px] text-fg-subtle">{meta}</p>
        {row.state === 'outdated' ? (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] font-bold text-warn" data-part="add-on-note">
            <TriangleAlert aria-hidden className="mt-px size-[13px] shrink-0" />
            {needsVersion(appName, row.range)}
          </p>
        ) : row.state === 'installed' ? (
          <p className="mt-1 text-[11.5px] text-fg-muted" data-part="add-on-note">
            {t('studio:appAddOns.card.notConnected', 'Not connected to {app}', { app: appName })}
          </p>
        ) : null}
        {featureOff ? (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-info" data-part="add-on-feature-off">
            <Info aria-hidden className="mt-px size-[13px] shrink-0" />
            {t(
              'studio:appAddOns.card.featureOff',
              '{features} is off: its pages are not in the sidebar until {addOn} is installed and connected.',
              { features: featureWords(row.features), addOn: row.name },
            )}
          </p>
        ) : null}
        {progress === null ? null : (
          <p role="status" className="mt-1 text-[11.5px] text-fg-muted">
            {t('studio:appAddOns.downloading', 'Downloading… {pct}%', { pct: Math.round(progress) })}
          </p>
        )}
      </div>
      {row.state === 'attached' || row.state === 'outdated' ? (
        <Button variant="secondary" size="sm" className={ROW_BUTTON} asChild>
          <Link to="/studio/add-ons" hash={`add-on-${row.key}`}>
            {t('studio:appAddOns.card.openSettings', 'Open its settings')}
            <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
          </Link>
        </Button>
      ) : row.state === 'installed' ? (
        <Button size="sm" className={ROW_BUTTON} disabled={busy} onClick={onConnect}>
          <Link2 aria-hidden className="size-3.5" />
          {t('studio:appAddOns.card.connect', 'Connect')}
        </Button>
      ) : row.state === 'absent' ? (
        <Button size="sm" className={ROW_BUTTON} disabled={busy} onClick={onInstall}>
          {progress === null ? <Download aria-hidden className="size-3.5" /> : <Spinner size="sm" />}
          {t('studio:appAddOns.card.install', 'Install')}
        </Button>
      ) : (
        <a
          href={docsUrl('self-hosting/installing-add-ons')}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-[5px] text-xs font-bold text-accent"
        >
          {t('studio:appAddOns.howTo', 'How to add an add-on')}
          <ArrowRight aria-hidden className="size-[13px] rtl:-scale-x-100" />
        </a>
      )}
    </li>
  );
}
