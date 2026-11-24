// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Do-not-text list (comp `Texts Activity`, X45–X51), in the
 * do-not-email list's layout.
 *
 * Nobody here gets any text from this business, including service texts.
 *
 *  - Record a stop request: a text from a sender name cannot take a STOP
 *    reply, so the person phones, e-mails or asks in person, and staff record
 *    it here. A desk may do this. Saving is immediate.
 *  - An erased person stays as a hash alone, with no number and no Remove.
 *  - Remove is the Super Admin's only, and says the person must have agreed
 *    again. A START reply is never a yes: it lifts the provider's block and
 *    leaves the list entry's job to the business.
 *  - An erased person's entry comes off only by the Super Admin, with the
 *    number typed again and a fresh yes the person gave, in its own words: a
 *    shared or passed-on line is otherwise never texted again.
 *  - A desk (`privacy.people` without `sms.manage`) never sees the list, which
 *    holds every app's customers. It looks up one number at a time, and the
 *    server audits each look-up.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareOff, Plus, Search, UserX } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Skeleton } from '@adminium/ui';

import { useAppToasts } from '../../pages/toasts.js';
import { t } from '../../i18n/t.js';
import { STOP_REASONS, liftErasedStop, lookupStop, recordStop, removeStop, stopListKey, stopListQuery, type StopAsked, type StopEntry, type StopReason } from './textsApi.js';
import { activeLocale, stopFrom, stopWhy } from './textsWords.js';

const COLUMNS = 'grid-cols-[minmax(220px,1.4fr)_190px_120px_minmax(220px,1.4fr)_96px]';

function RecordStop({ onClose, onDone }: { onClose: () => void; onDone: (entry: StopEntry, added: boolean) => void }) {
  const ids = useId();
  const [phone, setPhone] = useState('');
  const [asked, setAsked] = useState<StopAsked>('phone');
  const record = useMutation({ mutationFn: () => recordStop(phone.trim(), asked), onSuccess: (result) => onDone(result.data, result.added) });
  return (
    <Modal open size="md" onOpenChange={(open) => (open || record.isPending ? undefined : onClose())}>
      <ModalHeader icon={<MessageSquareOff />} title={t('studio:texts.stop.record', 'Record a stop request')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-stop-record">
        <p className="text-fg-muted">{t('studio:texts.stop.recordWhy', 'For someone who asked you, not by text, to stop getting texts. A text from a sender name can’t take a STOP reply, so this is how they stop.')}</p>
        <FormField label={t('studio:texts.stop.number', 'Phone number')} required controlId={`${ids}-phone`} error={record.isError ? t('studio:texts.stop.badNumber', 'This is not a phone number a text can reach. Write it with + and the country code.') : undefined}>
          <Input id={`${ids}-phone`} type="tel" dir="ltr" className="font-mono" value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="texts-stop-phone" />
        </FormField>
        <FormField label={t('studio:texts.stop.how', 'How they asked')} controlId={`${ids}-how`}>
          <Select id={`${ids}-how`} value={asked} onChange={(event) => setAsked(event.target.value as StopAsked)} data-testid="texts-stop-how">
            <option value="phone">{t('studio:texts.stop.asked.phone', 'By phone')}</option>
            <option value="email">{t('studio:texts.stop.asked.email', 'By e-mail')}</option>
            <option value="in-person">{t('studio:texts.stop.asked.inPerson', 'In person')}</option>
          </Select>
        </FormField>
        <p className="text-[12px] text-fg-muted">{t('studio:texts.stop.recordedBy', 'Recorded under your name. It takes effect at once, for every text from this business.')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={record.isPending} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        <Button loading={record.isPending} disabled={phone.trim() === ''} onClick={() => record.mutate()} data-testid="texts-stop-save">
          {t('studio:texts.stop.save', 'Stop texts to this number')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function LiftErased({ entry, onClose, onLifted }: { entry: StopEntry; onClose: () => void; onLifted: () => void }) {
  const ids = useId();
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState<'text-service' | 'text-marketing'>('text-service');
  const [how, setHow] = useState<'in-person' | 'phone' | 'email' | 'paper'>('in-person');
  const [words, setWords] = useState('');
  const [version, setVersion] = useState('');
  const lift = useMutation({ mutationFn: () => liftErasedStop(entry.id, { phone: phone.trim(), purpose, how, wording: { text: words.trim(), version: version.trim() } }), onSuccess: onLifted });
  const ready = phone.trim() !== '' && words.trim() !== '' && version.trim() !== '';
  return (
    <Modal open size="md" onOpenChange={(open) => (open || lift.isPending ? undefined : onClose())}>
      <ModalHeader tone="warn" title={t('studio:texts.stop.liftTitle', 'Text an erased person again?')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-stop-lift-form">
        <p>{t('studio:texts.stop.liftWhy', 'Only for a number that changed hands or is shared, when its holder has agreed to texts again. Type the number, and the words they agreed to: they are kept under your name.')}</p>
        <FormField label={t('studio:texts.stop.number', 'Phone number')} required controlId={`${ids}-phone`} error={lift.isError ? t('studio:texts.stop.liftFailed', 'This was not lifted. Check that the number is the one this entry was kept for.') : undefined}>
          <Input id={`${ids}-phone`} type="tel" dir="ltr" className="font-mono" value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="texts-stop-lift-phone" />
        </FormField>
        <FormField label={t('studio:texts.stop.liftPurpose', 'They agreed to')} controlId={`${ids}-purpose`}>
          <Select id={`${ids}-purpose`} value={purpose} onChange={(event) => setPurpose(event.target.value as 'text-service' | 'text-marketing')}>
            <option value="text-service">{t('studio:texts.stop.liftService', 'Service texts')}</option>
            <option value="text-marketing">{t('studio:texts.stop.liftMarketing', 'Marketing texts')}</option>
          </Select>
        </FormField>
        <FormField label={t('studio:texts.stop.how', 'How they asked')} controlId={`${ids}-how`}>
          <Select id={`${ids}-how`} value={how} onChange={(event) => setHow(event.target.value as 'in-person' | 'phone' | 'email' | 'paper')}>
            <option value="in-person">{t('studio:texts.stop.asked.inPerson', 'In person')}</option>
            <option value="phone">{t('studio:texts.stop.asked.phone', 'By phone')}</option>
            <option value="email">{t('studio:texts.stop.asked.email', 'By e-mail')}</option>
            <option value="paper">{t('studio:texts.stop.asked.paper', 'On paper')}</option>
          </Select>
        </FormField>
        <FormField label={t('studio:texts.stop.liftWords', 'The words they agreed to')} required controlId={`${ids}-words`}>
          <Input id={`${ids}-words`} value={words} onChange={(event) => setWords(event.target.value)} data-testid="texts-stop-lift-words" />
        </FormField>
        <FormField label={t('studio:texts.stop.liftVersion', 'Version of those words')} required controlId={`${ids}-version`}>
          <Input id={`${ids}-version`} value={version} onChange={(event) => setVersion(event.target.value)} data-testid="texts-stop-lift-version" />
        </FormField>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={lift.isPending} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        <Button loading={lift.isPending} disabled={!ready} onClick={() => lift.mutate()} data-testid="texts-stop-lift-yes">
          {t('studio:texts.stop.lift', 'Record the yes and lift')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function RemoveStop({ entry, onClose, onRemoved }: { entry: StopEntry; onClose: () => void; onRemoved: () => void }) {
  const remove = useMutation({ mutationFn: () => removeStop(entry.id), onSuccess: onRemoved });
  return (
    <Modal open size="sm" role="alertdialog" onOpenChange={(open) => (open || remove.isPending ? undefined : onClose())}>
      <ModalHeader tone="warn" title={t('studio:texts.stop.removeTitle', 'Take this number off the list?')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-2 text-[13px]" data-testid="texts-stop-remove-confirm">
        <bdi dir="ltr" className="font-mono">
          {entry.phone}
        </bdi>
        <p>{t('studio:texts.stop.removeBody', 'Only if this person has agreed again to get texts. Taking them off does not record a yes: they still get only the texts they agreed to.')}</p>
        {remove.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={remove.error.message} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" autoFocus disabled={remove.isPending} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()} data-testid="texts-stop-remove-yes">
          {t('studio:texts.stop.remove', 'Remove')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** A desk's view: one number at a time, never the list. */
function DeskLookup(): ReactNode {
  const toasts = useAppToasts();
  const ids = useId();
  const locale = activeLocale();
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const lookup = useMutation({ mutationFn: () => lookupStop(phone.trim()) });
  const found = lookup.data;
  return (
    <div className="flex flex-col gap-3.5" data-testid="texts-stop-desk">
      <p className="text-[13px] font-semibold" data-testid="texts-stop-line">
        {t('studio:texts.stop.line', 'Nobody here gets any text from this business, including service texts.')}
      </p>
      <p className="text-[12.5px] text-fg-muted">{t('studio:texts.stop.deskWhy', 'Look up one number at a time. The whole list holds every app’s customers, so only whoever manages texts sees it.')}</p>
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (phone.trim() !== '') lookup.mutate();
        }}
      >
        <FormField label={t('studio:texts.stop.number', 'Phone number')} controlId={`${ids}-lookup`} className="w-full sm:w-[260px]">
          <Input id={`${ids}-lookup`} type="tel" dir="ltr" className="font-mono" value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="texts-stop-lookup-phone" />
        </FormField>
        <Button type="submit" variant="secondary" loading={lookup.isPending} disabled={phone.trim() === ''} iconLeft={<Search className="size-4" />} data-testid="texts-stop-lookup">
          {t('studio:texts.stop.lookup', 'Look up')}
        </Button>
        <span className="ms-auto">
          <Button iconLeft={<Plus className="size-4" />} onClick={() => setAdding(true)} data-testid="texts-stop-add">
            {t('studio:texts.stop.record', 'Record a stop request')}
          </Button>
        </span>
      </form>
      <div role="status" aria-live="polite">
        {lookup.isError ? (
          <Alert tone="danger" title={t('studio:texts.loadFailed', 'This could not be loaded')} />
        ) : found === undefined ? null : found === null ? (
          <p className="text-[13px]" data-testid="texts-stop-lookup-none">
            {t('studio:texts.stop.lookupNone', 'This number is not on the list.')}
          </p>
        ) : (
          <p className="text-[13px]" data-testid="texts-stop-lookup-found">
            {t('studio:texts.stop.lookupFound', 'On the list since {date}: {why}.', { date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(found.addedAt)), why: stopWhy(found.reason) })}
          </p>
        )}
      </div>
      {adding ? (
        <RecordStop
          onClose={() => setAdding(false)}
          onDone={(entry, added) => {
            setAdding(false);
            toasts.push({ variant: added ? 'success' : 'warning', title: added ? t('studio:texts.stop.added', 'Texts to this number are stopped.') : t('studio:texts.stop.already', 'This number is on the list already.'), description: entry.phone ?? undefined });
          }}
        />
      ) : null}
    </div>
  );
}

export function StopListTab({ isSuperAdmin, canManage }: { isSuperAdmin: boolean; canManage: boolean }): ReactNode {
  return canManage ? <WholeList isSuperAdmin={isSuperAdmin} /> : <DeskLookup />;
}

function WholeList({ isSuperAdmin }: { isSuperAdmin: boolean }): ReactNode {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const list = useQuery(stopListQuery());
  const locale = activeLocale();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState<StopReason | ''>('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StopEntry | null>(null);
  const [lifting, setLifting] = useState<StopEntry | null>(null);
  const all = list.data?.data ?? [];
  const digits = typed.replace(/[^\d+]/g, '');
  const entries = all.filter((entry) => (reason === '' || entry.reason === reason) && (digits === '' || (entry.phone ?? '').includes(digits)));
  const refresh = () => void client.invalidateQueries({ queryKey: stopListKey });

  const addButton = (
    <Button iconLeft={<Plus className="size-4" />} onClick={() => setAdding(true)} data-testid="texts-stop-add">
      {t('studio:texts.stop.record', 'Record a stop request')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3.5" data-testid="texts-stop-list">
      <p className="text-[13px] font-semibold" data-testid="texts-stop-line">
        {t('studio:texts.stop.line', 'Nobody here gets any text from this business, including service texts.')}
      </p>
      {list.isError ? (
        <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={list.error.message} />
      ) : list.data === undefined ? (
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-[38px] w-[280px]" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      ) : all.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border-[1.5px] border-dashed border-border-strong bg-surface px-5 py-16 text-center" data-testid="texts-stop-empty">
          <div className="mb-4 flex size-[58px] items-center justify-center rounded-lg bg-accent-soft text-accent">
            <MessageSquareOff aria-hidden className="size-7" />
          </div>
          <div className="text-section text-fg">{t('studio:texts.stop.empty', 'Nobody is on the list yet.')}</div>
          <div className="mt-5">{addButton}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-[38px] w-full items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-3 sm:w-[260px]">
              <Search aria-hidden className="size-[15px] shrink-0 text-fg-subtle" />
              <input
                aria-label={t('studio:texts.stop.search', 'Search numbers')}
                placeholder={t('studio:texts.stop.search', 'Search numbers')}
                dir="ltr"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="min-w-0 flex-1 border-none bg-transparent px-0.5 py-px text-body-sm text-fg outline-none"
                data-testid="texts-stop-search"
              />
            </label>
            <Select aria-label={t('studio:texts.stop.col.why', 'Why')} value={reason} onChange={(event) => setReason(event.target.value as StopReason | '')} wrapperClassName="w-auto" className="h-[38px] font-semibold" data-testid="texts-stop-why">
              <option value="">{t('studio:texts.stop.whyAny', 'Why: any')}</option>
              {STOP_REASONS.map((one) => (
                <option key={one} value={one}>
                  {stopWhy(one)}
                </option>
              ))}
            </Select>
            <span className="font-mono text-[12px] text-fg-muted" data-testid="texts-stop-count">
              {t('studio:texts.stop.count', '{count, plural, one {# entry} other {# entries}}', { count: all.length })}
            </span>
            <span className="ms-auto">{addButton}</span>
          </div>
          <div role="table" aria-label={t('studio:texts.tab.stop', 'Do-not-text list')} className="overflow-x-auto rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
            <div className="min-w-[860px]">
              <div role="row" className={`grid ${COLUMNS} gap-3 border-b border-border bg-surface-2 px-[18px] py-[11px] text-micro uppercase text-fg-subtle`}>
                <span role="columnheader">{t('studio:texts.stop.col.number', 'Number')}</span>
                <span role="columnheader">{t('studio:texts.stop.col.why', 'Why')}</span>
                <span role="columnheader">{t('studio:texts.stop.col.when', 'When')}</span>
                <span role="columnheader">{t('studio:texts.stop.col.from', 'Where from')}</span>
                <span role="columnheader" className="text-end">
                  {t('studio:texts.stop.col.actions', 'Actions')}
                </span>
              </div>
              {entries.length === 0 ? (
                <div className="px-[18px] py-6 text-body text-fg-muted">{t('studio:texts.stop.noMatch', 'No entry matches.')}</div>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} role="row" data-testid="texts-stop-row" className={`grid ${COLUMNS} items-center gap-3 border-b border-border px-[18px] py-[13px] text-[13px] last:border-b-0 hover:bg-surface-2`}>
                    <span role="cell" className="min-w-0">
                      {entry.phone === null ? (
                        <span className="inline-flex items-center gap-[7px] text-fg-muted" data-testid="texts-stop-erased">
                          <UserX aria-hidden className="size-[15px] shrink-0" />
                          {t('studio:texts.stop.erased', 'Erased person, kept so they’re never texted again')}
                        </span>
                      ) : (
                        <bdi dir="ltr" className="font-mono text-[12px]">
                          {entry.phone}
                        </bdi>
                      )}
                    </span>
                    <span role="cell">{stopWhy(entry.reason)}</span>
                    <span role="cell" className="font-mono text-[12px] text-fg-muted">
                      {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.addedAt))}
                    </span>
                    <span role="cell" className="text-fg-muted">
                      {stopFrom(entry)}
                      {entry.reason === 'text-stop' ? <span className="mt-0.5 block text-[11.5px]">{t('studio:texts.stop.confirmSent', 'One plain confirmation went out, with no question and no offer.')}</span> : null}
                      {entry.reason === 'staff' ? <span className="mt-0.5 block text-[11.5px]">{t('studio:texts.stop.noConfirm', 'No confirmation by text, because this person asked the business directly.')}</span> : null}
                    </span>
                    <span role="cell" className="flex justify-end">
                      {entry.phone !== null && isSuperAdmin ? (
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(entry)} data-testid="texts-stop-remove">
                          {t('studio:texts.stop.remove', 'Remove')}
                        </Button>
                      ) : null}
                      {entry.phone === null && isSuperAdmin ? (
                        <Button variant="secondary" size="sm" onClick={() => setLifting(entry)} data-testid="texts-stop-lift">
                          {t('studio:texts.stop.liftOpen', 'Lift')}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <p className="text-[12px] text-fg-muted">{t('studio:texts.stop.start', 'A START reply lifts the provider’s block and takes the number off this list, but it is not a yes. The person still has to agree again before any text.')}</p>
        </>
      )}
      {adding ? (
        <RecordStop
          onClose={() => setAdding(false)}
          onDone={(entry, added) => {
            setAdding(false);
            refresh();
            toasts.push({ variant: added ? 'success' : 'warning', title: added ? t('studio:texts.stop.added', 'Texts to this number are stopped.') : t('studio:texts.stop.already', 'This number is on the list already.'), description: entry.phone ?? undefined });
          }}
        />
      ) : null}
      {lifting === null ? null : (
        <LiftErased
          entry={lifting}
          onClose={() => setLifting(null)}
          onLifted={() => {
            setLifting(null);
            refresh();
          }}
        />
      )}
      {removing === null ? null : (
        <RemoveStop
          entry={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
