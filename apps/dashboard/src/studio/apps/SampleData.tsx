// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's sample data, ported from `Installed Apps.dc.html`: the install
 * step's checkbox, the settings page's card, the Add and Remove dialogs, and
 * the banner on the app's own pages.
 *
 * The banner is loaded lazily from the page templates, through the settings
 * page's chunk: every lazy chunk's name costs the entry a line in its preload
 * table.
 *
 * Adding runs as a job and writes every record or none. Removing reads the
 * database first, and keeps the sample records your own records use and, when
 * ticked, the ones you changed.
 *
 * ─── Departures from the comp ──────────────────────────────────────────────
 *  - The comp describes one café ("a menu, tables, staff…"). Any app can ship
 *    sample data, so the words here are generic and the tables say the rest.
 *  - The Remove dialog names each table by the page that shows it, or by its
 *    table name when no page does, instead of labels written for one app.
 *  - A kept record is named by what it is called now (its label column),
 *    falling back to the bundle's own label.
 *  - The ledger table is not in the Add dialog's list: it is Adminium's own
 *    list of what it added, made on the first add (not at install).
 */
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  ProgressBar,
  Skeleton,
  Spinner,
} from '@adminium/ui';
import { Eraser, ImageIcon, ShieldCheck, Sprout } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { bootstrapQuery, flattenNav, hiddenPagesOf } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { studioMessagesReady } from '../studioMessages.js';
import {
  addSampleData,
  appOverviewKey,
  appOverviewQuery,
  followAppJob,
  removeSampleData,
  sampleDataKey,
  sampleDataQuery,
  sampleRemovePlanQuery,
  type AppOverview,
  type SampleDataStatus,
} from './appsApi.js';

const CARD = 'rounded-[14px] border border-border bg-surface p-[18px] shadow-sm';

function formatters() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

/** Everything that reads the sample data or the tables it lives in. */
export async function refreshSampleData(queryClient: ReturnType<typeof useQueryClient>, appKey: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sampleDataKey(appKey) }),
    queryClient.invalidateQueries({ queryKey: appOverviewKey(appKey) }),
  ]);
}

/** "pos_menu_items", from the app's short name. */
function realName(overview: AppOverview | undefined, ref: string): string {
  return overview?.tables.find((table) => table.ref === ref)?.table ?? ref;
}

/**
 * Follow an add to the end. Resolves with the job's progress along the way;
 * throws the job's own error.
 */
export async function runSampleAdd(
  appKey: string,
  onProgress: (progress: { pct: number; message: string | null }) => void,
): Promise<void> {
  const { jobId } = await addSampleData(appKey);
  await followAppJob(jobId, {
    onProgress,
    failed: t('studio:sampleData.addFailedBody', 'The sample data was not added. Nothing was written.'),
  });
}

// ── The install step ────────────────────────────────────────────────────────

/** Unticked by default: an install writes nothing it was not asked to. */
export function SampleInstallCard({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <section className={CARD} data-testid="install-sample-data">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <Sprout aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">
          {t('studio:sampleData.title', 'Sample data')}
        </span>
      </h3>
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
        <span className="text-[12.5px] leading-[1.5] text-fg-muted">
          <span className="font-bold text-fg">{t('studio:sampleData.add', 'Add sample data')}</span>
          {' — '}
          {t(
            'studio:sampleData.installNote',
            'a few example records in the app’s tables, so there is something to try it with. You can remove it in one click.',
          )}
        </span>
      </label>
    </section>
  );
}

// ── The settings card ───────────────────────────────────────────────────────

/** Drawn only for an app that ships sample data, or has some loaded. */
export function SampleDataCard({ appKey, connectionName }: { appKey: string; connectionName: string | null }) {
  const status = useQuery(sampleDataQuery(appKey));
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = status.data;
  if (data !== undefined && !data.offered && !data.loaded) return null;

  return (
    <section className={CARD} data-testid="app-sample-data">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <Sprout aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-extrabold tracking-[-0.01em]">{t('studio:sampleData.title', 'Sample data')}</span>
      </h3>
      {status.isPending ? <Skeleton height={30} width="60%" /> : null}
      {status.error === null ? null : <p className="text-[12.5px] text-danger">{status.error.message}</p>}
      {data === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <SampleStatusPill status={data} />
          {data.loaded ? (
            <Button variant="secondary" size="sm" onClick={() => setDialog('remove')}>
              <Eraser aria-hidden className="size-[15px]" />
              {t('studio:sampleData.remove', 'Remove sample data')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setDialog('add')}>
              <Sprout aria-hidden className="size-[15px]" />
              {t('studio:sampleData.add', 'Add sample data')}
            </Button>
          )}
        </div>
      )}
      {notice === null ? null : (
        <p role="status" className="mt-3 text-[12.5px] leading-[1.5] text-fg-muted">
          {notice}
        </p>
      )}
      {dialog === 'add' ? (
        <AddSampleDataDialog
          appKey={appKey}
          connectionName={connectionName}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            setNotice(null);
          }}
        />
      ) : null}
      {dialog === 'remove' ? (
        <RemoveSampleDataDialog
          appKey={appKey}
          onClose={() => setDialog(null)}
          onRemoved={(result) => {
            setDialog(null);
            setNotice(
              result.kept === 0
                ? null
                : t(
                    'studio:sampleData.keptNotice',
                    '{count, plural, one {# sample record stays: your own records use it, or you changed it.} other {# sample records stay: your own records use them, or you changed them.}}',
                    { count: result.kept },
                  ),
            );
          }}
        />
      ) : null}
    </section>
  );
}

function SampleStatusPill({ status }: { status: SampleDataStatus }) {
  if (!status.loaded) {
    return <Badge tone="neutral">{t('studio:sampleData.notLoaded', 'Not loaded')}</Badge>;
  }
  return (
    <Badge tone="pos">
      {status.addedAt === null
        ? t('studio:sampleData.loadedCount', 'Loaded · {count, plural, one {# record} other {# records}}', {
            count: status.total,
          })
        : t('studio:sampleData.loaded', 'Loaded · {count, plural, one {# record} other {# records}} · {date}', {
            count: status.total,
            date: formatters().date(status.addedAt, 'medium'),
          })}
    </Badge>
  );
}

// ── Add ─────────────────────────────────────────────────────────────────────

export function AddSampleDataDialog({
  appKey,
  connectionName,
  onClose,
  onAdded,
}: {
  appKey: string;
  connectionName: string | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery(sampleDataQuery(appKey));
  const overview = useQuery(appOverviewQuery(appKey));
  const [progress, setProgress] = useState<{ pct: number; message: string | null } | null>(null);
  const available = status.data?.available ?? null;

  const add = useMutation({
    mutationFn: () => runSampleAdd(appKey, setProgress),
    onSuccess: async () => {
      await refreshSampleData(queryClient, appKey);
      onAdded();
    },
    onSettled: () => setProgress(null),
  });

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
    >
      <ModalHeader
        icon={<Sprout />}
        title={t('studio:sampleData.add', 'Add sample data')}
        subtitle={
          connectionName === null
            ? undefined
            : t('studio:sampleData.addSubtitle', 'Into {connection}', { connection: connectionName })
        }
        closeLabel={t('studio:sampleData.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3.5">
          <p className="text-[13px] leading-[1.55] text-fg-muted">
            {connectionName === null
              ? t('studio:sampleData.addBodyNoConnection', 'A few example records in the app’s tables. Nothing else is touched.')
              : t('studio:sampleData.addBody', 'A few example records in the app’s tables. Nothing else in {connection} is touched.', {
                  connection: connectionName,
                })}
          </p>
          {status.isPending ? <Skeleton height={120} width="100%" /> : null}
          {available === null ? null : (
            <div className="overflow-hidden rounded-[12px] border border-border" data-testid="sample-add-tables">
              <ul>
                {available.tables.map((table) => (
                  <li key={table.ref} className="flex items-center gap-3 border-b border-border px-3.5 py-[9px]">
                    <MonoText className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted">
                      {realName(overview.data, table.ref)}
                    </MonoText>
                    <MonoText className="text-[12.5px] font-bold">{table.count}</MonoText>
                  </li>
                ))}
                {available.assets === 0 ? null : (
                  <li className="flex items-center gap-3 border-b border-border px-3.5 py-[9px]">
                    <ImageIcon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 text-[12.5px] text-fg-muted">
                      {t('studio:sampleData.images', 'Images, added to Files')}
                    </span>
                    <MonoText className="text-[12.5px] font-bold">{available.assets}</MonoText>
                  </li>
                )}
              </ul>
              <div className="flex items-center gap-3 bg-surface-2 px-3.5 py-[11px]">
                <span className="flex-1 text-[12.5px] font-bold">{t('studio:sampleData.total', 'Total')}</span>
                <MonoText className="text-[13px] font-bold">
                  {t('studio:sampleData.records', '{count, plural, one {# record} other {# records}}', {
                    count: available.total,
                  })}
                </MonoText>
              </div>
            </div>
          )}
          {status.data !== undefined && available === null && !status.data.loaded ? (
            <Alert tone="warn" title={t('studio:sampleData.none', 'This app ships no sample data')} />
          ) : null}
          {progress === null ? null : (
            <div className="flex flex-col gap-1.5" role="status">
              <ProgressBar value={progress.pct} label={t('studio:sampleData.adding', 'Adding sample data')} />
              <span className="text-xs text-fg-subtle">
                {t('studio:sampleData.adding', 'Adding sample data')}
              </span>
            </div>
          )}
          {add.error === null ? null : (
            <Alert role="alert" tone="danger" title={t('studio:sampleData.addFailed', 'The sample data was not added')}>
              {add.error.message}
            </Alert>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={add.isPending} onClick={onClose}>
          {t('studio:sampleData.cancel', 'Cancel')}
        </Button>
        <Button disabled={available === null || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Spinner size="sm" /> : <Sprout aria-hidden className="size-[15px]" />}
          {t('studio:sampleData.add', 'Add sample data')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Remove ──────────────────────────────────────────────────────────────────

export function RemoveSampleDataDialog({
  appKey,
  onClose,
  onRemoved,
}: {
  appKey: string;
  onClose: () => void;
  onRemoved: (result: { removed: number; kept: number }) => void;
}) {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const status = useQuery(sampleDataQuery(appKey));
  const overview = useQuery(appOverviewQuery(appKey));
  const plan = useQuery(sampleRemovePlanQuery(appKey));
  const [keepChanged, setKeepChanged] = useState(true);

  const remove = useMutation({
    mutationFn: () => removeSampleData(appKey, keepChanged),
    onSuccess: async (result) => {
      await refreshSampleData(queryClient, appKey);
      // The app's pages show these rows.
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      onRemoved(result);
    },
  });

  /**
   * A table by the page that shows it, else by its name. A page names its
   * table with the schema (`public.pos_menu_items`); the app's list does not.
   */
  const tableLabel = (ref: string): { text: string; mono: boolean } => {
    const table = realName(overview.data, ref);
    const connectionId = overview.data?.connection?.id ?? null;
    const item = [...flattenNav(bootstrap.nav), ...hiddenPagesOf(bootstrap)].find(
      (candidate) =>
        (candidate.connectionId ?? null) === connectionId &&
        (candidate.sourceTable === table || (candidate.sourceTable ?? '').endsWith(`.${table}`)),
    );
    return item === undefined ? { text: table, mono: true } : { text: t(item.labelKey, item.fallback), mono: false };
  };

  const data = plan.data;
  const fmt = formatters();
  const changedNames = (data?.changed ?? []).map((row) => row.title ?? row.label ?? tableLabel(row.ref).text);
  const loaded = status.data;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !remove.isPending) onClose();
      }}
    >
      <ModalHeader
        icon={<Eraser />}
        title={t('studio:sampleData.remove', 'Remove sample data')}
        subtitle={
          loaded === undefined || !loaded.loaded
            ? undefined
            : loaded.addedAt === null
              ? t('studio:sampleData.records', '{count, plural, one {# record} other {# records}}', { count: loaded.total })
              : t(
                  'studio:sampleData.removeSubtitle',
                  '{count, plural, one {# record added on {date}} other {# records added on {date}}}',
                  { count: loaded.total, date: fmt.date(loaded.addedAt, 'medium') },
                )
        }
        closeLabel={t('studio:sampleData.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3.5">
          <p className="text-[13px] leading-[1.55] text-fg-muted">
            {t(
              'studio:sampleData.removeBody',
              'Adminium kept a list of every record it added, so it takes out exactly those.',
            )}
          </p>
          {plan.isPending ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : null}
          {plan.error === null ? null : (
            <Alert tone="danger" title={t('studio:sampleData.planFailed', 'What would be removed could not be read')}>
              {plan.error.message}
            </Alert>
          )}
          {data === undefined ? null : (
            <>
              <div className="overflow-hidden rounded-[12px] border border-border" data-testid="sample-remove-tables">
                <div className="bg-surface-2 px-3.5 py-[9px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-fg-subtle">
                  {t('studio:sampleData.removes', 'Removes')}
                </div>
                <ul>
                  {data.tables.map((table) => {
                    const label = tableLabel(table.ref);
                    return (
                      <li key={table.ref} className="flex items-center gap-3 border-t border-border px-3.5 py-[9px]">
                        {label.mono ? (
                          <MonoText className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted">{label.text}</MonoText>
                        ) : (
                          <span className="min-w-0 flex-1 text-[12.5px] text-fg-muted">{label.text}</span>
                        )}
                        <MonoText className="text-[12.5px] font-bold">{table.count}</MonoText>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {data.kept.length === 0 ? null : (
                <div className="overflow-hidden rounded-[12px] border border-border" data-testid="sample-remove-kept">
                  <div className="bg-pos-soft px-3.5 py-[9px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-pos">
                    {t('studio:sampleData.kept', 'Kept')}
                  </div>
                  <ul>
                    {data.kept.map((row) => (
                      <li
                        key={`${row.ref}:${row.label ?? ''}:${row.title ?? ''}`}
                        className="flex items-start gap-2.5 border-t border-border px-3.5 py-2.5"
                      >
                        <ShieldCheck aria-hidden className="mt-px size-[15px] shrink-0 text-pos" />
                        <span className="text-[12.5px] leading-[1.5] text-fg-muted">
                          <span className="font-bold text-fg">{row.title ?? row.label ?? tableLabel(row.ref).text}</span>
                          {' — '}
                          {t(
                            'studio:sampleData.usedBy',
                            '{count, plural, one {used by # of your own records} other {used by # of your own records}}',
                            { count: row.usedBy },
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.changed.length === 0 ? null : (
                <label className="flex cursor-pointer items-start gap-[11px] rounded-[12px] border border-border px-[15px] py-[13px]">
                  <Checkbox checked={keepChanged} onCheckedChange={(next) => setKeepChanged(next === true)} />
                  <span>
                    <span className="block text-[12.5px] font-bold">
                      {t('studio:sampleData.keepChanged', 'Keep the ones I changed')}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-fg-subtle">
                      {t(
                        'studio:sampleData.changedList',
                        '{count, plural, one {# sample record you edited: {names}.} other {# sample records you edited: {names}.}}',
                        { count: data.changed.length, names: fmt.list(changedNames.slice(0, 6)) },
                      )}
                    </span>
                  </span>
                </label>
              )}
            </>
          )}
          {remove.error === null ? null : (
            <Alert role="alert" tone="danger" title={t('studio:sampleData.removeFailed', 'The sample data was not removed')}>
              {remove.error.message}
            </Alert>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={remove.isPending} onClick={onClose}>
          {t('studio:sampleData.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" disabled={data === undefined || remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? <Spinner size="sm" /> : <Eraser aria-hidden className="size-[15px]" />}
          {t('studio:sampleData.removeConfirm', 'Remove')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── The banner on the app's own pages ───────────────────────────────────────

/**
 * "Sample data is loaded — Remove it" (the comp's sidebar view). Rendered
 * outside the Studio routes that usually load the console's messages, so it
 * waits for them itself.
 */
export function SampleDataBanner({ appKey }: { appKey: string }) {
  use(studioMessagesReady());
  const status = useQuery(sampleDataQuery(appKey));
  const [removing, setRemoving] = useState(false);
  if (status.data?.loaded !== true) return null;
  return (
    <div
      data-testid="app-sample-banner"
      className="mb-3.5 flex flex-wrap items-center gap-[11px] rounded-[11px] border border-accent/25 bg-accent-soft px-3.5 py-2.5"
    >
      <Sprout aria-hidden className="size-[15px] shrink-0 text-accent" />
      <span className="min-w-[150px] flex-1 text-[12.5px] font-semibold text-fg">
        {t('studio:sampleData.banner', 'Sample data is loaded')}
      </span>
      <button
        type="button"
        className="cursor-pointer border-none bg-transparent text-[12.5px] font-bold text-accent"
        onClick={() => setRemoving(true)}
      >
        {t('studio:sampleData.bannerRemove', 'Remove it')}
      </button>
      {removing ? (
        <RemoveSampleDataDialog appKey={appKey} onClose={() => setRemoving(false)} onRemoved={() => setRemoving(false)} />
      ) : null}
    </div>
  );
}
