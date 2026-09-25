// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/add-ons` — the Studio surface for the add-on
 * runtime.
 *
 * Design input: the integrations comp. What it draws is a
 * browse grid, a connected list, a consent dialog and a disconnect. What this
 * page adds is the DATA STORY behind them, and the order below is the order an
 * operator actually moves through:
 *
 *  1. **What is available**, bundled first. A fresh install browses with no
 * network at all, so the list is useful before anyone decides whether to switch
 *     the online catalog on. "Check for newer" is a separate, visible action
 *     rather than something the page does on load.
 *  2. **What installing would do** — the plan, shown BEFORE consent. The install plan is
 *     explicit that this dialog "is the security surface, not decoration: it is
 *     where a user sees what an add-on may reach before it can reach it". So it
 *     names the tables, the hosts, and the reason when the answer is no.
 *  3. **What is installed**, per host, with connect and disconnect.
 *
 * ── THE TWO CONFIRMS SAY DIFFERENT THINGS, DELIBERATELY ────────────────────
 * Disable keeps everything and is reversible in one click. Disconnect deletes
 * the keys and keeps every table. Uninstall additionally removes the package
 * from disk and still keeps the tables. Three different outcomes, so three
 * different sentences — a shared "are you sure?" would make the safest of
 * them read like the most destructive.
 *
 * ── WHAT THIS PAGE WILL NOT DO ─────────────────────────────────────────────
 * It does not offer to create the tables an add-on wants. The server refuses a
 * plan that needs schema change (`ADD_ON_DDL_REQUIRED`, unbuilt), and the
 * honest surface for that is the plan saying which tables are missing — not a
 * disabled button, and certainly not a "create them" action that would fail.
 */
import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Blocks, Plug, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
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
  Select,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { featureWords } from '../apps/addOnWords.js';
import { AddOnNeededDialog, type AddOnNeeded } from './AddOnNeededDialog.js';
import { AddOnBrowser } from './AddOnBrowser.js';
import { PlanSummary } from './PlanSummary.js';
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
  saveAddOnSettings,
  setAddOnEnabled,
  uninstallAddOn,
  upgradeAddOn,
  type AddOnDto,
  type AddOnUse,
  type CatalogEntry,
  type InstallPlan,
  type StagedPackage,
} from './addOnsApi.js';

/** What a pending confirm is about; each has its own words. */
type Pending =
  | { kind: 'disconnect'; addOn: AddOnDto }
  | { kind: 'uninstall'; addOn: AddOnDto }
  | { kind: 'discard'; entry: CatalogEntry };

/**
 * Who uses an installed add-on, before anyone clicks: "Used by Client Portal
 * (Required) · Point of Sale (Needed for: Emailed receipts)".
 */
function UsedByLine({ uses }: { uses: readonly AddOnUse[] }) {
  return (
    <p className="text-xs text-fg-muted" data-part="add-on-used-by">
      {t('studio:addOnNeeded.usedByLine', 'Used by {apps}', {
        apps: uses
          .map((use) =>
            use.need === 'requires'
              ? t('studio:addOnNeeded.useRequired', '{app} (Required)', { app: use.appName })
              : use.need === 'feature'
                ? t('studio:addOnNeeded.useFeature', '{app} (Needed for: {features})', {
                    app: use.appName,
                    features: featureWords(use.features),
                  })
                : t('studio:addOnNeeded.useSuggested', '{app} (Suggested)', { app: use.appName }),
          )
          .join(' · '),
      })}
    </p>
  );
}

/** The consent dialog — the security surface, not decoration. */
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

/**
 * The NON-SECRET settings, generated from `manifest.settings`.
 *
 * ─── Why this is a different form from Connect ─────────────────────────────
 *
 * Their destinations differ, and everything else follows from that. A secret
 * goes to the encrypted credentials table and is never read back; these go to
 * `adminium_add_on_settings` and are read back in clear on every render — by
 * this form, by the add-on's own panel, and by every document a renderer
 * draws. Two destinations, two forms, and the REPO refuses a `secret` key on
 * the settings PUT so a mistake here cannot cross them.
 *
 * ─── On the `dashboard` host this form IS the settings surface (D23) ───────
 *
 * An add-on's own `settings.add-on.panel` fill never renders in stock Adminium
 * — that needs the dashboard slot host, which is post-v1. Until then this is
 * where its settings are edited, which is exactly why it is generated rather
 * than bespoke: it has to serve an add-on nobody has seen.
 *
 * ─── `json` renders as a raw editor, and that is said rather than hidden ───
 *
 * A structured editor for an arbitrary JSON shape is a feature of its own. In
 * v1 the field is a textarea that refuses to save unparseable text, and the
 * help line says so.
 */
function SettingsForm({ addOn, busy }: { addOn: AddOnDto; busy: boolean }) {
  const queryClient = useQueryClient();
  const editable = addOn.settings.filter((setting) => !setting.secret);
  const [draft, setDraft] = useState<Record<string, unknown>>(addOn.settingValues);
  const [invalid, setInvalid] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => saveAddOnSettings(addOn.key, draft),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['studio', 'add-ons'] }),
  });

  if (editable.length === 0) return null;

  const set = (key: string, value: unknown) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
        {t('studio:addOns.settings.title', 'Settings')}
      </p>
      {editable.map((setting) => {
        const label =
          setting.label === null ? setting.key : t(setting.label.key, setting.label.fallback);
        const value = draft[setting.key];
        return (
          <label key={setting.key} className="flex flex-col gap-1">
            <span className="text-sm">{label}</span>
            {setting.type === 'boolean' ? (
              <input
                type="checkbox"
                className="size-4"
                checked={value === true}
                aria-label={label}
                onChange={(event) => set(setting.key, event.currentTarget.checked)}
              />
            ) : setting.type === 'enum' ? (
              <Select
                value={typeof value === 'string' ? value : ''}
                aria-label={label}
                onChange={(event) => set(setting.key, event.currentTarget.value)}
              >
                {setting.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : setting.type === 'json' ? (
              <textarea
                className="min-h-20 rounded border border-border bg-bg p-2 font-mono text-xs"
                aria-label={label}
                defaultValue={JSON.stringify(value ?? null, null, 2)}
                onChange={(event) => {
                  try {
                    set(setting.key, JSON.parse(event.currentTarget.value));
                    setInvalid(null);
                  } catch {
                    // Refused rather than saved as a string: a `json` setting
                    // read back as text would break the add-on that declared
                    // it, silently, at render time.
                    setInvalid(setting.key);
                  }
                }}
              />
            ) : (
              <Input
                type={setting.type === 'number' ? 'number' : 'text'}
                value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                aria-label={label}
                onChange={(event) =>
                  set(
                    setting.key,
                    setting.type === 'number'
                      ? Number(event.currentTarget.value)
                      : event.currentTarget.value,
                  )
                }
              />
            )}
            {setting.help !== null && (
              <span className="text-xs text-fg-muted">
                {t(setting.help.key, setting.help.fallback)}
              </span>
            )}
            {setting.type === 'json' && invalid === setting.key && (
              <span className="text-xs text-danger">
                {t('studio:addOns.settings.badJson', 'That is not valid JSON, so it was not saved.')}
              </span>
            )}
          </label>
        );
      })}
      <div>
        <Button
          size="sm"
          disabled={busy || save.isPending || invalid !== null}
          onClick={() => save.mutate()}
        >
          {t('studio:addOns.settings.save', 'Save settings')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The connect form, GENERATED from the manifest.
 *
 * ─── The defect this replaces ──────────────────────────────────────────────
 *
 * It used to be one hard-coded `api_key` input. `shipping-dhl` has declared
 * TWO secrets since wave 4, and connecting it from this page was therefore
 * impossible — not awkward, impossible: the second value had nowhere to be
 * typed. Generating the form from `manifest.settings` fixes the class rather
 * than the instance, and a third add-on with three secrets needs no change
 * here at all.
 *
 * ─── SECRETS ONLY, and the rest go somewhere else ──────────────────────────
 *
 * This form is CONNECT: it collects the values marked `secret` and posts them
 * to the encrypted credentials table. Everything else an add-on declares is
 * ordinary configuration and is edited in `SettingsForm` below, which writes
 * through `PUT /add-ons/:key/settings`. The two are separate because their
 * destinations are: one is encrypted and never read back, the other is read
 * back in clear on every render.
 *
 * Values are cleared on submit rather than kept for a retry — a secret sitting
 * in component state after the request that needed it is a secret nobody
 * decided to keep.
 */
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

  /*
   * The declared secrets, or `api_key` when a manifest declares none. The
   * fallback keeps every add-on that connected before this change connecting
   * after it — `connect: 'api-key'` with no `settings` entry was the shape
   * three of them shipped.
   */
  const secrets = addOn.settings.filter((setting) => setting.secret);
  const fields =
    secrets.length > 0
      ? secrets
      : [
          {
            key: 'api_key',
            type: 'string',
            required: true,
            secret: true,
            label: { key: 'studio:addOns.connect.apiKey', fallback: 'API key' },
            help: null,
            options: [],
          },
        ];

  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">
            {field.label === null ? field.key : t(field.label.key, field.label.fallback)}
          </span>
          <Input
            // `password`, so a shoulder and a screen recording see dots. The
            // value never reaches a settings row either way, but the field it
            // is typed into is the one place it is visible.
            type="password"
            autoComplete="off"
            value={values[field.key] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.key]: event.currentTarget.value }))
            }
          />
          {field.help !== null && (
            <span className="text-xs text-fg-muted">{t(field.help.key, field.help.fallback)}</span>
          )}
        </label>
      ))}
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
 * SIDELOAD — upload a package this server could not have fetched.
 *
 * ── WHY THE HASH FIELD IS REQUIRED, AND NOT A CONVENIENCE ──────────────────
 *
 * An air-gapped operator has no registry to download from, so the only way in
 * is a file they carried. That path runs the IDENTICAL
 * verify-then-hardened-unpack the download path runs — one code path for
 * bundled, downloaded and uploaded packages — which means it needs the same
 * thing a download gets from the catalog: a hash to verify against, supplied by
 * somebody other than the bytes themselves.
 *
 * Every release publishes exactly this value beside its Download link, so the
 * person doing the sideloading can carry it without trusting this page, and the
 * server refuses anything that does not match. A form that computed the hash
 * from the uploaded file would be verifying the bytes against themselves.
 *
 * ── WHY THE KEY AND VERSION ARE NOT ASKED FOR ──────────────────────────────
 *
 * The server reads them from the package's own `manifest.json`, which is inside
 * the bytes the hash verifies — never from the filename, which an operator can
 * rename. Asking for them added nothing but a way to be wrong: a typed key that
 * differed from the manifest staged the package under a key its bundle URLs do
 * not use, so it installed and then served nothing. The card says what was read
 * once the upload lands.
 */
function SideloadCard({
  busy,
  onUpload,
}: {
  busy: boolean;
  /** Resolves to what the server staged, or `undefined` when it was refused. */
  onUpload: (file: File, input: { expectedSha512: string }) => Promise<StagedPackage | undefined>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sha, setSha] = useState('');
  const [uploaded, setUploaded] = useState<StagedPackage | null>(null);
  // Remounts the file input after an upload: a file input cannot be cleared
  // through React state, and leaving the old file picked invites sending it
  // again with the next package's hash.
  const [picker, setPicker] = useState(0);
  const ready = file !== null && sha.startsWith('sha512-');

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
        {uploaded === null ? null : (
          <Alert
            tone="pos"
            role="status"
            title={t('studio:addOns.sideload.uploaded.title', 'Uploaded {name} {version}', {
              name: uploaded.name,
              version: uploaded.version,
            })}
          >
            {t('studio:addOns.sideload.uploaded.body', 'Install it from the list above.')}
          </Alert>
        )}
        <FormField label={t('studio:addOns.sideload.file', 'Package file (.tgz)')}>
          <input
            key={picker}
            type="file"
            accept=".tgz,application/gzip"
            disabled={busy}
            aria-label={t('studio:addOns.sideload.file', 'Package file (.tgz)')}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
              setUploaded(null);
            }}
          />
        </FormField>
        <FormField
          label={t('studio:addOns.sideload.sha', 'Integrity (sha512-…)')}
          helper={t(
            'studio:addOns.sideload.shaHint',
            'The sha512- fingerprint published with the release, shown beside its Download link on adminium.dev/marketplace. The upload is refused if the bytes do not match.',
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
              void onUpload(file, { expectedSha512: sha }).then((staged) => {
                if (staged === undefined) return;
                setUploaded(staged);
                // The hash described that file, and would refuse the next one.
                setFile(null);
                setSha('');
                setPicker((n) => n + 1);
              });
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
  /** An app needs the add-on: refused (it requires it) or warned (a feature of it stops). */
  const [needed, setNeeded] = useState<{ needed: AddOnNeeded; confirm?: () => void } | null>(null);

  /*
   * "Open its settings" on an app's page lands here on `#add-on-<key>`: the
   * add-on's row is brought into view once the list has painted.
   */
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id.startsWith('add-on-')) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, []);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ADD_ONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ADD_ON_CATALOG_QUERY_KEY }),
    ]);
  };

  /**
   * One place that turns a thrown request into page state. Resolves to what
   * the request returned, or `undefined` once its failure is on the page.
   */
  const run = async <T,>(fn: () => Promise<T>, refusedAs?: Omit<AddOnNeeded, 'uses'>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (caught) {
      /*
       * The server's own guard: an app requires it. The page read who uses
       * it before the click, so this is a list that changed in between — the
       * same dialog, from the server's list, rather than a bare message.
       */
      if (refusedAs !== undefined && caught instanceof ApiError && caught.code === 'ADD_ON_REQUIRED_BY') {
        const apps = ((caught.details as { apps?: { app: string; name: string; status: string }[] } | undefined)?.apps ?? []);
        setNeeded({
          needed: {
            ...refusedAs,
            uses: apps.map((app) => ({ app: app.app, appName: app.name, status: app.status, need: 'requires', range: null, features: [] })),
          },
        });
        await refresh();
        return undefined;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  /** Uninstall: refused while an app requires it, warned while an app's feature uses it. */
  const askUninstall = (addOn: AddOnDto): void => {
    const uses = addOn.usedBy ?? [];
    const target = { key: addOn.key, name: addOn.name, version: addOn.version };
    const requiring = uses.filter((use) => use.need === 'requires');
    const featured = uses.filter((use) => use.need === 'feature');
    if (requiring.length > 0) {
      setNeeded({ needed: { action: 'uninstall', addOn: target, uses: requiring } });
    } else if (featured.length > 0) {
      setNeeded({
        needed: { action: 'uninstall', addOn: target, uses: featured },
        confirm: () => {
          setNeeded(null);
          void run(() => uninstallAddOn(addOn.key), { action: 'uninstall', addOn: target });
        },
      });
    } else {
      setPending({ kind: 'uninstall', addOn });
    }
  };

  /** Switching it off for one app: refused when that app requires it, warned when a feature of it stops. */
  const toggleAttachment = (addOn: AddOnDto, attachedTo: string, enabled: boolean): void => {
    const target = { key: addOn.key, name: addOn.name, version: addOn.version };
    const go = () =>
      void run(() => setAddOnEnabled(addOn.key, attachedTo, !enabled), { action: 'switch-off', addOn: target, host: attachedTo });
    if (!enabled) {
      go();
      return;
    }
    const uses = (addOn.usedBy ?? []).filter((use) => use.app === attachedTo);
    const requiring = uses.filter((use) => use.need === 'requires');
    const featured = uses.filter((use) => use.need === 'feature');
    if (requiring.length > 0) {
      setNeeded({ needed: { action: 'switch-off', addOn: target, uses: requiring, host: attachedTo } });
    } else if (featured.length > 0) {
      setNeeded({
        needed: { action: 'switch-off', addOn: target, uses: featured, host: attachedTo },
        confirm: () => {
          setNeeded(null);
          go();
        },
      });
    } else {
      go();
    }
  };

  /**
   * Run something that returns a JOB, and follow it to the end.
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

      <AddOnBrowser
        catalog={catalog}
        busy={busy}
        onRefreshCatalog={() => {
          void runJob(refreshCatalog);
        }}
        onToggleOnline={(next) => {
          void run(async () => {
            const state = await setCatalogEnabled(next);
            setVetoed(state.vetoed);
          });
        }}
        onDownload={(entry) => {
          void runJob(() => downloadAddOn(entry.key, entry.version));
        }}
        onInstall={openConsent}
        onDiscard={(entry) => setPending({ kind: 'discard', entry })}
        onUpgrade={(entry) => {
          void run(() => upgradeAddOn(entry.key));
        }}
      />

      <SideloadCard busy={busy} onUpload={(file, input) => run(() => uploadAddOn(file, input))} />

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
                <li key={addOn.key} id={`add-on-${addOn.key}`} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <strong>{addOn.name}</strong>
                    <Badge tone="neutral">{addOn.version}</Badge>
                    {/* Before the badge, a wiped volume left this row reading
                        as a healthy install — down to "Connected", since the
                        credential row survives it. */}
                    {addOn.missing && (
                      <Badge tone="danger">
                        {t('studio:addOns.installed.missing', 'Missing')}
                      </Badge>
                    )}
                    {addOn.connectKind !== 'none' && (
                      <Badge tone={addOn.connected ? 'pos' : 'warn'}>
                        {addOn.connected
                          ? t('studio:addOns.installed.connected', 'Connected')
                          : t('studio:addOns.installed.notConnected', 'Not connected')}
                      </Badge>
                    )}
                  </span>

                  {addOn.missing && (
                    <p className="text-xs text-danger">
                      {t(
                        'studio:addOns.installed.missingBody',
                        'Its files are not on this server, so none of it loads. Install it again, or remove it.',
                      )}
                    </p>
                  )}

                  {addOn.networkAllow.length > 0 && (
                    <p className="text-xs text-fg-muted">
                      <ShieldCheck className="inline size-3" />{' '}
                      {t('studio:addOns.installed.egress', 'May contact: {hosts}', {
                        hosts: addOn.networkAllow.join(', '),
                      })}
                    </p>
                  )}

                  {(addOn.usedBy ?? []).length === 0 ? null : <UsedByLine uses={addOn.usedBy ?? []} />}

                  <div className="flex flex-wrap gap-2">
                    {addOn.attachments.map((attachment) => (
                      <Button
                        key={attachment.attachedTo}
                        size="sm"
                        variant={attachment.enabled ? 'secondary' : 'ghost'}
                        disabled={busy}
                        onClick={() => toggleAttachment(addOn, attachment.attachedTo, attachment.enabled)}
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

                  {/*
                    * The non-secret half. Rendered whether or not the add-on
                    * is connected — a `connect: 'none'` add-on has settings
                    * too, and until the dashboard slot host lands this is the
                    * only place they can be edited.
                    */}
                  <SettingsForm addOn={addOn} busy={busy} />

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
                      onClick={() => askUninstall(addOn)}
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
                void run<unknown>(
                  () => {
                    if (current.kind === 'disconnect') return disconnectAddOn(current.addOn.key);
                    if (current.kind === 'uninstall') return uninstallAddOn(current.addOn.key);
                    return discardStaged(current.entry.key, current.entry.version);
                  },
                  current.kind === 'uninstall'
                    ? { action: 'uninstall', addOn: { key: current.addOn.key, name: current.addOn.name, version: current.addOn.version } }
                    : undefined,
                );
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

      {needed === null ? null : (
        <AddOnNeededDialog needed={needed.needed} busy={busy} onClose={() => setNeeded(null)} onConfirm={needed.confirm} />
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
