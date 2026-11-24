// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Setup (comp `Texts Setup`, X03–X20).
 *
 *  - Can replies reach this server: the payments page's reach card shell.
 *  - The provider: Twilio or Telnyx, one per server. A guided card with its
 *    steps, the key fields, and the check. A key the provider did not accept
 *    is never saved, and the saved one stays while a check runs. Keys that
 *    open another account ask first, because bills move there.
 *  - Connected: the masked account, its hint, saved and last checked, Replace
 *    key, Check again and Disconnect.
 *  - The sender and the country local numbers are read in.
 *  - Registration: between the business and its provider. Adminium cannot see
 *    it, approve it or speed it up, so the card says only that.
 *  - Where you can text, a test text, the daily limit and the sending hours.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheckBig, CircleX, Clock, FlaskConical, Gauge, Globe, KeyRound, MessageSquareText, PlugZap, RefreshCw, Search, Send, Unplug } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Modal, ModalBody, ModalFooter, ModalHeader, ProgressBar, Select, Spinner } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { ReachCard, reachToneOf } from '../reach/ReachCard.js';
import { OutLink } from '../shipping/shippingWords.js';
import { TEXT_COUNTRIES, countryName, countryNote, marketingAllowed } from './textCountries.js';
import { SEGMENT_TABLES, estimateLength } from './textCounter.js';
import { CounterLine } from './TextCounterView.js';
import {
  changedAccountOf,
  checkAccount,
  disconnectAccount,
  limitsKey,
  refusalReason,
  saveAccount,
  saveLimits,
  saveSending,
  sendTestText,
  sendingLimitsQuery,
  setupKey,
  smsSetupQuery,
  type AccountKeys,
  type SenderKind,
  type SmsAccount,
  type SmsProvider,
  type SmsSetup,
  type TestOutcome,
} from './textsApi.js';
import { TEXTS_LINKS } from './textsLinks.js';
import { activeLocale, checkFailedWords, cnSentence, providerName, reasonWords, stamp } from './textsWords.js';

const caption = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle';

/** The server's fixed test text (`SMS_TEST_BODY`): the test route sends nothing else. */
export const TEST_TEXT = 'Test text from Adminium. Your text message connection works.';

// ─── Can replies reach this server ─────────────────────────────────────────

function RepliesCard({ setup }: { setup: SmsSetup }) {
  const ok = setup.repliesCanArrive;
  return (
    <ReachCard
      testId="texts-reach"
      state={setup.reachability.state}
      tone={reachToneOf(setup.reachability.state)}
      icon={<Globe />}
      heading={t('studio:texts.reach.heading', 'Can replies reach this server?')}
      badge={ok ? t('studio:texts.reach.yes', 'Replies arrive') : t('studio:texts.reach.no', 'No replies')}
    >
      {ok ? (
        <p data-testid="texts-reach-ok">
          {t('studio:texts.reach.ok', 'Replies and delivery reports can reach this server.')}{' '}
          <bdi dir="ltr" className="font-mono text-[12.5px]">
            {setup.reachability.origin}
          </bdi>
        </p>
      ) : (
        <p className="font-semibold" data-testid="texts-reach-problem">
          {t('studio:texts.reach.problem', 'This server has no public https address. It can send service texts, but it can’t receive STOP replies or delivery reports. Marketing texts are off.')}
        </p>
      )}
    </ReachCard>
  );
}

// ─── The provider ───────────────────────────────────────────────────────────

interface FieldSpec {
  name: string;
  label: string;
  secret: boolean;
  help?: string | undefined;
}

function fieldsOf(provider: SmsProvider): FieldSpec[] {
  return provider === 'twilio'
    ? [
        { name: 'accountSid', label: t('studio:texts.field.accountSid', 'Account SID'), secret: false },
        { name: 'authToken', label: t('studio:texts.field.authToken', 'Auth Token'), secret: true, help: t('studio:texts.field.authTokenHelp', 'Sends the texts, and checks that updates really came from Twilio.') },
      ]
    : [
        { name: 'apiKey', label: t('studio:texts.field.apiKey', 'API key'), secret: true },
        { name: 'publicKey', label: t('studio:texts.field.publicKey', 'Public key'), secret: false, help: t('studio:texts.field.publicKeyHelp', 'Used only to check that updates really came from Telnyx.') },
        { name: 'messagingProfileId', label: t('studio:texts.field.profile', 'Messaging profile id'), secret: false },
      ];
}

/** A wrong paste, said beside its field. */
function pasteWords(code: string): string {
  switch (code) {
    case 'EMPTY':
      return t('studio:texts.paste.empty', 'Paste a value here.');
    case 'HAS_SPACES':
      return t('studio:texts.paste.spaces', 'Paste it with nothing before or after it.');
    case 'NOT_AN_ACCOUNT_SID':
      return t('studio:texts.paste.notSid', 'This is not an Account SID. It starts with AC.');
    case 'KEY_SID_IN_ACCOUNT_FIELD':
      return t('studio:texts.paste.keySid', 'That value is an API key SID. Paste the Account SID here. It starts with AC.');
    case 'SID_IN_TOKEN_FIELD':
      return t('studio:texts.paste.sidInToken', 'That value is an Account SID. Paste the Auth Token here.');
    case 'NOT_A_PROFILE_ID':
      return t('studio:texts.paste.profile', 'This is not a messaging profile id. Copy it from the profile’s page.');
    case 'NOT_A_PUBLIC_KEY':
      return t('studio:texts.paste.publicKey', 'This is not a public key. Copy it from the Public key page.');
    default:
      return t('studio:texts.paste.notKey', 'This doesn’t look like a key. Copy it again.');
  }
}

function Steps({ provider }: { provider: SmsProvider }) {
  const links = TEXTS_LINKS[provider];
  const steps: { title: string; line: string; href?: string | undefined; link?: string | undefined }[] =
    provider === 'twilio'
      ? [
          { title: t('studio:texts.steps.twilio.account', 'Open a paid Twilio account'), line: t('studio:texts.steps.twilio.accountLine', 'A trial account can’t send these texts.'), href: links.signUp, link: t('studio:texts.steps.openTwilio', 'Open Twilio') },
          { title: t('studio:texts.steps.twilio.keys', 'Copy your Account SID and Auth Token'), line: t('studio:texts.steps.twilio.keysLine', 'Both are on the console’s home page, under Account info.'), href: links.keys, link: t('studio:texts.steps.openConsole', 'Open the console') },
          { title: t('studio:texts.steps.paste', 'Paste them below'), line: t('studio:texts.steps.pasteLine', 'Each value on its own, with nothing before or after it.') },
          { title: t('studio:texts.steps.check', 'Check connection'), line: t('studio:texts.steps.checkLine', 'The provider is asked about the key before it is saved.') },
        ]
      : [
          { title: t('studio:texts.steps.telnyx.account', 'Open a Telnyx account'), line: t('studio:texts.steps.telnyx.accountLine', 'Self-serve. Telnyx may ask for identity checks.'), href: links.signUp, link: t('studio:texts.steps.openTelnyx', 'Open Telnyx') },
          { title: t('studio:texts.steps.telnyx.keys', 'Create an API key and copy the public key'), line: t('studio:texts.steps.telnyx.keysLine', 'Both are under Auth in the Telnyx portal.'), href: links.keys, link: t('studio:texts.steps.openPortal', 'Open the portal') },
          { title: t('studio:texts.steps.telnyx.profile', 'Copy your messaging profile id'), line: t('studio:texts.steps.telnyx.profileLine', 'The profile that holds the numbers you send from.'), href: links.senders, link: t('studio:texts.steps.openPortal', 'Open the portal') },
          { title: t('studio:texts.steps.check', 'Check connection'), line: t('studio:texts.steps.checkLine', 'The provider is asked about the key before it is saved.') },
        ];
  return (
    <ol className="flex flex-col gap-3" data-testid={`texts-steps-${provider}`}>
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[12px] font-semibold">
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-bold">{step.title}</span>
            <span className="text-[12.5px] text-fg-muted">{step.line}</span>
            {step.href === undefined ? null : <OutLink href={step.href}>{step.link}</OutLink>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProviderChoice({ value, onChange }: { value: SmsProvider; onChange: (provider: SmsProvider) => void }) {
  const name = useId();
  const options: { key: SmsProvider; line: string; price: string }[] = [
    { key: 'twilio', line: t('studio:texts.provider.twilioLine', 'Self-serve. After a timeout, you check before resending.'), price: '$0.0083' },
    { key: 'telnyx', line: t('studio:texts.provider.telnyxLine', 'Self-serve, may ask for identity checks. Can retry safely after a timeout.'), price: '$0.004' },
  ];
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2" data-testid="texts-provider-choice">
      <legend className="sr-only">{t('studio:texts.provider.legend', 'Your provider')}</legend>
      {options.map((option) => (
        <label key={option.key} className={`flex cursor-pointer gap-3 rounded-[12px] border-[1.5px] p-3.5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-accent-soft ${value === option.key ? 'border-accent bg-accent-soft-solid' : 'border-border bg-surface'}`}>
          <input type="radio" name={name} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} className="mt-1 accent-[var(--accent)]" data-testid={`texts-provider-${option.key}`} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[14px] font-bold">{providerName(option.key)}</span>
            <span className="text-[12.5px] text-fg-muted">{option.line}</span>
            <span className="text-[11.5px] text-fg-subtle">
              {t('studio:texts.provider.price', 'United States, per segment: {price}, plus carrier fees. Prices can change.', { price: option.price })}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function KeyForm({ provider, replacing, onDone, onCancel }: { provider: SmsProvider; replacing: boolean; onDone: (account: SmsAccount) => void; onCancel?: (() => void) | undefined }) {
  const fields = fieldsOf(provider);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; code: string } | null>(null);
  const [failed, setFailed] = useState<{ title: string; line: string } | null>(null);
  const [changed, setChanged] = useState<{ accountName: string | null } | null>(null);
  const ids = useId();

  const keys = (): AccountKeys =>
    provider === 'twilio'
      ? { provider, accountSid: (values['accountSid'] ?? '').trim(), authToken: (values['authToken'] ?? '').trim() }
      : { provider, apiKey: (values['apiKey'] ?? '').trim(), publicKey: (values['publicKey'] ?? '').trim(), messagingProfileId: (values['messagingProfileId'] ?? '').trim() };

  async function send(confirm: boolean) {
    setBusy(true);
    setFailed(null);
    setFieldError(null);
    try {
      const account = await saveAccount(keys(), confirm);
      setValues({});
      setChanged(null);
      onDone(account);
    } catch (error) {
      const other = changedAccountOf(error);
      const reason = refusalReason(error);
      const details = error instanceof ApiError ? (error.details as { field?: unknown } | null | undefined) : null;
      if (other !== null) setChanged(other);
      else if (typeof details?.field === 'string' && reason !== null) setFieldError({ field: details.field, code: reason });
      else if (reason === 'network-off') setFailed({ title: t('studio:texts.check.networkOff.title', 'Network features are off on this server'), line: t('studio:texts.check.networkOff.line', 'No provider can be reached until they are switched on.') });
      else if (error instanceof ApiError && error.code === 'OFF_BY_OPERATOR') setFailed({ title: t('studio:texts.check.operatorOff.title', 'Texts are switched off on this server'), line: t('studio:texts.check.operatorOff.line', 'Whoever runs this server has turned them off.') });
      else setFailed(checkFailedWords(reason === 'credentials-refused' || reason === 'profile-not-found' || reason === 'account-suspended' || reason === 'account-closed' || reason === 'account-disabled' || reason === 'unreachable' ? reason : null));
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(false);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} data-testid="texts-key-form" noValidate>
      <p className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px]" data-testid="texts-billed-on">
        {t('studio:texts.key.billed', 'Texts are sent and billed on your {provider} account. Customer phone numbers and message text go to {provider} and the carriers.', { provider: providerName(provider) })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const error = fieldError?.field === field.name ? pasteWords(fieldError.code) : undefined;
          return (
            <FormField key={field.name} label={field.label} required helper={field.help} error={error} controlId={`${ids}-${field.name}`}>
              <Input
                id={`${ids}-${field.name}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="font-mono"
                value={values[field.name] ?? ''}
                onChange={(event) => setValues((held) => ({ ...held, [field.name]: event.target.value }))}
                data-testid={`texts-field-${field.name}`}
              />
            </FormField>
          );
        })}
      </div>
      {failed !== null ? <Alert tone="danger" role="alert" title={failed.title} body={failed.line} data-testid="texts-check-failed" /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} iconLeft={<PlugZap className="size-4" />} data-testid="texts-key-check">
          {busy ? t('studio:texts.key.checking', 'Checking…') : t('studio:texts.steps.check', 'Check connection')}
        </Button>
        {onCancel === undefined ? null : (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t('studio:texts.key.keep', 'Keep the current key')}
          </Button>
        )}
      </div>
      {replacing && busy ? <p className="text-[12px] text-fg-muted">{t('studio:texts.key.kept', 'The saved key stays in use until the provider answers.')}</p> : null}
      <Modal open={changed !== null} onOpenChange={(open) => (open ? undefined : setChanged(null))}>
        <ModalHeader tone="warn" title={t('studio:texts.changed.title', 'This is a different account')} closeLabel={t('studio:texts.close', 'Close')} />
        <ModalBody className="flex flex-col gap-3 text-[13px]" data-testid="texts-changed">
          <p>
            {changed?.accountName != null
              ? t('studio:texts.changed.body', 'Texts will now be billed to {account} instead of the account connected now.', { account: changed.accountName })
              : t('studio:texts.changed.bodyNoName', 'Texts will now be billed to another account than the one connected now.')}
          </p>
          <p className="text-fg-muted">{t('studio:texts.changed.kept', 'Nothing has changed yet. The current key stays in force until you confirm. The sender is cleared, because it belongs to the old account.')}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setChanged(null)}>
            {t('studio:texts.key.keep', 'Keep the current key')}
          </Button>
          <Button disabled={busy} loading={busy} onClick={() => void send(true)} data-testid="texts-changed-confirm">
            {t('studio:texts.changed.confirm', 'Bill the new account')}
          </Button>
        </ModalFooter>
      </Modal>
    </form>
  );
}

function ConnectCard({ onConnected }: { onConnected: (account: SmsAccount) => void }) {
  const [provider, setProvider] = useState<SmsProvider>('twilio');
  return (
    <Card data-testid="texts-connect">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" icon={<KeyRound />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.connect.heading', 'Connect your provider')}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:texts.connect.sub', 'One provider account serves this whole server.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <ProviderChoice value={provider} onChange={setProvider} />
        <Steps provider={provider} />
        <KeyForm key={provider} provider={provider} replacing={false} onDone={onConnected} />
      </CardBody>
    </Card>
  );
}

function ConnectedCard({ account, locale, onChanged, onGone }: { account: SmsAccount; locale: string; onChanged: (account: SmsAccount) => void; onGone: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [asking, setAsking] = useState(false);
  const name = providerName(account.provider);
  const check = useMutation({ mutationFn: checkAccount, onSuccess: onChanged });
  const disconnect = useMutation({ mutationFn: disconnectAccount, onSuccess: onGone });
  const failed = account.check.ok ? null : checkFailedWords(account.check.reason);
  const unreachable = check.isError && refusalReason(check.error) === null;
  return (
    <Card data-testid="texts-connected">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile tone={failed === null && account.keyReadable ? 'pos' : 'danger'} icon={failed === null && account.keyReadable ? <CircleCheckBig /> : <CircleX />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">
            {account.accountName === null ? t('studio:texts.connected.titleNoName', 'Connected to {provider}', { provider: name }) : t('studio:texts.connected.title', 'Connected to {account}', { account: account.accountName })}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {name} · {account.timeoutRetry === 'never' ? t('studio:texts.connected.checkFirst', 'After a timeout, you check before resending.') : t('studio:texts.connected.sameKey', 'Retries safely after a timeout, for 24 hours.')}
          </p>
        </div>
        <Badge tone={failed === null && account.keyReadable ? 'pos' : 'danger'}>{failed === null && account.keyReadable ? t('studio:texts.connected.badge', 'Connected') : t('studio:texts.connected.badgeProblem', 'Needs a look')}</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-4 text-[13px]">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2">
          <dt className="text-fg-subtle">{t('studio:texts.connected.key', 'Key')}</dt>
          <dd>
            <bdi dir="ltr" className="font-mono font-medium">
              {account.accountHint}
            </bdi>
          </dd>
          <dt className="text-fg-subtle">{t('studio:texts.connected.saved', 'Saved')}</dt>
          <dd>
            <bdi dir="ltr" className="font-mono">
              {stamp(account.savedAt, locale)}
            </bdi>
          </dd>
          <dt className="text-fg-subtle">{t('studio:texts.connected.lastChecked', 'Last checked')}</dt>
          <dd>
            <bdi dir="ltr" className="font-mono">
              {stamp(account.check.at, locale)}
            </bdi>
          </dd>
        </dl>
        {!account.keyReadable ? (
          <Alert tone="danger" role="alert" data-testid="texts-key-unreadable" title={t('studio:texts.connected.unreadable', 'The saved key can no longer be opened')} body={t('studio:texts.connected.unreadableLine', 'This server’s secret changed. Paste the key again to send texts.')} />
        ) : null}
        {failed !== null ? <Alert tone="danger" role="alert" data-testid="texts-check-result" title={failed.title} body={failed.line} /> : null}
        {account.accountType === 'trial' ? (
          <Alert tone="warn" data-testid="texts-trial" title={t('studio:texts.check.trial.title', 'This is a trial account')} body={t('studio:texts.check.trial.line', 'A Twilio trial sends only Twilio’s own templates to verified numbers. Make it a paid account in Twilio, then check again.')} />
        ) : null}
        {unreachable ? <Alert tone="danger" role="alert" title={t('studio:texts.check.unreachable.title', 'We couldn’t reach the provider')} body={t('studio:texts.check.unreachable.line', 'Your saved key has not changed. Check this server’s internet connection and try again.')} /> : null}
        {replacing ? (
          <KeyForm
            provider={account.provider}
            replacing
            onDone={(next) => {
              setReplacing(false);
              onChanged(next);
            }}
            onCancel={() => setReplacing(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" iconLeft={<KeyRound className="size-4" />} onClick={() => setReplacing(true)} data-testid="texts-replace">
              {t('studio:texts.connected.replace', 'Replace key')}
            </Button>
            <Button variant="secondary" loading={check.isPending} iconLeft={<RefreshCw className="size-4" />} onClick={() => check.mutate()} disabled={!account.keyReadable} data-testid="texts-check-again">
              {check.isPending ? t('studio:texts.key.checking', 'Checking…') : t('studio:texts.connected.checkAgain', 'Check again')}
            </Button>
            <Button variant="ghost" className="ms-auto text-danger" iconLeft={<Unplug className="size-4" />} onClick={() => setAsking(true)} data-testid="texts-disconnect">
              {t('studio:texts.connected.disconnect', 'Disconnect')}
            </Button>
          </div>
        )}
      </CardBody>
      <Modal open={asking} onOpenChange={setAsking}>
        <ModalHeader tone="danger" title={t('studio:texts.disconnect.title', 'Disconnect {provider}?', { provider: name })} closeLabel={t('studio:texts.close', 'Close')} />
        <ModalBody className="text-[13px]" data-testid="texts-disconnect-confirm">
          {t('studio:texts.disconnect.body', 'Texts stop at once, and the keys are deleted from this server. Texts already handed to {provider} are not called back.', { provider: name })}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            {t('studio:texts.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" loading={disconnect.isPending} onClick={() => disconnect.mutate()} data-testid="texts-disconnect-yes">
            {t('studio:texts.disconnect.yes', 'Disconnect and delete the keys')}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}

// ─── The sender ─────────────────────────────────────────────────────────────

function senderWords(kind: SenderKind): { label: string; line: string } {
  switch (kind) {
    case 'number':
      return { label: t('studio:texts.sender.number', 'Number'), line: t('studio:texts.sender.numberLine', 'Can receive replies.') };
    case 'name':
      return { label: t('studio:texts.sender.name', 'Sender name'), line: t('studio:texts.sender.nameLine', 'Can’t receive replies, so each text gives your phone or e-mail for stopping.') };
    case 'pool':
      return { label: t('studio:texts.sender.pool', 'Messaging service or number pool'), line: t('studio:texts.sender.poolLine', 'Replies depend on the senders in it, so texts give your phone or e-mail for stopping.') };
  }
}

function senderError(code: string | null): string {
  switch (code) {
    case 'NOT_A_NUMBER':
      return t('studio:texts.sender.badNumber', 'Write the number in full, starting with + and the country code.');
    case 'NOT_A_NAME':
      return t('studio:texts.sender.badName', 'Up to 11 letters, digits and spaces, with at least one letter.');
    case 'NOT_A_POOL':
      return t('studio:texts.sender.badPool', 'Paste the Messaging Service SID (MG…), or this profile’s id for Telnyx.');
    case 'SENDER_OTHER_PROFILE':
      return t('studio:texts.sender.otherProfile', 'That number is on another messaging profile. Move it to this profile in Telnyx.');
    case 'BAD_COUNTRY':
      return t('studio:texts.sender.badCountry', 'Choose a country from the list.');
    default:
      return t('studio:texts.sender.refused', 'That sender could not be saved.');
  }
}

function SenderCard({ account, locale, onSaved }: { account: SmsAccount; locale: string; onSaved: (account: SmsAccount) => void }) {
  const [kind, setKind] = useState<SenderKind>(account.sender?.kind ?? 'number');
  const [value, setValue] = useState(account.sender?.value ?? '');
  const [country, setCountry] = useState(account.defaultCountry ?? '');
  const ids = useId();
  const save = useMutation({ mutationFn: () => saveSending({ kind, value: value.trim() }, country === '' ? null : country), onSuccess: onSaved });
  const kinds: SenderKind[] = ['number', 'name', 'pool'];
  const words = senderWords(kind);
  const countries = useMemo(() => TEXT_COUNTRIES.filter((one) => one.blocked !== true).map((one) => ({ code: one.code, name: countryName(one.code, locale) })), [locale]);
  return (
    <Card data-testid="texts-sender">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" icon={<Send />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.sender.heading', 'Who texts come from')}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:texts.sender.sub', 'A number or sender name from your provider’s console. Adminium buys none and registers none.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {account.sender === null ? (
          <Alert tone="warn" data-testid="texts-no-sender" title={t('studio:texts.check.noSender.title', 'Connected, but nothing can send yet')} body={t('studio:texts.check.noSender.line', 'Add a number or sender name in your provider’s console, then enter it here.')} />
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className={`${caption} mb-1`}>{t('studio:texts.sender.kind', 'Kind of sender')}</legend>
          {kinds.map((one) => (
            <label key={one} className="flex items-start gap-2.5 text-[13px]">
              <input type="radio" name={`${ids}-kind`} value={one} checked={kind === one} onChange={() => setKind(one)} className="mt-0.5 accent-[var(--accent)]" data-testid={`texts-sender-${one}`} />
              <span>
                <span className="font-bold">{senderWords(one).label}</span>
                <span className="block text-[12.5px] text-fg-muted">{senderWords(one).line}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={words.label} required controlId={`${ids}-value`} error={save.isError ? senderError(refusalReason(save.error)) : undefined}>
            <Input id={`${ids}-value`} dir="ltr" className="font-mono" value={value} onChange={(event) => setValue(event.target.value)} data-testid="texts-sender-value" />
          </FormField>
          <FormField label={t('studio:texts.sender.country', 'Country for local numbers')} helper={t('studio:texts.sender.countryHelp', 'A number written without + is read as one from here.')} controlId={`${ids}-country`}>
            <Select id={`${ids}-country`} value={country} onChange={(event) => setCountry(event.target.value)} data-testid="texts-sender-country">
              <option value="">{t('studio:texts.sender.noCountry', 'None: only numbers with +')}</option>
              {countries.map((one) => (
                <option key={one.code} value={one.code}>
                  {one.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <p className="text-[12px] text-fg-muted" data-testid="texts-stop-contact">
          {t('studio:texts.sender.contact', 'Where a text can’t take a STOP reply, it ends with the app’s phone number, or the reply-to address of your e-mail sender, so the person can ask you to stop. Staff then record it on the do-not-text list.')}
        </p>
        <div>
          <Button loading={save.isPending} disabled={value.trim() === ''} onClick={() => save.mutate()} data-testid="texts-sender-save">
            {t('studio:texts.save', 'Save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Registration ───────────────────────────────────────────────────────────

function RegistrationCard({ provider }: { provider: SmsProvider }) {
  const name = providerName(provider);
  return (
    <Card data-testid="texts-registration">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="warn" icon={<Clock />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.registration.heading', 'Registration')}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:texts.registration.sub', 'Some countries ask a business to register before it can text there.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 text-[13px]">
        <p className="font-semibold" data-testid="texts-registration-unknown">
          {t('studio:texts.registration.unknown', '{provider} doesn’t tell us this for your sender. Check it there.', { provider: name })}
        </p>
        <p className="text-fg-muted">{t('studio:texts.registration.between', 'Registration is between your business and {provider}. Adminium can’t see it, approve it or speed it up.', { provider: name })}</p>
        <p className="text-fg-muted">{t('studio:texts.registration.us', 'Texts to the United States are not delivered until your 10DLC or toll-free registration is approved. This can take days to weeks.')}</p>
        <OutLink href={TEXTS_LINKS[provider].registration}>{t('studio:texts.registration.open', 'Open registration in {provider}', { provider: name })}</OutLink>
      </CardBody>
    </Card>
  );
}

// ─── Where you can text ─────────────────────────────────────────────────────

function CountriesCard({ locale }: { locale: string }) {
  const [query, setQuery] = useState('');
  const ids = useId();
  const rows = TEXT_COUNTRIES.map((country) => ({ country, name: countryName(country.code, locale) })).filter(({ country, name }) => {
    const wanted = query.trim().toLocaleLowerCase(locale);
    return wanted === '' || name.toLocaleLowerCase(locale).includes(wanted) || country.dial.includes(wanted) || country.code.toLowerCase() === wanted;
  });
  const yes = t('studio:texts.countries.yes', 'Yes');
  const no = t('studio:texts.countries.no', 'No');
  return (
    <Card data-testid="texts-countries">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile tone="neutral" icon={<Globe />} />
        <h2 className="min-w-0 flex-1 text-[14.5px] font-bold">{t('studio:texts.countries.heading', 'Where you can text')}</h2>
        <label className="relative w-full sm:w-[240px]">
          <span className="sr-only">{t('studio:texts.countries.search', 'Search countries')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input id={`${ids}-search`} className="ps-8" placeholder={t('studio:texts.countries.search', 'Search countries')} value={query} onChange={(event) => setQuery(event.target.value)} data-testid="texts-countries-search" />
        </label>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2">
              {[
                t('studio:texts.countries.col.country', 'Country'),
                t('studio:texts.countries.col.dial', 'Code'),
                t('studio:texts.countries.col.sender', 'Sender'),
                t('studio:texts.countries.col.replies', 'Replies'),
                t('studio:texts.countries.col.service', 'Service texts'),
                t('studio:texts.countries.col.marketing', 'Marketing texts'),
                t('studio:texts.countries.col.stop', 'How a person stops'),
              ].map((label) => (
                <th key={label} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle first:ps-5">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ country, name }) =>
              country.blocked === true ? (
                <tr key={country.code} className="border-b border-border bg-danger-soft last:border-0" data-testid="texts-country-CN">
                  <th scope="row" className="py-2.5 pe-3 ps-5 text-start font-bold">
                    {name}
                  </th>
                  <td className="px-3 py-2.5">
                    <bdi dir="ltr" className="font-mono">
                      {country.dial}
                    </bdi>
                  </td>
                  <td colSpan={5} className="px-3 py-2.5 font-semibold">
                    {cnSentence()}
                  </td>
                </tr>
              ) : (
                <tr key={country.code} className="border-b border-border align-top last:border-0" data-testid={`texts-country-${country.code}`}>
                  <th scope="row" className="py-2.5 pe-3 ps-5 text-start font-bold">
                    {name}
                    <span className="mt-0.5 block text-[11.5px] font-normal text-fg-muted">{countryNote(country.code)}</span>
                  </th>
                  <td className="px-3 py-2.5">
                    <bdi dir="ltr" className="font-mono">
                      {country.dial}
                    </bdi>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{country.route === 'number' ? t('studio:texts.sender.number', 'Number') : t('studio:texts.sender.name', 'Sender name')}</td>
                  <td className="px-3 py-2.5">{country.replies ? yes : no}</td>
                  <td className="px-3 py-2.5">{yes}</td>
                  <td className="px-3 py-2.5">{marketingAllowed(country) ? yes : <span className="font-semibold">{t('studio:texts.countries.serviceOnly', 'Service only')}</span>}</td>
                  <td className="px-3 py-2.5">{country.replies ? t('studio:texts.countries.stopReply', 'Replies STOP') : t('studio:texts.countries.stopThroughYou', 'No replies, so opt-out goes through you')}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── A test text ────────────────────────────────────────────────────────────

function testResultWords(result: TestOutcome, provider: string): { tone: 'pos' | 'warn' | 'danger' | 'info'; title: string; line: string } {
  if (result.outcome === 'accepted') return { tone: 'info', title: t('studio:texts.test.sent', 'Handed to {provider}', { provider }), line: t('studio:texts.test.sentLine', 'A test text gets no delivery report here, so look at the phone. With a test key nothing is delivered.') };
  if (result.outcome === 'unknown') return { tone: 'warn', title: t('studio:texts.status.unknown', 'Unknown, check before resending'), line: t('studio:texts.test.unknownLine', 'We didn’t get an answer from {provider}. Look in its message log before sending another.', { provider }) };
  if (result.outcome === 'not-taken') return { tone: 'warn', title: t('studio:texts.test.notTaken', 'Not sent'), line: t('studio:texts.reason.notReached', 'Not sent. The provider could not be reached, and nothing was handed over.') };
  if (result.reason === 'country-blocked-cn') return { tone: 'danger', title: t('studio:texts.test.refused', 'Not sent'), line: cnSentence() };
  return { tone: 'danger', title: t('studio:texts.test.refused', 'Not sent'), line: reasonWords(result.reason) ?? t('studio:texts.reason.other', 'Not sent. The provider refused it.') };
}

function TestDialog({ open, onClose, provider }: { open: boolean; onClose: () => void; provider: SmsProvider }) {
  const [to, setTo] = useState('');
  const ids = useId();
  const name = providerName(provider);
  const test = useMutation({ mutationFn: () => sendTestText(to.trim()) });
  const limited = test.isError && test.error instanceof ApiError && test.error.status === 429;
  const estimate = estimateLength(TEST_TEXT, SEGMENT_TABLES.standard);
  const result = test.data === undefined ? null : testResultWords(test.data, name);
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          test.reset();
          onClose();
        }
      }}
    >
      <ModalHeader icon={<MessageSquareText />} title={t('studio:texts.test.title', 'Send a test text')} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 text-[13px]" data-testid="texts-test">
        <FormField label={t('studio:texts.test.to', 'Phone number')} required controlId={`${ids}-to`} helper={t('studio:texts.test.toHelp', 'With + and the country code, or a local number of the country set above.')}>
          <Input id={`${ids}-to`} type="tel" dir="ltr" className="font-mono" autoComplete="off" value={to} onChange={(event) => setTo(event.target.value)} data-testid="texts-test-to" />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className={caption}>{t('studio:texts.test.message', 'The test text')}</span>
          <p lang="en" dir="ltr" className="rounded-[14px] bg-surface-2 px-3 py-2.5 text-start">
            {TEST_TEXT}
          </p>
          <CounterLine estimate={estimate} />
          <p className="text-[12px] text-fg-muted">{t('studio:texts.test.fixed', 'The test text is always these words, so this button can’t send anything else.')}</p>
        </div>
        <p className="text-[12.5px]">{t('studio:texts.test.cost', 'This uses your provider account and may cost a small charge.')}</p>
        <div role="status" aria-live="polite">
          {test.isPending ? (
            <span className="inline-flex items-center gap-2 text-fg-muted">
              <Spinner size="sm" /> {t('studio:texts.test.sending', 'Sending…')}
            </span>
          ) : result !== null ? (
            <Alert tone={result.tone} title={result.title} body={result.line} data-testid="texts-test-result" />
          ) : limited ? (
            <Alert tone="warn" title={t('studio:texts.test.limited', 'Too many test texts. Try again in a few minutes.')} />
          ) : test.isError ? (
            <Alert tone="danger" title={t('studio:texts.test.refused', 'Not sent')} body={refusalReason(test.error) === 'network-off' ? t('studio:texts.check.networkOff.title', 'Network features are off on this server') : test.error.message} />
          ) : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('studio:texts.close', 'Close')}
        </Button>
        <Button loading={test.isPending} disabled={to.trim() === ''} iconLeft={<Send className="size-4" />} onClick={() => test.mutate()} data-testid="texts-test-send">
          {t('studio:texts.test.send', 'Send test')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── The daily limit and the hours ─────────────────────────────────────────

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function LimitsCard() {
  const client = useQueryClient();
  const limits = useQuery(sendingLimitsQuery());
  const ids = useId();
  const limitInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<{ limit: string; from: string; to: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: { dailyLimit: number; serviceHours: { from: string; to: string } }) => saveLimits(body),
    onSuccess: (data) => {
      client.setQueryData(limitsKey, data);
      setDraft(null);
    },
  });
  if (limits.data === undefined) {
    return (
      <Card data-testid="texts-limits">
        <CardBody className="flex justify-center p-8">{limits.isError ? <Alert tone="danger" title={t('studio:texts.loadFailed', 'This could not be loaded')} /> : <Spinner size="md" />}</CardBody>
      </Card>
    );
  }
  const held = limits.data;
  const shown = draft ?? { limit: String(held.dailyLimit), from: held.serviceHours.from, to: held.serviceHours.to };
  const number = Number(shown.limit);
  const limitBad = !Number.isInteger(number) || number < 1 || number > 100_000;
  const hoursBad = !CLOCK.test(shown.from) || !CLOCK.test(shown.to) || shown.from === shown.to;
  const reached = held.usedToday >= held.dailyLimit;
  const warning = !reached && held.usedToday >= held.warnAt;
  const set = (patch: Partial<typeof shown>) => setDraft({ ...shown, ...patch });
  return (
    <Card data-testid="texts-limits">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone={reached ? 'danger' : warning ? 'warn' : 'neutral'} icon={<Gauge />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.limits.heading', 'Daily limit and sending hours')}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:texts.limits.why', 'This protects your provider bill if an automation goes wrong.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-col gap-1.5" data-testid="texts-limits-meter">
          <div className="flex items-baseline gap-2">
            <span className="text-[12.5px] font-bold">{t('studio:texts.limits.today', 'Sent today')}</span>
            <bdi dir="ltr" className="ms-auto font-mono text-[12.5px] font-semibold">
              {held.usedToday} / {held.dailyLimit}
            </bdi>
          </div>
          <ProgressBar value={Math.min(held.usedToday, held.dailyLimit)} max={held.dailyLimit} tone={reached ? 'danger' : warning ? 'warn' : 'accent'} label={t('studio:texts.limits.today', 'Sent today')} />
          <p className="text-[11.5px] text-fg-subtle">{t('studio:texts.limits.warnAt', 'The warning starts at {count}. The count starts again at midnight, {zone}.', { count: held.warnAt, zone: held.dayZone })}</p>
        </div>
        {reached ? (
          <Alert
            tone="danger"
            role="alert"
            data-testid="texts-limit-reached"
            title={t('studio:texts.limits.reached', 'Today’s limit is reached. Texts wait until tomorrow, unless their moment passes first.')}
            action={
              <Button size="sm" variant="secondary" onClick={() => limitInput.current?.focus()}>
                {t('studio:texts.limits.raise', 'Raise the limit')}
              </Button>
            }
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('studio:texts.limits.limit', 'Texts a day, at most')} required controlId={`${ids}-limit`} error={limitBad ? t('studio:texts.limits.limitBad', 'A whole number from 1 to 100,000.') : undefined}>
            <Input ref={limitInput} id={`${ids}-limit`} type="number" inputMode="numeric" min={1} max={100000} dir="ltr" className="font-mono" value={shown.limit} onChange={(event) => set({ limit: event.target.value })} data-testid="texts-limit" />
          </FormField>
          <FormField label={t('studio:texts.limits.from', 'Service texts from')} required controlId={`${ids}-from`} error={hoursBad ? t('studio:texts.limits.hoursBad', 'Two different times, like 08:00 and 21:00.') : undefined}>
            <Input id={`${ids}-from`} type="time" dir="ltr" className="font-mono" value={shown.from} onChange={(event) => set({ from: event.target.value })} data-testid="texts-hours-from" />
          </FormField>
          <FormField label={t('studio:texts.limits.to', 'Until')} required controlId={`${ids}-to`}>
            <Input id={`${ids}-to`} type="time" dir="ltr" className="font-mono" value={shown.to} onChange={(event) => set({ to: event.target.value })} data-testid="texts-hours-to" />
          </FormField>
        </div>
        <ul className="flex flex-col gap-1.5 text-[12.5px] text-fg-muted">
          <li>{t('studio:texts.limits.clock', 'Service hours are on the business’s clock. A text due outside them waits for the next opening, and is skipped if that is after its moment.')}</li>
          <li data-testid="texts-any-time">{t('studio:texts.limits.anyTime', 'Texts a customer is waiting for right now, such as “Your room is ready”, may go at any time. Each app says which of its texts these are.')}</li>
          <li>{t('studio:texts.limits.marketing', 'Marketing texts: 09:00–20:00, Monday to Saturday. Fixed.')}</li>
        </ul>
        {save.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={save.error.message} /> : null}
        <div>
          <Button loading={save.isPending} disabled={draft === null || limitBad || hoursBad} onClick={() => save.mutate({ dailyLimit: number, serviceHours: { from: shown.from, to: shown.to } })} data-testid="texts-limits-save">
            {t('studio:texts.save', 'Save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

export function SetupTab(): ReactNode {
  const client = useQueryClient();
  const setup = useQuery(smsSetupQuery());
  const locale = activeLocale();
  const [testing, setTesting] = useState(false);
  const account = setup.data?.account ?? null;
  const put = (next: SmsAccount | null) => client.setQueryData(setupKey, (held: SmsSetup | undefined) => (held === undefined ? held : { ...held, account: next }));
  if (setup.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );
  }
  if (setup.isError) return <Alert tone="danger" role="alert" data-testid="texts-load-error" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={setup.error.message} />;
  const ready = account !== null && account.keyReadable && account.sender !== null;
  return (
    <div className="flex flex-col gap-[18px]" data-testid="texts-setup">
      <RepliesCard setup={setup.data} />
      {account === null ? (
        <ConnectCard onConnected={put} />
      ) : (
        <>
          <ConnectedCard account={account} locale={locale} onChanged={put} onGone={() => put(null)} />
          <SenderCard key={`${account.savedAt}`} account={account} locale={locale} onSaved={put} />
          <RegistrationCard provider={account.provider} />
        </>
      )}
      <CountriesCard locale={locale} />
      <Card data-testid="texts-test-card">
        <CardBody className="flex flex-wrap items-center gap-3">
          <IconTile tone="neutral" icon={<FlaskConical />} />
          <div className="min-w-[200px] flex-1">
            <h2 className="text-[14.5px] font-bold">{t('studio:texts.test.title', 'Send a test text')}</h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">{ready ? t('studio:texts.test.sub', 'One fixed text, to a phone you hold.') : t('studio:texts.test.notReady', 'Connect a provider and choose a sender first.')}</p>
          </div>
          <Button variant="secondary" disabled={!ready} onClick={() => setTesting(true)} data-testid="texts-test-open">
            {t('studio:texts.test.open', 'Send a test text')}
          </Button>
        </CardBody>
      </Card>
      {account === null ? null : <TestDialog open={testing} onClose={() => setTesting(false)} provider={account.provider} />}
      <LimitsCard />
    </div>
  );
}
