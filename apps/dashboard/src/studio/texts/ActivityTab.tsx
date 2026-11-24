// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Activity (comp `Texts Activity`, X37–X44).
 *
 * One row per text, newest first. A row holds no number and no words: the
 * server keeps the number only as `+1 ••• 177`, and never keeps the message.
 * "Sent" means handed to the provider and is never called delivered; delivered
 * shows only when the provider reports it, and a price only when it says one.
 *
 * UNKNOWN. After a timeout Twilio cannot say whether it took a text, so the
 * row waits for a person. Someone with `sms.manage` settles it: "It was sent"
 * closes it, "It was not sent" lets the app send it again, and that send runs
 * every check again (consent, the stop list, the hours, today's limit). A desk
 * sees "Ask the owner". Telnyx retries such a text itself with the same key
 * for 24 hours, so its rows end delivered or, past that, unknown the same way.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleHelp, Eye, MessageSquareText } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Drawer, DrawerBody, DrawerHeader, EmptyState, FormField, IconTile, Modal, ModalBody, ModalFooter, ModalHeader, Select, Skeleton } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { OutLink } from '../shipping/shippingWords.js';
import { encodingWord } from './TextCounterView.js';
import { deliveriesKey, deliveriesQuery, settleDelivery, type Delivery } from './textsApi.js';
import { TEXTS_LINKS } from './textsLinks.js';
import { STATUS_TONE, STATUS_WORDS, activeLocale, providerName, reasonWords, stamp, statusLabel, statusLine, statusOf, type StatusWord } from './textsWords.js';

const head = 'whitespace-nowrap border-b border-border px-3 py-2 text-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle';

/** The calling code of a masked number: `+1 ••• 177` → `+1`. */
export function dialOf(masked: string | null): string | null {
  const found = masked === null ? null : /^\+\d{1,3}/.exec(masked);
  return found === null ? null : found[0];
}

function Status({ row }: { row: Delivery }) {
  const word = statusOf(row);
  return <Badge tone={STATUS_TONE[word]}>{statusLabel(word)}</Badge>;
}

const about = (row: Delivery): string => (row.source === null ? t('studio:texts.activity.rule', 'An automation') : `${row.source.app} · ${row.source.table}`);
const segmentsOf = (row: Delivery): number => row.segments ?? row.estimatedSegments;

function Price({ row }: { row: Delivery }) {
  if (row.price === null) return <span className="text-fg-subtle">—</span>;
  return (
    <bdi dir="ltr" className="font-mono">
      {row.price.amount} {row.price.currency}
    </bdi>
  );
}

// ─── Unknown, check before resending (X41–X43) ─────────────────────────────

function SettleUnknown({ row, canManage, onSettled }: { row: Delivery; canManage: boolean; onSettled: (row: Delivery) => void }) {
  const provider = row.provider === null ? 'Twilio' : providerName(row.provider);
  const [asking, setAsking] = useState(false);
  const settle = useMutation({ mutationFn: (answer: 'went' | 'not-sent') => settleDelivery(row.id, answer), onSuccess: onSettled });
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-warn bg-warn-soft p-3.5 text-[13px]" data-testid="texts-unknown">
      <p className="font-bold">{t('studio:texts.status.unknown', 'Unknown, check before resending')}</p>
      <p>{statusLine('unknown', provider)}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-1 text-[12.5px]">
        <dt className="text-fg-subtle">{t('studio:texts.activity.col.number', 'Number')}</dt>
        <dd>
          <bdi dir="ltr" className="font-mono">
            {row.phoneMasked ?? '—'}
          </bdi>
        </dd>
        <dt className="text-fg-subtle">{t('studio:texts.activity.col.about', 'About')}</dt>
        <dd>{about(row)}</dd>
        <dt className="text-fg-subtle">{t('studio:texts.activity.calledAt', 'Handed over at')}</dt>
        <dd>
          <bdi dir="ltr" className="font-mono">
            {stamp(row.mayHaveGoneAt ?? row.createdAt, activeLocale())}
          </bdi>
        </dd>
      </dl>
      {row.provider === null ? null : <OutLink href={TEXTS_LINKS[row.provider].log}>{t('studio:texts.activity.openLog', 'Open {provider}’s message log', { provider })}</OutLink>}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={settle.isPending && settle.variables === 'went'} onClick={() => settle.mutate('went')} data-testid="texts-settle-went">
            {t('studio:texts.activity.went', 'It was sent')}
          </Button>
          <Button variant="secondary" onClick={() => setAsking(true)} data-testid="texts-settle-not-sent">
            {t('studio:texts.activity.notSent', 'It was not sent, send again')}
          </Button>
        </div>
      ) : (
        <p className="font-semibold" data-testid="texts-unknown-ask">
          {t('studio:texts.activity.askOwner', 'Ask the owner to check this with {provider}.', { provider })}
        </p>
      )}
      {settle.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={settle.error.message} /> : null}
      <Modal open={asking} onOpenChange={setAsking}>
        <ModalHeader tone="warn" title={t('studio:texts.activity.confirmTitle', 'Send this text again?')} closeLabel={t('studio:texts.close', 'Close')} />
        <ModalBody className="flex flex-col gap-3 text-[13px]" data-testid="texts-settle-confirm">
          <p className="font-bold">{t('studio:texts.activity.declare', 'I checked {provider} and this text was not sent.', { provider })}</p>
          <p>{t('studio:texts.activity.twice', 'If that’s wrong, the person gets it twice and the business pays twice.')}</p>
          <p className="text-fg-muted">{t('studio:texts.activity.rechecked', 'Before it goes again, consent, the do-not-text list, the sending hours and today’s limit are all checked again. It may still be skipped.')}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            {t('studio:texts.cancel', 'Cancel')}
          </Button>
          <Button
            loading={settle.isPending && settle.variables === 'not-sent'}
            onClick={() => {
              settle.mutate('not-sent', { onSuccess: () => setAsking(false) });
            }}
            data-testid="texts-settle-not-sent-yes"
          >
            {t('studio:texts.activity.confirmResend', 'It was not sent. Send again')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Row detail (X40) ───────────────────────────────────────────────────────

function DeliveryDrawer({ row, canManage, onClose, onSettled }: { row: Delivery | null; canManage: boolean; onClose: () => void; onSettled: (row: Delivery) => void }): ReactNode {
  if (row === null) return null;
  const locale = activeLocale();
  const word = statusOf(row);
  const provider = row.provider === null ? '—' : providerName(row.provider);
  const reason = reasonWords(row.reason);
  const story: { text: string; at: number | null }[] = [{ text: t('studio:texts.activity.story.queued', 'Queued'), at: row.createdAt }];
  if (row.mayHaveGoneAt !== null) story.push({ text: t('studio:texts.activity.story.handed', 'Handed to {provider}', { provider }), at: row.mayHaveGoneAt });
  if (row.attempts > 1 && row.provider === 'telnyx' && word !== 'unknown') story.push({ text: t('studio:texts.activity.story.retried', 'Retried safely with the same key'), at: null });
  if (word !== 'waiting') story.push({ text: statusLabel(word), at: row.updatedAt });
  return (
    <Drawer open size="md" onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerHeader
        title={
          <span>
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">{t('studio:texts.activity.text', 'Text')}</span>
            <bdi dir="ltr" className="font-mono">
              {row.phoneMasked ?? '—'}
            </bdi>
          </span>
        }
        closeLabel={t('studio:texts.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-5" data-testid="texts-activity-drawer">
        <div className="flex flex-col gap-1.5">
          <span>
            <Status row={row} />
          </span>
          <p className="text-[13px]">{statusLine(word, provider)}</p>
          {reason === null ? null : <p className="text-[13px] font-semibold">{reason}</p>}
          {row.providerErrorCode === null ? null : (
            <p className="text-[12px] text-fg-muted">
              {t('studio:texts.activity.code', '{provider} said:', { provider })}{' '}
              <q dir="ltr" className="font-mono">
                {row.providerErrorCode}
              </q>
            </p>
          )}
        </div>
        {word === 'unknown' ? <SettleUnknown row={row} canManage={canManage} onSettled={onSettled} /> : null}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2 text-[13px]">
          <dt className="text-fg-subtle">{t('studio:texts.activity.col.number', 'Number')}</dt>
          <dd>
            <bdi dir="ltr" className="font-mono">
              {row.phoneMasked ?? '—'}
            </bdi>
          </dd>
          <dt className="text-fg-subtle">{t('studio:texts.activity.col.about', 'About')}</dt>
          <dd className="font-semibold">{about(row)}</dd>
          <dt className="text-fg-subtle">{t('studio:texts.activity.kind', 'Kind')}</dt>
          <dd>{row.textClass === 'marketing' ? t('studio:texts.activity.marketing', 'Marketing') : t('studio:texts.activity.service', 'Service')}</dd>
          <dt className="text-fg-subtle">{t('studio:texts.activity.provider', 'Provider')}</dt>
          <dd>{provider}</dd>
          <dt className="text-fg-subtle">{t('studio:texts.activity.col.segments', 'Segments')}</dt>
          <dd>
            <bdi dir="ltr" className="font-mono">
              {segmentsOf(row)}
            </bdi>{' '}
            <span className="text-fg-muted">
              · {encodingWord(row.encoding)} · {row.segments === null ? t('studio:texts.counter.estimate', 'estimate') : t('studio:texts.activity.reported', 'reported by the provider')}
            </span>
          </dd>
          <dt className="text-fg-subtle">{t('studio:texts.activity.col.price', 'Price')}</dt>
          <dd>
            <Price row={row} />
          </dd>
        </dl>
        <p className="text-[12px] text-fg-muted">{t('studio:texts.activity.noBody', 'The message itself is not kept, so it can’t be shown here.')}</p>
        <section className="flex flex-col gap-3">
          <h3 className="text-[14.5px] font-bold tracking-[-0.01em]">{t('studio:texts.activity.whatHappened', 'What happened')}</h3>
          <ol className="flex flex-col">
            {story.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex shrink-0 flex-col items-center pt-1" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-fg-subtle" />
                  {index < story.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
                </span>
                <div className="min-w-0 pb-3.5">
                  <p className="text-[13px] font-bold">{step.text}</p>
                  {step.at === null ? null : (
                    <p dir="ltr" className="mt-px text-start font-mono text-[11.5px] text-fg-subtle">
                      {stamp(step.at, locale)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </DrawerBody>
    </Drawer>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

export function ActivityTab({ canManage }: { canManage: boolean }): ReactNode {
  const client = useQueryClient();
  const list = useQuery(deliveriesQuery());
  const locale = activeLocale();
  const ids = useId();
  const [status, setStatus] = useState<StatusWord | ''>('');
  const [dial, setDial] = useState('');
  const [about_, setAbout] = useState('');
  const [opened, setOpened] = useState<Delivery | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const all = list.data?.data ?? [];
  const dials = useMemo(() => [...new Set(all.map((row) => dialOf(row.phoneMasked)).filter((one): one is string => one !== null))].sort(), [all]);
  const abouts = useMemo(() => [...new Set(all.map(about))].sort(), [all]);
  const rows = all.filter((row) => (status === '' || statusOf(row) === status) && (dial === '' || dialOf(row.phoneMasked) === dial) && (about_ === '' || about(row) === about_));
  const unknown = all.filter((row) => row.state === 'unknown');
  const open = (row: Delivery, from: HTMLElement) => {
    opener.current = from;
    setOpened(row);
  };
  const settled = (next: Delivery) => {
    client.setQueryData(deliveriesKey, (held: { data: Delivery[]; next: string | null } | undefined) => (held === undefined ? held : { ...held, data: held.data.map((one) => (one.id === next.id ? next : one)) }));
    setOpened(next);
  };

  return (
    <div className="flex flex-col gap-[18px]" data-testid="texts-activity">
      {!canManage ? (
        <div role="note" className="flex items-center gap-2.5 rounded-[14px] bg-info-soft px-4 py-3 text-[13px] font-semibold" data-testid="texts-activity-view-only">
          <Eye className="size-[17px] shrink-0 text-info" aria-hidden="true" />
          <span>{t('studio:texts.activity.viewOnly', 'You can see texts here. Ask the owner to settle one or change settings.')}</span>
        </div>
      ) : null}
      {unknown.length > 0 ? (
        <Card data-testid="texts-unknown-card">
          <CardHeader className="flex items-center gap-3">
            <IconTile tone="warn" icon={<CircleHelp />} />
            <h2 className="min-w-0 flex-1 text-[14.5px] font-bold">{t('studio:texts.activity.unknownCount', '{count, plural, one {# text needs a check} other {# texts need a check}}', { count: unknown.length })}</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {unknown.map((row) => (
              <SettleUnknown key={row.id} row={row} canManage={canManage} onSettled={settled} />
            ))}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-5 py-3.5">
          <FormField className="w-[190px] max-sm:w-full" label={t('studio:texts.activity.filter.status', 'Status')} controlId={`${ids}-status`}>
            <Select id={`${ids}-status`} value={status} onChange={(event) => setStatus(event.target.value as StatusWord | '')} data-testid="texts-filter-status">
              <option value="">{t('studio:texts.activity.filter.all', 'All')}</option>
              {STATUS_WORDS.map((word) => (
                <option key={word} value={word}>
                  {statusLabel(word)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField className="w-[190px] max-sm:w-full" label={t('studio:texts.activity.filter.about', 'About')} controlId={`${ids}-about`}>
            <Select id={`${ids}-about`} value={about_} onChange={(event) => setAbout(event.target.value)} data-testid="texts-filter-about">
              <option value="">{t('studio:texts.activity.filter.all', 'All')}</option>
              {abouts.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField className="w-[150px] max-sm:w-full" label={t('studio:texts.activity.filter.code', 'Country code')} controlId={`${ids}-dial`}>
            <Select id={`${ids}-dial`} value={dial} onChange={(event) => setDial(event.target.value)} data-testid="texts-filter-dial">
              <option value="">{t('studio:texts.activity.filter.all', 'All')}</option>
              {dials.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        {list.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3 px-5 py-4">
            <span className="sr-only">{t('studio:texts.activity.loading', 'Loading texts')}</span>
            {[0, 1, 2, 3].map((one) => (
              <Skeleton key={one} height={16} />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-5">
            <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={list.error.message} />
          </div>
        ) : all.length === 0 ? (
          <EmptyState icon={<MessageSquareText />} title={t('studio:texts.activity.emptyTitle', 'No texts yet')} body={t('studio:texts.activity.emptyBody', 'When an app or an automation sends a text, it appears here.')} data-testid="texts-activity-empty" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-5 py-8 text-center" data-testid="texts-activity-no-match">
            <p className="text-[13px] font-bold">{t('studio:texts.activity.noMatch', 'No texts match these filters.')}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setStatus('');
                setDial('');
                setAbout('');
              }}
            >
              {t('studio:texts.activity.clear', 'Clear filters')}
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <table className="w-full border-collapse text-[13px]" data-testid="texts-activity-table">
                <thead>
                  <tr className="bg-surface-2">
                    <th scope="col" className={`${head} ps-5`}>
                      {t('studio:texts.activity.col.when', 'When')}
                    </th>
                    <th scope="col" className={head}>
                      {t('studio:texts.activity.col.number', 'Number')}
                    </th>
                    <th scope="col" className={head}>
                      {t('studio:texts.activity.col.about', 'About')}
                    </th>
                    <th scope="col" className={head}>
                      {t('studio:texts.activity.col.status', 'Status')}
                    </th>
                    <th scope="col" className={`${head} text-end`}>
                      {t('studio:texts.activity.col.segments', 'Segments')}
                    </th>
                    <th scope="col" className={`${head} pe-5 text-end`}>
                      {t('studio:texts.activity.col.price', 'Price')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${opened?.id === row.id ? 'bg-accent-soft-solid' : ''}`} data-testid="texts-activity-row">
                      <td dir="ltr" className="whitespace-nowrap py-2.5 pe-3 ps-5 text-start font-mono text-[12px] text-fg-muted">
                        {stamp(row.createdAt, locale)}
                      </td>
                      <td className="px-3 py-2.5">
                        <button type="button" className="text-start font-mono font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={(event) => open(row, event.currentTarget)}>
                          <bdi dir="ltr">{row.phoneMasked ?? '—'}</bdi>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">{about(row)}</td>
                      <td className="px-3 py-2.5">
                        <Status row={row} />
                        {row.state === 'skipped' && reasonWords(row.reason) !== null ? <span className="mt-0.5 block text-[11.5px] text-fg-muted">{reasonWords(row.reason)}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        <bdi dir="ltr" className="font-mono">
                          {segmentsOf(row)}
                        </bdi>
                      </td>
                      <td className="py-2.5 pe-5 ps-3 text-end">
                        <Price row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden" data-testid="texts-activity-cards">
              {rows.map((row) => (
                <li key={row.id} className="border-b border-border last:border-0">
                  <button type="button" className="flex w-full flex-col gap-1.5 px-4 py-3 text-start" onClick={(event) => open(row, event.currentTarget)}>
                    <span className="flex w-full items-baseline gap-2.5">
                      <bdi dir="ltr" className="whitespace-nowrap font-mono text-[13px] font-semibold">
                        {row.phoneMasked ?? '—'}
                      </bdi>
                      <span className="ms-auto">
                        <Status row={row} />
                      </span>
                    </span>
                    <span className="text-[12px] text-fg-muted">
                      {about(row)} ·{' '}
                      <bdi dir="ltr" className="font-mono">
                        {stamp(row.createdAt, locale)}
                      </bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <DeliveryDrawer
        row={opened}
        canManage={canManage}
        onSettled={settled}
        onClose={() => {
          setOpened(null);
          opener.current?.focus();
        }}
      />
    </div>
  );
}
