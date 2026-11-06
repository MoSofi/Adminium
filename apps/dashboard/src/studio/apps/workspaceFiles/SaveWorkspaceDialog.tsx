// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save workspace, ported from `Apps Per Database.dc.html` part 8 (Y-A5).
 *
 *  - **8a, the quick dialog**: each database of the workspace with its app's
 *    name, key and next version ("Last saved 1.0.0"), a tick to leave it out,
 *    and "More choices", which opens Save as app's own wizard for that
 *    database. The Check of every app is merged under the list, each item
 *    named by its app. Save waits while an item needs a choice.
 *  - **8b, the file**: its name and size, its fingerprint and each app's, each
 *    with Copy, and Download.
 *  - **8c, too big**: the 128 MB alert replaces the Check line; Save stays on.
 *
 * Self-contained: `SaveWorkspaceButton` is the row's button and owns the
 * dialog, so it mounts on any workspace row with the workspace it is for.
 *
 * ─── Departures ────────────────────────────────────────────────────────────
 *
 *  **S1 — "Server settings" is drawn from notes.** The comp has no control
 *  for the server-wide part; the plan says the dialog asks "Server settings:
 *  from {database} / none", none by default. It is a select under the list in
 *  the dialog's own field anatomy, shown only to someone who manages
 *  settings (the save refuses it to anyone else).
 *  **S2 — fingerprints are real** (`sha512-` + base64), shortened in the
 *  middle, Copy giving the whole; the comp's are 64-hex fakes.
 *  **S3 — the result dialog is lg (720)**, a kit size, where the comp draws 640.
 *  **S4 — "More choices" shows only where the page that mounts the dialog
 *  opens Save as app's wizard** (`onMoreChoices`); the dialog cannot open it
 *  by itself.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, IconTile, Input, Modal, ModalBody, ModalHeader, MonoText, Select, Spinner } from '@adminium/ui';
import { Archive, CircleCheck, Copy, Database, Download, Package, PackageCheck, PackagePlus, SlidersHorizontal, TriangleAlert } from 'lucide-react';

import { bootstrapQuery, holdsSystemAction } from '../../../app/bootstrap.js';
import { t } from '../../../i18n/t.js';
import { formatBytes } from '../../storage/storageApi.js';
import { sentence } from '../addOnWords.js';
import { APP_SAVES_QUERY_KEY as SINGLE_SAVES_QUERY_KEY } from '../saveAppApi.js';
import {
  APP_SAVES_QUERY_KEY,
  planWorkspaceSave,
  reasonOf,
  saveWorkspace,
  workspaceSaveFileHref,
  type SavedWorkspaceFile,
  type WorkspaceAppPlan,
  type WorkspaceAppRequest,
  type WorkspaceSavePlan,
  type WorkspaceSaveRequest,
} from './workspaceFilesApi.js';

/** The workspace a save is for: its id, name and databases. */
export interface SaveWorkspaceTarget {
  id: string;
  name: string;
  connectionIds: readonly string[];
}

/** "More choices": open Save as app's wizard for one database; `apply` brings its answers back here. */
export type OnMoreChoices = (app: WorkspaceAppRequest, apply: (next: WorkspaceAppRequest) => void) => void;

// `leading-[normal]`: the comp renders at `normal`, and this system's `leading-normal` is 1.5.
const SMALL_BUTTON = 'h-8 rounded-[10px] px-[11px] text-[12.5px] font-bold';
const FOOT_BUTTON = 'h-9 rounded-[10px] px-3.5 text-[13px] font-bold';
const OVERLINE = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle';

/** Where the dialog's first plan is kept: every database of the workspace, as it would be saved. */
export function firstPlanKey(workspaceId: string) {
  return ['workspace-save-plan', workspaceId] as const;
}

/** A fingerprint shortened in the middle, for a line that has no room for 95 characters. */
export function shortFingerprint(integrity: string): string {
  return integrity.length <= 40 ? integrity : `${integrity.slice(0, 26)}…${integrity.slice(-10)}`;
}

/** One database's row as the person edits it. */
interface Row {
  connectionId: string;
  include: boolean;
  name: string;
  key: string;
  version: string;
  /** The answers Save as app's wizard brought back ("More choices"). */
  extra: Pick<WorkspaceAppRequest, 'include' | 'rows' | 'answers'>;
}

function requestOf(rows: readonly Row[], instanceFrom: string | null): WorkspaceSaveRequest {
  const apps = rows
    .filter((row) => row.include)
    .map((row): WorkspaceAppRequest => ({ connectionId: row.connectionId, key: row.key.trim(), name: row.name.trim(), ...(row.version.trim() === '' ? {} : { version: row.version.trim() }), ...row.extra }));
  return { apps, instanceFrom: instanceFrom !== null && apps.some((app) => app.connectionId === instanceFrom) ? instanceFrom : null };
}

/** The Check of every app, merged: what needs a choice (and what is refused), each named by its app. */
export function mergedChoices(plan: WorkspaceSavePlan): { key: string; app: string; message: string }[] {
  return plan.apps.flatMap((app) => [
    ...app.plan.problems.map((problem, n) => ({ key: `${app.key}:problem:${String(n)}`, app: app.name, message: problem.message })),
    ...app.plan.check.filter((item) => item.group === 'choice').map((item, n) => ({ key: `${app.key}:choice:${String(n)}`, app: app.name, message: item.message })),
  ]);
}

export function SaveWorkspaceButton({ workspace, onMoreChoices }: { workspace: SaveWorkspaceTarget; onMoreChoices?: OnMoreChoices | undefined }) {
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const [open, setOpen] = useState(false);
  // Same right as Save as app; a workspace with no database has nothing to save.
  if (bootstrap === undefined || !holdsSystemAction(bootstrap, 'manifests.manage') || workspace.connectionIds.length === 0) return null;
  return (
    <>
      <Button variant="secondary" className={SMALL_BUTTON} onClick={() => setOpen(true)}>
        <PackagePlus aria-hidden className="size-[15px]" />
        {t('studio:workspaceFiles.save.button', 'Save workspace')}
      </Button>
      {open ? <SaveWorkspaceDialog workspace={workspace} onClose={() => setOpen(false)} onMoreChoices={onMoreChoices} /> : null}
    </>
  );
}

export function SaveWorkspaceDialog({ workspace, onClose, onMoreChoices }: { workspace: SaveWorkspaceTarget; onClose: () => void; onMoreChoices?: OnMoreChoices | undefined }) {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const managesSettings = bootstrap !== undefined && holdsSystemAction(bootstrap, 'settings.manage');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [instanceFrom, setInstanceFrom] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkspaceSavePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [saved, setSaved] = useState<SavedWorkspaceFile | null>(null);
  const hintId = useId();
  const settingsId = useId();
  const asked = useRef(0);

  // The first plan names every database with its app's key, name and next version.
  const first = useQuery({ queryKey: firstPlanKey(workspace.id), queryFn: () => planWorkspaceSave(workspace.id, {}), staleTime: 30_000 });
  /** The request the first plan answers: planned already, so not asked again. */
  const initial = useRef<string | null>(null);
  useEffect(() => {
    if (first.data === undefined || rows !== null) return;
    const start = first.data.plan.apps.map((app) => ({ connectionId: app.connectionId, include: true, name: app.name, key: app.key, version: app.plan.version, extra: {} }));
    initial.current = JSON.stringify(requestOf(start, null));
    setPlan(first.data.plan);
    setRows(start);
  }, [first.data, rows]);

  // Every change plans again, a moment after the last keystroke.
  const request = useMemo(() => (rows === null ? null : requestOf(rows, instanceFrom)), [rows, instanceFrom]);
  const replan = useMutation({
    mutationFn: (body: WorkspaceSaveRequest) => planWorkspaceSave(workspace.id, body),
  });
  useEffect(() => {
    if (request === null || first.data === undefined) return;
    if (JSON.stringify(request) === initial.current) {
      asked.current += 1;
      setPlan(first.data.plan);
      return;
    }
    if ((request.apps ?? []).length === 0) {
      setPlan(null);
      return;
    }
    const n = ++asked.current;
    const timer = setTimeout(() => {
      replan.mutate(request, {
        onSuccess: ({ plan: next }) => {
          if (n !== asked.current) return;
          setPlan(next);
          setError(null);
        },
        onError: (cause) => {
          if (n !== asked.current) return;
          setPlan(null);
          setError(cause.message);
        },
      });
    }, 350);
    return () => clearTimeout(timer);
    // `replan` is stable enough: its `mutate` is, and the effect is keyed on what it sends.
  }, [request, first.data]);

  const save = useMutation({
    mutationFn: () => saveWorkspace(workspace.id, request ?? {}),
    onSuccess: ({ save: file }) => {
      setSaved(file);
      setTooBig(false);
      void queryClient.invalidateQueries({ queryKey: APP_SAVES_QUERY_KEY });
      // Each app of the workspace was saved too: the single saves' list reads them.
      void queryClient.invalidateQueries({ queryKey: SINGLE_SAVES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: firstPlanKey(workspace.id) });
    },
    onError: (cause) => {
      if (reasonOf(cause) === 'WORKSPACE_FILE_TOO_LARGE') {
        setTooBig(true);
        setError(null);
        return;
      }
      setError(cause.message);
    },
  });

  if (saved !== null) return <SavedWorkspaceDialog file={saved} onClose={onClose} />;

  const included = rows?.filter((row) => row.include) ?? [];
  const choices = plan === null ? [] : mergedChoices(plan);
  const planning = first.isLoading || replan.isPending;
  const canSave = plan !== null && plan.ready && included.length > 0 && !planning && !save.isPending;
  const appOf = (connectionId: string): WorkspaceAppPlan | undefined => plan?.apps.find((app) => app.connectionId === connectionId) ?? first.data?.plan.apps.find((app) => app.connectionId === connectionId);
  const update = (connectionId: string, patch: Partial<Row>) => setRows((current) => current?.map((row) => (row.connectionId === connectionId ? { ...row, ...patch } : row)) ?? null);

  return (
    <Modal open size="lg" onOpenChange={(next) => (next || save.isPending ? undefined : onClose())}>
      <ModalHeader
        icon={<PackagePlus aria-hidden />}
        title={t('studio:workspaceFiles.save.title', 'Save {workspace} as one file', { workspace: workspace.name })}
        subtitle={sentence('studio:workspaceFiles.save.subtitle', 'Workspace · {count, plural, one {{n} database} other {{n} databases}}', { n: <MonoText>{String(workspace.connectionIds.length)}</MonoText> }, { count: workspace.connectionIds.length })}
        closeLabel={t('studio:workspaceFiles.close', 'Close')}
        className="border-b border-border"
      />
      <ModalBody className="flex flex-col gap-4 py-5 leading-[normal]">
        <p className="text-[13px] leading-[1.5] text-fg-muted">{t('studio:workspaceFiles.save.intro', 'Each database becomes an app inside one file. Nothing on this server changes.')}</p>
        {rows === null ? (
          first.isError ? (
            <Alert tone="danger" title={t('studio:workspaceFiles.error', 'Something went wrong')}>
              {first.error.message}
            </Alert>
          ) : (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )
        ) : (
          <ul className="rounded-[10px] border border-border" data-part="save-rows">
            {rows.map((row, n) => {
              const app = appOf(row.connectionId);
              const database = app?.database.name ?? row.connectionId;
              const fieldId = `${hintId}-${String(n)}`;
              return (
                <li key={row.connectionId} className="flex flex-col gap-3 border-b border-border px-4 py-3.5 last:border-b-0" data-testid={`save-row-${database}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Checkbox
                      checked={row.include}
                      aria-label={t('studio:workspaceFiles.save.include', 'Include {database}', { database })}
                      onCheckedChange={(next) => update(row.connectionId, { include: next === true })}
                    />
                    <IconTile tone="neutral" className="size-7 rounded-[10px] [&_svg]:size-3.5">
                      <Database aria-hidden />
                    </IconTile>
                    <MonoText className="min-w-0 flex-1 text-[13px] font-bold">{database}</MonoText>
                    {onMoreChoices === undefined ? null : (
                      <Button
                        variant="secondary"
                        className={SMALL_BUTTON}
                        disabled={!row.include}
                        onClick={() =>
                          onMoreChoices({ connectionId: row.connectionId, key: row.key, name: row.name, ...(row.version === '' ? {} : { version: row.version }), ...row.extra }, (next) =>
                            update(row.connectionId, { name: next.name, key: next.key, version: next.version ?? row.version, extra: { ...(next.include === undefined ? {} : { include: next.include }), ...(next.rows === undefined ? {} : { rows: next.rows }), ...(next.answers === undefined ? {} : { answers: next.answers }) } }),
                          )
                        }
                      >
                        <SlidersHorizontal aria-hidden className="size-[15px]" />
                        {t('studio:workspaceFiles.save.moreChoices', 'More choices')}
                      </Button>
                    )}
                  </div>
                  {row.include ? (
                    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,.8fr)] gap-3 ps-[30px] max-sm:grid-cols-1">
                      <div className="min-w-0">
                        <label htmlFor={`${fieldId}-name`} className="mb-1.5 block text-[12.5px] font-bold">
                          {t('studio:workspaceFiles.save.name', 'Name')}
                        </label>
                        <Input id={`${fieldId}-name`} value={row.name} maxLength={80} className="h-[38px]" onChange={(event) => update(row.connectionId, { name: event.currentTarget.value })} />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor={`${fieldId}-key`} className="mb-1.5 block text-[12.5px] font-bold">
                          {t('studio:workspaceFiles.save.key', 'Key')}
                        </label>
                        <Input id={`${fieldId}-key`} value={row.key} maxLength={80} spellCheck={false} className="h-[38px] font-mono" onChange={(event) => update(row.connectionId, { key: event.currentTarget.value })} />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor={`${fieldId}-version`} className="mb-1.5 block text-[12.5px] font-bold">
                          {t('studio:workspaceFiles.save.version', 'Version')}
                        </label>
                        <Input
                          id={`${fieldId}-version`}
                          value={row.version}
                          spellCheck={false}
                          className="h-[38px] font-mono"
                          aria-describedby={app?.lastSaved == null ? undefined : `${fieldId}-last`}
                          onChange={(event) => update(row.connectionId, { version: event.currentTarget.value })}
                        />
                        {app?.lastSaved == null ? null : (
                          <div id={`${fieldId}-last`} className="mt-1.5 text-[11.5px] leading-[1.5] text-fg-subtle">
                            {sentence('studio:workspaceFiles.save.lastSaved', 'Last saved {version}', { version: <MonoText>{app.lastSaved}</MonoText> })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {managesSettings && included.length > 0 ? (
          <div className="flex flex-col gap-1.5" data-part="server-settings">
            <label htmlFor={settingsId} className="text-[12.5px] font-bold">
              {t('studio:workspaceFiles.save.settings.label', 'Server settings')}
            </label>
            <Select id={settingsId} value={instanceFrom ?? ''} aria-describedby={`${settingsId}-help`} onChange={(event) => setInstanceFrom(event.currentTarget.value === '' ? null : event.currentTarget.value)}>
              <option value="">{t('studio:workspaceFiles.save.settings.none', 'None')}</option>
              {included.map((row) => (
                <option key={row.connectionId} value={row.connectionId}>
                  {t('studio:workspaceFiles.save.settings.from', 'From {database}', { database: appOf(row.connectionId)?.database.name ?? row.connectionId })}
                </option>
              ))}
            </Select>
            <p id={`${settingsId}-help`} className="text-[11.5px] leading-[1.5] text-fg-subtle">
              {t('studio:workspaceFiles.save.settings.help', 'The look, languages, wording and system emails of this server travel with one app at most.')}
            </p>
          </div>
        ) : null}

        {tooBig ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-danger/25 bg-danger-soft px-[15px] py-3 text-[12.5px] leading-[1.5]" data-part="too-big">
            <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
            <span>{sentence('studio:workspaceFiles.save.tooBig', 'This workspace file would be larger than {size}. Leave out a database or its sample rows and try again.', { size: <MonoText>128 MB</MonoText> })}</span>
          </div>
        ) : choices.length > 0 ? (
          <div className="rounded-[10px] border border-warn/25 bg-warn-soft px-[15px] py-3" data-part="check">
            <p className="flex items-center gap-2 text-[13px] font-bold">
              <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
              {t('studio:workspaceFiles.save.needChoice', '{count, plural, one {# thing needs a choice} other {# things need a choice}}', { count: choices.length })}
            </p>
            <ul className="mt-2 flex flex-col gap-1 ps-6 text-[12.5px] leading-[1.5] text-fg-muted">
              {choices.map((choice) => (
                <li key={choice.key}>
                  <span className="font-bold text-fg">{choice.app}</span> · {choice.message}
                </li>
              ))}
            </ul>
          </div>
        ) : plan !== null && plan.ready ? (
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-pos" role="status">
            <CircleCheck aria-hidden className="size-4" />
            {t('studio:workspaceFiles.save.ready', 'Nothing needs a choice.')}
          </p>
        ) : null}
        {error === null ? null : (
          <Alert tone="danger" title={t('studio:workspaceFiles.error', 'Something went wrong')}>
            {error}
          </Alert>
        )}
      </ModalBody>
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-[22px] py-3.5 leading-[normal]">
        <div id={hintId} className="min-w-[180px] flex-1 text-[12.5px] leading-[1.5] text-fg-muted">
          {choices.length > 0 && !tooBig
            ? t('studio:workspaceFiles.save.useMoreChoices', 'Use More choices on an app to make its choices.')
            : included.length === 0 && rows !== null
              ? t('studio:workspaceFiles.save.noneIncluded', 'Tick at least one database.')
              : null}
        </div>
        <Button variant="ghost" className={FOOT_BUTTON} disabled={save.isPending} onClick={onClose}>
          {t('studio:workspaceFiles.cancel', 'Cancel')}
        </Button>
        <Button className={FOOT_BUTTON} disabled={!canSave} loading={save.isPending} aria-describedby={canSave ? undefined : hintId} onClick={() => save.mutate()}>
          {t('studio:workspaceFiles.save.save', 'Save')}
        </Button>
      </div>
    </Modal>
  );
}

function CopyButton({ text, label, quiet = false }: { text: string; label: string; quiet?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={quiet ? 'ghost' : 'secondary'}
      className={SMALL_BUTTON}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <CircleCheck aria-hidden className="size-[15px] text-pos" /> : <Copy aria-hidden className="size-[15px]" />}
      {copied ? t('studio:workspaceFiles.copied', 'Copied') : t('studio:workspaceFiles.copy', 'Copy')}
    </Button>
  );
}

/** 8b: the saved file, its fingerprint and each app's, and Download. */
export function SavedWorkspaceDialog({ file, onClose }: { file: SavedWorkspaceFile; onClose: () => void }) {
  return (
    <Modal open size="lg" onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalHeader icon={<PackageCheck aria-hidden />} title={t('studio:workspaceFiles.saved.title', '{workspace} is saved as one file', { workspace: file.name })} closeLabel={t('studio:workspaceFiles.close', 'Close')} className="border-b border-border" />
      <ModalBody className="flex flex-col gap-4 py-5 leading-[normal]">
        <p className="text-[13px] leading-[1.5] text-fg-muted">{t('studio:workspaceFiles.saved.intro', 'Download it to install it on another server.')}</p>
        <div className="flex items-center gap-[13px]">
          <IconTile tone="accent" className="size-11 rounded-[10px] [&_svg]:size-[22px]">
            <Archive aria-hidden />
          </IconTile>
          <div className="min-w-0 flex-1">
            <MonoText className="block text-sm font-bold [overflow-wrap:anywhere]">{file.filename}</MonoText>
            <MonoText className="mt-0.5 block text-[11.5px] text-fg-subtle">{formatBytes(file.bytes)}</MonoText>
          </div>
        </div>
        <div className="rounded-[10px] border border-border bg-surface-2 p-3.5" data-part="fingerprint">
          <div className="mb-2 flex items-center gap-2">
            <span className={OVERLINE}>{t('studio:workspaceFiles.saved.fingerprint', 'Fingerprint')}</span>
            <span className="flex-1" />
            <CopyButton text={file.integrity} label={t('studio:workspaceFiles.saved.copyFile', 'Copy the file’s fingerprint')} />
          </div>
          <MonoText className="block text-[12.5px] leading-[1.6] [overflow-wrap:anywhere]" title={file.integrity}>
            {shortFingerprint(file.integrity)}
          </MonoText>
        </div>
        <div>
          <div className={`${OVERLINE} mb-2`}>{t('studio:workspaceFiles.saved.inside', 'Apps inside')}</div>
          <ul className="rounded-[10px] border border-border">
            {file.apps.map((app) => {
              const name = `${app.key}-${app.version}.tgz`;
              return (
                <li key={app.key} className="flex items-center gap-3 border-b border-border px-3.5 py-[11px] last:border-b-0">
                  <IconTile tone="neutral" className="size-7 rounded-[10px] [&_svg]:size-3.5">
                    <Package aria-hidden />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <MonoText className="block text-[13px] font-semibold">{name}</MonoText>
                    <MonoText className="mt-0.5 block text-[11.5px] text-fg-muted [overflow-wrap:anywhere]" title={app.integrity}>
                      {shortFingerprint(app.integrity)}
                    </MonoText>
                  </div>
                  <CopyButton quiet text={app.integrity} label={t('studio:workspaceFiles.saved.copyApp', 'Copy the fingerprint of {file}', { file: name })} />
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-[13px] leading-[1.5] text-fg-muted">{t('studio:workspaceFiles.saved.keep', 'Keep the fingerprints with the file. The new server asks for them to check the file is the one you saved.')}</p>
      </ModalBody>
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-[22px] py-3.5">
        <span className="flex-1" />
        <Button variant="secondary" className={FOOT_BUTTON} onClick={onClose}>
          {t('studio:workspaceFiles.saved.done', 'Done')}
        </Button>
        <a href={workspaceSaveFileHref(file.id)} download={file.filename} className={`inline-flex items-center gap-[7px] bg-accent text-accent-fg ${FOOT_BUTTON} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}>
          <Download aria-hidden className="size-[15px]" />
          {t('studio:workspaceFiles.saved.download', 'Download')}
        </a>
      </div>
    </Modal>
  );
}
