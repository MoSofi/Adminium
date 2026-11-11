// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One copy's update, reviewed before it runs: `Install Your Own App.dc.html`
 * part 4 ("Update Fernhill Ops to v1.1.0") and `Apps Per Database.dc.html`
 * part 4b ("Update Invoices on kiln to v1.0.17", "Copy 2 of 2").
 *
 * Every copy of an app runs one version, so a newer file updates each copy in
 * turn, each through this dialog on its own database. It shows what the new
 * version brings there — where the file came from and its fingerprint, the
 * page addresses taken, the tables, the rules that would send data out, the
 * look and languages of the server, what is filled in afterwards, the public
 * access and role grants it adds — and Update sends the answers with the
 * checksum of the check it showed.
 *
 * An update that stopped part way (409 `APP_UPDATE_INCOMPLETE`) is finished by
 * sending it again: the dialog says where it stopped, and "Finish the update"
 * does that.
 *
 * ─── Departures from the comp ──────────────────────────────────────────────
 *
 *  **U1 — no page counts.** The comp's "Pages 22: Kept 4, Replaced 15, Added 2"
 *  needs a page diff the plan does not carry; the dialog shows the one part of
 *  it that asks something, the name clashes, as the install does.
 *
 *  **U2 — "Outside addresses" are every such rule of the new version.** The
 *  plan cannot tell which are new in it, so the card lists them all and says a
 *  new one arrives off and empty while one already here keeps its address.
 */
import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, MonoText, Spinner } from '@adminium/ui';
import { ArrowRight, ArrowUpCircle, RotateCw } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { addOnCatalogQuery, downloadAddOn, getAddOnJob } from '../add-ons/addOnsApi.js';
import { AddOnsInstallCard, addOnBlock, addOnChoicesOf, type AddOnPicks } from './AddOnsInstallCard.js';
import { PublicWiderCard, publicWiderHold } from './PublicWiderCard.js';
import {
  planApp,
  type AppAddOnRow,
  type AppInstallPlan,
  type InstallAnswers,
  type PlannedAppTable,
  type UpdateAnswers,
  type UpdateStoppedDetails,
} from './appsApi.js';
import { CheckHint, TableCheck, type TakenPick } from './InstallCheck.js';
import {
  AfterInstallCard,
  ExistingTablesCard,
  HoldHint,
  InstanceCard,
  NO_INSTANCE_ANSWERS,
  OutsideAddressesCard,
  PageClashesCard,
  WhereItCameFrom,
  existingTables,
  instanceAnswersOf,
  reviewHold,
  type InstanceAnswers,
  type PageAnswer,
} from './installReview.js';
import { RoleGrantsAddedCard } from './PrivacyGrantsCard.js';
import { PublicAccessInstallCard, publicAccessBlocked } from './PublicAccessInstallCard.js';
import { AppsRoleTablesWiderCard, RoleTablesUpdateCard } from './RoleTablesList.js';

/** The grants a new version's roles are given that the running one's were not: the update asks before it gives them. */
export function grantsAddedOf(plan: AppInstallPlan): { privacy: NonNullable<AppInstallPlan['privacyGrants']>; addOn: NonNullable<AppInstallPlan['addOnGrants']> } {
  return {
    privacy: (plan.privacyGrants ?? []).filter((grant) => grant.added === true),
    addOn: (plan.addOnGrants ?? []).filter((grant) => grant.added === true),
  };
}

export const asksGrants = (plan: AppInstallPlan): boolean => {
  const added = grantsAddedOf(plan);
  return added.privacy.length > 0 || added.addOn.length > 0;
};

/** What a new version's roles hold more of add-ons' tables than the running one's: the update asks before it gives it. */
export function roleTablesWider(plan: AppInstallPlan): NonNullable<AppInstallPlan['roleTables']> {
  return (plan.roleTables ?? []).filter((entry) => entry.wider !== undefined);
}

/**
 * The add-ons an update's check shows: each the new version needs updated
 * ("Update it too"), installed with it, or cannot have here. One that is
 * already there as the version needs it is not news, and is not shown.
 */
export function updateAddOnRows(plan: AppInstallPlan): AppAddOnRow[] {
  return (plan.addOns ?? []).filter(
    (row) => row.action === 'update' || row.state === 'outdated' || (row.need === 'requires' && (row.action === 'install' || row.state === 'unavailable')),
  );
}

/** Whether a new version's check has anything to show or ask about its add-ons, or the endpoints it widens. */
export function asksAddOnsOrWider(plan: AppInstallPlan): boolean {
  return updateAddOnRows(plan).length > 0 || (plan.publicWider ?? []).length > 0;
}

/**
 * An add-on the app needs at a newer version that runs on another database
 * too: every copy runs one version, so it is updated on the Add-ons page
 * (each copy in turn) before this app can be.
 */
function EveryCopyFirst({ rows }: { rows: readonly AppAddOnRow[] }) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  const elsewhere = rows.filter((row) => row.problems.some((problem) => problem.code === 'ONE_VERSION_PER_APP'));
  if (elsewhere.length === 0) return null;
  return (
    <Alert tone="warn" title={t('studio:hostedApps.update.everyCopy.title', 'Update the add-on on every database first')} data-part="update-every-copy">
      {t(
        'studio:hostedApps.update.everyCopy.body',
        '{addOns, plural, one {{names} runs} other {{names} run}} on another database too, and every copy runs one version. Update every copy on the Add-ons page, then update this app.',
        { addOns: elsewhere.length, names: elsewhere.map((row) => row.name).join(', ') },
      )}{' '}
      <a
        href="/studio/add-ons"
        className="font-bold text-accent"
        onClick={(event) => {
          if (router === null) return;
          event.preventDefault();
          void router.navigate({ to: '/studio/add-ons' });
        }}
      >
        {t('studio:hostedApps.update.everyCopy.link', 'Open Add-ons')}
      </a>
    </Alert>
  );
}

/** Whether a new version's check has anything to show or ask about its tables. */
export function checkAsks(tables: readonly PlannedAppTable[]): boolean {
  return tables.some((table) => table.class === 'new' || table.class === 'taken' || table.edits.length > 0);
}

/**
 * What a new version adds to what the app's guests can do — the entries its
 * keys would gain, and a staff screen's key it would open to a shared link,
 * for the operator to allow as at install — or null when it adds nothing.
 */
export function publicAccessAdded(plan: AppInstallPlan): NonNullable<AppInstallPlan['publicAccess']> | null {
  const access = plan.publicAccess;
  const added = (access?.endpoints ?? []).filter((endpoint) => endpoint.onUpdate === 'granted');
  const unlocked = access?.opensWithoutStaff ?? [];
  // A key for the app's phone app is a new key: asked like a new entry.
  const phone = access?.phoneKey === 'made';
  return access === undefined || (added.length === 0 && unlocked.length === 0 && !phone) ? null : { ...access, endpoints: added };
}

/** Whether the review has anything a self-made file's update must show: a clash, where it came from, its look, what to fill in. */
export function reviewAsks(plan: AppInstallPlan): boolean {
  return (plan.pageClashes ?? []).length > 0 || plan.madeAt !== undefined || plan.instance !== undefined || plan.instanceRestore !== undefined || (plan.afterInstall ?? []).length > 0;
}

/**
 * A new version without the server-wide part: what the running one wrote over
 * the whole server goes back to what it was, and only a settings manager may
 * run that. Counted by kind; never a value.
 */
function InstanceRestoreNote({ restore }: { restore: NonNullable<AppInstallPlan['instanceRestore']> }) {
  const count = restore.values.length;
  return (
    <Alert tone="warn" title={t('studio:hostedApps.update.instanceRestore.title', 'The server’s look goes back')}>
      <span className="block">
        {t(
          'studio:hostedApps.update.instanceRestore.body',
          '{count, plural, one {This version no longer carries the server’s look and languages. # value it set goes back to what it was: the look, the words and the system emails.} other {This version no longer carries the server’s look and languages. # values it set go back to what they were: the look, the words and the system emails.}}',
          { count },
        )}
      </span>
      <span className="mt-1 block">
        {restore.canRestore
          ? t('studio:hostedApps.update.instanceRestore.manager', 'Only someone who may change the server’s settings can run this update.')
          : t('studio:hostedApps.update.instanceRestore.locked', 'Only someone who may change the server’s settings can run this update: ask someone who has that permission.')}
      </span>
    </Alert>
  );
}

export interface UpdateReviewProps {
  appKey: string;
  /** The app's name; the key when it is not known. */
  appName: string;
  to: string;
  /** The version the copy runs now; absent when not known. */
  from?: string | undefined;
  plan: AppInstallPlan;
  connectionId: string;
  /** The copy's database by name, said in the title when there are several. */
  connectionName?: string | undefined;
  /** Which copy of how many, when every copy is updated in turn. */
  copy?: { n: number; total: number } | undefined;
  /** The uploaded file's own fingerprint, for the check; '' when nothing was uploaded. */
  integrity?: string | undefined;
  publisher?: { id: string; name: string } | undefined;
  busy: boolean;
  error?: string | null | undefined;
  /** The update stopped part way: where, and the button that finishes it. */
  stopped?: UpdateStoppedDetails | null | undefined;
  onCancel: () => void;
  onConfirm: (answers: UpdateAnswers) => void;
}

/** "The update to 1.1.0 stopped while writing pages. Nothing was lost; 1.0.0's pages are still here." */
export function stoppedWords(details: UpdateStoppedDetails): string {
  // The steps after the version moved: pages (with rules, roles, mails, documents and keys), starting rows, the look and languages.
  return details.stage === 'pages'
    ? t('studio:hostedApps.update.stopped.pages', 'The update to {to} stopped while writing pages. Nothing was lost; {from}’s pages are still here.', {
        to: details.to,
        from: details.from,
      })
    : details.stage === 'seeds'
      ? t('studio:hostedApps.update.stopped.seeds', 'The update to {to} stopped while adding its starting rows. Nothing was lost, and finishing it adds the rest.', { to: details.to })
      : details.stage === 'instance'
        ? t('studio:hostedApps.update.stopped.instance', 'The update to {to} stopped while applying the look and languages. Nothing was lost, and finishing it applies them.', { to: details.to })
        : t('studio:hostedApps.update.stopped.other', 'The update to {to} stopped part way. Nothing was lost, and finishing it carries on from where it stopped.', {
        to: details.to,
      });
}

/**
 * A new version's check on one copy, shown the way the install shows it; the
 * update sends the answers and the checksum of the check it showed.
 */
export function UpdateReviewDialog(props: UpdateReviewProps) {
  const { plan: initial } = props;
  const [plan, setPlan] = useState(initial);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, TakenPick>>({});
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  // A new version's tables of a shape another app has: that app's, or separate ones.
  const [sharePicks, setSharePicks] = useState<NonNullable<InstallAnswers['shares']>>({});
  const [pagePicks, setPagePicks] = useState<NonNullable<InstallAnswers['pages']>>({});
  const [useExisting, setUseExisting] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [instance, setInstance] = useState<InstanceAnswers>(NO_INSTANCE_ANSWERS);
  const holdId = useId();
  // What Update sent: Finish the update sends it again.
  const [lastSent, setLastSent] = useState<UpdateAnswers | null>(null);

  const answersOf = (next: {
    picks?: Record<string, TakenPick>;
    renameTo?: Record<string, string>;
    shares?: NonNullable<InstallAnswers['shares']>;
    pages?: NonNullable<InstallAnswers['pages']>;
    existing?: boolean;
  }): Pick<InstallAnswers, 'choices' | 'shares' | 'pages' | 'existing'> => {
    const nextPicks = next.picks ?? picks;
    const nextRename = next.renameTo ?? renameTo;
    const choices: NonNullable<InstallAnswers['choices']> = {};
    for (const ref of Object.keys(nextPicks).sort()) {
      if (nextPicks[ref] === 'reuse') choices[ref] = { action: 'reuse' };
      if (nextPicks[ref] === 'rename-existing') choices[ref] = { action: 'rename-existing', to: nextRename[ref] ?? '' };
    }
    const shares = next.shares ?? sharePicks;
    const pages = next.pages ?? pagePicks;
    const existing = next.existing ?? useExisting;
    const sorted = <V,>(record: Record<string, V>): Record<string, V> => Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]!]));
    return {
      ...(existing || Object.keys(choices).length === 0 ? {} : { choices }),
      ...(Object.keys(shares).length === 0 ? {} : { shares: sorted(shares) }),
      ...(Object.keys(pages).length === 0 ? {} : { pages: sorted(pages) }),
      ...(existing ? { existing: 'use' as const } : {}),
    };
  };
  const answers = answersOf({});
  const [checked, setChecked] = useState<Pick<InstallAnswers, 'choices' | 'shares' | 'pages' | 'existing'>>({});
  const dirty = JSON.stringify(answers) !== JSON.stringify(checked);

  const recheck = useMutation({
    mutationFn: (next: Pick<InstallAnswers, 'choices' | 'shares' | 'pages' | 'existing'>) =>
      planApp({ key: props.appKey, version: props.to, connectionId: props.connectionId, ...next }),
    onSuccess: (reply, next) => {
      setPlan(reply.plan);
      setChecked(next);
    },
  });

  /*
   * Ticked by default, as at install, where the app already has its public
   * access (the new customer screens need the rest). An app installed
   * without it is asked afresh, unticked: the operator said no once. So is
   * a version that opens a staff screen's key to anyone with a link.
   */
  const [allowPublic, setAllowPublic] = useState(
    () =>
      initial.publicAccess?.endpoints.some((endpoint) => endpoint.onUpdate === 'held') === true &&
      (initial.publicAccess.opensWithoutStaff ?? []).length === 0,
  );
  // What visitors already reach that this version would show more of: unticked, and Update waits for the tick.
  const [allowWider, setAllowWider] = useState(false);
  // The add-ons this version needs moved: "Update it too" ticked by default, as at install.
  const [addOnPicks, setAddOnPicks] = useState<AddOnPicks>({ ticked: {}, update: {} });
  const [downloading, setDownloading] = useState<{ key: string; pct: number } | null>(null);
  const catalogue = useQuery({ ...addOnCatalogQuery, enabled: updateAddOnRows(initial).some((row) => !row.staged) });

  const tables = plan.tables ?? [];
  // A menu another app already has is a question too: its own, or that app's.
  const asksTables = checkAsks(tables) || (plan.shareOffers ?? []).length > 0;
  const access = publicAccessAdded(plan);
  const wider = roleTablesWider(plan);
  const grants = grantsAddedOf(plan);
  const integrity = props.integrity ?? '';
  const restore = plan.instanceRestore;
  // Putting the server's look back is a change of its settings: only a settings manager runs this update.
  const restoreLocked = restore !== undefined && !restore.canRestore;
  const addOnRows = updateAddOnRows(plan);
  const addOnHold = addOnRows.length === 0 ? null : addOnBlock(props.appName, addOnRows, addOnPicks);
  const wideningRows = plan.publicWider ?? [];
  const widerHold = publicWiderHold(wideningRows, allowWider);
  const hold = reviewHold({ plan, pages: checked.pages, fingerprint, integrity }) ?? addOnHold ?? widerHold;

  /**
   * An add-on the version needs that is in the catalogue but not on this
   * server: downloaded first, as a job, then the check is made again.
   */
  const download = useMutation({
    mutationFn: async (row: AppAddOnRow) => {
      if (row.offeredVersion === null) throw new Error('no version');
      setDownloading({ key: row.key, pct: 0 });
      const { jobId } = await downloadAddOn(row.key, row.offeredVersion);
      for (;;) {
        const job = await getAddOnJob(jobId);
        setDownloading({ key: row.key, pct: job.progress?.pct ?? 0 });
        if (job.status === 'succeeded') return;
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(job.lastError ?? t('studio:addOns.job.failed', 'The download did not finish. Nothing was installed.'));
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    },
    onSuccess: () => recheck.mutate(checked),
    onSettled: () => setDownloading(null),
  });
  const busy = props.busy || recheck.isPending || download.isPending;
  const stopped = props.stopped ?? null;

  /*
   * What Update sends, and what Finish the update sends when this dialog
   * opened on an update stopped before (a reload): the answers on screen
   * now, so a part written after the stop (the look and languages, say) is
   * asked again rather than dropped.
   */
  const answersToSend = (): UpdateAnswers => ({
    ...(plan.checksum === undefined ? {} : { planChecksum: plan.checksum }),
    ...checked,
    ...instanceAnswersOf(plan.instance, instance),
    ...(access === null ? {} : { publicAccess: allowPublic && !publicAccessBlocked(access) }),
    // Shown above: the Update button is the say.
    ...(wider.length === 0 ? {} : { roleTables: true }),
    // …and so is it for what the roles are newly given.
    ...(grants.privacy.length === 0 && grants.addOn.length === 0 ? {} : { roleGrants: true }),
    // The add-ons it moves with it, as the card shows them ("Update it too").
    ...(addOnRows.length === 0 ? {} : { addOns: addOnChoicesOf(addOnRows, addOnPicks) }),
    // Ticked on the card: the endpoints it widens show visitors more.
    ...(wideningRows.length === 0 ? {} : { publicWider: allowWider }),
  });

  const answerPage = (page: string, answer: PageAnswer | undefined) => {
    const next = { ...pagePicks };
    if (answer === undefined) delete next[page];
    else next[page] = answer;
    setPagePicks(next);
    recheck.mutate(answersOf({ pages: next }));
  };

  const title =
    props.connectionName === undefined
      ? t('studio:hostedApps.update.title', 'Update {app} to v{version}', { app: props.appName, version: props.to })
      : t('studio:hostedApps.update.titleOn', 'Update {app} on {database} to v{version}', { app: props.appName, database: props.connectionName, version: props.to });

  const subtitle =
    props.copy !== undefined && props.from !== undefined
      ? t('studio:hostedApps.update.copyOf', 'Copy {n} of {total} · {from} → {to}', { n: props.copy.n, total: props.copy.total, from: props.from, to: props.to })
      : asksTables
        ? t('studio:hostedApps.update.checkSubtitle', 'Check the tables this version uses.')
        : access !== null
          ? t('studio:hostedApps.update.accessSubtitle', 'Check what this version lets the app’s customers do.')
          : wider.length > 0
            ? t('studio:hostedApps.update.rolesSubtitle', 'Check what this version’s roles may do with add-ons’ tables.')
            : asksGrants(plan)
              ? t('studio:hostedApps.update.grantsSubtitle', 'Check what this version’s roles are newly given.')
              : addOnRows.length > 0
                ? t('studio:hostedApps.update.addOnsSubtitle', 'Check the add-ons this version needs.')
                : wideningRows.length > 0
                  ? t('studio:hostedApps.update.widerSubtitle', 'Check what this version shows visitors.')
                  : t('studio:hostedApps.update.reviewSubtitle', 'Check what this version brings.');

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(next) => {
        if (!next && !busy) props.onCancel();
      }}
    >
      <ModalHeader icon={<ArrowUpCircle />} title={title} subtitle={subtitle} closeLabel={t('studio:hostedApps.update.close', 'Close')} />
      <ModalBody>
        <div className="flex flex-col gap-3 leading-[normal]">
          {props.from === undefined || props.copy !== undefined ? null : (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <MonoText>{props.from}</MonoText>
              <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
              <MonoText className="font-bold text-fg">{props.to}</MonoText>
            </p>
          )}
          {props.connectionName === undefined || props.copy === undefined || props.copy.total < 2 ? null : (
            <p className="text-[12.5px] text-fg-muted">
              {t('studio:hostedApps.update.onlyThis', 'Only {app} on {database} changes in this dialog. Its settings, roles and email templates there are kept.', {
                app: props.appName,
                database: props.connectionName,
              })}
            </p>
          )}
          {stopped === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={stoppedWords(stopped)}
              action={
                <Button size="sm" disabled={busy} onClick={() => props.onConfirm(lastSent ?? answersToSend())}>
                  {busy ? <Spinner size="sm" /> : <RotateCw aria-hidden className="size-4" />}
                  {t('studio:hostedApps.update.finish', 'Finish the update')}
                </Button>
              }
            >
              {stopped.cause === '' ? null : <MonoText className="block text-xs">{stopped.cause}</MonoText>}
            </Alert>
          )}
          {props.error === null || props.error === undefined ? null : (
            <Alert role="alert" tone="danger" title={t('studio:hostedApps.error', 'Something went wrong')}>
              {props.error}
            </Alert>
          )}
          {recheck.error === null ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.error', 'Something went wrong')}>
              {recheck.error.message}
            </Alert>
          )}
          {plan.madeAt === undefined && integrity === '' ? null : (
            <div className="rounded-[14px] border border-border bg-surface p-4">
              <WhereItCameFrom
                compact
                name={props.appName}
                version={props.to}
                madeAt={plan.madeAt}
                publisher={props.publisher}
                integrity={integrity}
                fingerprint={fingerprint}
                onFingerprint={setFingerprint}
              />
            </div>
          )}
          <PageClashesCard
            clashes={plan.pageClashes ?? []}
            answers={pagePicks}
            busy={busy}
            onAnswer={answerPage}
            onRenameTo={(page, to) => setPagePicks((pages) => ({ ...pages, [page]: { action: 'rename-existing', to } }))}
          />
          {existingTables(plan).length === 0 ? null : (
            <ExistingTablesCard
              plan={plan}
              used={checked.existing === 'use'}
              busy={busy}
              onUse={() => {
                setUseExisting(true);
                setPicks({});
                recheck.mutate(answersOf({ existing: true, picks: {} }));
              }}
              onChange={() => {
                setUseExisting(false);
                recheck.mutate(answersOf({ existing: false }));
              }}
            />
          )}
          {!asksTables ? null : (
            <TableCheck
              plan={{ ...plan, tables }}
              appName={props.appName}
              connectionName=""
              heading={false}
              allowAltPrefix={false}
              open={open}
              onToggle={(ref) => setOpen((rows) => ({ ...rows, [ref]: rows[ref] !== true }))}
              picks={picks}
              onPick={(ref, pick) => {
                const table = tables.find((candidate) => candidate.ref === ref);
                const nextPicks = { ...picks, [ref]: pick };
                const nextRename =
                  pick === 'rename-existing' && renameTo[ref] === undefined && table !== undefined
                    ? { ...renameTo, [ref]: table.renameExistingTo ?? `${table.table}_old` }
                    : renameTo;
                setPicks(nextPicks);
                setRenameTo(nextRename);
                recheck.mutate(answersOf({ picks: nextPicks, renameTo: nextRename }));
              }}
              onShare={(shape, pick) => {
                const next = { ...sharePicks, [shape]: pick };
                setSharePicks(next);
                recheck.mutate(answersOf({ shares: next }));
              }}
              renameTo={renameTo}
              onRenameTo={(ref, value) => setRenameTo((names) => ({ ...names, [ref]: value }))}
              prefix=""
              onPrefix={() => undefined}
              altPrefixInUse={null}
              onUsualPrefix={() => undefined}
              busy={busy}
            />
          )}
          <OutsideAddressesCard items={plan.afterInstall} forUpdate />
          {plan.instance === undefined ? null : <InstanceCard part={plan.instance} answers={instance} onAnswers={setInstance} />}
          {restore === undefined ? null : <InstanceRestoreNote restore={restore} />}
          <AfterInstallCard items={plan.afterInstall} />
          {access === null ? null : <PublicAccessInstallCard access={access} checked={allowPublic} onChange={setAllowPublic} />}
          <RoleTablesUpdateCard entries={wider} />
          <AppsRoleTablesWiderCard entries={wider} />
          <RoleGrantsAddedCard privacy={grants.privacy} addOn={grants.addOn} />
          {download.error === null ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.error', 'Something went wrong')}>
              {download.error.message}
            </Alert>
          )}
          {addOnRows.length === 0 ? null : (
            <AddOnsInstallCard
              appName={props.appName}
              connectionName={props.connectionName ?? ''}
              rows={addOnRows}
              picks={addOnPicks}
              onTick={(key, next) => setAddOnPicks((picks) => ({ ...picks, ticked: { ...picks.ticked, [key]: next } }))}
              onUpdate={(key, next) => setAddOnPicks((picks) => ({ ...picks, update: { ...picks.update, [key]: next } }))}
              catalogueOn={catalogue.data?.onlineEnabled ?? null}
              downloading={downloading}
              onDownload={(row) => download.mutate(row)}
              busy={busy}
            />
          )}
          <EveryCopyFirst rows={addOnRows} />
          <PublicWiderCard rows={wideningRows} checked={allowWider} onChange={setAllowWider} disabled={busy || plan.publicAccess?.canGrant === false} />
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="me-auto">
          {hold !== null && !dirty ? <HoldHint id={holdId}>{hold}</HoldHint> : <CheckHint plan={plan} picks={picks} dirty={dirty} forUpdate />}
        </span>
        <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
          {t('studio:hostedApps.update.cancel', 'Cancel')}
        </Button>
        {dirty ? (
          <Button disabled={busy} onClick={() => recheck.mutate(answers)}>
            {recheck.isPending ? <Spinner size="sm" /> : null}
            {t('studio:hostedApps.install.check.again', 'Check again')}
          </Button>
        ) : stopped !== null ? null : (
          <Button
            disabled={busy || !plan.installable || hold !== null || restoreLocked}
            aria-describedby={hold === null ? undefined : holdId}
            onClick={() => {
              const sent = answersToSend();
              setLastSent(sent);
              props.onConfirm(sent);
            }}
          >
            {props.busy ? <Spinner size="sm" /> : null}
            {t('studio:hostedApps.update.confirm', 'Update')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
