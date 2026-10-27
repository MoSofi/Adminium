// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/email-templates/do-not-email` — the do-not-email list (comp `Email To
 * Contacts.dc.html` 4a 532-580, 4b 583-594, 4c 596-614, 4d 616-639; opened
 * from the e-mail templates' ⋯ menu, after "Manage senders").
 *
 * Every address no marketing mail of any app on this install may go to:
 * who unsubscribed by the link, marked a mail as spam, bounced, objected
 * through Lead finder, or was added by hand. Search, a "Why" filter, the
 * count, "Add addresses" (one per line) and "Remove" (its confirm).
 *
 *  - An erased person's entry has no address: it reads "Erased person — kept
 *    so they're never e-mailed again" and has no Remove.
 *  - "Remove" is offered where the server says this reader may
 *    (`mayRemove`): a Super Admin, signed in. A marketer sees and adds, and
 *    removes nobody.
 *  - The count is of entries (the erased ones have no address to count as
 *    one), from the server's total for the "Why" chosen.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, MailX, Plus, Search, UserX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Select, Skeleton, Textarea } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { STOP_LIST_QUERY_KEY, STOP_REASONS, addToStopList, removeFromStopList, stopListQuery, type StopEntry, type StopReason } from './marketingApi.js';

/** "Why" in words. */
export function reasonWords(reason: StopReason): string {
  switch (reason) {
    case 'link':
      return t('studio:marketingMail.dne.why.link', 'Unsubscribed by link');
    case 'spam':
      return t('studio:marketingMail.dne.why.spam', 'Marked as spam');
    case 'bounce':
      return t('studio:marketingMail.dne.why.bounce', 'Bounced');
    case 'hand':
      return t('studio:marketingMail.dne.why.hand', 'Added by hand');
    case 'relay-unsubscribe':
      return t('studio:marketingMail.dne.why.relayUnsubscribe', 'Unsubscribed through the mail service');
    case 'old-mark':
      return t('studio:marketingMail.dne.why.oldMark', 'Unsubscribed before records were kept');
    case 'lead-finder':
      return t('studio:marketingMail.dne.why.leadFinder', 'Objected through Lead finder');
    case 'erased':
      return t('studio:marketingMail.dne.why.erased', 'Erased on request');
  }
}

/** "Where from": the campaign, form or service it came from, or who added it. */
function whereFrom(entry: StopEntry): string {
  if (entry.reason === 'hand' && entry.addedBy !== null) return t('studio:marketingMail.dne.addedBy', 'Added by {name}', { name: entry.addedBy.label });
  if (entry.reason === 'lead-finder' && entry.origin === null) return t('studio:marketingMail.dne.leadFinder', 'Lead finder');
  return entry.origin ?? '—';
}

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** The comp's table columns: address, why, when, where from, actions. */
const COLUMNS = 'grid-cols-[minmax(260px,1.6fr)_210px_120px_minmax(200px,1.3fr)_96px]';

export function DoNotEmailPage(): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [reason, setReason] = useState<StopReason | null>(null);
  const [more, setMore] = useState<StopEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StopEntry | null>(null);

  // The search waits for a pause in the typing.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => {
    setMore([]);
    setCursor(null);
  }, [q, reason]);

  const list = useQuery(stopListQuery({ q, reason }));
  const page = useQuery({ ...stopListQuery({ q, reason, cursor }), enabled: cursor !== null });
  useEffect(() => {
    // Only a page past the first: with no cursor the key is the first page's own.
    if (cursor !== null && page.data !== undefined) setMore((prev) => [...prev, ...page.data.entries.filter((one) => !prev.some((held) => held.id === one.id))]);
  }, [cursor, page.data]);

  const entries = [...(list.data?.entries ?? []), ...more];
  const next = cursor === null ? (list.data?.next ?? null) : (page.data?.next ?? null);
  const total = list.data?.total ?? 0;
  const filtered = q.trim() !== '' || reason !== null;

  async function refresh(): Promise<void> {
    setMore([]);
    setCursor(null);
    await queryClient.invalidateQueries({ queryKey: STOP_LIST_QUERY_KEY });
  }

  const addButton = (
    <Button size="topbar" iconLeft={<Plus />} onClick={() => setAdding(true)} data-testid="dne-add">
      {t('studio:marketingMail.dne.add', 'Add addresses')}
    </Button>
  );

  return (
    <>
      <PageActions title={t('studio:marketingMail.dne.title', 'Do-not-email list')} backTo="/email-templates">
        {addButton}
      </PageActions>
      <PageSurface width="full" className="flex flex-col gap-3.5 leading-[normal]" testId="do-not-email">
        {list.isError ? (
          <Alert tone="danger" title={t('studio:marketingMail.dne.loadFailed', 'The list could not be loaded. Try again.')} />
        ) : list.data === undefined ? (
          <div className="flex flex-col gap-3" aria-hidden>
            <Skeleton className="h-[38px] w-[280px]" />
            <Skeleton className="h-[240px] w-full" />
          </div>
        ) : total === 0 && !filtered ? (
          <div className="flex flex-col items-center rounded-xl border-[1.5px] border-dashed border-border-strong bg-surface px-5 py-16 text-center">
            <div className="mb-4 flex size-[58px] items-center justify-center rounded-lg bg-accent-soft text-accent">
              <MailX aria-hidden className="size-7" />
            </div>
            <div className="text-section text-fg">{t('studio:marketingMail.dne.empty', 'Nobody is on the list yet.')}</div>
            <Button iconLeft={<Plus />} onClick={() => setAdding(true)} className="mt-5 h-auto px-[18px] py-2.5 font-bold">
              {t('studio:marketingMail.dne.add', 'Add addresses')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="flex h-[38px] w-full items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-3 sm:w-[280px]">
                <Search aria-hidden className="size-[15px] shrink-0 text-fg-subtle" />
                <input
                  aria-label={t('studio:marketingMail.dne.search', 'Search addresses')}
                  placeholder={t('studio:marketingMail.dne.search', 'Search addresses')}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  className="min-w-0 flex-1 border-none bg-transparent px-0.5 py-px text-body-sm text-fg outline-none"
                />
              </label>
              <Select
                aria-label={t('studio:marketingMail.dne.whyLabel', 'Why')}
                value={reason ?? ''}
                onChange={(event) => setReason(event.target.value === '' ? null : (event.target.value as StopReason))}
                wrapperClassName="w-auto"
                className="h-[38px] font-semibold"
              >
                <option value="">{t('studio:marketingMail.dne.whyAny', 'Why: any')}</option>
                {STOP_REASONS.map((one) => (
                  <option key={one} value={one}>
                    {reasonWords(one)}
                  </option>
                ))}
              </Select>
              <span className="ms-auto font-mono text-[12px] text-fg-muted" data-testid="dne-count">
                {t('studio:marketingMail.dne.count', '{count, plural, one {# entry} other {# entries}}', { count: total })}
              </span>
            </div>
            <div role="table" aria-label={t('studio:marketingMail.dne.title', 'Do-not-email list')} className="overflow-x-auto rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
              <div className="min-w-[930px]">
                <div role="row" className={`grid ${COLUMNS} gap-3 border-b border-border bg-surface-2 px-[18px] py-[11px] text-micro uppercase text-fg-subtle`}>
                  <span role="columnheader">{t('studio:marketingMail.dne.col.address', 'Address')}</span>
                  <span role="columnheader">{t('studio:marketingMail.dne.col.why', 'Why')}</span>
                  <span role="columnheader">{t('studio:marketingMail.dne.col.when', 'When')}</span>
                  <span role="columnheader">{t('studio:marketingMail.dne.col.from', 'Where from')}</span>
                  <span role="columnheader" className="text-end">{t('studio:marketingMail.dne.col.actions', 'Actions')}</span>
                </div>
                {entries.length === 0 ? (
                  <div className="px-[18px] py-6 text-body text-fg-muted">{t('studio:marketingMail.dne.noMatch', 'No entry matches.')}</div>
                ) : (
                  entries.map((entry) => (
                    <div key={entry.id} role="row" data-testid="dne-row" className={`grid ${COLUMNS} items-center gap-3 border-b border-border px-[18px] py-[var(--row-py,13px)] text-[length:var(--cell-fs,13px)] last:border-b-0 hover:bg-surface-2`}>
                      <span role="cell" className="min-w-0">
                        {entry.address === null ? (
                          <span className="inline-flex items-center gap-[7px] text-fg-muted">
                            <UserX aria-hidden className="size-[15px] shrink-0" />
                            {t('studio:marketingMail.dne.erased', 'Erased person — kept so they’re never e-mailed again')}
                          </span>
                        ) : (
                          <span dir="ltr" className="font-mono text-[12px] [overflow-wrap:anywhere]">{entry.address}</span>
                        )}
                      </span>
                      <span role="cell">{reasonWords(entry.reason)}</span>
                      <span role="cell" className="font-mono text-[12px] text-fg-muted">
                        {new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.addedAt))}
                      </span>
                      <span role="cell" className="text-fg-muted">{whereFrom(entry)}</span>
                      <span role="cell" className="flex justify-end">
                        {entry.address !== null && entry.mayRemove ? (
                          <Button variant="secondary" size="sm" onClick={() => setRemoving(entry)} className="h-auto rounded-[10px] px-[11px] py-1.5 font-bold">
                            {t('studio:marketingMail.dne.remove', 'Remove')}
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            {next === null ? null : (
              <div className="flex justify-center">
                <Button variant="secondary" loading={page.isFetching} onClick={() => setCursor(next)}>
                  {t('studio:marketingMail.dne.more', 'Show more')}
                </Button>
              </div>
            )}
          </>
        )}
      </PageSurface>
      {adding ? (
        <AddAddresses
          onClose={() => setAdding(false)}
          onAdded={async (result) => {
            setAdding(false);
            await refresh();
            toasts.push({
              variant: result.invalid.length === 0 ? 'success' : 'warning',
              title: t('studio:marketingMail.dne.added', '{added, plural, one {# address added} other {# addresses added}}', { added: result.added }),
              description:
                result.invalid.length > 0
                  ? t('studio:marketingMail.dne.notAddresses', 'Not addresses, left out: {list}', { list: result.invalid.join(', ') })
                  : result.already > 0
                    ? t('studio:marketingMail.dne.already', '{count, plural, one {# was on the list already} other {# were on the list already}}', { count: result.already })
                    : undefined,
            });
          }}
        />
      ) : null}
      {removing === null ? null : (
        <RemoveConfirm
          entry={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            const address = removing.address ?? '';
            setRemoving(null);
            await refresh();
            toasts.push({ variant: 'success', title: t('studio:marketingMail.dne.removed', '{address} is off the list.', { address }) });
          }}
        />
      )}
    </>
  );
}

/** "Add addresses": one per line (comp 4d). */
function AddAddresses({ onClose, onAdded }: { onClose: () => void; onAdded: (result: { added: number; already: number; invalid: string[] }) => Promise<void> }): ReactNode {
  const toasts = useAppToasts();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  async function add(): Promise<void> {
    setBusy(true);
    try {
      await onAdded(await addToStopList(lines.slice(0, 500)));
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.dne.addFailed', 'The addresses were not added. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      className="max-w-[500px]"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader icon={<MailX />} title={t('studio:marketingMail.dne.add', 'Add addresses')} closeLabel={t('studio:marketingMail.close', 'Close')} className="items-center border-b border-border py-[18px]" />
      <ModalBody className="py-[18px]">
        <Textarea
          aria-label={t('studio:marketingMail.dne.addresses', 'Addresses')}
          placeholder={t('studio:marketingMail.dne.onePerLine', 'One address per line')}
          rows={5}
          mono
          dir="ltr"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="text-[12px] leading-[1.6]"
          data-testid="dne-addresses"
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('studio:marketingMail.cancel', 'Cancel')}
        </Button>
        <Button onClick={() => void add()} loading={busy} disabled={lines.length === 0} data-testid="dne-add-confirm">
          {t('studio:marketingMail.dne.add', 'Add addresses')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** "Remove from the list?" (comp 4c): the address, the sentence, Cancel / Remove. Focus starts on Cancel. */
function RemoveConfirm({ entry, onClose, onRemoved }: { entry: StopEntry; onClose: () => void; onRemoved: () => Promise<void> }): ReactNode {
  const toasts = useAppToasts();
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await removeFromStopList(entry.id);
      await onRemoved();
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.dne.removeFailed', 'The address was not removed. Try again.') });
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      className="max-w-[420px]"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader
        icon={<MailPlus />}
        tone="warn"
        hideClose
        closeLabel={t('studio:marketingMail.close', 'Close')}
        title={t('studio:marketingMail.dne.removeTitle', 'Remove from the list?')}
        subtitle={
          <>
            <span dir="ltr" className="mt-1.5 block font-mono text-[12px] text-fg [overflow-wrap:anywhere]">{entry.address}</span>
            <span className="mx-auto mt-2 block max-w-[310px] text-body text-fg-muted">
              {t('studio:marketingMail.dne.removeBody', 'They will get marketing mail again only if they agree again.')}
            </span>
          </>
        }
        className="flex-col items-center px-6 pb-5 pt-6 text-center [&>*:first-child]:mb-1.5 [&>*:first-child]:size-[52px] [&>*:first-child]:rounded-lg [&>*:first-child_svg]:size-6"
      />
      <ModalFooter className="gap-2.5 [&>button]:flex-1">
        <Button variant="secondary" autoFocus onClick={onClose} disabled={busy}>
          {t('studio:marketingMail.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" onClick={() => void remove()} loading={busy} data-testid="dne-remove-confirm">
          {t('studio:marketingMail.dne.remove', 'Remove')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
