// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Marketing: a marketing text run, who it reaches and why the rest
 * are left out, its schedule, its results, and a person's marketing yes.
 *
 * WHO. `system:settings:manage`, as the server's marketing routes require
 * (the right e-mail campaigns use), held with `sms.manage`: the page offers
 * the tab to that pair alone.
 *
 * WHAT CAN'T BE OVERRIDDEN. A run is refused as a whole when the server can't
 * hear a STOP, when the sender is a name, with no provider, or when whoever
 * runs the server switched it off: the panel says each reason and what to do,
 * and nothing here sends anyway. A person is left out for a reason the send
 * path decides (no yes, a STOP, a country where nobody can reply STOP, +86, a
 * yes their country expects confirmed first): each group shows its count, its
 * exact reason and "See who", and no group can be let through.
 *
 * LOCKED. A version may ship marketing texts locked until their wording is
 * reviewed. Then the tab says so calmly, and the preview still counts who a
 * run would reach, but nothing can be sent or scheduled.
 *
 * DOUBLE OPT-IN. Where a country expects a yes confirmed (Germany), the yes
 * is confirmed by a link in an e-mail, never by a text reply, or recorded by
 * a named staff member who heard it in person.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CircleSlash, Clock, Info, Megaphone, Plus, Send, Users } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Drawer, DrawerBody, DrawerHeader, EmptyState, FormField, IconTile, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Skeleton, Textarea } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import {
  askToConfirm,
  audienceRefusalOf,
  cancelRun,
  confirmedInPerson,
  createRun,
  groupPeople,
  isLocked,
  LOCKED,
  marketingKey,
  marketingSetupQuery,
  previewRun,
  recordMarketingYes,
  runPeopleQuery,
  runRefusalsOf,
  runsQuery,
  savedViewsQuery,
  unfilledOf,
  type Audience,
  type ConsentHow,
  type GroupPerson,
  type MarketingSetup,
  type Run,
  type RunPreview,
  type RunRefusal,
} from './marketingApi.js';
import { audienceRefusalWords, CN_REASON, cnWords, confirmRequestWords, COUNTRY_REASON, groupWords, inPersonWords, noDoorDetail, RUN_TONE, runRefusalWords, runStateLabel } from './marketingWords.js';
import { countryName } from './textCountries.js';
import { activeLocale, reasonWords, stamp, statusLabel, statusOf, STATUS_TONE } from './textsWords.js';
import type { Delivery } from './textsApi.js';

// ─── small parts ────────────────────────────────────────────────────────────

function Figure({ value, testId }: { value: number; testId?: string }) {
  return (
    <bdi dir="ltr" className="font-mono font-semibold" data-testid={testId}>
      {value}
    </bdi>
  );
}

const countryLabel = (code: string | null): string => (code === null ? '—' : countryName(code, activeLocale()));

const daysWord = (): string => t('studio:texts.mkt.hours.days', 'Monday to Saturday');

/** The run-level refusals, as one panel: every reason and what to do. Nothing in it lets anyone send anyway. */
function RefusalPanel({ refusals, testId = 'texts-mkt-refusals' }: { refusals: readonly RunRefusal[]; testId?: string }) {
  const shown = refusals.filter((one) => one.reason !== LOCKED);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border-[1.5px] border-warn bg-warn-soft p-3.5 text-[13px]" role="alert" data-testid={testId}>
      <p className="font-bold">{t('studio:texts.mkt.refusals.title', 'Marketing texts can’t go from this server yet')}</p>
      <ul className="flex flex-col gap-1.5 ps-4 [list-style:disc]">
        {shown.map((one) => (
          <li key={`${one.reason}-${one.detail ?? ''}`} data-testid="texts-mkt-refusal" data-reason={one.reason}>
            {runRefusalWords(one.reason, one.detail)}
            {one.reason === 'marketing-without-replies' && noDoorDetail(one.detail) !== null ? ` ${noDoorDetail(one.detail) ?? ''}` : ''}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-fg-muted">{t('studio:texts.mkt.refusals.serviceStill', 'Service texts still go as before.')}</p>
    </div>
  );
}

/** The calm, finished state of a version that ships marketing texts locked. */
function LockedCard() {
  return (
    <Card data-testid="texts-mkt-locked">
      <div className="flex items-start gap-3">
        <IconTile tone="neutral" icon={<Info />} />
        <div>
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.mkt.locked.title', 'Marketing texts are not yet available')}</h2>
          <p className="mt-[3px] text-[12.5px] text-fg-muted">{runRefusalWords(LOCKED, null)}</p>
          <p className="mt-[3px] text-[12.5px] text-fg-muted">{t('studio:texts.mkt.locked.preview', 'You can still see who a marketing text would reach. Sending and scheduling open in a later version.')}</p>
        </div>
      </div>
    </Card>
  );
}

// ─── "See who" and a person's marketing yes ─────────────────────────────────

function RecordYes({ person, audience, locked, onClose, onDone }: { person: GroupPerson; audience: Audience; locked: boolean; onClose: () => void; onDone: (words: string) => void }) {
  const ids = useId();
  const [how, setHow] = useState<ConsentHow>('in-person');
  const [text, setText] = useState('');
  const [version, setVersion] = useState('1');
  const save = useMutation({
    mutationFn: () => recordMarketingYes({ connectionId: audience.connectionId, table: audience.table, key: person.key, how, wording: { text: text.trim(), version: version.trim() } }),
    // While marketing is locked the server mails no confirmation, so the page does not say one went.
    onSuccess: () => onDone(locked ? t('studio:texts.mkt.yes.savedLocked', 'Their marketing yes is recorded under your name.') : t('studio:texts.mkt.yes.saved', 'Their marketing yes is recorded under your name. Where their country expects it, a confirmation e-mail goes to them now.')),
  });
  return (
    <Modal open size="md" onOpenChange={(open) => (open || save.isPending ? undefined : onClose())}>
      <ModalHeader title={t('studio:texts.mkt.yes.title', 'Record a marketing yes')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-mkt-yes">
        <p className="text-fg-muted">{t('studio:texts.mkt.yes.why', 'Only for someone who said yes to marketing texts, in these words, to you. An e-mail or newsletter yes never counts. Nobody is asked to reply YES.')}</p>
        <p>
          {person.name ?? '—'}{' '}
          <bdi dir="ltr" className="font-mono">
            {person.phone ?? ''}
          </bdi>
        </p>
        <FormField label={t('studio:texts.mkt.yes.how', 'How they said yes')} controlId={`${ids}-how`}>
          <Select id={`${ids}-how`} value={how} onChange={(event) => setHow(event.target.value as ConsentHow)} data-testid="texts-mkt-yes-how">
            <option value="in-person">{t('studio:texts.stop.asked.inPerson', 'In person')}</option>
            <option value="phone">{t('studio:texts.stop.asked.phone', 'By phone')}</option>
            <option value="email">{t('studio:texts.stop.asked.email', 'By e-mail')}</option>
            <option value="paper">{t('studio:texts.mkt.yes.paper', 'On paper')}</option>
          </Select>
        </FormField>
        <FormField label={t('studio:texts.mkt.yes.wording', 'The words they agreed to')} required controlId={`${ids}-wording`}>
          <Textarea id={`${ids}-wording`} rows={3} value={text} onChange={(event) => setText(event.target.value)} data-testid="texts-mkt-yes-wording" />
        </FormField>
        <FormField label={t('studio:texts.mkt.yes.version', 'Version of those words')} required controlId={`${ids}-version`}>
          <Input id={`${ids}-version`} value={version} onChange={(event) => setVersion(event.target.value)} className="w-[120px] font-mono" />
        </FormField>
        {save.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={save.error.message} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        <Button loading={save.isPending} disabled={text.trim() === '' || version.trim() === ''} onClick={() => save.mutate()} data-testid="texts-mkt-yes-save">
          {t('studio:texts.mkt.yes.save', 'Record their yes')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function PersonActions({ person, audience, reason, locked }: { person: GroupPerson; audience: Audience; reason: string; locked: boolean }) {
  const [said, setSaid] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const ref = { connectionId: audience.connectionId, table: audience.table, key: person.key };
  const ask = useMutation({ mutationFn: () => askToConfirm(ref), onSuccess: (outcome) => setSaid(confirmRequestWords(outcome)), onError: (error) => setSaid(error.message) });
  const inPerson = useMutation({ mutationFn: () => confirmedInPerson(ref, 'in-person'), onSuccess: (outcome) => setSaid(inPersonWords(outcome)), onError: (error) => setSaid(error.message) });
  return (
    <div className="flex flex-col items-start gap-1.5">
      {reason === 'unconfirmed-consent' ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" loading={ask.isPending} disabled={locked} onClick={() => ask.mutate()} data-testid="texts-mkt-ask-confirm">
            {t('studio:texts.mkt.confirm.ask', 'Ask to confirm by e-mail')}
          </Button>
          <Button size="sm" variant="secondary" loading={inPerson.isPending} onClick={() => inPerson.mutate()} data-testid="texts-mkt-in-person">
            {t('studio:texts.mkt.confirm.inPerson', 'They confirmed in person')}
          </Button>
        </div>
      ) : null}
      {reason === 'no-consent' ? (
        <Button size="sm" variant="secondary" onClick={() => setRecording(true)} data-testid="texts-mkt-record-yes">
          {t('studio:texts.mkt.yes.save', 'Record their yes')}
        </Button>
      ) : null}
      {said === null ? null : (
        <p role="status" className="text-[12px] text-fg-muted" data-testid="texts-mkt-person-said">
          {said}
        </p>
      )}
      {recording ? (
        <RecordYes
          person={person}
          audience={audience}
          locked={locked}
          onClose={() => setRecording(false)}
          onDone={(words) => {
            setRecording(false);
            setSaid(words);
          }}
        />
      ) : null}
    </div>
  );
}

function SeeWho({ audience, reason, count, locked, onClose }: { audience: Audience; reason: string; count: number; locked: boolean; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const page = useQuery({ queryKey: [...marketingKey, 'who', audience.connectionId, audience.table, audience.viewId ?? null, reason, offset], queryFn: () => groupPeople({ audience, reason, offset }) });
  const title = reason === 'ok' ? t('studio:texts.mkt.who.ok', 'Who gets it') : t('studio:texts.mkt.who.title', 'Who is left out');
  return (
    <Drawer open size="lg" onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerHeader icon={<Users />} title={title} subtitle={reason === 'ok' ? t('studio:texts.mkt.who.okLine', '{count, plural, one {# person} other {# people}} can get this text.', { count }) : groupWords(reason)} closeLabel={t('studio:texts.close', 'Close')} />
      <DrawerBody className="flex flex-col gap-3 text-[13px]" data-testid="texts-mkt-who" data-reason={reason}>
        {reason === 'unconfirmed-consent' ? <p className="text-fg-muted">{t('studio:texts.mkt.who.confirmWhy', 'Each is waiting to confirm by e-mail. Someone with no e-mail can’t be confirmed yet: ask them in person, then record it here.')}</p> : null}
        {page.isError ? (
          <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={page.error.message} />
        ) : page.data === undefined ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <ul className="flex flex-col">
            {page.data.people.map((person) => (
              <li key={person.key} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 border-b border-border py-2.5 last:border-b-0" data-testid="texts-mkt-who-row">
                <div className="min-w-[180px] flex-1">
                  <p className="font-semibold" dir="auto">
                    {person.name ?? '—'}
                  </p>
                  <p className="text-[12px] text-fg-muted">
                    <bdi dir="ltr" className="font-mono">
                      {person.phone ?? '—'}
                    </bdi>{' '}
                    · {countryLabel(person.country)}
                  </p>
                </div>
                <PersonActions person={person} audience={audience} reason={reason} locked={locked} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {offset > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setOffset(Math.max(0, offset - 50))}>
              {t('studio:texts.mkt.who.previous', 'Previous')}
            </Button>
          ) : null}
          {page.data?.more === true ? (
            <Button size="sm" variant="ghost" onClick={() => setOffset(offset + 50)}>
              {t('studio:texts.mkt.who.next', 'Next')}
            </Button>
          ) : null}
        </div>
      </DrawerBody>
    </Drawer>
  );
}

// ─── who it reaches ─────────────────────────────────────────────────────────

/** The groups, largest first, with the country refusals drawn as their own block. */
function Reach({ preview, setup, audience, locked }: { preview: RunPreview; setup: MarketingSetup; audience: Audience; locked: boolean }) {
  const [who, setWho] = useState<{ reason: string; count: number } | null>(null);
  const groups = Object.entries(preview.skipped).sort(([, a], [, b]) => b - a);
  const noReply = new Set(setup.countries.noReplies);
  const blockedCountries = preview.countries.filter((one) => noReply.has(one.country) && one.country !== 'CN' && one.people > 0);
  const locale = activeLocale();
  return (
    <div className="flex flex-col gap-3" data-testid="texts-mkt-preview">
      <p className="text-[15px]">
        {t('studio:texts.mkt.reach.line', '{canSend} of {people} can get it.', { canSend: preview.canSend, people: preview.people })}{' '}
        {preview.canSend > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setWho({ reason: 'ok', count: preview.canSend })} data-testid="texts-mkt-who-ok">
            {t('studio:texts.mkt.reach.seeWho', 'See who')}
          </Button>
        ) : null}
      </p>
      {preview.template.refusals.length > 0 ? <RefusalPanel refusals={preview.template.refusals} testId="texts-mkt-template-refusals" /> : null}
      {preview.template.unfilled.length > 0 ? (
        <Alert tone="danger" title={t('studio:texts.mkt.unfilled', 'Nothing fills {names} in this template. Give it a backup in Templates, or take it out.', { names: preview.template.unfilled.map((one) => `{{${one}}}`).join(', ') })} />
      ) : null}
      {blockedCountries.length > 0 ? (
        <div className="rounded-[12px] border border-border bg-surface-2 p-3.5 text-[13px]" data-testid="texts-mkt-country-block">
          <p className="font-semibold">{t('studio:texts.mkt.country.title', 'Marketing texts can’t go to these countries because people there can’t reply STOP.')}</p>
          <p className="mt-1 text-fg-muted">{blockedCountries.map((one) => countryName(one.country, locale)).join(' · ')}</p>
          <p className="mt-1 text-[12px] text-fg-muted">{t('studio:texts.mkt.country.service', 'Service texts to them still work, with a way to stop through you.')}</p>
        </div>
      ) : null}
      {preview.skipped[CN_REASON] !== undefined ? (
        <p className="rounded-[12px] border border-border bg-surface-2 p-3.5 text-[13px]" data-testid="texts-mkt-cn">
          {cnWords()}
        </p>
      ) : null}
      {groups.length === 0 ? null : (
        <ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="texts-mkt-groups">
          {groups.map(([reason, count]) => (
            <li key={reason} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3.5 py-2.5 last:border-b-0" data-testid="texts-mkt-group" data-reason={reason}>
              <span className="w-10 shrink-0 text-end">
                <Figure value={count} />
              </span>
              <span className="min-w-0 flex-1 text-[13px]">{reason === COUNTRY_REASON ? reasonWords(reason) : groupWords(reason)}</span>
              <Button size="sm" variant="ghost" onClick={() => setWho({ reason, count })} data-testid="texts-mkt-group-who">
                {t('studio:texts.mkt.reach.seeWho', 'See who')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {preview.countries.length > 0 ? (
        <table className="w-full text-[12.5px]" data-testid="texts-mkt-countries">
          <caption className="pb-1.5 text-start text-[12px] font-semibold text-fg-muted">{t('studio:texts.mkt.countries.caption', 'By country')}</caption>
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[0.05em] text-fg-subtle">
              <th className="py-1 text-start font-bold">{t('studio:texts.mkt.countries.country', 'Country')}</th>
              <th className="py-1 text-end font-bold">{t('studio:texts.mkt.countries.people', 'People')}</th>
              <th className="py-1 text-end font-bold">{t('studio:texts.mkt.countries.canSend', 'Can get it')}</th>
              <th className="py-1 ps-3 text-start font-bold">{t('studio:texts.mkt.countries.when', 'When')}</th>
            </tr>
          </thead>
          <tbody>
            {preview.countries.map((one) => (
              <tr key={one.country} className="border-t border-border">
                <td className="py-1.5">{countryName(one.country, locale)}</td>
                <td className="py-1.5 text-end">
                  <Figure value={one.people} />
                </td>
                <td className="py-1.5 text-end">
                  <Figure value={one.canSend} />
                </td>
                <td className="py-1.5 ps-3 text-fg-muted" data-testid="texts-mkt-country-when">
                  {one.canSend === 0
                    ? '—'
                    : one.noWindow
                      ? t('studio:texts.mkt.countries.noWindow', 'No sending hours open in all its time zones within two weeks')
                      : one.opensAt === null
                        ? t('studio:texts.mkt.countries.now', 'At the time chosen')
                        : t('studio:texts.mkt.countries.opens', 'Moves to {time}, when the hours open', { time: stamp(one.opensAt, locale) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-[12.5px] text-fg-muted" data-testid="texts-mkt-daily">
        {preview.daily.days > 1
          ? t('studio:texts.mkt.daily.days', 'Today has {left} of {limit} texts left, so this goes over {days} days.', { left: preview.daily.left, limit: preview.daily.limit, days: preview.daily.days })
          : t('studio:texts.mkt.daily.today', 'Today has {left} of {limit} texts left.', { left: preview.daily.left, limit: preview.daily.limit })}
      </p>
      {who === null ? null : <SeeWho audience={audience} reason={who.reason} count={who.count} locked={locked} onClose={() => setWho(null)} />}
    </div>
  );
}

// ─── setting up a run ───────────────────────────────────────────────────────

/** `YYYY-MM-DDTHH:mm` on this browser's clock, for a datetime-local field. */
function localField(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewRun({ setup, onClose, onMade }: { setup: MarketingSetup; onClose: () => void; onMade: (run: Run) => void }) {
  const ids = useId();
  const locked = isLocked(setup.preflight);
  const readable = setup.tables.filter((one) => one.phones === 'readable');
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState(setup.templates[0]?.key ?? '');
  const [tableId, setTableId] = useState(readable[0] === undefined ? '' : `${readable[0].connectionId}\u0000${readable[0].table}`);
  const [viewId, setViewId] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState(() => localField(Date.now() + 60 * 60 * 1000));
  const [connectionId = '', table = ''] = tableId.split('\u0000');
  const audience: Audience = { connectionId, table, viewId: viewId === '' ? null : viewId };
  const scheduleAt = when === 'later' && at !== '' ? new Date(at).getTime() : undefined;
  const views = useQuery({ ...savedViewsQuery(connectionId, table), enabled: tableId !== '' });
  const preview = useMutation({ mutationFn: () => previewRun({ templateKey, audience, scheduleAt }) });
  const make = useMutation({ mutationFn: () => createRun({ name: name.trim(), templateKey, audience, scheduleAt }), onSuccess: onMade });
  const reset = () => {
    preview.reset();
    make.reset();
  };
  const ready = templateKey !== '' && tableId !== '';
  const looked = preview.data;
  const blocked = looked === undefined || locked || !looked.preflight.ok || looked.canSend === 0 || looked.template.refusals.length > 0 || looked.template.unfilled.length > 0;
  const madeRefusals = runRefusalsOf(make.error);
  const audienceRefused = audienceRefusalOf(preview.error) ?? audienceRefusalOf(make.error);
  const unfilled = unfilledOf(make.error);

  return (
    <Modal open size="lg" onOpenChange={(open) => (open || make.isPending ? undefined : onClose())}>
      <ModalHeader icon={<Megaphone />} title={t('studio:texts.mkt.new.title', 'New marketing text')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-mkt-new">
        <p className="font-semibold" data-testid="texts-mkt-only-agreed">
          {t('studio:texts.mkt.new.onlyAgreed', 'Only people who agreed to marketing texts.')}
        </p>
        {locked ? <p className="text-fg-muted">{t('studio:texts.mkt.locked.preview', 'You can still see who a marketing text would reach. Sending and scheduling open in a later version.')}</p> : null}
        <FormField label={t('studio:texts.mkt.new.name', 'Name')} required controlId={`${ids}-name`} helper={t('studio:texts.mkt.new.nameHelp', 'For you and your team. Customers never see it.')}>
          <Input id={`${ids}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} data-testid="texts-mkt-name" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('studio:texts.mkt.new.template', 'Template')} required controlId={`${ids}-template`}>
            <Select
              id={`${ids}-template`}
              value={templateKey}
              onChange={(event) => {
                setTemplateKey(event.target.value);
                reset();
              }}
              data-testid="texts-mkt-template"
            >
              {setup.templates.length === 0 ? <option value="">{t('studio:texts.mkt.new.noTemplate', 'No text template yet')}</option> : null}
              {setup.templates.map((one) => (
                <option key={one.key} value={one.key}>
                  {one.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:texts.mkt.new.table', 'People')} required controlId={`${ids}-table`}>
            <Select
              id={`${ids}-table`}
              value={tableId}
              onChange={(event) => {
                setTableId(event.target.value);
                setViewId('');
                reset();
              }}
              data-testid="texts-mkt-table"
            >
              {readable.length === 0 ? <option value="">{t('studio:texts.mkt.new.noTable', 'No people table you can text')}</option> : null}
              {setup.tables.map((one) => (
                <option key={`${one.connectionId}-${one.table}`} value={`${one.connectionId}\u0000${one.table}`} disabled={one.phones !== 'readable'}>
                  {one.phones === 'readable' ? `${one.appName} · ${one.label}` : t('studio:texts.mkt.new.tableHidden', '{app} · {table} (numbers hidden from you)', { app: one.appName, table: one.label })}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:texts.mkt.new.view', 'Saved view')} controlId={`${ids}-view`}>
            <Select
              id={`${ids}-view`}
              value={viewId}
              disabled={tableId === ''}
              onChange={(event) => {
                setViewId(event.target.value);
                reset();
              }}
              data-testid="texts-mkt-view"
            >
              <option value="">{t('studio:texts.mkt.new.everyone', 'Everyone in the table')}</option>
              {(views.data ?? []).map((one) => (
                <option key={one.id} value={one.id} disabled={one.refused !== null}>
                  {one.refused === null ? one.name : `${one.name} (${audienceRefusalWords(one.refused)})`}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:texts.mkt.new.when', 'When')} controlId={`${ids}-when`}>
            <Select
              id={`${ids}-when`}
              value={when}
              onChange={(event) => {
                setWhen(event.target.value as 'now' | 'later');
                reset();
              }}
              data-testid="texts-mkt-when"
            >
              <option value="now">{t('studio:texts.mkt.new.now', 'As soon as the hours allow')}</option>
              <option value="later">{t('studio:texts.mkt.new.later', 'At a time')}</option>
            </Select>
          </FormField>
        </div>
        {when === 'later' ? (
          <FormField label={t('studio:texts.mkt.new.at', 'Send at')} controlId={`${ids}-at`}>
            <Input
              id={`${ids}-at`}
              type="datetime-local"
              dir="ltr"
              value={at}
              onChange={(event) => {
                setAt(event.target.value);
                reset();
              }}
              className="w-[240px] font-mono"
              data-testid="texts-mkt-at"
            />
          </FormField>
        ) : null}
        <p className="flex items-start gap-2 text-[12px] text-fg-muted" data-testid="texts-mkt-hours">
          <Clock aria-hidden className="mt-px size-4 shrink-0" />
          {t('studio:texts.mkt.hours.line', 'Marketing texts go {from}–{to}, {days}, on each person’s clock. A time outside them moves to the next opening. A country with several time zones gets them only when the hours are open in all of them.', { from: setup.hours.from, to: setup.hours.to, days: daysWord() })}
        </p>
        <div>
          <Button variant="secondary" iconLeft={<Users className="size-4" />} disabled={!ready} loading={preview.isPending} onClick={() => preview.mutate()} data-testid="texts-mkt-check">
            {t('studio:texts.mkt.new.check', 'See who it reaches')}
          </Button>
        </div>
        {audienceRefused !== null ? <Alert tone="danger" role="alert" title={audienceRefusalWords(audienceRefused)} /> : null}
        {preview.isError && audienceRefused === null ? <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={preview.error.message} /> : null}
        {looked === undefined ? null : (
          <>
            <RefusalPanel refusals={looked.preflight.refusals} />
            <Reach preview={looked} setup={setup} audience={audience} locked={locked} />
          </>
        )}
        {madeRefusals !== null ? <RefusalPanel refusals={madeRefusals} testId="texts-mkt-made-refusals" /> : null}
        {unfilled !== null ? <Alert tone="danger" role="alert" title={t('studio:texts.mkt.unfilled', 'Nothing fills {names} in this template. Give it a backup in Templates, or take it out.', { names: unfilled.map((one) => `{{${one}}}`).join(', ') })} /> : null}
        {make.isError && madeRefusals === null && unfilled === null && audienceRefused === null ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={make.error.message} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={make.isPending} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        {locked ? (
          <span className="text-[12px] text-fg-muted" data-testid="texts-mkt-locked-send">
            {t('studio:texts.mkt.locked.short', 'Not yet available in this version')}
          </span>
        ) : (
          <Button
            iconLeft={when === 'later' ? <CalendarClock className="size-4" /> : <Send className="size-4 rtl:-scale-x-100" />}
            loading={make.isPending}
            disabled={blocked || name.trim() === ''}
            onClick={() => make.mutate()}
            data-testid="texts-mkt-send"
          >
            {when === 'later'
              ? t('studio:texts.mkt.new.schedule', 'Schedule for {count, plural, one {# person} other {# people}}', { count: looked?.canSend ?? 0 })
              : t('studio:texts.mkt.new.send', 'Send to {count, plural, one {# person} other {# people}}', { count: looked?.canSend ?? 0 })}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

// ─── a run's results ────────────────────────────────────────────────────────

const OPEN_STATES: ReadonlySet<Run['status']> = new Set(['scheduled', 'running', 'waiting']);
const mayCancel = (run: Run): boolean => OPEN_STATES.has(run.status) || (run.status === 'done' && run.totals.sending > 0);

function Results({ run, onClose, onCancel }: { run: Run; onClose: () => void; onCancel: () => void }) {
  const people = useQuery(runPeopleQuery(run.id));
  const { totals } = run;
  const skipped = Object.entries(totals.skipped).sort(([, a], [, b]) => b - a);
  const skippedAll = skipped.reduce((sum, [, n]) => sum + n, 0);
  const tiles: { label: string; value: number; id: string }[] = [
    { id: 'people', label: t('studio:texts.mkt.results.people', 'People'), value: totals.people },
    { id: 'sent', label: t('studio:texts.mkt.results.sent', 'Handed to the provider'), value: totals.sent },
    { id: 'delivered', label: t('studio:texts.mkt.results.delivered', 'Delivered'), value: totals.delivered },
    { id: 'failed', label: t('studio:texts.mkt.results.failed', 'Failed'), value: totals.failed },
    { id: 'unknown', label: t('studio:texts.mkt.results.unknown', 'Unknown'), value: totals.unknown },
    { id: 'skipped', label: t('studio:texts.mkt.results.skipped', 'Skipped'), value: skippedAll },
    { id: 'waiting', label: t('studio:texts.mkt.results.waiting', 'Still to go'), value: totals.queued + totals.sending },
    { id: 'optOuts', label: t('studio:texts.mkt.results.optOuts', 'Opted out after it'), value: totals.optOuts },
  ];
  const forbidden = people.error instanceof ApiError && people.error.status === 403;
  return (
    <Drawer open size="lg" onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerHeader icon={<Megaphone />} title={run.name} subtitle={runStateLabel(run.status)} closeLabel={t('studio:texts.close', 'Close')} />
      <DrawerBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-mkt-results">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.id} className="rounded-[10px] border border-border bg-surface px-3 py-2.5" data-testid={`texts-mkt-total-${tile.id}`}>
              <dt className="text-[11px] text-fg-muted">{tile.label}</dt>
              <dd className="text-[18px]">
                <Figure value={tile.value} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-[12px] text-fg-muted">{t('studio:texts.mkt.results.sentNote', '“Handed to the provider” is not “delivered”: delivered shows only when the provider reports it.')}</p>
        {run.status === 'failed' && run.reason !== null ? <Alert tone="danger" title={runRefusalWords(run.reason, null)} /> : null}
        {run.waitingUntil !== null ? <p>{t('studio:texts.mkt.results.waitingUntil', 'Today’s limit is used. It goes on at {time}.', { time: stamp(run.waitingUntil, activeLocale()) })}</p> : null}
        {skipped.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-[12.5px] font-bold">{t('studio:texts.mkt.results.skippedBy', 'Skipped, by reason')}</h3>
            <ul className="flex flex-col rounded-lg border border-border">
              {skipped.map(([reason, count]) => (
                <li key={reason} className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0" data-testid="texts-mkt-results-skip" data-reason={reason}>
                  <span className="w-10 shrink-0 text-end">
                    <Figure value={count} />
                  </span>
                  <span>{groupWords(reason)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h3 className="mb-1.5 text-[12.5px] font-bold">{t('studio:texts.mkt.results.who', 'Each person')}</h3>
          {forbidden ? (
            <p className="text-fg-muted" data-testid="texts-mkt-results-forbidden">
              {t('studio:texts.mkt.results.forbidden', 'You can read only some of these people, or none of their numbers, so the list is not shown to you.')}
            </p>
          ) : people.isError ? (
            <Alert tone="danger" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={people.error.message} />
          ) : people.data === undefined ? (
            <Skeleton className="h-[120px] w-full" />
          ) : (
            <ul className="flex flex-col">
              {people.data.data.map((one) => {
                const word = one.delivery === null ? null : statusOf({ state: one.delivery.state as Delivery['state'], providerStatus: one.delivery.providerStatus });
                return (
                  <li key={one.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0" data-testid="texts-mkt-results-row">
                    <span className="min-w-[140px] flex-1" dir="auto">
                      {one.name ?? '—'}
                    </span>
                    <bdi dir="ltr" className="font-mono text-[12px]">
                      {one.phone ?? '—'}
                    </bdi>
                    {word !== null ? <Badge tone={STATUS_TONE[word]}>{statusLabel(word)}</Badge> : one.state === 'skipped' ? <Badge tone="neutral">{statusLabel('skipped')}</Badge> : <Badge tone="neutral">{runStateLabel(one.state === 'cancelled' ? 'cancelled' : 'scheduled')}</Badge>}
                    {one.reason !== null ? <span className="basis-full text-[12px] text-fg-muted">{groupWords(one.reason)}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {mayCancel(run) ? (
          <div>
            <Button variant="destructive" iconLeft={<CircleSlash className="size-4" />} onClick={onCancel} data-testid="texts-mkt-results-cancel">
              {t('studio:texts.mkt.cancel.open', 'Cancel this run')}
            </Button>
          </div>
        ) : null}
      </DrawerBody>
    </Drawer>
  );
}

function CancelRun({ run, onClose, onDone }: { run: Run; onClose: () => void; onDone: () => void }) {
  const cancel = useMutation({ mutationFn: () => cancelRun(run.id), onSuccess: onDone });
  return (
    <Modal open size="sm" role="alertdialog" onOpenChange={(open) => (open || cancel.isPending ? undefined : onClose())}>
      <ModalHeader tone="warn" title={t('studio:texts.mkt.cancel.title', 'Cancel “{name}”?', { name: run.name })} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-2 text-[13px]" data-testid="texts-mkt-cancel">
        <p>{t('studio:texts.mkt.cancel.body', 'Nothing more is handed to the provider, and texts still waiting for their hours are not sent. Texts already handed over can’t be called back.')}</p>
        {cancel.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={cancel.error.message} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" autoFocus disabled={cancel.isPending} onClick={onClose}>
          {t('studio:texts.mkt.cancel.keep', 'Keep it')}
        </Button>
        <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate()} data-testid="texts-mkt-cancel-yes">
          {t('studio:texts.mkt.cancel.yes', 'Cancel the run')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── the tab ────────────────────────────────────────────────────────────────

const COLUMNS = 'grid-cols-[minmax(180px,1.4fr)_150px_150px_minmax(140px,1fr)_110px]';

export function MarketingTab(): ReactNode {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const setup = useQuery(marketingSetupQuery());
  const runs = useQuery(runsQuery());
  const [making, setMaking] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Run | null>(null);
  const locale = activeLocale();
  const list = useMemo(() => runs.data?.data ?? [], [runs.data]);
  const open = list.find((one) => one.id === opened) ?? null;
  const refresh = () => void client.invalidateQueries({ queryKey: marketingKey });

  if (setup.isError) return <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={setup.error.message} data-testid="texts-mkt-error" />;
  if (setup.data === undefined) return <Skeleton className="h-[240px] w-full" />;
  const data = setup.data;
  const locked = isLocked(data.preflight);
  const others = data.preflight.refusals.filter((one) => one.reason !== LOCKED);
  // The dialog opens for a look while marketing is locked; any other refusal keeps it shut, with the panel saying why.
  const canOpen = others.length === 0;

  return (
    <div className="flex flex-col gap-3.5" data-testid="texts-marketing">
      {locked ? <LockedCard /> : null}
      <RefusalPanel refusals={data.preflight.refusals} />
      <Card padded={false}>
        <CardHeader>
          <IconTile tone="accent" icon={<Megaphone />} />
          <div>
            <h2 className="text-[14.5px] font-bold">{t('studio:texts.mkt.title', 'Marketing texts')}</h2>
            <p className="mt-[3px] text-[12.5px] text-fg-muted">{t('studio:texts.mkt.new.onlyAgreed', 'Only people who agreed to marketing texts.')}</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 text-[12.5px] text-fg-muted">
          <p>{t('studio:texts.mkt.hours.short', 'They go {from}–{to}, {days}, on each person’s clock.', { from: data.hours.from, to: data.hours.to, days: daysWord() })}</p>
          <p data-testid="texts-mkt-today">{t('studio:texts.mkt.daily.used', 'Today: {used} of {limit} texts used, service texts included.', { used: data.daily.used, limit: data.daily.limit })}</p>
          <p>{t('studio:texts.mkt.never', 'Never to a found lead or a bought list, never from a sender name, and never where people can’t reply STOP.')}</p>
          <div className="pt-1.5">
            <Button iconLeft={<Plus className="size-4" />} disabled={!canOpen} onClick={() => setMaking(true)} data-testid="texts-mkt-open-new">
              {locked ? t('studio:texts.mkt.new.look', 'See who a marketing text would reach') : t('studio:texts.mkt.new.title', 'New marketing text')}
            </Button>
          </div>
        </CardBody>
      </Card>
      {runs.isError ? (
        <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={runs.error.message} />
      ) : runs.data === undefined ? (
        <Skeleton className="h-[160px] w-full" />
      ) : list.length === 0 ? (
        <EmptyState icon={<Megaphone />} title={t('studio:texts.mkt.empty', 'No marketing text has been sent yet.')} compact data-testid="texts-mkt-empty" />
      ) : (
        <div role="table" aria-label={t('studio:texts.mkt.runs', 'Marketing texts')} className="overflow-x-auto rounded-lg border border-border bg-surface shadow-[var(--shadow)]" data-testid="texts-mkt-runs">
          <div className="min-w-[760px]">
            <div role="row" className={`grid ${COLUMNS} gap-3 border-b border-border bg-surface-2 px-[18px] py-[11px] text-micro uppercase text-fg-subtle`}>
              <span role="columnheader">{t('studio:texts.mkt.col.name', 'Name')}</span>
              <span role="columnheader">{t('studio:texts.mkt.col.status', 'Status')}</span>
              <span role="columnheader">{t('studio:texts.mkt.col.when', 'When')}</span>
              <span role="columnheader">{t('studio:texts.mkt.col.reached', 'Handed over · delivered')}</span>
              <span role="columnheader" className="text-end">
                {t('studio:texts.stop.col.actions', 'Actions')}
              </span>
            </div>
            {list.map((run) => (
              <div key={run.id} role="row" data-testid="texts-mkt-run" className={`grid ${COLUMNS} items-center gap-3 border-b border-border px-[18px] py-[12px] text-[13px] last:border-b-0`}>
                <span role="cell" className="min-w-0">
                  <span className="block truncate font-semibold">{run.name}</span>
                  <span className="block truncate font-mono text-[11.5px] text-fg-muted">{run.templateKey}</span>
                </span>
                <span role="cell">
                  <Badge tone={RUN_TONE[run.status]}>{runStateLabel(run.status)}</Badge>
                </span>
                <span role="cell">
                  <bdi dir="ltr" className="font-mono text-[12px] text-fg-muted">
                    {stamp(run.scheduledAt, locale)}
                  </bdi>
                </span>
                <span role="cell" className="text-[12.5px]">
                  <Figure value={run.totals.sent} /> · <Figure value={run.totals.delivered} />{' '}
                  <span className="text-fg-muted">{t('studio:texts.mkt.col.of', 'of {count}', { count: run.totals.people })}</span>
                </span>
                <span role="cell" className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setOpened(run.id)} data-testid="texts-mkt-run-open">
                    {t('studio:texts.mkt.results.open', 'Results')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {making ? (
        <NewRun
          setup={data}
          onClose={() => setMaking(false)}
          onMade={(run) => {
            setMaking(false);
            refresh();
            toasts.push({ variant: 'success', title: run.status === 'scheduled' ? t('studio:texts.mkt.made.scheduled', 'Scheduled for {time}.', { time: stamp(run.scheduledAt, locale) }) : t('studio:texts.mkt.made.now', 'It is going out now, within the sending hours.') });
          }}
        />
      ) : null}
      {open === null ? null : <Results run={open} onClose={() => setOpened(null)} onCancel={() => setCancelling(open)} />}
      {cancelling === null ? null : (
        <CancelRun
          run={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            refresh();
            toasts.push({ variant: 'success', title: t('studio:texts.mkt.cancel.done', 'The run is cancelled.') });
          }}
        />
      )}
    </div>
  );
}
