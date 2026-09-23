// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Uninstalling an app, ported from `Installed Apps.dc.html`'s Uninstall
 * dialog: what goes and what stays, side by side, read from the server's own
 * plan — then an unticked "Also delete its tables and data", which alone asks
 * for the app's key typed back.
 *
 * Deleting an app role takes its members' membership with it and hard-deletes
 * the API keys bound to it; the dialog says so, with the counts, before
 * anything happens. The drop is offered only to someone who may discard data
 * (Super Admin), and only for tables the app made and nothing else names.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  Spinner,
} from '@adminium/ui';
import { Check, Minus, Trash2 } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { APP_CATALOG_QUERY_KEY, APPS_QUERY_KEY, uninstallApp, uninstallPlanQuery } from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';

export interface UninstallAppDialogProps {
  appKey: string;
  /** What the app is called, for the title. */
  name: string;
  /** "Version 0.2.0 · by Adminium", when the caller has it. */
  subtitle?: string | undefined;
  onClose: () => void;
  onUninstalled: () => void;
}

export function UninstallAppDialog({ appKey, name, subtitle, onClose, onUninstalled }: UninstallAppDialogProps) {
  const queryClient = useQueryClient();
  const plan = useQuery(uninstallPlanQuery(appKey));
  const [drop, setDrop] = useState(false);
  const [typed, setTyped] = useState('');

  const remove = useMutation({
    mutationFn: () => uninstallApp(appKey, drop ? { dropTables: true, confirmKey: typed.trim() } : {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
      // The sidebar: the app's section and its screens go with it.
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      onUninstalled();
    },
  });

  const data = plan.data;
  const droppable = data?.tables.filter((table) => table.droppable) ?? [];
  const offerDrop = data !== undefined && data.canDropTables && droppable.length > 0;
  const blocked = drop && typed.trim() !== appKey;

  const removed: string[] = [];
  const kept: string[] = [];
  if (data !== undefined) {
    removed.push(t('studio:uninstall.files', 'The app’s files'));
    if (data.pages.removed.length > 0) {
      removed.push(
        t('studio:uninstall.pages', '{count, plural, one {# page} other {# pages}}', { count: data.pages.removed.length }),
      );
    }
    if (data.keys > 0) {
      removed.push(
        t('studio:uninstall.keys', '{count, plural, one {Its browser key} other {Its # browser keys}}', { count: data.keys }),
      );
    }
    removed.push(t('studio:uninstall.settings', 'Its settings'));
    if ((data.rules ?? 0) > 0) {
      removed.push(
        t('studio:uninstall.rules', '{count, plural, one {Its column rule} other {Its # column rules}}', { count: data.rules ?? 0 }),
      );
    }
    for (const role of data.roles) removed.push(role.name);
    if (data.hosts.length > 0) {
      removed.push(
        t('studio:uninstall.hosts', '{count, plural, one {Its domain} other {Its # domains}}', { count: data.hosts.length }),
      );
    }
    const keptTables = drop ? data.tables.length - droppable.length : data.tables.length;
    if (keptTables > 0) {
      kept.push(
        t('studio:uninstall.tables', '{count, plural, one {# table and every record in it} other {# tables and every record in them}}', {
          count: keptTables,
        }),
      );
    }
    if (data.pages.kept.length > 0) {
      kept.push(t('studio:uninstall.editedPages', 'Pages you edited stay as ordinary pages'));
    }
    kept.push(t('studio:uninstall.audit', 'Its entries in the audit log'));
  }
  const cascading = data?.roles.filter((role) => role.members > 0 || role.apiKeys > 0) ?? [];

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !remove.isPending) onClose();
      }}
    >
      <ModalHeader
        icon={<Trash2 />}
        tone={drop ? 'danger' : 'accent'}
        title={t('studio:uninstall.title', 'Uninstall {app}?', { app: name })}
        subtitle={subtitle}
        closeLabel={t('studio:uninstall.close', 'Close')}
      />
      <ModalBody>
        {plan.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : null}
        {plan.error === null ? null : (
          <Alert tone="danger" title={t('studio:uninstall.planFailed', 'What would be removed could not be read')}>
            {plan.error.message}
          </Alert>
        )}
        {data === undefined ? null : (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
              <List tone="removed" title={t('studio:uninstall.removed', 'Removed')} items={removed} />
              <List tone="kept" title={t('studio:uninstall.kept', 'Kept')} items={kept} />
            </div>
            {cascading.map((role) => (
              <Alert key={role.slug} tone="warn" title={role.name}>
                {t(
                  'studio:uninstall.roleCascade',
                  'Removing this role takes it from {members, plural, one {# person} other {# people}} and deletes {keys, plural, one {# API key} other {# API keys}} bound to it. Those keys stop working at once.',
                  { members: role.members, keys: role.apiKeys },
                )}
              </Alert>
            ))}
            {offerDrop ? (
              <div className={`overflow-hidden rounded-[12px] border ${drop ? 'border-danger/40' : 'border-border'}`}>
                <label className="flex cursor-pointer items-start gap-[11px] px-[15px] py-[13px]">
                  <Checkbox checked={drop} onCheckedChange={(next) => setDrop(next === true)} />
                  <span>
                    <span className="block text-[12.5px] font-bold text-danger">
                      {t('studio:uninstall.dropTitle', 'Also delete its tables and data')}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-fg-subtle">
                      {t(
                        'studio:uninstall.dropBody',
                        '{count, plural, one {Deletes the # table it made and every record in it.} other {Deletes the # tables it made and every record in them.}} This cannot be undone.',
                        { count: droppable.length },
                      )}
                    </span>
                  </span>
                </label>
                {drop ? (
                  <div className="px-[15px] pb-3.5">
                    <label className="block text-[11.5px] text-fg-muted">
                      {t('studio:uninstall.typeKey', 'Type the app’s key {key} to confirm.', { key: appKey })}
                      <Input
                        className="mt-[7px] font-mono"
                        value={typed}
                        placeholder={appKey}
                        onChange={(event) => setTyped(event.currentTarget.value)}
                      />
                    </label>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {droppable.map((table) => (
                        <li key={table.table}>
                          <MonoText className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px]">{table.table}</MonoText>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {remove.error === null ? null : (
              <Alert role="alert" tone="danger" title={t('studio:uninstall.failed', 'The app was not uninstalled')}>
                {remove.error.message}
              </Alert>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={remove.isPending} onClick={onClose}>
          {t('studio:uninstall.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" disabled={data === undefined || blocked || remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? <Spinner size="sm" /> : <Trash2 aria-hidden className="size-[15px]" />}
          {drop
            ? t('studio:uninstall.confirmDrop', 'Uninstall and delete data')
            : t('studio:uninstall.confirm', 'Uninstall')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function List({ tone, title, items }: { tone: 'removed' | 'kept'; title: string; items: string[] }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-border">
      <div
        className={`px-[13px] py-[9px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] ${
          tone === 'kept' ? 'bg-pos-soft text-pos' : 'bg-surface-2 text-fg-subtle'
        }`}
      >
        {title}
      </div>
      <ul>
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-[9px] border-t border-border px-[13px] py-2 text-[12.5px] leading-[1.45] text-fg-muted"
          >
            {tone === 'kept' ? (
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-pos" />
            ) : (
              <Minus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
            )}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
