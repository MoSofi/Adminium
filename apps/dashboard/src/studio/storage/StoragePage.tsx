// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/storage` — where the instance's bytes live
 * (37-files-and-storage.md §3.8, 37-T21).
 *
 * Four things an operator does here, and one they must never be able to do by
 * accident:
 *
 *  1. **See where every byte already is.** The list opens with "This server's
 *     disk", which is not a row in any table: `destination_id IS NULL` is the
 *     implicit destination (37 D3). It cannot be edited, disabled or deleted,
 *     and it is the only place that can report how much room is left, because
 *     the local driver can call `statfs` and a bucket cannot. Every figure on
 *     this page is a bare fact — "N used", and for the disk "N available on
 *     this disk". Never a fraction of a capacity: the comp's "128.4 GB of
 *     200 GB" meter is a comp defect (37 D23, Appendix D), and a denominator
 *     is the first half of a sales pitch this product does not make.
 *
 *  2. **Add a destination** — a path on this machine, any S3-compatible
 *     bucket, any WebDAV server. The S3 presets fill endpoint, region and
 *     path-style; where a provider cannot be known without the operator's own
 *     account id or region, the preset leaves the field EMPTY and shows the
 *     shape as a placeholder. A plausible wrong endpoint fails at the first
 *     upload; a blank one fails at Test, in front of the person who can fix it.
 *
 *  3. **Test — before saving as well as after.** A failure is a 200 whose
 *     `data.ok` is false, and the provider's message (`SignatureDoesNotMatch`,
 *     `NoSuchBucket`, a TLS error) is rendered verbatim. It is the only part
 *     of the reply the operator can act on, so this surface never paraphrases
 *     it and never routes it through the error boundary.
 *
 *  4. **Move files.** From and to, both ends including this server's disk,
 *     which is how "move everything off the box" is said. It starts a job and
 *     shows the id; this page deliberately does not poll it — a migration runs
 *     for as long as it runs, and a spinner that owns the tab would be a worse
 *     answer than a sentence saying it continues without you.
 *
 * And the thing that must not happen: THE SECRET IS WRITE-ONLY. The server
 * never sends a credential back, so the editor has nothing to prefill; the
 * fields open blank on an edit too, and the page says the stored one is kept.
 * A blank field must therefore reach the PATCH as an ABSENT key, never as an
 * empty string — an empty string would replace a working credential with a
 * broken one and take every future upload with it. `patchBodyFromDraft` owns
 * that rule and `draftSecretIssue` catches the half-typed pair that would
 * otherwise be dropped in silence.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HardDrive, Cloud, FolderInput, Plus, Server } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  FormField,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  StatusPill,
  Switch,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { t } from '../../i18n/t.js';
import {
  DESTINATIONS_QUERY_KEY,
  LOCAL_DESTINATION_VALUE,
  STORAGE_USAGE_QUERY_KEY,
  S3_PRESETS,
  applyPreset,
  createBodyFromDraft,
  createDestination,
  deleteDestination,
  destinationsQuery,
  draftFromDestination,
  draftIsSavable,
  draftSecretIssue,
  emptyDraft,
  fileCountFromError,
  formatBytes,
  messageFromError,
  migrateFiles,
  patchBodyFromDraft,
  presetById,
  setDefaultDestination,
  storageUsageQuery,
  testBodyFromDraft,
  testDestination,
  testDraftDestination,
  updateDestination,
  type DestinationDraft,
  type DestinationTestResult,
  type DestinationView,
  type S3Preset,
  type S3PresetId,
  type StorageDriver,
  MIGRATE_KINDS,
  type MigrateKind,
  type StorageUsageEntry,
} from './storageApi.js';

/**
 * File-kind names for the move filter. A `switch` for the same reason
 * `driverLabel` is one: a key assembled at runtime is invisible to the
 * extractor and to the parity gate (`adminium/no-dynamic-i18n-key`).
 *
 * The wording says what each kind IS to the operator, not what the column
 * stores — "uploads" means nothing until you say they are the files people
 * attached to records.
 */
function migrateKindLabel(kind: MigrateKind): string {
  switch (kind) {
    case 'upload':
      return t('studio:storage.kind.upload', 'Files attached to records');
    case 'export':
      return t('studio:storage.kind.export', 'Export artifacts');
    case 'import':
      return t('studio:storage.kind.import', 'Uploaded CSVs and their error reports');
    case 'branding':
      return t('studio:storage.kind.branding', 'The workspace logo');
    case 'schema':
      return t('studio:storage.kind.schema', 'Imported schema files');
    case 'archive':
      return t('studio:storage.kind.archive', 'Archived audit batches');
  }
}

/**
 * Driver names. A `switch` rather than a lookup keyed by the driver string,
 * because a computed key is invisible to the extractor and to the parity gate
 * (`adminium/no-dynamic-i18n-key`).
 */
function driverLabel(driver: StorageDriver | string): string {
  switch (driver) {
    case 'local':
      return t('studio:storage.driver.local', 'A path on this machine');
    case 's3':
      return t('studio:storage.driver.s3', 'S3-compatible bucket');
    case 'webdav':
      return t('studio:storage.driver.webdav', 'WebDAV server');
    default:
      return driver;
  }
}

/** Provider names, used nominatively as picker labels (37 Appendix D allows this; logos are banned). */
function presetLabel(id: S3PresetId): string {
  switch (id) {
    case 'aws':
      return t('studio:storage.preset.aws', 'AWS S3');
    case 'spaces':
      return t('studio:storage.preset.spaces', 'DigitalOcean Spaces');
    case 'r2':
      return t('studio:storage.preset.r2', 'Cloudflare R2');
    case 'tigris':
      return t('studio:storage.preset.tigris', 'Tigris');
    case 'b2':
      return t('studio:storage.preset.b2', 'Backblaze B2');
    case 'wasabi':
      return t('studio:storage.preset.wasabi', 'Wasabi');
    case 'minio':
      return t('studio:storage.preset.minio', 'MinIO or another S3-compatible server');
  }
}

function statusLabel(status: DestinationView['status']): string {
  switch (status) {
    case 'ok':
      return t('studio:storage.status.ok', 'Reachable');
    case 'error':
      return t('studio:storage.status.error', 'Unreachable');
    case 'untested':
      return t('studio:storage.status.untested', 'Not tested');
  }
}

/** Which bucket, share or path a row points at — the line under its name. */
function destinationTarget(destination: DestinationView): string {
  const config = destination.config as {
    root?: string;
    bucket?: string;
    prefix?: string;
    url?: string;
  };
  const base =
    destination.driver === 'local'
      ? (config.root ?? '')
      : destination.driver === 's3'
        ? (config.bucket ?? '')
        : (config.url ?? '');
  const prefix = config.prefix ?? '';
  return prefix === '' ? base : `${base}/${prefix}`;
}

export function StoragePage() {
  const client = useQueryClient();
  const destinations = useQuery(destinationsQuery());
  /*
   * Usage is its own query and its own failure. It is the FILES route, it
   * answers for the implicit destination that has no row, and an operator
   * whose grants cover storage but not files still gets the whole list — the
   * page just has no byte figures to draw. Folding it into the destinations
   * query would have made a missing figure look like a missing destination.
   */
  const usage = useQuery(storageUsageQuery());

  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [deleting, setDeleting] = useState<DestinationView | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ name: string; fileCount: number } | null>(
    null,
  );
  /** Last Test result per saved row, keyed by id; the drawer keeps its own. */
  const [probes, setProbes] = useState<Record<string, DestinationTestResult>>({});
  const [movedJobId, setMovedJobId] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: DESTINATIONS_QUERY_KEY }),
      client.invalidateQueries({ queryKey: STORAGE_USAGE_QUERY_KEY }),
    ]);
  };

  const save = useMutation({
    mutationFn: async (next: DestinationDraft) =>
      next.id === null
        ? createDestination(createBodyFromDraft(next))
        : updateDestination(next.id, patchBodyFromDraft(next)),
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await refresh();
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const remove = useMutation({
    mutationFn: (destination: DestinationView) => deleteDestination(destination.id),
    onSuccess: async () => {
      setDeleting(null);
      setDeleteBlocked(null);
      setError(null);
      await refresh();
    },
    onError: (raised: unknown, destination: DestinationView) => {
      const fileCount = fileCountFromError(raised);
      setDeleting(null);
      // A 409 is not a failure to report as one: it is the server saying the
      // destination still holds files, and the count is the whole instruction.
      if (fileCount !== null) setDeleteBlocked({ name: destination.name, fileCount });
      else setError(messageFromError(raised));
    },
  });

  const makeDefault = useMutation({
    mutationFn: (destination: DestinationView) => setDefaultDestination(destination.id),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const toggleDisabled = useMutation({
    mutationFn: (destination: DestinationView) =>
      updateDestination(destination.id, { disabled: !destination.disabled }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const probe = useMutation({
    mutationFn: (destination: DestinationView) => testDestination(destination.id),
    onSuccess: async (result, destination) => {
      setProbes((current) => ({ ...current, [destination.id]: result }));
      // The probe stamps `status` and `lastError` on the row, so the list is
      // stale the moment it returns.
      await client.invalidateQueries({ queryKey: DESTINATIONS_QUERY_KEY });
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const move = useMutation({
    mutationFn: (input: { from: string; to: string }) => migrateFiles(input),
    onSuccess: (jobId) => {
      setMovedJobId(jobId);
      setMoving(false);
      setError(null);
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const rows = destinations.data ?? [];
  const usageRows = usage.data ?? [];
  const usageFor = (id: string | null): StorageUsageEntry | undefined =>
    usageRows.find((entry) => entry.destinationId === id);
  const localUsage = usageFor(null);
  /* No row is the default ⇒ the implicit destination is (37 D3). */
  const localIsDefault = !rows.some((row) => row.isDefault);
  const busy =
    save.isPending ||
    remove.isPending ||
    makeDefault.isPending ||
    toggleDisabled.isPending ||
    move.isPending;

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:storage.title', 'Storage')}
        subtitle={t(
          'studio:storage.subtitle',
          'Where this instance keeps uploaded files, exports and other stored bytes.',
        )}
      >
        <Button
          variant="secondary"
          iconLeft={<FolderInput className="size-4" />}
          disabled={busy}
          onClick={() => {
            setMovedJobId(null);
            setMoving(true);
          }}
          data-testid="studio-storage-move-open"
        >
          {t('studio:storage.move.open', 'Move files…')}
        </Button>
        <Button
          iconLeft={<Plus className="size-4" />}
          disabled={busy}
          onClick={() => setDraft(emptyDraft())}
          data-testid="studio-storage-add"
        >
          {t('studio:storage.add', 'Add a destination')}
        </Button>
      </PageActions>

      {destinations.isError ? (
        <Alert
          tone="danger"
          role="alert"
          data-testid="studio-storage-error"
          title={t('studio:storage.loadFailed.title', 'Destinations could not be loaded')}
          // A 403 is the expected failure — `storage.manage` is a new key that
          // no built-in role holds. Anything else must NOT be reported as a
          // permission problem: that sends the operator to edit a role matrix
          // that was never the cause.
          body={
            destinations.error instanceof ApiError && destinations.error.status === 403
              ? t(
                  'studio:storage.loadFailed.forbidden',
                  'Changing where files are stored needs the “Manage storage” permission. Ask an administrator to grant it to one of your roles.',
                )
              : messageFromError(destinations.error)
          }
        />
      ) : null}

      {error !== null ? (
        <Alert
          tone="danger"
          role="alert"
          data-testid="studio-storage-action-error"
          title={t('studio:storage.actionFailed', 'That did not work')}
          body={error}
        />
      ) : null}

      {deleteBlocked !== null ? (
        <Alert
          tone="warn"
          role="alert"
          data-testid="studio-storage-delete-blocked"
          title={t('studio:storage.delete.blockedTitle', 'This destination still holds files')}
          // A real plural rather than `fmt` + "(s)": the count is the whole
          // instruction, and it is the one string on this page where an
          // inflecting language would read as broken.
          body={t(
            'studio:storage.delete.blockedBody',
            '{name} still holds {count, plural, one {# file} other {# files}}. Move them to another destination first, then delete it.',
            { name: deleteBlocked.name, count: deleteBlocked.fileCount },
          )}
        />
      ) : null}

      {movedJobId !== null ? (
        <Alert
          tone="info"
          role="status"
          data-testid="studio-storage-move-started"
          title={t('studio:storage.move.startedTitle', 'The move has started')}
          body={t(
            'studio:storage.move.startedBody',
            'It runs in the background as job {jobId} and keeps going if you leave this page. The counts below change as files arrive — reload to see them.',
            { jobId: movedJobId },
          )}
        />
      ) : null}

      {destinations.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner size="md" />
        </div>
      ) : null}

      {destinations.isSuccess ? (
        <Card padded={false}>
          <CardHeader className="flex items-start gap-3">
            <IconTile tone="accent" size="md" icon={<HardDrive />} />
            <div className="min-w-0">
              <h2 className="text-section text-fg">
                {t('studio:storage.list.title', 'Destinations')}
              </h2>
              <p className="text-body-sm text-fg-muted">
                {t(
                  'studio:storage.list.subtitle',
                  'New files go to the default destination. Existing files stay where they are until you move them.',
                )}
              </p>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <ul data-testid="studio-storage-list">
              {/*
                The implicit destination, always first and never editable. It
                is not a row in any table — see the file header — so it carries
                no id, no Test and no Delete, and its only extra fact is the
                one only a local driver can know.
              */}
              <li className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <IconTile tone="neutral" size="sm" icon={<Server />} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {t('studio:storage.localDisk', "This server's disk")}
                    {localIsDefault ? (
                      <Badge tone="accent" data-testid="studio-storage-local-default">
                        {t('studio:storage.default', 'Default')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-body-sm text-fg-muted">
                    {driverLabel('local')}
                    {localUsage === undefined ? null : (
                      <>
                        {' · '}
                        <span data-testid="studio-storage-local-usage">
                          {t('studio:storage.usedBytes', '{size} used', {
                            size: formatBytes(localUsage.bytes),
                          })}
                        </span>
                        {' · '}
                        {t(
                          'studio:storage.fileCount',
                          '{count, plural, one {# file} other {# files}}',
                          { count: localUsage.files },
                        )}
                        {localUsage.available === undefined ? null : (
                          <>
                            {' · '}
                            <span data-testid="studio-storage-local-available">
                              {t(
                                'studio:storage.availableOnDisk',
                                '{size} available on this disk',
                                { size: formatBytes(localUsage.available) },
                              )}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </li>

              {rows.map((destination) => (
                <DestinationRow
                  key={destination.id}
                  destination={destination}
                  usage={usageFor(destination.id)}
                  probe={probes[destination.id]}
                  busy={busy || probe.isPending}
                  onEdit={() => {
                    setError(null);
                    setDraft(draftFromDestination(destination));
                  }}
                  onTest={() => probe.mutate(destination)}
                  onDefault={() => makeDefault.mutate(destination)}
                  onToggleDisabled={() => toggleDisabled.mutate(destination)}
                  onDelete={() => {
                    setDeleteBlocked(null);
                    setDeleting(destination);
                  }}
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {draft !== null ? (
        <DestinationEditor
          draft={draft}
          busy={save.isPending}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => save.mutate(draft)}
        />
      ) : null}

      {deleting !== null ? (
        <Modal
          open
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
        >
          <ModalHeader
            tone="danger"
            title={t('studio:storage.delete.title', 'Delete this destination')}
            closeLabel={t('common.close', 'Close')}
          />
          <ModalBody>
            <p className="text-body-sm text-fg-muted">
              {t(
                'studio:storage.delete.body',
                'Adminium forgets {name} and its credential. Nothing stored in it is touched — the bucket or server itself is yours, and files still recorded against it will refuse the delete.',
                { name: deleting.name },
              )}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => remove.mutate(deleting)}
              data-testid="studio-storage-delete-confirm"
            >
              {t('studio:storage.delete.confirm', 'Delete destination')}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}

      {moving ? (
        <MoveFilesModal
          destinations={rows}
          busy={move.isPending}
          onClose={() => setMoving(false)}
          onMove={(input) => move.mutate(input)}
        />
      ) : null}
    </PageSurface>
  );
}

/* ------------------------------------------------------------- one row */

function DestinationRow({
  destination,
  usage,
  probe,
  busy,
  onEdit,
  onTest,
  onDefault,
  onToggleDisabled,
  onDelete,
}: {
  destination: DestinationView;
  usage: StorageUsageEntry | undefined;
  probe: DestinationTestResult | undefined;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDefault: () => void;
  onToggleDisabled: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
      data-testid={`studio-storage-row-${destination.id}`}
    >
      <IconTile tone="neutral" size="sm" icon={<Cloud />} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {destination.name}
          {destination.isDefault ? (
            <Badge tone="accent">{t('studio:storage.default', 'Default')}</Badge>
          ) : null}
          {destination.disabled ? (
            <Badge tone="warn">{t('studio:storage.disabled', 'Disabled')}</Badge>
          ) : null}
          <StatusPill
            status={destination.status}
            tone={
              destination.status === 'ok'
                ? 'pos'
                : destination.status === 'error'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {statusLabel(destination.status)}
          </StatusPill>
        </p>
        <p className="text-body-sm text-fg-muted">
          {driverLabel(destination.driver)}
          {' · '}
          <span className="font-mono">{destinationTarget(destination)}</span>
          {/*
            Bytes come from the usage route and the count from the row itself,
            so when usage did not load the figure is simply ABSENT. Rendering
            "0 byte used" from a missing answer would be a fabricated fact
            about somebody's bucket, and the file count — which the
            destinations route computes server-side — is still true.
          */}
          {usage === undefined ? null : (
            <>
              {' · '}
              {t('studio:storage.usedBytes', '{size} used', { size: formatBytes(usage.bytes) })}
            </>
          )}
          {' · '}
          {t('studio:storage.fileCount', '{count, plural, one {# file} other {# files}}', {
            count: destination.fileCount,
          })}
        </p>
        {/*
          The provider's own words, twice over: `lastError` is what the last
          stored probe said, and `probe` is what the one just clicked said.
          Neither is paraphrased — a rewritten `SignatureDoesNotMatch` is a
          rewritten instruction.
        */}
        {destination.status === 'error' && destination.lastError !== null ? (
          <p className="text-body-sm text-danger" data-testid={`studio-storage-last-error-${destination.id}`}>
            {destination.lastError}
          </p>
        ) : null}
        {probe === undefined ? null : probe.ok ? (
          <p className="text-body-sm text-pos" data-testid={`studio-storage-probe-${destination.id}`}>
            {t('studio:storage.test.ok', 'Reached in {ms}ms', { ms: probe.latencyMs })}
          </p>
        ) : (
          <p className="text-body-sm text-danger" data-testid={`studio-storage-probe-${destination.id}`}>
            {probe.error}
          </p>
        )}
        {destination.disabled ? (
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio:storage.defaultBlockedByDisabled',
              'A disabled destination cannot be the default. Enable it first.',
            )}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={onTest}
          data-testid={`studio-storage-test-${destination.id}`}
        >
          {t('studio:storage.test.button', 'Test')}
        </Button>
        {/*
          "Set as default" is not offered on a disabled destination, because
          the server 409s it — an affordance that cannot succeed is a trap, so
          the row explains the refusal instead of performing it.
        */}
        {!destination.isDefault && !destination.disabled ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={onDefault}
            data-testid={`studio-storage-default-${destination.id}`}
          >
            {t('studio:storage.setDefault', 'Set as default')}
          </Button>
        ) : null}
        <Button variant="ghost" disabled={busy} onClick={onToggleDisabled}>
          {destination.disabled
            ? t('studio:storage.enable', 'Enable')
            : t('studio:storage.disable', 'Disable')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={onEdit}
          data-testid={`studio-storage-edit-${destination.id}`}
        >
          {t('studio:storage.edit', 'Edit')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDelete}>
          {t('studio:storage.deleteButton', 'Delete')}
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------- the editor drawer */

function DestinationEditor({
  draft,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  draft: DestinationDraft;
  busy: boolean;
  onChange: (next: DestinationDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  /*
   * The draft Test lives here rather than in the page: it is about what is on
   * screen right now, not about a saved row, and it is the FIRST-configuration
   * path — an operator typing bucket credentials should find out they are
   * wrong without first storing them.
   */
  const [result, setResult] = useState<DestinationTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const patch = (change: Partial<DestinationDraft>): void => onChange({ ...draft, ...change });
  const preset: S3Preset = presetById(draft.presetId);
  const secretIssue = draftSecretIssue(draft);

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTestError(null);
    setResult(null);
    try {
      setResult(await testDraftDestination(testBodyFromDraft(draft)));
    } catch (raised) {
      // A transport failure is NOT a probe result: the reply never arrived, so
      // there is no provider message to show and pretending otherwise would
      // blame the bucket for the browser.
      setTestError(messageFromError(raised));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Drawer
      open
      size="lg"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerHeader
        icon={<Cloud />}
        title={
          draft.id === null
            ? t('studio:storage.editor.createTitle', 'Add a destination')
            : t('studio:storage.editor.editTitle', 'Edit destination')
        }
        subtitle={t(
          'studio:storage.editor.subtitle',
          'Adminium reads and writes through this destination on your behalf; it is infrastructure you control.',
        )}
        closeLabel={t('common.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-4">
        <FormField label={t('studio:storage.field.name', 'Name')}>
          <Input
            value={draft.name}
            placeholder={t('studio:storage.field.namePlaceholder', 'Uploads bucket')}
            onChange={(event) => patch({ name: event.target.value })}
            data-testid="studio-storage-field-name"
          />
        </FormField>

        <FormField
          label={t('studio:storage.field.driver', 'Kind')}
          helper={
            draft.id === null
              ? undefined
              : t(
                  'studio:storage.field.driverLocked',
                  'Changing the kind of a destination that already holds files would leave those files unreachable.',
                )
          }
        >
          <Select
            value={draft.driver}
            disabled={draft.id !== null}
            onChange={(event) => patch({ driver: event.target.value as StorageDriver })}
            data-testid="studio-storage-field-driver"
          >
            <option value="local">{driverLabel('local')}</option>
            <option value="s3">{driverLabel('s3')}</option>
            <option value="webdav">{driverLabel('webdav')}</option>
          </Select>
        </FormField>

        {draft.driver === 'local' ? (
          <FormField
            label={t('studio:storage.field.root', 'Directory')}
            helper={t(
              'studio:storage.field.rootHelper',
              'An absolute path this server can write to — a mounted volume or a network share. Not the default directory, which is already the first entry in the list.',
            )}
          >
            <Input
              value={draft.root}
              placeholder="/srv/adminium/files"
              onChange={(event) => patch({ root: event.target.value })}
              data-testid="studio-storage-field-root"
            />
          </FormField>
        ) : null}

        {draft.driver === 's3' ? (
          <>
            <FormField
              label={t('studio:storage.field.preset', 'Provider')}
              helper={t(
                'studio:storage.field.presetHelper',
                'Fills in the endpoint, region and addressing style. Anything the provider cannot know about your account is left blank for you to type.',
              )}
            >
              <Select
                value={draft.presetId}
                onChange={(event) =>
                  onChange(applyPreset(draft, event.target.value as S3PresetId))
                }
                data-testid="studio-storage-field-preset"
              >
                {S3_PRESETS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {presetLabel(entry.id)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label={t('studio:storage.field.endpoint', 'Endpoint')}
              helper={
                preset.endpointHint === ''
                  ? t(
                      'studio:storage.field.endpointDerived',
                      'Leave empty for AWS itself — the endpoint follows from the region.',
                    )
                  : undefined
              }
            >
              <Input
                value={draft.endpoint}
                placeholder={preset.endpointHint}
                onChange={(event) => patch({ endpoint: event.target.value })}
                data-testid="studio-storage-field-endpoint"
              />
            </FormField>

            <FormField label={t('studio:storage.field.region', 'Region')}>
              <Input
                value={draft.region}
                placeholder={preset.regionHint}
                onChange={(event) => patch({ region: event.target.value })}
                data-testid="studio-storage-field-region"
              />
            </FormField>

            <FormField label={t('studio:storage.field.bucket', 'Bucket')}>
              <Input
                value={draft.bucket}
                onChange={(event) => patch({ bucket: event.target.value })}
                data-testid="studio-storage-field-bucket"
              />
            </FormField>

            <label className="flex items-center gap-2">
              <span className="text-body-sm text-fg-muted">
                {t('studio:storage.field.pathStyle', 'Path-style addressing')}
              </span>
              <Switch
                checked={draft.forcePathStyle}
                aria-label={t(
                  'studio:storage.field.pathStyleToggle',
                  'Address the bucket as a path rather than a hostname',
                )}
                onCheckedChange={(checked) => patch({ forcePathStyle: checked })}
                data-testid="studio-storage-field-path-style"
              />
            </label>
          </>
        ) : null}

        {draft.driver === 'webdav' ? (
          <FormField
            label={t('studio:storage.field.url', 'Collection URL')}
            helper={t(
              'studio:storage.field.urlHelper',
              'The collection Adminium writes into, as your server publishes it.',
            )}
          >
            <Input
              value={draft.url}
              placeholder="https://nas.example.com/remote.php/dav/files/ava"
              onChange={(event) => patch({ url: event.target.value })}
              data-testid="studio-storage-field-url"
            />
          </FormField>
        ) : null}

        {draft.driver !== 'local' ? (
          <>
            <FormField
              label={t('studio:storage.field.prefix', 'Prefix')}
              helper={t(
                'studio:storage.field.prefixHelper',
                'A folder inside the destination. Two destinations on one bucket that differ only here share the bucket without sharing a namespace.',
              )}
            >
              <Input
                value={draft.prefix}
                placeholder="adminium/"
                onChange={(event) => patch({ prefix: event.target.value })}
                data-testid="studio-storage-field-prefix"
              />
            </FormField>

            <FormField
              label={t('studio:storage.field.publicBaseUrl', 'Public base URL')}
              helper={t(
                'studio:storage.field.publicBaseUrlHelper',
                'Optional. Where these objects are readable without Adminium — a CDN in front of a public bucket. Used only when a column stores a link.',
              )}
            >
              <Input
                value={draft.publicBaseUrl}
                placeholder="https://cdn.example.com"
                onChange={(event) => patch({ publicBaseUrl: event.target.value })}
                data-testid="studio-storage-field-public-base-url"
              />
            </FormField>
          </>
        ) : null}

        {/*
          THE WRITE-ONLY HALF. Blank on every open, including an edit — the
          server never sent a credential to prefill with. The helper says what
          leaving it blank does, because the alternative reading ("blank means
          none") is exactly the one that would cost an operator their bucket.
        */}
        {draft.driver === 's3' ? (
          <>
            <FormField label={t('studio:storage.field.accessKeyId', 'Access key ID')}>
              <Input
                value={draft.accessKeyId}
                autoComplete="off"
                onChange={(event) => patch({ accessKeyId: event.target.value })}
                data-testid="studio-storage-field-access-key"
              />
            </FormField>
            <FormField
              label={t('studio:storage.field.secretAccessKey', 'Secret access key')}
              helper={
                draft.hasSecret
                  ? t(
                      'studio:storage.field.secretKept',
                      'A key is stored. Leave both fields blank to keep it; fill in both to replace it.',
                    )
                  : undefined
              }
            >
              <Input
                type="password"
                value={draft.secretAccessKey}
                autoComplete="new-password"
                onChange={(event) => patch({ secretAccessKey: event.target.value })}
                data-testid="studio-storage-field-secret-key"
              />
            </FormField>
          </>
        ) : null}

        {draft.driver === 'webdav' ? (
          <>
            <FormField label={t('studio:storage.field.username', 'Username')}>
              <Input
                value={draft.username}
                autoComplete="off"
                onChange={(event) => patch({ username: event.target.value })}
                data-testid="studio-storage-field-username"
              />
            </FormField>
            <FormField
              label={t('studio:storage.field.password', 'Password')}
              helper={
                draft.hasSecret
                  ? t(
                      'studio:storage.field.secretKept',
                      'A key is stored. Leave both fields blank to keep it; fill in both to replace it.',
                    )
                  : undefined
              }
            >
              <Input
                type="password"
                value={draft.password}
                autoComplete="new-password"
                onChange={(event) => patch({ password: event.target.value })}
                data-testid="studio-storage-field-password"
              />
            </FormField>
          </>
        ) : null}

        {secretIssue === 'partial' ? (
          <Alert
            tone="warn"
            role="alert"
            data-testid="studio-storage-secret-partial"
            title={t('studio:storage.secret.partialTitle', 'Half a credential is not a credential')}
            body={t(
              'studio:storage.secret.partialBody',
              'Fill in both fields to replace the stored credential, or clear both to keep it. Saving one alone would quietly keep the old one.',
            )}
          />
        ) : null}

        {testError !== null ? (
          <Alert
            tone="danger"
            role="alert"
            data-testid="studio-storage-draft-test-error"
            title={t('studio:storage.test.unreachable', 'The test could not be run')}
            body={testError}
          />
        ) : null}

        {result === null ? null : result.ok ? (
          <Alert
            tone="pos"
            role="status"
            data-testid="studio-storage-draft-test-result"
            title={t('studio:storage.test.ok', 'Reached in {ms}ms', { ms: result.latencyMs })}
          />
        ) : (
          <Alert
            tone="danger"
            role="alert"
            data-testid="studio-storage-draft-test-result"
            title={t('studio:storage.test.failed', 'Could not reach this destination')}
            // Verbatim: the provider's own words are the only part of this
            // reply the operator can act on.
            body={result.error}
          />
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button
          variant="ghost"
          loading={testing}
          disabled={busy}
          onClick={() => void runTest()}
          data-testid="studio-storage-draft-test"
        >
          {t('studio:storage.test.button', 'Test')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          loading={busy}
          disabled={!draftIsSavable(draft)}
          onClick={onSave}
          data-testid="studio-storage-save"
        >
          {t('studio:storage.save', 'Save destination')}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

/* --------------------------------------------------------- move files… */

/**
 * From → to, with this server's disk offered on BOTH sides — moving everything
 * off the box and moving everything back onto it are the same verb, and a
 * picker that only offered rows could express neither.
 */
function MoveFilesModal({
  destinations,
  busy,
  onClose,
  onMove,
}: {
  destinations: DestinationView[];
  busy: boolean;
  onClose: () => void;
  onMove: (input: { from: string; to: string; kinds: readonly MigrateKind[] }) => void;
}) {
  const [from, setFrom] = useState<string>(LOCAL_DESTINATION_VALUE);
  const [to, setTo] = useState<string>(destinations[0]?.id ?? LOCAL_DESTINATION_VALUE);
  // Empty = every kind, which is both the common case and what the server does
  // with no filter — so the control starts unchecked rather than all-checked.
  const [kinds, setKinds] = useState<readonly MigrateKind[]>([]);

  const options = [
    { value: LOCAL_DESTINATION_VALUE, label: t('studio:storage.localDisk', "This server's disk") },
    ...destinations.map((destination) => ({ value: destination.id, label: destination.name })),
  ];

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalHeader
        icon={<FolderInput />}
        title={t('studio:storage.move.title', 'Move files')}
        subtitle={t(
          'studio:storage.move.subtitle',
          'Copies every file from one destination to another and then forgets the old copy. Downloads keep working throughout.',
        )}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <FormField label={t('studio:storage.move.from', 'From')}>
          <Select
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            data-testid="studio-storage-move-from"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('studio:storage.move.to', 'To')}>
          <Select
            value={to}
            onChange={(event) => setTo(event.target.value)}
            data-testid="studio-storage-move-to"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label={t('studio:storage.move.kinds', 'Limit to')}
          helper={t(
            'studio:storage.move.kindsHelp',
            'Leave everything unticked to move all of them. Uploads are the files people attach; the rest are artifacts Adminium made.',
          )}
        >
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MIGRATE_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={(event) =>
                    setKinds((current) =>
                      event.target.checked
                        ? [...current, kind]
                        : current.filter((entry) => entry !== kind),
                    )
                  }
                  data-testid={`studio-storage-move-kind-${kind}`}
                />
                <span className="text-body-sm text-fg-muted">{migrateKindLabel(kind)}</span>
              </label>
            ))}
          </div>
        </FormField>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          loading={busy}
          disabled={from === to}
          onClick={() => onMove({ from, to, kinds })}
          data-testid="studio-storage-move-start"
        >
          {t('studio:storage.move.start', 'Start the move')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
