// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspaces dialogs of Data connections (`Workspaces.dc.html`, its managing boards):
 *
 * - **New workspace** (md): a name, with its tile drawn as it is typed, and
 *   the databases to put in it. The first workspace on a server changes
 *   everyone's menu, so that dialog says so.
 * - **Rename** (sm): the same name rules.
 * - **Delete** (sm alert): the databases stay; the email templates, report
 *   layouts and invoice layouts shown in this workspace alone are listed,
 *   since after the delete they are shown in none.
 * - **Workspaces for {database}** (md): a checkbox per workspace. Ticking
 *   none puts it in "Other databases"; nobody's access changes.
 *
 * Names are required, unique and at most 80 characters; the error sits under
 * the field. Each change is audited by the server and redraws every menu.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Layers, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, MonoText } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { initialsOf } from '../../shell/workspaces/model.js';
import { WorkspaceTile } from '../../shell/workspaces/WorkspaceTile.js';
import type { ConnectionDto } from '../api.js';
import { deletePlanQuery, refreshWorkspaces, workspacesApi, type ShownOnlyIn, type WorkspaceDto } from './workspacesApi.js';

const MAX_NAME = 80;

function engineName(engine: string): string {
  switch (engine) {
    case 'postgres':
      return t('studio:source.engine.postgres', 'PostgreSQL');
    case 'mysql':
      return t('studio:source.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('studio:source.engine.sqlite', 'SQLite');
    default:
      return engine;
  }
}

/** A name's problem, or null: required, unique among the others, at most 80. */
function nameProblem(name: string, others: readonly WorkspaceDto[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return t('studio:hub.workspaces.error.nameRequired', 'Give the workspace a name.');
  if (trimmed.length > MAX_NAME) return t('studio:hub.workspaces.error.nameLong', 'Keep the name to 80 characters.');
  if (others.some((other) => other.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return t('studio:hub.workspaces.error.nameTaken', 'A workspace already has that name.');
  return null;
}

/** One ticked-or-not row of a dialog's list. */
function CheckLine({ id, checked, onChange, label, children }: { id: string; checked: boolean; onChange: (next: boolean) => void; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-[11px]">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} aria-label={label} />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        {children}
      </label>
    </div>
  );
}

/** The bordered list the dialogs tick rows in. */
function CheckList({ children, labelledBy }: { children: React.ReactNode; labelledBy?: string }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="divide-y divide-border rounded-md border border-border">
      {children}
    </div>
  );
}

export function NewWorkspaceModal({
  workspaces,
  connections,
  preset = [],
  onClose,
  onCreated,
}: {
  workspaces: readonly WorkspaceDto[];
  connections: readonly ConnectionDto[];
  /** Databases ticked to begin with (from a connection's "New workspace…"). */
  preset?: readonly string[];
  onClose: () => void;
  onCreated?: ((workspace: WorkspaceDto) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const ids = useId();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(preset));
  const [tried, setTried] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const problem = taken === name.trim() ? t('studio:hub.workspaces.error.nameTaken', 'A workspace already has that name.') : nameProblem(name, workspaces);
  const noDatabase = picked.size === 0 ? t('studio:hub.workspaces.error.noDatabase', 'Tick at least one database.') : null;
  const first = workspaces.length === 0;

  const create = useMutation({
    mutationFn: () => workspacesApi.create({ name: name.trim(), connectionIds: connections.filter((c) => picked.has(c.id)).map((c) => c.id) }),
    onSuccess: async ({ workspace }) => {
      await refreshWorkspaces(queryClient);
      toasts.push({ variant: 'success', title: t('studio:hub.workspaces.created', 'Workspace “{name}” created', { name: workspace.name }) });
      onCreated?.(workspace);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setTaken(name.trim());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem !== null || noDatabase !== null) return;
    create.mutate();
  };

  return (
    <Modal open size="md" onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalHeader icon={<FolderPlus />} title={t('studio:hub.workspaces.new.title', 'New workspace')} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <form id={`${ids}-form`} className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {first ? (
            <Alert tone="info" data-testid="first-workspace-notice" title={t('studio:hub.workspaces.new.first', 'Everyone’s menu groups by workspace from now on. Databases in none show under Other databases.')} />
          ) : null}
          <div className="flex items-start gap-3">
            <WorkspaceTile group={{ kind: 'workspace', initials: initialsOf(name) || '·' }} size={38} className="mt-6" />
            <FormField
              className="min-w-0 flex-1"
              label={t('studio:hub.workspaces.new.name', 'Name')}
              required
              helper={t('studio:hub.workspaces.new.nameHint', 'Its tile shows the first letters of its name.')}
              error={tried || taken !== null ? (problem ?? undefined) : undefined}
            >
              <Input value={name} maxLength={MAX_NAME} autoFocus onChange={(event) => setName(event.target.value)} data-testid="workspace-name" />
            </FormField>
          </div>
          <div>
            <div id={`${ids}-dbs`} className="mb-1.5 text-[12.5px] font-bold">
              {t('studio:hub.workspaces.new.databases', 'Databases to put in it')}
            </div>
            <CheckList labelledBy={`${ids}-dbs`}>
              {connections.map((connection) => (
                <CheckLine
                  key={connection.id}
                  id={`${ids}-db-${connection.id}`}
                  label={connection.name}
                  checked={picked.has(connection.id)}
                  onChange={(next) =>
                    setPicked((prev) => {
                      const out = new Set(prev);
                      if (next) out.add(connection.id);
                      else out.delete(connection.id);
                      return out;
                    })
                  }
                >
                  <span className="min-w-0 flex-1">
                    <MonoText className="block truncate text-[13px] font-semibold">{connection.name}</MonoText>
                    <span className="mt-px block text-[11.5px] text-fg-subtle">
                      {connection.tableCount === null
                        ? engineName(connection.engine)
                        : t('studio:hub.workspaces.new.tables', '{engine} · {count, plural, one {# table} other {# tables}}', { engine: engineName(connection.engine), count: connection.tableCount })}
                    </span>
                  </span>
                </CheckLine>
              ))}
            </CheckList>
            {tried && noDatabase !== null ? (
              <p role="alert" className="mt-1.5 text-caption text-danger">
                {noDatabase}
              </p>
            ) : null}
          </div>
          {create.isError && !(create.error instanceof ApiError && create.error.status === 409) ? (
            <Alert tone="danger" title={t('studio:hub.workspaces.error.saveFailed', 'The workspace could not be saved. Try again.')} body={create.error instanceof Error ? create.error.message : ''} />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form={`${ids}-form`} loading={create.isPending} data-testid="workspace-create">
          {t('studio:hub.workspaces.new.create', 'Create workspace')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function RenameWorkspaceModal({ workspace, workspaces, onClose }: { workspace: WorkspaceDto; workspaces: readonly WorkspaceDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const [name, setName] = useState(workspace.name);
  const [taken, setTaken] = useState<string | null>(null);
  const others = workspaces.filter((other) => other.id !== workspace.id);
  const problem = taken === name.trim() ? t('studio:hub.workspaces.error.nameTaken', 'A workspace already has that name.') : nameProblem(name, others);
  const save = useMutation({
    mutationFn: () => workspacesApi.rename(workspace.id, name.trim()),
    onSuccess: async () => {
      await refreshWorkspaces(queryClient);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setTaken(name.trim());
    },
  });
  return (
    <Modal open size="sm" onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalHeader title={t('studio:hub.workspaces.rename.title', 'Rename workspace')} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <form
          id={`${ids}-form`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (problem === null && name.trim() !== workspace.name) save.mutate();
          }}
        >
          <FormField label={t('studio:hub.workspaces.new.name', 'Name')} required helper={t('studio:hub.workspaces.new.nameHint', 'Its tile shows the first letters of its name.')} error={problem ?? undefined}>
            <Input value={name} maxLength={MAX_NAME} autoFocus onChange={(event) => setName(event.target.value)} />
          </FormField>
          {save.isError && !(save.error instanceof ApiError && save.error.status === 409) ? (
            <Alert className="mt-3" tone="danger" title={t('studio:hub.workspaces.error.saveFailed', 'The workspace could not be saved. Try again.')} />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form={`${ids}-form`} loading={save.isPending} disabled={problem !== null || name.trim() === workspace.name}>
          {t('studio:hub.workspaces.rename.save', 'Rename')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function kindLabel(kind: ShownOnlyIn['kind']): string {
  switch (kind) {
    case 'email-template':
      return t('studio:hub.workspaces.kind.emailTemplate', 'Email template');
    case 'report':
      return t('studio:hub.workspaces.kind.report', 'Report layout');
    default:
      return t('studio:hub.workspaces.kind.invoice', 'Invoice layout');
  }
}

export function DeleteWorkspaceModal({ workspace, onClose }: { workspace: WorkspaceDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const plan = useQuery(deletePlanQuery(workspace.id));
  const remove = useMutation({
    mutationFn: () => workspacesApi.remove(workspace.id),
    onSuccess: async () => {
      await refreshWorkspaces(queryClient);
      toasts.push({ variant: 'success', title: t('studio:hub.workspaces.deleted', 'Workspace “{name}” deleted', { name: workspace.name }) });
      onClose();
    },
  });
  const shownOnlyIn = plan.data?.shownOnlyIn ?? [];
  return (
    <Modal open size="sm" role="alertdialog" onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalHeader icon={<Trash2 />} tone="danger" title={t('studio:hub.workspaces.delete.title', 'Delete {name}?', { name: workspace.name })} closeLabel={t('common.close', 'Close')} />
      <ModalBody className="flex flex-col gap-3">
        <p className="text-[13px] leading-[1.5] text-fg">{t('studio:hub.workspaces.delete.body', 'Its databases stay. They leave this workspace.')}</p>
        {shownOnlyIn.length > 0 ? (
          <div data-testid="delete-shown-only-in">
            <p className="text-[13px] leading-[1.5] text-fg-muted">
              {t('studio:hub.workspaces.delete.shownOnlyIn', 'These are shown in this workspace alone. After the delete they are shown in none:')}
            </p>
            <ul className="mt-1.5 list-disc ps-5 text-[13px]">
              {shownOnlyIn.map((item) => (
                <li key={`${item.kind}:${item.itemId}`}>
                  {item.name} <span className="text-fg-subtle">· {kindLabel(item.kind)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {plan.data?.last === true ? (
          <p className="text-[13px] leading-[1.5] text-fg-muted">{t('studio:hub.workspaces.delete.last', 'It is the last workspace: everyone’s menu goes back to one list.')}</p>
        ) : null}
        {remove.isError ? <Alert tone="danger" title={t('studio:hub.workspaces.error.deleteFailed', 'The workspace could not be deleted. Try again.')} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" loading={remove.isPending} disabled={plan.isPending} onClick={() => remove.mutate()} data-testid="workspace-delete-confirm">
          {t('studio:hub.workspaces.delete.confirm', 'Delete')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ConnectionWorkspacesModal({
  connection,
  workspaces,
  connections,
  onClose,
}: {
  connection: Pick<ConnectionDto, 'id' | 'name'>;
  workspaces: readonly WorkspaceDto[];
  connections: readonly ConnectionDto[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const ids = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(workspaces.filter((w) => w.connectionIds.includes(connection.id)).map((w) => w.id)));
  const [making, setMaking] = useState(false);
  const save = useMutation({
    mutationFn: () => workspacesApi.setForConnection(connection.id, workspaces.filter((w) => picked.has(w.id)).map((w) => w.id)),
    onSuccess: async () => {
      await refreshWorkspaces(queryClient);
      toasts.push({ variant: 'success', title: t('studio:hub.workspaces.connection.saved', 'Workspaces saved') });
      onClose();
    },
  });
  if (making) {
    return (
      <NewWorkspaceModal
        workspaces={workspaces}
        connections={connections}
        preset={[connection.id]}
        onClose={() => setMaking(false)}
        onCreated={(created) => setPicked((prev) => new Set([...prev, created.id]))}
      />
    );
  }
  return (
    <Modal open size="md" onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalHeader
        icon={<Layers />}
        title={t('studio:hub.workspaces.connection.title', 'Workspaces for {name}', { name: connection.name })}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        {workspaces.length === 0 ? null : (
          <CheckList>
            {workspaces.map((workspace) => (
              <CheckLine
                key={workspace.id}
                id={`${ids}-ws-${workspace.id}`}
                label={workspace.name}
                checked={picked.has(workspace.id)}
                onChange={(next) =>
                  setPicked((prev) => {
                    const out = new Set(prev);
                    if (next) out.add(workspace.id);
                    else out.delete(workspace.id);
                    return out;
                  })
                }
              >
                <WorkspaceTile group={{ kind: 'workspace', initials: initialsOf(workspace.name) }} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{workspace.name}</span>
                  <span className="mt-px block text-[11.5px] text-fg-subtle">
                    {t('workspaces.databases', '{count, plural, one {# database} other {# databases}}', { count: workspace.connectionIds.length })}
                  </span>
                </span>
              </CheckLine>
            ))}
          </CheckList>
        )}
        <div>
          <Button variant="ghost" size="sm" className="px-1.5 text-accent" onClick={() => setMaking(true)}>
            <FolderPlus aria-hidden className="size-[15px]" />
            {t('studio:hub.workspaces.connection.newInline', 'New workspace…')}
          </Button>
        </div>
        <p className="text-[12.5px] leading-[1.5] text-fg-muted">
          {t('studio:hub.workspaces.connection.note', 'Its pages and apps show in each workspace you tick. Nobody’s access changes.')}
        </p>
        {save.isError ? <Alert tone="danger" title={t('studio:hub.workspaces.error.saveFailed', 'The workspace could not be saved. Try again.')} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate()} data-testid="connection-workspaces-save">
          {t('common.save', 'Save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
