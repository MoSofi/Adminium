// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "E-mail consent": a person's standing for each purpose, the do-not-email
 * list, and the history of what they said, newest first; with "Replied",
 * "Record consent…" and "They said no" for whoever may change the record.
 *
 * Drawn on the record page of a table an app declares as people, below the
 * tabs (`RecordConsentPanel.tsx`), and by an app's own screen through the
 * kit's `consent` part: so it imports nothing of the dashboard's. Its words
 * come from the provider around it (`useMaybeT`), its calls from the
 * {@link ConsentClient} it is handed, and what happened after a press is
 * told through `notify` (a toast) or, without one, in a polite line of its
 * own.
 *
 * What it shows is the server's (`POST /consent/panel`), which reads the one
 * consent log every screen reads: a CRM's own "may be e-mailed" line reads
 * the same reply, so the two never disagree. It never shows an address the
 * server sent: the server sends none. The Record consent dialog names the
 * person by what the page holds for this reader (`name`, `address`), and an
 * address the reader is shown masked is never given to it.
 *
 * - "Replied" stops the person's e-mail sequences. Its explanation is a real
 *   description of the button (`aria-describedby`) and is shown in full in
 *   the confirm that opens on a press, by keyboard and by touch alike.
 * - "They said no" puts the record's address on the do-not-email list; only
 *   a Super Admin takes it off again, so it asks first. It is not offered
 *   while the address is on the list already, or when there is no address.
 * - An erased person's row says so calmly and offers nothing.
 *
 * Phone: the header's buttons sit in a two-column grid, 44 px high, and a
 * history line's time goes under its text.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';
import { Button, FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, Modal, ModalFooter, ModalHeader, SegmentedControl, ChoiceChips, Textarea } from '@adminium/ui';
import { Check, FileCheck2, FilePenLine, Info, MailCheck, MailX, Minus, Reply, Settings, SquareCheck, Stamp, Upload, User, UserX, type LucideIcon } from 'lucide-react';

import { CONSENT_HOWS, CONSENT_PURPOSES, type ConsentClient, type ConsentHow, type ConsentPanelView, type ConsentPurpose, type ConsentRecordRef } from './consentTypes.js';
import { day, dayTime, historyLines, howName, purposeBadge, purposeDetail, purposeName, stopWhy, type LineIcon, type LineTone } from './consentWords.js';

export interface ConsentPanelProps {
  record: ConsentRecordRef;
  view: ConsentPanelView;
  client: ConsentClient;
  /** The person's name as the page shows it to this reader; null when it shows none. */
  name: string | null;
  /** Their address as the page shows it to this reader: null when it is masked for them, or empty. */
  address: string | null;
  /** The reader's language tag, for dates. */
  locale: string;
  /** After a change was saved: read the panel again. */
  onChanged: () => void | Promise<void>;
  /** Says what happened (a toast). Left out, the panel says it in a line of its own. */
  notify?: ((message: string, tone: 'success' | 'error') => void) | undefined;
  /**
   * The confirms and the Record consent form drawn inside the panel, under
   * its header, instead of in a dialog over the page: an app's own screen
   * (the kit), whose styles stop at the part's own element.
   */
  inline?: boolean | undefined;
}

const LINE_ICONS: Record<LineIcon, LucideIcon> = {
  'mail-x': MailX,
  'mail-check': MailCheck,
  'file-check': FileCheck2,
  'file-pen': FilePenLine,
  'square-check': SquareCheck,
  reply: Reply,
  upload: Upload,
  user: User,
  settings: Settings,
};

const TILE_TONES: Record<LineTone, string> = {
  pos: 'bg-pos-soft text-pos',
  neutral: 'bg-surface-3 text-fg-muted',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent',
};

const BADGE_TONES = { pos: 'bg-pos-soft text-pos', neutral: 'bg-surface-3 text-fg-muted', danger: 'bg-danger-soft text-danger' } as const;
const BADGE_ICONS = { check: Check, minus: Minus, 'mail-x': MailX } as const;

/** The two header buttons' look: the comp's 12.5/700, and 44 px in a two-column grid on a phone. */
const HEADER_BUTTON = 'rounded-[10px] text-[12.5px] font-bold max-sm:h-11 max-sm:w-full max-sm:text-[13px]';

type Confirming = 'replied' | 'said-no' | null;

export function ConsentPanel({ record, view, client, name, address, locale, onChanged, notify, inline = false }: ConsentPanelProps): ReactNode {
  const t = useMaybeT();
  const headingId = useId();
  const hintId = useId();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const tell = (text: string, tone: 'success' | 'error'): void => {
    if (notify !== undefined) notify(text, tone);
    else setSaid({ text, tone });
  };
  const failed = (error: unknown): void => {
    const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
    tell(reason === 'ERASED' ? t('common:consent.toast.erased', 'This person was erased: nothing more is recorded about them.') : t('common:consent.toast.failed', 'That was not saved. Try again.'), 'error');
  };

  async function press(what: Exclude<Confirming, null>): Promise<void> {
    setBusy(true);
    try {
      if (what === 'replied') {
        await client.replied(record);
        tell(t('common:consent.toast.replied', 'Marked as replied. Their e-mail sequences stop.'), 'success');
      } else {
        const { added } = await client.saidNo(record);
        tell(added ? t('common:consent.toast.saidNo', 'They are on the do-not-email list now.') : t('common:consent.toast.already', 'They were on the do-not-email list already.'), 'success');
      }
      setConfirming(null);
      await onChanged();
    } catch (error) {
      setConfirming(null);
      failed(error);
    } finally {
      setBusy(false);
    }
  }

  const steps = (
    <>
      {confirming === null ? null : (
        <ConfirmStep
          inline={inline}
          icon={confirming === 'replied' ? Reply : MailX}
          tone={confirming === 'replied' ? 'accent' : 'warn'}
          title={confirming === 'replied' ? t('common:consent.confirm.repliedTitle', 'Mark as replied?') : t('common:consent.confirm.saidNoTitle', 'Put them on the do-not-email list?')}
          body={
            confirming === 'replied'
              ? t('common:consent.panel.repliedHint', 'They replied to a marketing e-mail. This stops their e-mail sequences.')
              : t('common:consent.confirm.saidNoBody', 'Marketing mail skips them from now on; service mail like quotes and receipts still reaches them. Only a Super Admin can take them off the list.')
          }
          confirm={confirming === 'replied' ? t('common:consent.confirm.repliedConfirm', 'Mark as replied') : t('common:consent.confirm.saidNoConfirm', 'Put on the list')}
          busy={busy}
          onConfirm={() => void press(confirming)}
          onCancel={() => setConfirming(null)}
          testId={confirming === 'replied' ? 'consent-replied-confirm' : 'consent-said-no-confirm'}
        />
      )}
      {recording ? (
        <RecordConsentDialog
          inline={inline}
          name={name}
          address={address}
          onCancel={() => setRecording(false)}
          onSave={async (input) => {
            try {
              await client.recordConsent(record, input);
              setRecording(false);
              tell(t('common:consent.toast.recorded', 'Consent recorded for the {purpose}.', { purpose: purposeName(t, input.purpose) }), 'success');
              await onChanged();
            } catch (error) {
              failed(error);
            }
          }}
        />
      ) : null}
    </>
  );
  const canAct = view.mayChange && !view.erased;
  const lines = historyLines(t, view.history);

  return (
    <section aria-labelledby={headingId} className="max-w-[820px] overflow-hidden rounded-[14px] border border-border bg-surface shadow-card" data-testid="consent-panel">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-5 max-sm:flex-col max-sm:items-stretch max-sm:px-4 max-sm:pb-3 max-sm:pt-4">
        <div className="min-w-[180px] flex-1">
          <h2 id={headingId} className="m-0 text-[14.5px] font-bold tracking-[-0.01em] rtl:tracking-normal">
            {t('common:consent.panel.title', 'E-mail consent')}
          </h2>
        </div>
        {canAct ? (
          <div className="flex flex-wrap items-center gap-2.5 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2">
            <span id={hintId} className="sr-only">
              {t('common:consent.panel.repliedHint', 'They replied to a marketing e-mail. This stops their e-mail sequences.')}
            </span>
            <Button variant="secondary" className={HEADER_BUTTON} aria-describedby={hintId} onClick={() => setConfirming('replied')} data-testid="consent-replied">
              <Reply aria-hidden="true" />
              {t('common:consent.panel.replied', 'Replied')}
            </Button>
            <Button className={HEADER_BUTTON} onClick={() => setRecording(true)} data-testid="consent-record">
              <FilePenLine aria-hidden="true" />
              {t('common:consent.panel.record', 'Record consent…')}
            </Button>
            {view.addressKnown && view.stopped === null ? (
              <Button variant="ghost" className={`${HEADER_BUTTON} max-sm:col-span-2`} onClick={() => setConfirming('said-no')} data-testid="consent-said-no">
                <MailX aria-hidden="true" />
                {t('common:consent.panel.saidNo', 'They said no')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {inline ? steps : null}
      {view.erased ? (
        <Note icon={UserX} tone="neutral" testId="consent-erased">
          {t('common:consent.panel.erased', 'This person was erased. Their address stays on the do-not-email list, so they are never e-mailed again. Nothing else is kept about them.')}
        </Note>
      ) : (
        <>
          {view.stopped !== null ? (
            <Note icon={MailX} tone="warn" testId="consent-banner">
              {t('common:consent.panel.banner', 'On the do-not-email list since {date} ({why}). Marketing mail skips them; service mail like quotes and receipts still reaches them.', {
                date: day(locale, view.stopped.since),
                why: stopWhy(t, view.stopped.reason),
              })}
            </Note>
          ) : null}
          {!view.addressKnown ? (
            <Note icon={Info} tone="neutral" testId="consent-no-address">
              {t('common:consent.panel.noAddress', 'This record has no e-mail address yet.')}
            </Note>
          ) : null}

          <ul className="m-0 list-none border-t border-border p-0">
            {view.purposes.map((one) => {
              const badge = purposeBadge(t, one.state, one.event);
              const BadgeIcon = BADGE_ICONS[badge.icon];
              const detail = purposeDetail(t, locale, one.event);
              return (
                <li key={one.purpose} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-5 py-[13px] max-sm:px-4 max-sm:py-[11px]" data-testid={`consent-purpose-${one.purpose}`}>
                  <span className="min-w-[120px] text-[13px] font-bold max-sm:min-w-0 max-sm:flex-1">{purposeName(t, one.purpose)}</span>
                  <span className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${BADGE_TONES[badge.tone]}`} data-testid={`consent-badge-${one.purpose}`}>
                    <BadgeIcon aria-hidden="true" className="size-3" />
                    {badge.text}
                  </span>
                  {detail === '' ? null : <span className="basis-full text-[12.5px] leading-normal text-fg-muted max-sm:text-[12px]">{detail}</span>}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-3 px-5 pb-5 pt-4 max-sm:gap-2.5 max-sm:px-4 max-sm:pb-4 max-sm:pt-3.5">
            <div>
              <h3 className="m-0 text-[14px] font-bold">{t('common:consent.panel.history', 'Consent history')}</h3>
              <p className="m-0 mt-0.5 text-[11.5px] text-fg-muted">{t('common:consent.panel.historyNote', "Newest first. Kept as it happened; entries can't be edited.")}</p>
            </div>
            {lines.length === 0 ? (
              <p className="m-0 text-[13px] text-fg-muted" data-testid="consent-history-empty">
                {t('common:consent.panel.historyEmpty', 'Nothing recorded yet.')}
              </p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3 p-0 max-sm:gap-2.5" data-testid="consent-history">
                {lines.map((line) => {
                  const Icon = LINE_ICONS[line.icon];
                  return (
                    <li key={line.key} className="flex items-start gap-[11px] max-sm:gap-2.5">
                      <span className={`flex size-[22px] shrink-0 items-center justify-center rounded-md ${TILE_TONES[line.tone]}`}>
                        <Icon aria-hidden="true" className="size-3" />
                      </span>
                      <div className="min-w-0 text-[13px] leading-normal max-sm:text-[12.5px]">
                        {line.text}{' '}
                        <span className="text-fg-muted max-sm:block">
                          <span aria-hidden="true" className="max-sm:hidden">
                            ·{' '}
                          </span>
                          <bdi className="font-mono text-[12px] max-sm:text-[11.5px]">{dayTime(locale, line.at)}</bdi>
                          {line.extra === null ? null : <> {line.extra}</>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}

      {said === null ? null : (
        <p role="status" className={`m-0 border-t border-border px-5 py-3 text-[12.5px] ${said.tone === 'error' ? 'text-danger' : 'text-fg-muted'}`} data-testid="consent-said">
          {said.text}
        </p>
      )}

      {inline ? null : steps}
    </section>
  );
}

function Note({ icon: Icon, tone, testId, children }: { icon: LucideIcon; tone: 'warn' | 'neutral'; testId: string; children: ReactNode }): ReactNode {
  return (
    <div
      role="note"
      className={`mx-5 mb-3.5 flex gap-2.5 rounded-[10px] border px-[13px] py-[11px] max-sm:mx-4 ${tone === 'warn' ? 'border-warn/25 bg-warn-soft' : 'border-border bg-surface-2'}`}
      data-testid={testId}
    >
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone === 'warn' ? 'text-warn' : 'text-fg-muted'}`} />
      <span className="text-[12.5px] leading-normal">{children}</span>
    </div>
  );
}

/**
 * Where a confirm or the Record consent form is drawn on an app's own screen:
 * inside the panel, under its header, with no layer over the page (the kit
 * styles nothing outside its own element). Named by its heading, the focus
 * put on its first control, and Escape closes it.
 */
function InlineStep({ titleId, onCancel, busy, testId, children }: { titleId: string; onCancel: () => void; busy: boolean; testId: string; children: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-first]')?.focus();
  }, []);
  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      className="mx-5 mb-4 flex flex-col gap-4 rounded-[12px] border border-border-strong bg-surface-2 p-4 max-sm:mx-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation();
          onCancel();
        }
      }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** A small confirm: what the press does, said in full, with Cancel first (focus starts there). */
function ConfirmStep(props: {
  inline: boolean;
  icon: LucideIcon;
  tone: 'accent' | 'warn';
  title: string;
  body: string;
  confirm: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}): ReactNode {
  const t = useMaybeT();
  const titleId = useId();
  const Icon = props.icon;
  const buttons = (
    <>
      <Button variant="secondary" autoFocus={!props.inline} data-first onClick={props.onCancel} disabled={props.busy}>
        {t('common:consent.confirm.cancel', 'Cancel')}
      </Button>
      <Button onClick={props.onConfirm} loading={props.busy} data-testid={`${props.testId}-yes`}>
        {props.confirm}
      </Button>
    </>
  );
  if (props.inline) {
    return (
      <InlineStep titleId={titleId} onCancel={props.onCancel} busy={props.busy} testId={props.testId}>
        <div className="flex items-start gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${props.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'}`}>
            <Icon aria-hidden="true" className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="m-0 text-[14px] font-bold">
              {props.title}
            </h3>
            <p className="m-0 mt-1 text-[12.5px] leading-normal text-fg-muted">{props.body}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2.5">{buttons}</div>
      </InlineStep>
    );
  }
  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      className="max-w-[420px]"
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <div data-testid={props.testId}>
        <ModalHeader
          icon={<Icon />}
          tone={props.tone}
          hideClose
          closeLabel={t('common:consent.dialog.close', 'Close')}
          title={props.title}
          subtitle={<span className="mx-auto mt-2 block max-w-[320px] text-body text-fg-muted">{props.body}</span>}
          className="flex-col items-center px-6 pb-5 pt-6 text-center [&>*:first-child]:mb-1.5 [&>*:first-child]:size-[52px] [&>*:first-child]:rounded-lg [&>*:first-child_svg]:size-6"
        />
        <ModalFooter className="gap-2.5 [&>button]:flex-1">{buttons}</ModalFooter>
      </div>
    </Modal>
  );
}

/**
 * "Record consent": one person, one purpose, how they agreed and a note. The
 * staff member and the date are the server's (from the session and the
 * clock), never typed.
 */
function RecordConsentDialog({
  inline,
  name,
  address,
  onCancel,
  onSave,
}: {
  inline: boolean;
  name: string | null;
  address: string | null;
  onCancel: () => void;
  onSave: (input: { purpose: ConsentPurpose; how: ConsentHow; note: string | null }) => Promise<void>;
}): ReactNode {
  const t = useMaybeT();
  const id = useId();
  const [purpose, setPurpose] = useState<ConsentPurpose>('newsletter');
  const [how, setHow] = useState<ConsentHow>('in-person');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const subtitle =
    name === null && address === null ? undefined : (
      <span data-testid="consent-dialog-who">
        {name ?? ''}
        {name !== null && address !== null ? ' · ' : ''}
        {address === null ? null : (
          <bdi dir="ltr" className="font-mono">
            {address}
          </bdi>
        )}
      </span>
    );
  const title = t('common:consent.dialog.title', 'Record consent');

  const fields = (
    <>
      <div className="flex flex-col gap-[7px]">
        <span className="text-[12.5px] font-bold" id={`${id}-purpose`}>
          {t('common:consent.dialog.purpose', 'Purpose')}
        </span>
        <SegmentedControl
          aria-labelledby={`${id}-purpose`}
          className="self-start"
          value={purpose}
          onValueChange={(value) => setPurpose(value as ConsentPurpose)}
          options={CONSENT_PURPOSES.map((one) => ({ value: one, label: purposeName(t, one) }))}
          data-first
        />
      </div>
      <div className="flex flex-col gap-[7px]">
        <span className="text-[12.5px] font-bold" id={`${id}-how`}>
          {t('common:consent.dialog.how', 'How did they agree?')}
        </span>
        <ChoiceChips
          aria-labelledby={`${id}-how`}
          value={how}
          onValueChange={(value) => {
            if (value !== null) setHow(value as ConsentHow);
          }}
          options={CONSENT_HOWS.map((one) => ({ value: one, label: howName(t, one) }))}
        />
      </div>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-note`}>
        <span className="text-[12.5px] font-bold">{t('common:consent.dialog.note', 'Note')}</span>
        <Textarea id={`${id}-note`} rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} data-testid="consent-dialog-note" />
      </label>
      <div className="flex gap-[9px] rounded-[10px] bg-surface-3 px-[13px] py-[11px]">
        <Stamp aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-fg-muted" />
        <span className="text-[12.5px] leading-normal">{t('common:consent.dialog.stamp', "Your name and today's date are saved with it.")}</span>
      </div>
    </>
  );
  const buttons = (
    <>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
        {t('common:consent.dialog.cancel', 'Cancel')}
      </Button>
      <Button type="submit" loading={saving} data-testid="consent-dialog-save">
        {t('common:consent.dialog.save', 'Record consent')}
      </Button>
    </>
  );
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setSaving(true);
    void onSave({ purpose, how, note: note.trim() === '' ? null : note.trim() }).finally(() => setSaving(false));
  };

  if (inline) {
    return (
      <InlineStep titleId={`${id}-title`} onCancel={onCancel} busy={saving} testId="consent-dialog">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <FilePenLine aria-hidden="true" className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 id={`${id}-title`} className="m-0 text-[14px] font-bold">
                {title}
              </h3>
              {subtitle === undefined ? null : <p className="m-0 mt-0.5 text-[11.5px] text-fg-subtle [overflow-wrap:anywhere]">{subtitle}</p>}
            </div>
          </div>
          {fields}
          <div className="flex justify-end gap-2.5">{buttons}</div>
        </form>
      </InlineStep>
    );
  }
  return (
    <FormDialog
      open
      width={560}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <form onSubmit={submit} data-testid="consent-dialog">
        <FormDialogHeader icon={<FilePenLine />} title={title} {...(subtitle === undefined ? {} : { subtitle })} closeLabel={t('common:consent.dialog.close', 'Close')} />
        <FormDialogBody className="flex flex-col gap-4">{fields}</FormDialogBody>
        <FormDialogFooter>{buttons}</FormDialogFooter>
      </form>
    </FormDialog>
  );
}
