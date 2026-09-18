// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/lists` — the workspace's option lists (plan 50 D20).
 *
 * A list is the answers a column accepts, named once. This page is where the
 * names live: the three Adminium ships, and every list this workspace wrote.
 *
 * ─── The built-ins are on the page, and cannot be changed here ─────────────
 *
 * Hiding them would make "countries" look like something the workspace has to
 * build. They are rows on the same list with no Delete and no Edit — opening
 * one offers the copy that IS the edit (see `OptionListEditor`).
 *
 * ─── A refused delete is an instruction, not an error ──────────────────────
 *
 * Deleting a list a rule points at would leave the rule naming nothing. The
 * server answers 409 with the columns that use it, and this page prints them:
 * "remove it from those columns first" is only actionable if it says which.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { List, Plus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  IconTile,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  Spinner,
} from '@adminium/ui';

import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { t } from '../../i18n/t.js';
import { OptionListEditor, type OptionListDraft } from './OptionListEditor.js';
import {
  OPTION_LISTS_QUERY_KEY,
  createOptionList,
  deleteOptionList,
  messageFromError,
  optionListsQuery,
  updateOptionList,
  usedByFromError,
  type OptionListView,
} from './optionListsApi.js';

/** A list that does not exist yet, so the editor can open on a blank draft. */
const NEW_LIST: OptionListView = { key: '', name: '', items: [], origin: 'custom', editable: true };

export function OptionListsPage() {
  const client = useQueryClient();
  const lists = useQuery(optionListsQuery());
  const [editing, setEditing] = useState<OptionListView | null>(null);
  const [deleting, setDeleting] = useState<OptionListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<{ name: string; columns: string[] } | null>(null);

  const rows = lists.data ?? [];
  const taken = rows.map((row) => row.key);

  const save = useMutation({
    mutationFn: async (draft: OptionListDraft) =>
      draft.key === null
        ? createOptionList({
            key: draft.newKey.trim(),
            name: draft.name.trim(),
            items: draft.items,
            ...(draft.origin === 'custom' ? {} : { origin: draft.origin }),
          })
        : updateOptionList(draft.key, { name: draft.name.trim(), items: draft.items }),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await client.invalidateQueries({ queryKey: OPTION_LISTS_QUERY_KEY });
    },
    onError: (raised: unknown) => setError(messageFromError(raised)),
  });

  const remove = useMutation({
    mutationFn: (list: OptionListView) => deleteOptionList(list.key),
    onSuccess: async () => {
      setDeleting(null);
      setInUse(null);
      setError(null);
      await client.invalidateQueries({ queryKey: OPTION_LISTS_QUERY_KEY });
    },
    onError: (raised: unknown, list: OptionListView) => {
      const columns = usedByFromError(raised);
      setDeleting(null);
      if (columns !== null) setInUse({ name: list.name, columns });
      else setError(messageFromError(raised));
    },
  });

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:lists.title', 'Lists')}
        subtitle={t(
          'studio:lists.subtitle',
          'The answers a column accepts, named once and used from anywhere.',
        )}
      >
        <Button
          iconLeft={<Plus className="size-4" />}
          onClick={() => {
            setError(null);
            setEditing(NEW_LIST);
          }}
          data-testid="studio-lists-new"
        >
          {t('studio:lists.new', 'New list')}
        </Button>
      </PageActions>

      {error === null ? null : <Alert tone="danger" title={error} />}
      {inUse === null ? null : (
        <Alert
          tone="warn"
          title={t('studio:lists.inUseTitle', '{name} is used by a column', { name: inUse.name })}
          body={
            inUse.columns.length === 0
              ? t('studio:lists.inUseNone', 'Remove it from the columns that use it first.')
              : t('studio:lists.inUseBody', 'Remove it from {columns} first.', {
                  columns: inUse.columns.join(', '),
                })
          }
        />
      )}

      {lists.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : lists.isError ? (
        <Alert tone="danger" title={messageFromError(lists.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<List className="size-5" />}
          title={t('studio:lists.emptyTitle', 'No lists yet')}
          body={t('studio:lists.emptyBody', 'A list is a set of answers a column accepts.')}
        />
      ) : (
        <Card padded={false}>
          <CardBody className="divide-y divide-border p-0">
            {rows.map((list) => (
              <div key={list.key} className="flex items-center gap-3 px-4 py-3" data-testid="studio-lists-row">
                <IconTile tone={list.editable ? 'accent' : 'neutral'} size="md" icon={<List />} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-section text-fg">{list.name}</h3>
                    {list.editable ? null : (
                      <Badge tone="neutral">{t('studio:lists.builtin', 'Built in')}</Badge>
                    )}
                    <MonoText className="text-[11px] text-fg-subtle">{list.key}</MonoText>
                  </div>
                  <p className="text-caption text-fg-subtle">
                    {t('studio:lists.valueCount', '{count} values', { count: list.items.length })}
                    {list.origin.startsWith('copy:')
                      ? ` · ${t('studio:lists.copiedFrom', 'a copy of {key}', {
                          key: list.origin.slice('copy:'.length),
                        })}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setEditing(list);
                  }}
                >
                  {list.editable ? t('studio:lists.edit', 'Edit') : t('studio:lists.view', 'View')}
                </Button>
                {list.editable ? (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(list)}>
                    {t('studio:lists.delete', 'Delete')}
                  </Button>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <OptionListEditor
        list={editing}
        taken={taken}
        saving={save.isPending}
        error={error}
        onClose={() => setEditing(null)}
        onSave={(draft) => save.mutate(draft)}
      />

      {deleting === null ? null : (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <ModalHeader
            tone="danger"
            title={t('studio:lists.deleteTitle', 'Delete {name}?', { name: deleting.name })}
            closeLabel={t('studio:lists.close', 'Close')}
          />
          <ModalBody>
            <p className="text-body-sm text-fg-muted">
              {t(
                'studio:lists.deleteBody',
                'The list goes. The values already stored in your rows stay exactly as they are \u2014 a list says what a form offers, not what a column holds.',
              )}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('studio:lists.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => remove.mutate(deleting)}
              data-testid="studio-lists-delete-confirm"
            >
              {t('studio:lists.delete', 'Delete')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </PageSurface>
  );
}
