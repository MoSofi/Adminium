// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/add-ons` — the Studio surface for the add-on runtime
 * (26-add-on-runtime.md §7, 26-T14; 32-add-on-distribution.md §4.4).
 *
 * Design input: `designs/Integrations.dc.html`. What that comp draws is a
 * browse grid, a connected list, a consent dialog and a disconnect. What this
 * page adds is the DATA STORY behind them, and the order below is the order an
 * operator actually moves through:
 *
 *  1. **What is available**, bundled first. A fresh install browses with no
 *     network at all (32 D8), so the list is useful before anyone decides
 *     whether to switch the online catalog on. "Check for newer" is a separate,
 *     visible action rather than something the page does on load.
 *  2. **What installing would do** — the plan, shown BEFORE consent. 26 §7 is
 *     explicit that this dialog "is the security surface, not decoration: it is
 *     where a user sees what an add-on may reach before it can reach it". So it
 *     names the tables, the hosts, and the reason when the answer is no.
 *  3. **What is installed**, per host, with connect and disconnect.
 *
 * ── THE TWO CONFIRMS SAY DIFFERENT THINGS, DELIBERATELY ────────────────────
 * Disable keeps everything and is reversible in one click. Disconnect deletes
 * the keys and keeps every table (24 D16 / 26 D5). Uninstall additionally
 * removes the package from disk (32 D11) and still keeps the tables. Three
 * different outcomes, so three different sentences — a shared "are you sure?"
 * would make the safest of them read like the most destructive.
 *
 * ── WHAT THIS PAGE WILL NOT DO ─────────────────────────────────────────────
 * It does not offer to create the tables an add-on wants. The server refuses a
 * plan that needs schema change (`ADD_ON_DDL_REQUIRED`, 26-T02 unbuilt), and
 * the honest surface for that is the plan saying which tables are missing — not
 * a disabled button, and certainly not a "create them" action that would fail.
 */
import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Blocks, CloudDownload, Plug, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Switch,
} from '@adminium/ui';

import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { t } from '../../i18n/t.js';
import {
  ADD_ONS_QUERY_KEY,
  ADD_ON_CATALOG_QUERY_KEY,
  addOnCatalogQuery,
  addOnsQuery,
  connectAddOn,
  disconnectAddOn,
  discardStaged,
  downloadAddOn,
  getAddOnJob,
  setCatalogEnabled,
  uploadAddOn,
  fetchInstallPlan,
  installAddOn,
  refreshCatalog,
  setAddOnEnabled,
  uninstallAddOn,
  upgradeAddOn,
  type AddOnDto,
  type CatalogEntry,
  type InstallPlan,
} from './addOnsApi.js';

/** What a pending confirm is about; each has its own words. */
type Pending =
  | { kind: 'disconnect'; addOn: AddOnDto }
  | { kind: 'uninstall'; addOn: AddOnDto }
  | { kind: 'discard'; entry: CatalogEntry };

/**
 * The plan, rendered as prose an operator can act on.
 *
 * Every branch says what WILL happen rather than what the API returned, because
 * this is the moment consent is given and a field name is not consent.
 */
function PlanSummary({ plan }: { plan: InstallPlan }) {
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

/** The consent dialog (26 §7) — the security surface, not decoration. */
function ConsentDialog({
  entry,
  plan,
  hosts,
  busy,
  onCancel,
  onConfirm,
}: {
  entry: CatalogEntry;
  plan: InstallPlan | null;
  hosts: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (attachTo: string[]) => void;
}) {
  const [attachTo, setAttachTo] = useState<string[]>(hosts);
  const blocked =
    plan === null ||
    !plan.installable ||
    plan.reuse.some((table) => table.missingColumns.length > 0);
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <ModalHeader
        icon={<ShieldCheck />}
        title={t('studio:addOns.consent.title', 'Install {name}', { name: entry.name })}
        subtitle={t(
          'studio:addOns.consent.subtitle',
          'What this add-on will do, before it can do it.',
        )}
        closeLabel={t('studio:addOns.consent.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3">
          {plan === null ? (
            <p className="text-sm text-fg-muted">
              {t('studio:addOns.consent.loading', 'Working out what this would do…')}
            </p>
          ) : (
            <PlanSummary plan={plan} />
          )}
          {hosts.length > 0 && (
            <FormField label={t('studio:addOns.consent.hosts', 'Attach to')}>
              <div className="flex flex-wrap gap-2">
                {hosts.map((host) => (
                  <Badge
                    key={host}
                    tone={attachTo.includes(host) ? 'accent' : 'neutral'}
                    onClick={() =>
                      setAttachTo((current) =>
                        current.includes(host)
                          ? current.filter((one) => one !== host)
                          : [...current, host],
                      )
                    }
                  >
                    {host}
                  </Badge>
                ))}
              </div>
            </FormField>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t('studio:addOns.consent.cancel', 'Cancel')}
        </Button>
        <Button disabled={busy || blocked} onClick={() => onConfirm(attachTo)}>
          {t('studio:addOns.consent.confirm', 'Install')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** The api-key connect form. Values go straight out and are never cached. */
function ConnectForm({
  addOn,
  busy,
  onConnect,
}: {
  addOn: AddOnDto;
  busy: boolean;
  onConnect: (credentials: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (addOn.connectKind !== 'api-key') return null;
  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder={t('studio:addOns.connect.apiKey', 'API key')}
        value={values['api_key'] ?? ''}
        onChange={(event) =>
          setValues((current) => ({ ...current, api_key: event.currentTarget.value }))
        }
      />
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          onConnect(values);
          // Cleared on submit rather than kept for a retry: a secret sitting in
          // component state after the request that needed it is a secret nobody
          // decided to keep.
          setValues({});
        }}
      >
        {t('studio:addOns.connect.submit', 'Connect')}
      </Button>
    </div>
  );
}

/**
 * SIDELOAD (32 D4) — upload a package this server could not have fetched.
 *
 * ── WHY THE HASH FIELD IS REQUIRED, AND NOT A CONVENIENCE ──────────────────
 *
 * An air-gapped operator has no registry to download from, so the only way in
 * is a file they carried. That path runs the IDENTICAL
 * verify-then-hardened-unpack the download path runs — one code path for
 * bundled, npm and upload — which means it needs the same thing a download
 * gets from the registry: a hash to verify against, supplied by somebody other
 * than the bytes themselves.
 *
 * `npm pack --json` prints exactly this value as `integrity`, so the person
 * doing the sideloading can produce it without trusting this page, and the
 * server refuses anything that does not match. A form that computed the hash
 * from the uploaded file would be verifying the bytes against themselves.
 *
 * The key and version are asked for rather than read out of the tarball,
 * deliberately: the store's directory grammar is `<key>/<version>/`, and
 * deriving them from a filename an operator can rename is how a package ends up
 * staged under somebody else's name.
 */
function SideloadCard({
  busy,
  onUpload,
}: {
  busy: boolean;
  onUpload: (file: File, input: { key: string; version: string; expectedSha512: string }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const [version, setVersion] = useState('');
  const [sha, setSha] = useState('');
  const ready = file !== null && key !== '' && version !== '' && sha.startsWith('sha512-');

  return (
    <Card>
      <CardHeader className="flex items-start gap-3">
        <IconTile>
          <Upload />
        </IconTile>
        <span className="flex flex-col">
          <strong>{t('studio:addOns.sideload.title', 'Upload a package')}</strong>
          <span className="text-sm text-fg-muted">
            {t(
              'studio:addOns.sideload.hint',
              'For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.',
            )}
          </span>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <FormField label={t('studio:addOns.sideload.file', 'Package file (.tgz)')}>
          <input
            type="file"
            accept=".tgz,application/gzip"
            disabled={busy}
            aria-label={t('studio:addOns.sideload.file', 'Package file (.tgz)')}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
            }}
          />
        </FormField>
        <FormField label={t('studio:addOns.sideload.key', 'Add-on key')}>
          <Input
            value={key}
            disabled={busy}
            onChange={(event) => {
              setKey(event.currentTarget.value);
            }}
          />
        </FormField>
        <FormField label={t('studio:addOns.sideload.version', 'Version')}>
          <Input
            value={version}
            disabled={busy}
            onChange={(event) => {
              setVersion(event.currentTarget.value);
            }}
          />
        </FormField>
        <FormField
          label={t('studio:addOns.sideload.sha', 'Integrity (sha512-…)')}
          helper={t(
            'studio:addOns.sideload.shaHint',
            'The `integrity` value `npm pack --json` printed. The upload is refused if the bytes do not match.',
          )}
        >
          <Input
            value={sha}
            disabled={busy}
            placeholder="sha512-…"
            onChange={(event) => {
              setSha(event.currentTarget.value.trim());
            }}
          />
        </FormField>
        <span>
          <Button
            disabled={busy || !ready}
            onClick={() => {
              if (file === null) return;
              onUpload(file, { key, version, expectedSha512: sha });
            }}
          >
            {t('studio:addOns.sideload.submit', 'Upload')}
          </Button>
        </span>
      </CardBody>
    </Card>
  );
}

/**
 * Poll cadence for a running download. A module constant rather than a prop so
 * the page's own route mount needs no wiring; the suite overrides it by mocking
 * the timer rather than by threading a seam through `studioRoutes`.
 */
const jobPollMs = 400;

export function AddOnsPage() {
  const queryClient = useQueryClient();
  const [{ data: installed }, { data: catalog }] = useSuspenseQueries({
    queries: [addOnsQuery, addOnCatalogQuery],
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [consent, setConsent] = useState<{ entry: CatalogEntry; plan: InstallPlan | null } | null>(
    null,
  );
  const [progress, setProgress] = useState<{ pct: number; message: string | null } | null>(null);
  const [vetoed, setVetoed] = useState(false);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ADD_ONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ADD_ON_CATALOG_QUERY_KEY }),
    ]);
  };

  /** One place that turns a thrown request into page state. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Run something that returns a JOB, and follow it to the end (32 D10).
   *
   * A download is not a request. It runs on the worker — with its retries, its
   * cancellation and its `jobs:<jobId>` topic — so `POST /add-ons/download`
   * answers `{ jobId }` immediately and the bytes arrive later. Without this the
   * page said "done" the instant the job was ENQUEUED and the operator refreshed
   * to find nothing staged.
   *
   * Polled rather than socket-subscribed, deliberately: it is the same read the
   * connect wizard's introspection step uses, it needs no subscription to tear
   * down when the page unmounts mid-download, and it keeps this surface
   * testable without a socket.
   */
  const runJob = async (start: () => Promise<{ jobId: string }>): Promise<void> => {
    setBusy(true);
    setError(null);
    setProgress({ pct: 0, message: null });
    try {
      const { jobId } = await start();
      for (;;) {
        const job = await getAddOnJob(jobId);
        setProgress({ pct: job.progress?.pct ?? 0, message: job.progress?.message ?? null });
        if (job.status === 'succeeded') break;
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(
            job.lastError ??
              t('studio:addOns.job.failed', 'The download did not finish. Nothing was installed.'),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, jobPollMs));
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const openConsent = (entry: CatalogEntry): void => {
    setConsent({ entry, plan: null });
    void (async () => {
      try {
        const plan = await fetchInstallPlan(entry.key);
        setConsent((current) => (current?.entry.key === entry.key ? { entry, plan } : current));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setConsent(null);
      }
    })();
  };

  const byKey = new Map(installed.map((addOn) => [addOn.key, addOn]));

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:addOns.title', 'Add-ons')}
        subtitle={t(
          'studio:addOns.subtitle',
          'Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.',
        )}
      />

      {error !== null && (
        <Alert tone="danger" title={t('studio:addOns.error', 'Something went wrong')}>
          {error}
        </Alert>
      )}

      {vetoed && (
        <Alert
          tone="warn"
          title={t('studio:addOns.veto.title', 'This deployment cannot browse online')}
        >
          {t(
            'studio:addOns.veto.body',
            'The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself.',
          )}
        </Alert>
      )}

      {progress !== null && (
        <Alert tone="info" title={t('studio:addOns.job.title', 'Downloading')}>
          {progress.message ??
            t(
              'studio:addOns.job.body',
              'Fetching and verifying. Nothing is installed until you say so.',
            )}{' '}
          <strong>{`${String(Math.round(progress.pct))}%`}</strong>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex items-start justify-between gap-3">
          <span className="flex items-start gap-3">
            <IconTile>
              <CloudDownload />
            </IconTile>
            <span className="flex flex-col">
              <strong>{t('studio:addOns.browse.title', 'Available')}</strong>
              <span className="text-sm text-fg-muted">
                {catalog.onlineEnabled
                  ? t(
                      'studio:addOns.browse.online',
                      'Includes add-ons from the online catalogue. Checking for newer versions is a separate action.',
                    )
                  : t(
                      'studio:addOns.browse.offline',
                      'Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.',
                    )}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-3">
            {catalog.onlineEnabled && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void runJob(refreshCatalog);
                }}
              >
                {t('studio:addOns.browse.refresh', 'Check for newer')}
              </Button>
            )}
            {/*
              THE SWITCH IS HERE, beside what it changes, rather than in
              Settings. 26 D3: these routes are gated on `manifests.manage` and
              the /settings/* routes are not, so a switch deciding whether this
              deployment talks to a package registry belongs with the add-ons.
            */}
            <Switch
              checked={catalog.onlineEnabled}
              disabled={busy}
              onCheckedChange={(next) => {
                void run(async () => {
                  const state = await setCatalogEnabled(next);
                  setVetoed(state.vetoed);
                });
              }}
              aria-label={t('studio:addOns.browse.toggle', 'Browse the online catalogue')}
            />
          </span>
        </CardHeader>
        <CardBody>
          {catalog.addOns.length === 0 ? (
            <EmptyState
              icon={<Blocks />}
              title={t('studio:addOns.browse.emptyTitle', 'No add-ons available')}
              body={t(
                'studio:addOns.browse.emptyBody',
                'This build shipped none, and the online catalogue is off.',
              )}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {catalog.addOns.map((entry) => (
                <li key={entry.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <strong>{entry.name}</strong>
                    <Badge tone="neutral">{entry.version}</Badge>
                    {entry.source === 'bundled' && (
                      <Badge tone="neutral">
                        {t('studio:addOns.browse.bundled', 'Included')}
                      </Badge>
                    )}
                    {entry.upgradeTo !== null && (
                      <Badge tone="accent">
                        {t('studio:addOns.browse.upgrade', 'v{version} available', {
                          version: entry.upgradeTo,
                        })}
                      </Badge>
                    )}
                  </span>
                  <span className="flex gap-2">
                    {entry.state === 'available' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          void runJob(() => downloadAddOn(entry.key, entry.version));
                        }}
                      >
                        {t('studio:addOns.browse.download', 'Download')}
                      </Button>
                    )}
                    {entry.state === 'staged' && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => openConsent(entry)}>
                          {t('studio:addOns.browse.install', 'Install')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setPending({ kind: 'discard', entry })}
                        >
                          {t('studio:addOns.browse.discard', 'Discard')}
                        </Button>
                      </>
                    )}
                    {entry.state === 'installed' && entry.upgradeTo !== null && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void run(() => upgradeAddOn(entry.key));
                        }}
                      >
                        {t('studio:addOns.browse.upgradeAction', 'Upgrade')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <SideloadCard
        busy={busy}
        onUpload={(file, input) => {
          void run(() => uploadAddOn(file, input));
        }}
      />

      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile>
            <Plug />
          </IconTile>
          <strong>{t('studio:addOns.installed.title', 'Installed')}</strong>
        </CardHeader>
        <CardBody>
          {installed.length === 0 ? (
            <EmptyState
              icon={<Blocks />}
              title={t('studio:addOns.installed.emptyTitle', 'Nothing installed yet')}
              body={t(
                'studio:addOns.installed.emptyBody',
                'Install an add-on above and it will appear here with its hosts and connection.',
              )}
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {installed.map((addOn) => (
                <li key={addOn.key} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <strong>{addOn.name}</strong>
                    <Badge tone="neutral">{addOn.version}</Badge>
                    {addOn.connectKind !== 'none' && (
                      <Badge tone={addOn.connected ? 'pos' : 'warn'}>
                        {addOn.connected
                          ? t('studio:addOns.installed.connected', 'Connected')
                          : t('studio:addOns.installed.notConnected', 'Not connected')}
                      </Badge>
                    )}
                  </span>

                  {addOn.networkAllow.length > 0 && (
                    <p className="text-xs text-fg-muted">
                      <ShieldCheck className="inline size-3" />{' '}
                      {t('studio:addOns.installed.egress', 'May contact: {hosts}', {
                        hosts: addOn.networkAllow.join(', '),
                      })}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {addOn.attachments.map((attachment) => (
                      <Button
                        key={attachment.attachedTo}
                        size="sm"
                        variant={attachment.enabled ? 'secondary' : 'ghost'}
                        disabled={busy}
                        onClick={() => {
                          void run(() =>
                            setAddOnEnabled(
                              addOn.key,
                              attachment.attachedTo,
                              !attachment.enabled,
                            ),
                          );
                        }}
                      >
                        {attachment.attachedTo}
                        {attachment.enabled
                          ? ` · ${t('studio:addOns.installed.on', 'on')}`
                          : ` · ${t('studio:addOns.installed.off', 'off')}`}
                      </Button>
                    ))}
                  </div>

                  {!addOn.connected && (
                    <ConnectForm
                      addOn={addOn}
                      busy={busy}
                      onConnect={(credentials) => {
                        void run(() => connectAddOn(addOn.key, credentials));
                      }}
                    />
                  )}

                  <div className="flex gap-2">
                    {addOn.connected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setPending({ kind: 'disconnect', addOn })}
                      >
                        {t('studio:addOns.installed.disconnect', 'Disconnect')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructiveSoft"
                      disabled={busy}
                      onClick={() => setPending({ kind: 'uninstall', addOn })}
                    >
                      {t('studio:addOns.installed.uninstall', 'Uninstall')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {consent !== null && (
        <ConsentDialog
          entry={consent.entry}
          plan={consent.plan}
          hosts={byKey.get(consent.entry.key)?.attachments.map((a) => a.attachedTo) ?? []}
          busy={busy}
          onCancel={() => setConsent(null)}
          onConfirm={(attachTo) => {
            const entry = consent.entry;
            setConsent(null);
            void run(() => installAddOn({ key: entry.key, version: entry.version, attachTo }));
          }}
        />
      )}

      {pending !== null && (
        <Modal
          open
          onOpenChange={(next) => {
            if (!next) setPending(null);
          }}
        >
          {/*
           * Three outcomes, three sentences. A shared "are you sure?" would make
           * disconnect — which keeps every table and every row — read as
           * dangerously as uninstall. */}
          <ModalHeader
            icon={<TriangleAlert />}
            tone={pending.kind === 'uninstall' ? 'danger' : 'warn'}
            closeLabel={t('studio:addOns.confirm.close', 'Close')}
            title={
            pending.kind === 'disconnect'
              ? t('studio:addOns.confirm.disconnectTitle', 'Disconnect this add-on')
              : pending.kind === 'uninstall'
                ? t('studio:addOns.confirm.uninstallTitle', 'Uninstall this add-on')
                : t('studio:addOns.confirm.discardTitle', 'Discard this download')
            }
          />
          <ModalBody>
            {
            pending.kind === 'disconnect'
              ? t(
                  'studio:addOns.confirm.disconnectBody',
                  'Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.',
                )
              : pending.kind === 'uninstall'
                ? t(
                    'studio:addOns.confirm.uninstallBody',
                    'Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.',
                  )
                : t(
                    'studio:addOns.confirm.discardBody',
                    'The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.',
                  )
            }
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t('studio:addOns.confirm.cancel', 'Cancel')}
            </Button>
            <Button
              variant={pending.kind === 'uninstall' ? 'destructive' : 'destructiveSoft'}
              disabled={busy}
              onClick={() => {
                const current = pending;
                setPending(null);
                void run(() => {
                  if (current.kind === 'disconnect') return disconnectAddOn(current.addOn.key);
                  if (current.kind === 'uninstall') return uninstallAddOn(current.addOn.key);
                  return discardStaged(current.entry.key, current.entry.version);
                });
              }}
            >
              {pending.kind === 'disconnect'
                ? t('studio:addOns.confirm.disconnect', 'Disconnect')
                : pending.kind === 'uninstall'
                  ? t('studio:addOns.confirm.uninstall', 'Uninstall')
                  : t('studio:addOns.confirm.discard', 'Discard')}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {catalog.addOns.some((entry) => entry.upgradeTo !== null) && (
        <p className="flex items-center gap-1 text-xs text-fg-muted">
          <TriangleAlert className="size-3" />
          {t(
            'studio:addOns.upgradeNote',
            'Upgrading keeps the hosts an add-on is attached to and the connection it already has.',
          )}
        </p>
      )}
    </PageSurface>
  );
}
