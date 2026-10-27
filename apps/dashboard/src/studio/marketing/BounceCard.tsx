// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Bounces and spam reports", the card after Senders in Workspace settings
 * (comp `Email To Contacts.dc.html` 5a 723-751, 5d 816-831): which mail
 * service this install sends through, the address it calls when a mail
 * bounces or is marked as spam, and what proves its calls.
 *
 * The card keeps the comp's layout; its secret row's words change per
 * service, because each service proves its calls its own way (owner's
 * ruling on the W1 critique, a numbered departure from the comp):
 *   - Mailgun: "Signing key", pasted;
 *   - SendGrid: "Verification key", pasted;
 *   - Amazon SES: "Topic ARN", typed;
 *   - Postmark and Brevo: "Copy these into {service}": a user name and
 *     password Adminium makes, shown in the reply that makes them and never
 *     again ("Replace" makes new ones);
 *   - "Another service": the info box only.
 * Whatever is saved shows as "Set on {date}" with "Replace"; nothing pasted is
 * ever shown back.
 *
 * Choosing a listed service makes its notice address on the server (a random
 * address that does nothing until the service calls it), so the address can
 * be copied at once, as the comp shows it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Info, KeyRound, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, IconButton, Input } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { relativeTime } from '../api-keys/model.js';
import {
  NOTICE_ENDPOINTS_QUERY_KEY,
  NOTICE_SERVICES,
  noticeEndpointsQuery,
  openNoticeEndpoint,
  putNoticeSecret,
  replaceNoticeCredentials,
  type MadeCredentials,
  type NoticeEndpoint,
  type NoticeEndpoints,
  type NoticeService,
} from './marketingApi.js';

/** The services' own names: not translated. */
const SERVICE_NAMES: Readonly<Record<Exclude<NoticeService, 'other'>, string>> = {
  ses: 'Amazon SES',
  postmark: 'Postmark',
  mailgun: 'Mailgun',
  brevo: 'Brevo',
  sendgrid: 'SendGrid',
};

function serviceName(service: NoticeService): string {
  return service === 'other' ? t('studio:marketingMail.bounce.other', 'Another service') : SERVICE_NAMES[service];
}

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** The secret row's words for a service that takes something pasted. */
function pastedWords(endpoint: NoticeEndpoint, service: string): { label: string; placeholder: string; saved: string; secret: boolean } {
  switch (endpoint.secretRow) {
    case 'signing-key':
      return {
        label: t('studio:marketingMail.bounce.signingKey', 'Signing key'),
        placeholder: t('studio:marketingMail.bounce.signingKeyPaste', 'Paste the signing key from {service}', { service }),
        saved: t('studio:marketingMail.bounce.signingKeySaved', 'Signing key saved.'),
        secret: true,
      };
    case 'verification-key':
      return {
        label: t('studio:marketingMail.bounce.verificationKey', 'Verification key'),
        placeholder: t('studio:marketingMail.bounce.verificationKeyPaste', 'Paste the verification key from {service}', { service }),
        saved: t('studio:marketingMail.bounce.verificationKeySaved', 'Verification key saved.'),
        secret: false,
      };
    default:
      return {
        label: t('studio:marketingMail.bounce.topicArn', 'Topic ARN'),
        placeholder: t('studio:marketingMail.bounce.topicArnPaste', 'Paste the topic ARN from {service}', { service }),
        saved: t('studio:marketingMail.bounce.topicArnSaved', 'Topic ARN saved.'),
        secret: false,
      };
  }
}

/** A mono box with a copy button: the comp's address row. */
function CopyBox({ value, label, onCopied, testId }: { value: string; label: string; onCopied: () => void; testId?: string }): ReactNode {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-border-strong bg-surface-2 py-2 pe-2 ps-3">
      <code dir="ltr" data-testid={testId} className="min-w-0 flex-1 font-mono text-[12px] [overflow-wrap:anywhere]">
        {value}
      </code>
      <IconButton
        variant="bordered"
        size="md"
        label={label}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(onCopied, () => {
            // A refused clipboard leaves the text on screen to select by hand.
          })
        }
      >
        <Copy />
      </IconButton>
    </div>
  );
}

/** "Set on {date}", the date in mono as the comp draws it: the sentence is split where the date goes. */
function withMonoDate(at: number): ReactNode {
  const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(at));
  const [before = '', after = ''] = t('studio:marketingMail.bounce.setOn', 'Set on {date}', { date: '\u0000' }).split('\u0000');
  return (
    <>
      {before}
      <span className="font-mono text-[12px]">{date}</span>
      {after}
    </>
  );
}

function firstChoice(data: NoticeEndpoints): NoticeService {
  return data.suggested ?? data.services.find((one) => one.opened)?.service ?? 'other';
}

export function BounceCard(): ReactNode {
  const query = useQuery(noticeEndpointsQuery());
  if (query.data === undefined) return null;
  return <BounceCardBody data={query.data} />;
}

function BounceCardBody({ data }: { data: NoticeEndpoints }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [service, setService] = useState<NoticeService>(() => firstChoice(data));
  /** Made credentials, by service: held only while the card is open, never read back. */
  const [made, setMade] = useState<Partial<Record<NoticeService, MadeCredentials>>>({});
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(new Set<NoticeService>());

  const endpoint = data.services.find((one) => one.service === service) ?? null;
  const name = serviceName(service);
  const copied = () => toasts.push({ variant: 'success', title: t('studio:marketingMail.copied', 'Copied to the clipboard.') });

  function store(next: NoticeEndpoint): void {
    queryClient.setQueryData<NoticeEndpoints>(NOTICE_ENDPOINTS_QUERY_KEY, (prev) => (prev === undefined ? prev : { ...prev, services: prev.services.map((one) => (one.service === next.service ? next : one)) }));
  }

  // A listed service gets its address the first time it is chosen (see the header).
  useEffect(() => {
    if (service === 'other' || endpoint === null || endpoint.opened || data.publicOrigin === null || opening.current.has(service)) return;
    opening.current.add(service);
    void openNoticeEndpoint(service).then(
      (reply) => {
        store(reply.endpoint);
        if (reply.credentials !== null) setMade((prev) => ({ ...prev, [service]: reply.credentials! }));
      },
      () => {
        opening.current.delete(service);
        toasts.push({ variant: 'error', title: t('studio:marketingMail.bounce.failed', 'That was not saved. Try again.') });
      },
    );
    // Keyed on the choice and on what was read for it; `store` and `toasts` change nothing it decides.
  }, [service, endpoint, data.publicOrigin]);

  function choose(next: NoticeService): void {
    setService(next);
    setReplacing(false);
    setDraft('');
  }

  async function savePasted(words: { saved: string }): Promise<void> {
    if (draft.trim() === '') return;
    setBusy(true);
    try {
      store(await putNoticeSecret(service, draft.trim()));
      setDraft('');
      setReplacing(false);
      toasts.push({ variant: 'success', title: words.saved });
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.bounce.invalid', 'That was not saved. Check what you pasted and try again.') });
    } finally {
      setBusy(false);
    }
  }

  async function newCredentials(): Promise<void> {
    setBusy(true);
    try {
      const reply = await replaceNoticeCredentials(service);
      store(reply.endpoint);
      if (reply.credentials !== null) setMade((prev) => ({ ...prev, [service]: reply.credentials! }));
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.bounce.failed', 'That was not saved. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  const setOn = (at: number) => (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-border px-[11px] py-[9px]">
      <KeyRound aria-hidden className="size-[15px] shrink-0 text-fg-muted" />
      <span className="flex-1 text-body text-fg">{withMonoDate(at)}</span>
      <Button
        variant="secondary"
        size="sm"
        loading={busy && endpoint?.secretRow === 'copy-credentials'}
        onClick={() => (endpoint?.secretRow === 'copy-credentials' ? void newCredentials() : setReplacing(true))}
        className="h-auto rounded-[10px] px-[11px] py-1.5 font-bold"
      >
        {t('studio:marketingMail.bounce.replace', 'Replace')}
      </Button>
    </div>
  );

  let secretRow: ReactNode = null;
  if (endpoint !== null && service !== 'other') {
    if (endpoint.secretRow === 'copy-credentials') {
      const shown = made[service];
      secretRow = (
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-bold text-fg">{t('studio:marketingMail.bounce.copyThese', 'Copy these into {service}', { service: name })}</span>
          {shown !== undefined ? (
            <div className="flex flex-col gap-2" data-part="made-credentials">
              <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center">
                <span className="text-caption font-semibold text-fg-muted">{t('studio:marketingMail.bounce.user', 'User name')}</span>
                <CopyBox value={shown.user} label={t('studio:marketingMail.bounce.copyUser', 'Copy user name')} onCopied={copied} />
                <span className="text-caption font-semibold text-fg-muted">{t('studio:marketingMail.bounce.password', 'Password')}</span>
                <CopyBox value={shown.pass} label={t('studio:marketingMail.bounce.copyPassword', 'Copy password')} onCopied={copied} testId="made-password" />
              </div>
              <p className="text-caption text-fg-muted">{t('studio:marketingMail.bounce.shownOnce', 'Shown only now. \u201cReplace\u201d makes new ones and stops these.')}</p>
              {endpoint.secretSetAt === null ? null : setOn(endpoint.secretSetAt)}
            </div>
          ) : endpoint.secretSetAt !== null ? (
            setOn(endpoint.secretSetAt)
          ) : null}
        </div>
      );
    } else {
      const words = pastedWords(endpoint, name);
      secretRow = (
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-bold text-fg">{words.label}</span>
          {endpoint.ready && endpoint.secretSetAt !== null && !replacing ? (
            setOn(endpoint.secretSetAt)
          ) : (
            <div className="flex gap-2">
              <Input
                type={words.secret ? 'password' : 'text'}
                aria-label={words.label}
                placeholder={words.placeholder}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="flex-1 font-mono text-[12.5px]"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button loading={busy} disabled={draft.trim() === ''} onClick={() => void savePasted(words)} className="font-bold">
                {t('studio:marketingMail.bounce.save', 'Save')}
              </Button>
            </div>
          )}
        </div>
      );
    }
  }

  const ago = endpoint?.lastNoticeAt == null ? null : relativeTime(endpoint.lastNoticeAt, Date.now(), locale());

  return (
    <Card id="bounces" className="flex flex-col gap-4" data-part="bounce-card">
      <div>
        <h3 className="text-card-title text-fg">{t('studio:marketingMail.bounce.title', 'Bounces and spam reports')}</h3>
        <p className="mt-0.5 text-body-sm text-fg-muted">
          {t('studio:marketingMail.bounce.body', 'Your mail service tells Adminium when a mail bounces or is marked as spam, and that address goes on the do-not-email list.')}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span id="bounce-service-label" className="text-body-sm font-bold text-fg">{t('studio:marketingMail.bounce.service', 'Your mail service')}</span>
        <div role="radiogroup" aria-labelledby="bounce-service-label" className="flex flex-wrap gap-1.5">
          {NOTICE_SERVICES.map((one) => {
            const on = one === service;
            return (
              <button
                key={one}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(one)}
                onKeyDown={(event) => {
                  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  const dir = document.documentElement.dir === 'rtl' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft') ? -step : step;
                  const at = (NOTICE_SERVICES.indexOf(one) + dir + NOTICE_SERVICES.length) % NOTICE_SERVICES.length;
                  const next = NOTICE_SERVICES[at]!;
                  choose(next);
                  (event.currentTarget.parentElement?.children[at] as HTMLElement | undefined)?.focus();
                }}
                className={
                  'rounded-[20px] border px-[11px] py-1.5 text-[12px] font-bold leading-[normal] transition-colors ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
                  (on ? 'border-accent bg-accent-soft text-fg' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-3')
                }
              >
                {serviceName(one)}
              </button>
            );
          })}
        </div>
      </div>
      {service === 'other' ? (
        <div className="flex gap-[9px] rounded-[10px] bg-info-soft px-[13px] py-[11px]">
          <Info aria-hidden className="mt-0.5 size-[15px] shrink-0 text-info" />
          <span className="text-body-sm text-fg">
            {t('studio:marketingMail.bounce.otherNote', 'Mails refused while sending are still caught. Add other bounces by hand to the do-not-email list.')}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-bold text-fg">{t('studio:marketingMail.bounce.paste', 'Paste this address into {service}', { service: name })}</span>
            {data.publicOrigin === null ? (
              <div className="flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2.5">
                <TriangleAlert aria-hidden className="mt-0.5 size-[15px] shrink-0 text-warn" />
                <span className="text-body-sm text-fg">
                  {t('studio:marketingMail.bounce.noOrigin', 'Set the address in email links first: your mail service needs it to reach this server.')}{' '}
                  <a href="#email-link-origin" className="font-bold text-accent hover:underline">
                    {t('studio:marketingMail.bounce.setOrigin', 'Set the address')}
                  </a>
                </span>
              </div>
            ) : endpoint?.address == null ? (
              <div className="h-[50px] rounded-[10px] border border-border-strong bg-surface-2" aria-hidden />
            ) : (
              <CopyBox value={endpoint.address} label={t('studio:marketingMail.bounce.copyAddress', 'Copy address')} onCopied={copied} testId="notice-address" />
            )}
          </div>
          {secretRow}
          <div className="flex items-center gap-2 text-body-sm text-fg-muted" data-part="last-notice">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${ago === null ? 'bg-fg-subtle' : 'bg-pos'}`} />
            {ago === null ? t('studio:marketingMail.bounce.nothingYet', 'Nothing has arrived yet') : t('studio:marketingMail.bounce.lastNotice', 'Last notice {ago}', { ago })}
          </div>
        </>
      )}
    </Card>
  );
}
