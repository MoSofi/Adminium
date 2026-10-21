// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/payments` — where a shop sets up taking payments.
 *
 * Today it has one tab, Setup; Ways to pay, What can be paid, Pay page and
 * Activity join it as they are built, never as tabs that open onto nothing.
 *
 * Setup reads top to bottom the way the work goes:
 *
 *  1. **Can customers reach this server?** First, because a payment service
 *     needs to send customers to a page here and to call this server back.
 *     While it cannot, the services stay folded with "Set this up first."
 *     Manual ways to pay and staff recording work whatever it says.
 *  2. **One card per payment service** (each a payment add-on: "Card
 *     payments" connects to Stripe, "Wallet payments" to PayPal). A checklist
 *     that keeps its progress, the way the key is made, then per mode (test,
 *     live) the key fields and the webhook card. Each field saves on its own:
 *     replacing one never disconnects anything. A saved field shows a hint
 *     (`rk_test_…a1B2`) and is never shown back.
 *
 * Words name the provider plainly ("the Stripe page", "the Stripe
 * dashboard"), never in the possessive. A person who may only view payments
 * sees all of it, and no control.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Check, Copy, CreditCard, Globe, KeyRound, ShieldAlert, Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@adminium/ui';
import { formatRelativeTime } from '@adminium/widgets';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import {
  PAYMENTS_SETUP_QUERY_KEY,
  checkKeys,
  checklistProgress,
  choosePath,
  knownProvider,
  paymentsSetupQuery,
  saveField,
  saveRefusalOf,
  setStopped,
  type ChecklistStep,
  type FieldView,
  type KnownProvider,
  type ModeView,
  type PaymentMode,
  type Reachability,
  type ReachabilityState,
  type SaveRefusal,
  type ServiceView,
} from './paymentsApi.js';

export interface PaymentsPageProps {
  /** Opens the settings hub, where "Address in email links" (the public address) is set. */
  onOpenSettings: () => void;
}

// ─── Words ──────────────────────────────────────────────────────────────────
// Switches rather than assembled keys: a key built at runtime is invisible to
// the extractor and to the parity gate.

function providerWord(provider: KnownProvider, fallback: string): string {
  if (provider === 'stripe') return 'Stripe';
  if (provider === 'paypal') return 'PayPal';
  return fallback;
}

function connectsTo(provider: KnownProvider): string | null {
  if (provider === 'stripe') return t('studio:payments.service.connectsStripe', 'Connects to Stripe');
  if (provider === 'paypal') return t('studio:payments.service.connectsPaypal', 'Connects to PayPal');
  return null;
}

function reachBadge(state: ReachabilityState): string {
  switch (state) {
    case 'network-off':
      return t('studio:payments.reach.badge.networkOff', 'Works offline');
    case 'desktop':
    case 'this-computer':
      return t('studio:payments.reach.badge.thisComputer', 'This computer only');
    case 'not-set':
      return t('studio:payments.reach.badge.notSet', 'Not set');
    case 'private-network':
    case 'dot-local':
      return t('studio:payments.reach.badge.private', 'Private network');
    case 'not-https':
      return t('studio:payments.reach.badge.https', 'Needs https');
    case 'proxy-hidden':
      return t('studio:payments.reach.badge.proxy', 'Proxy setting');
    case 'reachable':
      return t('studio:payments.reach.badge.reachable', 'Reachable');
  }
}

function reachProblem(state: ReachabilityState): string {
  switch (state) {
    case 'network-off':
      return t('studio:payments.reach.problem.networkOff', 'This server is set to work without the internet, so it cannot take online payments.');
    case 'desktop':
    case 'this-computer':
      return t('studio:payments.reach.problem.thisComputer', 'This server runs on this computer only. Customers cannot reach it.');
    case 'not-set':
      return t('studio:payments.reach.problem.notSet', 'This server has no public address yet.');
    case 'private-network':
    case 'dot-local':
      return t('studio:payments.reach.problem.private', 'Only people on your own network can reach this address.');
    case 'not-https':
      return t('studio:payments.reach.problem.https', 'Pay pages need https. Put this server behind HTTPS first.');
    case 'proxy-hidden':
      return t('studio:payments.reach.problem.proxy', "This server is behind a proxy that hides your customers' addresses. Turn on ADMINIUM_TRUST_PROXY.");
    case 'reachable':
      return '';
  }
}

function reachFix(state: ReachabilityState): string {
  switch (state) {
    case 'network-off':
      return t('studio:payments.reach.fix.networkOff', 'Set ADMINIUM_NETWORK_FEATURES=on on the server, restart it, then check again.');
    case 'desktop':
    case 'this-computer':
      return t('studio:payments.reach.fix.thisComputer', 'Run Adminium on a server with a public https address, then set up payments there.');
    case 'not-set':
      return t('studio:payments.reach.fix.notSet', 'Add the address people use to open this server. It is “Address in email links” in the Senders card.');
    case 'private-network':
    case 'dot-local':
      return t('studio:payments.reach.fix.private', 'Give this server a public https address, and set it as “Address in email links” in Senders.');
    case 'not-https':
      return t('studio:payments.reach.fix.https', 'When HTTPS works, change the address in Senders to the https one.');
    case 'proxy-hidden':
      return t('studio:payments.reach.fix.proxy', 'Set ADMINIUM_TRUST_PROXY=on on the server, restart it, then check again.');
    case 'reachable':
      return '';
  }
}

function reachTone(state: ReachabilityState): 'pos' | 'warn' | 'danger' | 'neutral' {
  if (state === 'reachable') return 'pos';
  if (state === 'network-off') return 'neutral';
  if (state === 'not-set' || state === 'proxy-hidden') return 'warn';
  return 'danger';
}

function stepLabel(step: ChecklistStep, provider: KnownProvider): string {
  if (provider === 'paypal') {
    switch (step) {
      case 'test-key':
        return t('studio:payments.step.paypal.testKey', 'Sandbox app');
      case 'test-webhook':
        return t('studio:payments.step.paypal.testWebhook', 'Sandbox webhook');
      case 'live-key':
        return t('studio:payments.step.paypal.liveKey', 'Live app');
      default:
        break;
    }
  }
  switch (step) {
    case 'path':
      return t('studio:payments.step.path', 'Choose how to make your Stripe key');
    case 'test-key':
      return t('studio:payments.step.testKey', 'Test key');
    case 'test-webhook':
      return t('studio:payments.step.testWebhook', 'Test webhook');
    case 'test-payment':
      return t('studio:payments.step.testPayment', 'Send a test payment');
    case 'live-key':
      return t('studio:payments.step.liveKey', 'Live key');
    case 'live-webhook':
      return t('studio:payments.step.liveWebhook', 'Live webhook');
    case 'live-payment':
      return t('studio:payments.step.livePayment', 'First live payment arrived');
  }
}

function fieldLabel(field: FieldView, mode: PaymentMode): string {
  switch (field.key) {
    case 'secret_key':
      return mode === 'test' ? t('studio:payments.field.testKey', 'Test key') : t('studio:payments.field.liveKey', 'Live key');
    case 'webhook_secret':
      return t('studio:payments.field.signingSecret', 'Signing secret');
    case 'client_id':
      return t('studio:payments.field.clientId', 'Client id');
    case 'client_secret':
      return t('studio:payments.field.secret', 'Secret');
    case 'webhook_id':
      return t('studio:payments.field.webhookId', 'Webhook ID');
    default:
      return field.label?.fallback ?? field.key;
  }
}

function fieldPrompt(field: FieldView, mode: PaymentMode): string | null {
  switch (field.key) {
    case 'secret_key':
      return mode === 'test'
        ? t('studio:payments.field.testKeyPrompt', 'Paste the key that starts with rk_test_')
        : t('studio:payments.field.liveKeyPrompt', 'Paste the key that starts with rk_live_');
    case 'webhook_secret':
      return t('studio:payments.field.signingSecretPrompt', "Paste the signing secret from the endpoint's page in Stripe. It starts with whsec_.");
    case 'webhook_id':
      return t('studio:payments.field.webhookIdPrompt', 'PayPal shows it on the webhook’s page. Adminium needs it to check that a message really came from PayPal.');
    default:
      return field.help?.fallback ?? null;
  }
}

function refusalSentence(reason: SaveRefusal): string {
  switch (reason) {
    case 'SECRET_KEY':
      return t('studio:payments.refused.secretKey', 'This is a secret key (sk_). Stripe asks plugins not to use them. Make a restricted key instead.');
    case 'PUBLISHABLE_KEY':
      return t('studio:payments.refused.publishableKey', 'This is a publishable key (pk_). Paste the restricted key (rk_) instead.');
    case 'WEBHOOK_SECRET_IN_KEY_FIELD':
      return t('studio:payments.refused.webhookSecretInKey', 'This is a webhook secret (whsec_). It goes in the webhook card below.');
    case 'KEY_IN_SECRET_FIELD':
      return t('studio:payments.refused.keyInSecret', 'This is a key, not a signing secret. Paste the secret that starts with whsec_ from the endpoint’s page.');
    case 'LIVE_KEY_IN_TEST_FIELD':
      return t('studio:payments.refused.liveInTest', 'This is a live key. This field is for the test key.');
    case 'TEST_KEY_IN_LIVE_FIELD':
      return t('studio:payments.refused.testInLive', 'This is a test key. This field is for the live key.');
    case 'NOT_A_RESTRICTED_KEY':
      return t('studio:payments.refused.notRestricted', 'This is not a restricted key. It starts with rk_test_ or rk_live_.');
    case 'NOT_A_SIGNING_SECRET':
      return t('studio:payments.refused.notSigningSecret', 'This is not a signing secret. It starts with whsec_.');
    case 'HAS_SPACES':
      return t('studio:payments.refused.hasSpaces', 'There is a space or a line break inside what you pasted. Paste one value only.');
    case 'EMPTY':
      return t('studio:payments.refused.empty', 'Paste a value first.');
    case 'network-off':
      return t('studio:payments.refused.networkOff', 'This server is set to work without the internet, so no payment service can be connected.');
    case 'desktop':
      return t('studio:payments.refused.desktop', 'The desktop app takes payments by hand only: customers cannot reach this computer.');
  }
}

function errorText(error: unknown): string {
  const reason = saveRefusalOf(error);
  if (reason !== null) return refusalSentence(reason);
  if (error instanceof ApiError) return error.message;
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

const when = (at: number) => formatRelativeTime(new Date(at).toISOString());

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      iconLeft={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? t('studio:payments.copied', 'Copied') : t('studio:payments.copy', 'Copy')}
    </Button>
  );
}

// ─── The reachability card ──────────────────────────────────────────────────

function ReachabilityCard({ reach, onOpenSettings, onCheckAgain, checking }: { reach: Reachability; onOpenSettings: () => void; onCheckAgain: () => void; checking: boolean }) {
  const ok = reach.state === 'reachable';
  return (
    <Card data-testid="payments-reach" data-state={reach.state}>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={<Globe />} tone={reachTone(reach.state)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:payments.reach.heading', 'Can customers reach this server?')}</h2>
        </div>
        <Badge tone={reachTone(reach.state)}>{reachBadge(reach.state)}</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 text-[13px]">
        {ok ? (
          <>
            <p data-testid="payments-reach-ok">
              {t('studio:payments.reach.ok', 'Customers can reach this server.')}
            </p>
            <p className="text-fg-muted">
              {t('studio:payments.reach.address', "This server's public address:")}{' '}
              <span dir="ltr" className="font-mono">
                {reach.origin}
              </span>{' '}
              <Button variant="link" size="sm" onClick={onOpenSettings}>
                {t('studio:payments.reach.change', 'Change')}
              </Button>
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold" data-testid="payments-reach-problem">
              {reachProblem(reach.state)}
            </p>
            <p className="text-fg-muted">
              {t('studio:payments.reach.current', 'Current value')}:{' '}
              <span dir="ltr" className="font-mono">
                {reach.state === 'network-off' ? 'ADMINIUM_NETWORK_FEATURES=off' : (reach.origin ?? t('studio:payments.reach.notSetValue', 'not set'))}
              </span>
            </p>
            <p>
              <span className="font-semibold">{t('studio:payments.reach.fixLabel', 'Fix:')}</span> {reachFix(reach.state)}
            </p>
            <p className="text-fg-muted">
              {t('studio:payments.reach.still', 'Still works here: ways to pay by hand, recording payments, the card-terminal record.')}
            </p>
            <div className="flex flex-wrap gap-2">
              {reach.state === 'not-set' ? (
                <Button onClick={onOpenSettings}>{t('studio:payments.reach.setAddress', 'Set the address')}</Button>
              ) : (
                <Button variant="secondary" disabled={checking} onClick={onCheckAgain}>
                  {t('studio:payments.reach.checkAgain', 'Check again')}
                </Button>
              )}
            </div>
          </>
        )}
        {reach.notPort443 ? (
          <Alert
            tone="warn"
            data-testid="payments-reach-port"
            title={t('studio:payments.reach.portTitle', 'The address has a port')}
            body={t('studio:payments.reach.portBody', 'PayPal only sends webhooks to port 443. Use an address without a port.')}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}

// ─── One field ──────────────────────────────────────────────────────────────

function FieldRow({ service, mode, field, canManage }: { service: ServiceView; mode: PaymentMode; field: FieldView; canManage: boolean }) {
  const client = useQueryClient();
  const provider = knownProvider(service.key);
  const [editing, setEditing] = useState(!field.set);
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => saveField(service.key, mode, field.key, value),
    onSuccess: async () => {
      setValue('');
      setEditing(false);
      await client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY });
    },
  });
  const id = `payments-${service.key}-${mode}-${field.key}`;
  const prompt = fieldPrompt(field, mode);
  const name = providerWord(provider, service.name);

  return (
    <div className="flex flex-col gap-2" data-testid={id}>
      <label htmlFor={id} className="text-[12.5px] font-semibold">
        {fieldLabel(field, mode)}
      </label>
      {field.set && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="size-4 text-fg-muted" aria-hidden="true" />
          <span dir="ltr" className="font-mono text-[12.5px]" data-testid={`${id}-hint`}>
            {field.hint}
          </span>
          {field.setAt !== null ? (
            <span className="text-[12px] text-fg-muted">{t('studio:payments.field.savedWhen', 'Saved {when}', { when: when(field.setAt) })}</span>
          ) : null}
          {canManage ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t('studio:payments.field.replace', 'Replace')}
            </Button>
          ) : null}
        </div>
      ) : canManage ? (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            className="min-w-[180px] flex-1 font-mono"
            value={value}
            aria-invalid={save.isError ? 'true' : 'false'}
            aria-describedby={`${id}-note`}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" disabled={save.isPending || value.trim() === ''}>
            {field.webhook ? t('studio:payments.field.save', 'Save') : t('studio:payments.field.checkAndSave', 'Check and save')}
          </Button>
          {field.set ? (
            <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
              {t('studio:payments.field.cancel', 'Cancel')}
            </Button>
          ) : null}
        </form>
      ) : (
        <p className="text-[12.5px] text-fg-muted">{t('studio:payments.field.notSet', 'Not set')}</p>
      )}
      <p id={`${id}-note`} className="text-[12.5px]" role={save.isError ? 'alert' : undefined}>
        {save.isPending ? (
          <span className="text-fg-muted">
            {field.webhook ? t('studio:payments.field.saving', 'Saving…') : t('studio:payments.field.checking', 'Checking with {provider}…', { provider: name })}
          </span>
        ) : save.isError ? (
          <span className="font-semibold text-danger" data-testid={`${id}-error`}>
            {errorText(save.error)}
          </span>
        ) : editing && canManage && prompt !== null ? (
          <span className="text-fg-muted">{prompt}</span>
        ) : null}
      </p>
    </div>
  );
}

// ─── One mode of one service ────────────────────────────────────────────────

function CheckLine({ service, mode, view }: { service: ServiceView; mode: PaymentMode; view: ModeView }) {
  const provider = knownProvider(service.key);
  const name = providerWord(provider, service.name);
  const check = view.check;
  if (check === null) return null;
  if (check.ok && check.missing.length > 0) {
    return (
      <Alert
        tone="warn"
        icon={<ShieldAlert />}
        data-testid={`payments-${service.key}-${mode}-missing`}
        title={t('studio:payments.check.missing', '{provider} says this key is missing: {list}. Edit the key in {provider} and paste it again.', {
          provider: name,
          list: check.missing.join(', '),
        })}
      />
    );
  }
  if (check.ok) {
    return (
      <p className="text-[12.5px] text-fg-muted" data-testid={`payments-${service.key}-${mode}-checked`}>
        {t('studio:payments.check.ok', '{provider} accepted this key. Checked {when}.', { provider: name, when: when(check.at) })}
      </p>
    );
  }
  if (check.code === 'CREDENTIALS_REFUSED' || check.code === 'PERMISSION_MISSING') return null;
  return (
    <Alert
      tone="danger"
      data-testid={`payments-${service.key}-${mode}-refused`}
      title={t('studio:payments.check.failed', '{provider} could not check this key.', { provider: name })}
      body={check.message ?? undefined}
    />
  );
}

function WebhookCard({ service, mode, view, canManage }: { service: ServiceView; mode: PaymentMode; view: ModeView; canManage: boolean }) {
  const provider = knownProvider(service.key);
  const name = providerWord(provider, service.name);
  const fields = view.fields.filter((field) => field.webhook);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4" aria-labelledby={`wh-${service.key}-${mode}`} data-testid={`payments-${service.key}-${mode}-webhook`}>
      <h4 id={`wh-${service.key}-${mode}`} className="text-[13px] font-bold">
        {provider === 'stripe' ? t('studio:payments.webhook.headingStripe', 'Webhook (Stripe calls it a webhook endpoint)') : t('studio:payments.webhook.heading', 'Webhook')}
      </h4>
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold">{t('studio:payments.webhook.address', 'Address')}</span>
        {view.webhookUrl === null ? (
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.webhook.noAddress', 'This server needs a public address first.')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="break-all font-mono text-[12.5px]">
              {view.webhookUrl}
            </span>
            <CopyButton text={view.webhookUrl} label={t('studio:payments.webhook.copyAddress', 'Copy the webhook address')} />
          </div>
        )}
      </div>
      {service.webhookEvents.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold">{t('studio:payments.webhook.events', 'Tick these events in {provider}', { provider: name })}</span>
          <ul className="flex flex-col gap-1">
            {service.webhookEvents.map((event) => (
              <li key={event} className="flex items-center gap-2">
                <span dir="ltr" className="font-mono text-[12.5px]">
                  {event}
                </span>
                <CopyButton text={event} label={t('studio:payments.webhook.copyEvent', 'Copy {event}', { event })} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {provider === 'stripe' ? (
        <p className="text-[12.5px]">{t('studio:payments.webhook.snapshot', 'Choose the Snapshot payload.')}</p>
      ) : null}
      {fields.map((field) => (
        <FieldRow key={`${field.key}-${String(field.set)}`} service={service} mode={mode} field={field} canManage={canManage} />
      ))}
      {provider === 'stripe' ? (
        <p className="text-[12px] text-fg-muted">{t('studio:payments.webhook.stripeListen', 'The secret that stripe listen prints is a different one.')}</p>
      ) : null}
      <p className="text-[12.5px]" data-testid={`payments-${service.key}-${mode}-log`}>
        {view.firstEventAt !== null
          ? t('studio:payments.webhook.arrived', 'The first event arrived {when}, checked.', { when: when(view.firstEventAt) })
          : mode === 'live'
            ? t('studio:payments.webhook.noLiveEvent', 'No live event has arrived yet.')
            : t('studio:payments.webhook.nothing', 'Nothing has reached this address yet. If you made the endpoint, check that your proxy lets it through.')}
      </p>
    </section>
  );
}

function ModeSection({ service, mode, canManage }: { service: ServiceView; mode: PaymentMode; canManage: boolean }) {
  const client = useQueryClient();
  const view = service[mode];
  const keyFields = view.fields.filter((field) => !field.webhook);
  const recheck = useMutation({
    mutationFn: () => checkKeys(service.key, mode),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY }),
  });
  const allSet = keyFields.length > 0 && keyFields.every((field) => field.set);
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`mode-${service.key}-${mode}`} data-testid={`payments-${service.key}-${mode}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`mode-${service.key}-${mode}`} className="text-[13px] font-bold">
          {mode === 'test' ? t('studio:payments.mode.test', 'Test') : t('studio:payments.mode.live', 'Live')}
        </h3>
        {view.accountId !== null ? (
          <span dir="ltr" className="font-mono text-[12px] text-fg-muted">
            {view.accountId}
          </span>
        ) : null}
        {canManage && allSet ? (
          <Button variant="secondary" size="sm" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
            {t('studio:payments.check.again', 'Check')}
          </Button>
        ) : null}
      </div>
      {keyFields.map((field) => (
        <FieldRow key={`${field.key}-${String(field.set)}`} service={service} mode={mode} field={field} canManage={canManage} />
      ))}
      {recheck.isError ? <Alert tone="danger" role="alert" title={errorText(recheck.error)} /> : null}
      <CheckLine service={service} mode={mode} view={view} />
      <WebhookCard service={service} mode={mode} view={view} canManage={canManage} />
    </section>
  );
}

// ─── The way a Stripe key is made ───────────────────────────────────────────

const STRIPE_ACCESS: readonly { access: string; why: () => string }[] = [
  { access: 'Checkout Sessions: write', why: () => t('studio:payments.access.sessionsWrite', 'Start a payment and end one that is no longer needed') },
  { access: 'Checkout Sessions: read', why: () => t('studio:payments.access.sessionsRead', 'See how a payment ended') },
  { access: 'PaymentIntents: read', why: () => t('studio:payments.access.intentsRead', 'See the amount taken') },
  { access: 'Charges and Refunds: write', why: () => t('studio:payments.access.refundsWrite', 'Give refunds (in Stripe this access also allows changing charges)') },
  { access: 'Events: read', why: () => t('studio:payments.access.eventsRead', 'Catch a payment whose webhook went missing') },
  { access: 'Disputes: read', why: () => t('studio:payments.access.disputesRead', 'Show disputes') },
  { access: 'Payment Method Configurations: read', why: () => t('studio:payments.access.methodsRead', 'See which ways to pay you switched on') },
  { access: 'Accounts: read', why: () => t('studio:payments.access.accountRead', 'Show which Stripe account the key belongs to') },
  { access: 'Webhook endpoints: read (optional)', why: () => t('studio:payments.access.webhooksRead', 'Check your live webhook') },
];

function PathChooser({ service, canManage }: { service: ServiceView; canManage: boolean }) {
  const client = useQueryClient();
  const pick = useMutation({
    mutationFn: (path: 'app' | 'by-hand') => choosePath(service.key, path),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY }),
  });
  const guide =
    service.path === 'app'
      ? [
          t('studio:payments.path.app.step1', 'Install Node.js 22 or later'),
          t('studio:payments.path.app.step2', 'Install the Stripe CLI'),
          'stripe login',
          'stripe plugin install apps',
          t('studio:payments.path.app.step5', 'Unzip the template and open its folder'),
          'stripe apps upload',
          t('studio:payments.path.app.step7', 'Install the app in the Stripe dashboard and copy its key'),
        ]
      : service.path === 'by-hand'
        ? [
            t('studio:payments.path.hand.step1', 'In the Stripe dashboard, open Developers → API keys'),
            t('studio:payments.path.hand.step2', 'Choose “Create restricted key”'),
            t('studio:payments.path.hand.step3', 'Name it Adminium'),
            t('studio:payments.path.hand.step4', 'Set the access in the list below. Leave everything else at None.'),
            t('studio:payments.path.hand.step5', 'Create the key and copy it'),
          ]
        : [];
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`path-${service.key}`} data-testid={`payments-${service.key}-path`}>
      <h3 id={`path-${service.key}`} className="text-[13px] font-bold">
        {stepLabel('path', knownProvider(service.key))}
      </h3>
      <RadioGroup
        value={service.path ?? ''}
        disabled={!canManage || pick.isPending}
        onValueChange={(next) => {
          if (next === 'app' || next === 'by-hand') pick.mutate(next);
        }}
      >
        <Radio
          value="app"
          label={t('studio:payments.path.app.title', 'With your own Stripe App (the way Stripe recommends)')}
          description={t('studio:payments.path.app.desc', 'You upload a small app to your own Stripe account once, using the Stripe command-line tool. It makes a key with exactly the access below.')}
        />
        <Radio
          value="by-hand"
          label={t('studio:payments.path.hand.title', 'By hand in the Stripe dashboard (no terminal)')}
          description={t('studio:payments.path.hand.desc', 'Make a restricted key yourself with the access below. Stripe prefers the app, but this works too.')}
        />
      </RadioGroup>
      {guide.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-[12.5px]" data-testid={`payments-${service.key}-guide`}>
          {guide.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {service.path === 'app' ? (
        <p className="text-[12.5px] text-fg-muted">{t('studio:payments.path.app.note', 'Upload once in your test account and once in your live account.')}</p>
      ) : null}
      <div className="flex flex-col gap-1">
        <h4 className="text-[12.5px] font-bold">{t('studio:payments.access.heading', 'The access the key needs')}</h4>
        <p className="text-[12.5px] text-fg-muted">{t('studio:payments.access.note', 'Both ways give the key exactly this. Leave everything else at None.')}</p>
        <table className="text-[12.5px]">
          <thead>
            <tr>
              <th className="py-1 pe-3 text-start font-semibold">{t('studio:payments.access.access', 'Access')}</th>
              <th className="py-1 text-start font-semibold">{t('studio:payments.access.why', 'Why')}</th>
            </tr>
          </thead>
          <tbody>
            {STRIPE_ACCESS.map((row) => (
              <tr key={row.access} className="border-t border-border">
                <td dir="ltr" className="py-1 pe-3 text-start font-mono">
                  {row.access}
                </td>
                <td className="py-1">{row.why()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── One service ────────────────────────────────────────────────────────────

function KeyAlarm({ service }: { service: ServiceView }) {
  const name = providerWord(knownProvider(service.key), service.name);
  const failed = [service.test.check, service.live.check].find((check) => check !== null && !check.ok && (check.code === 'CREDENTIALS_REFUSED' || check.code === 'PERMISSION_MISSING'));
  if (failed === undefined || failed === null) return null;
  return (
    <Alert
      tone="danger"
      role="alert"
      icon={<KeyRound />}
      data-testid={`payments-${service.key}-alarm`}
      title={
        failed.code === 'CREDENTIALS_REFUSED'
          ? t('studio:payments.alarm.refused', '{provider} refused the key. It may have been revoked, or the app uninstalled.', { provider: name })
          : t('studio:payments.alarm.permission', '{provider} refused the key: it is missing a permission.', { provider: name })
      }
      body={t('studio:payments.alarm.paused', 'Payments are paused until a working key is saved.')}
    />
  );
}

function StopSwitch({ service, canManage }: { service: ServiceView; canManage: boolean }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const toggle = useMutation({
    mutationFn: (stopped: boolean) => setStopped(service.key, stopped),
    onSuccess: async () => {
      setConfirming(false);
      await client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY });
    },
  });
  const id = `payments-${service.key}-stop`;
  return (
    <div className="flex flex-col gap-2" data-testid={id}>
      <div className="flex items-center gap-3">
        <Switch
          id={id}
          checked={service.stopped}
          disabled={!canManage || toggle.isPending}
          onCheckedChange={(next) => {
            if (next) setConfirming(true);
            else toggle.mutate(false);
          }}
        />
        <label htmlFor={id} className="text-[13px] font-semibold">
          {t('studio:payments.stop.label', 'Stop new payments')}
        </label>
      </div>
      <p className="text-[12.5px] text-fg-muted">
        {t('studio:payments.stop.desc', 'No new payments start. Adminium keeps the key to finish waiting payments and to give refunds.')}
      </p>
      <Modal open={confirming} onOpenChange={(open) => (open ? null : setConfirming(false))}>
        <ModalHeader title={t('studio:payments.stop.confirmTitle', 'Stop new payments?')} closeLabel={t('studio:payments.close', 'Close')} />
        <ModalBody>
          <p className="text-[13px]">
            {t('studio:payments.stop.confirmBody', 'Customers cannot start a payment with {service} until you turn this off again. Payments already on their way still finish, and refunds still work.', {
              service: service.name,
            })}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('studio:payments.stop.cancel', 'Keep taking payments')}
          </Button>
          <Button disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>
            {t('studio:payments.stop.confirm', 'Stop new payments')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function ServiceCard({ service, canManage, reachable, paypalConnected }: { service: ServiceView; canManage: boolean; reachable: boolean; paypalConnected: boolean }) {
  const provider = knownProvider(service.key);
  const progress = checklistProgress(service);
  const connects = connectsTo(provider);
  const icon = provider === 'paypal' ? <Wallet /> : <CreditCard />;
  return (
    <Card data-testid={`payments-service-${service.key}`}>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14.5px] font-bold">{service.name}</h2>
            <Badge tone={service.liveOn ? 'pos' : 'info'}>{service.liveOn ? t('studio:payments.mode.live', 'Live') : t('studio:payments.mode.test', 'Test')}</Badge>
            {service.stopped ? <Badge tone="warn">{t('studio:payments.stop.badge', 'New payments stopped')}</Badge> : null}
          </div>
          {connects !== null ? <p className="text-[12.5px] text-fg-muted">{connects}</p> : null}
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        {!reachable ? (
          <p className="text-[13px] text-fg-muted" data-testid={`payments-service-${service.key}-first`}>
            {t('studio:payments.service.first', 'Set this up first.')}
          </p>
        ) : (
          <>
            {!service.loaded ? (
              <Alert
                tone="warn"
                title={t('studio:payments.service.notLoaded', 'This add-on did not load, so its keys cannot be checked.')}
                body={t('studio:payments.service.notLoadedBody', 'A payment service loads only from a package Adminium can vouch for: one this build bundles, or one downloaded from the catalogue.')}
              />
            ) : null}
            <KeyAlarm service={service} />
            {provider === 'paypal' && paypalConnected ? (
              <p className="text-[12.5px] text-fg-muted">{t('studio:payments.service.paypalOnce', 'PayPal shows once: through this card, not on the Stripe page.')}</p>
            ) : null}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-bold">{t('studio:payments.checklist.heading', 'Setup checklist')}</span>
                <span className="text-[12.5px] text-fg-muted" data-testid={`payments-service-${service.key}-progress`}>
                  {t('studio:payments.checklist.progress', '{done} of {total} done · your progress is kept', progress)}
                </span>
              </div>
              <ol className="flex flex-col gap-1">
                {service.checklist.map((step, index) => (
                  <li key={step.step} className="flex items-center gap-2 text-[12.5px]">
                    <span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded-full bg-surface-3 text-[11px]">
                      {step.done ? <Check className="size-3" /> : index + 1}
                    </span>
                    <span>
                      {stepLabel(step.step, provider)}
                      {step.done ? <span className="sr-only"> · {t('studio:payments.checklist.done', 'done')}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {service.hasPaths ? <PathChooser service={service} canManage={canManage} /> : null}
            <ModeSection service={service} mode="test" canManage={canManage} />
            <ModeSection service={service} mode="live" canManage={canManage} />
            <StopSwitch service={service} canManage={canManage} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ─── The page ───────────────────────────────────────────────────────────────

export function PaymentsPage({ onOpenSettings }: PaymentsPageProps): ReactNode {
  const setup = useQuery(paymentsSetupQuery());
  const data = setup.data;
  const reachable = data?.reachability.state === 'reachable';
  const paypalConnected = (data?.services ?? []).some(
    (one) => knownProvider(one.key) === 'paypal' && [one.test.check, one.live.check].some((check) => check?.ok === true),
  ) && (data?.services ?? []).some((one) => knownProvider(one.key) === 'stripe' && [one.test.check, one.live.check].some((check) => check?.ok === true));

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:payments.title', 'Payments')}
        subtitle={t('studio:payments.subtitle', 'Take payments for invoices and other records. The money goes straight to your own Stripe or PayPal account; Adminium never holds it.')}
      />
      <Tabs defaultValue="setup">
        <TabsList aria-label={t('studio:payments.title', 'Payments')}>
          <TabsTrigger value="setup">{t('studio:payments.tab.setup', 'Setup')}</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="flex flex-col gap-5 pt-4">
          {setup.isPending ? (
            <div className="flex justify-center p-10">
              <Spinner size="md" />
            </div>
          ) : null}
          {setup.isError ? (
            <Alert
              tone="danger"
              role="alert"
              data-testid="payments-load-error"
              title={t('studio:payments.loadFailed', 'Payments could not be loaded')}
              body={
                setup.error instanceof ApiError && setup.error.status === 403
                  ? t('studio:payments.forbidden', 'Seeing payments needs the “Set up payments” or the “See payment activity” permission.')
                  : errorText(setup.error)
              }
            />
          ) : null}
          {data !== undefined ? (
            <>
              {!data.canManage ? (
                <Alert tone="info" data-testid="payments-view-only" title={t('studio:payments.viewOnly', 'You can see how payments are set up, but not change it.')} />
              ) : null}
              <ReachabilityCard
                reach={data.reachability}
                onOpenSettings={onOpenSettings}
                onCheckAgain={() => void setup.refetch()}
                checking={setup.isFetching}
              />
              {data.services.length === 0 ? (
                <Card data-testid="payments-no-services">
                  <CardBody className="text-[13px]">
                    {t('studio:payments.noServices', 'No payment service is installed. Install Card payments or Wallet payments from Add-ons, then set it up here.')}
                  </CardBody>
                </Card>
              ) : (
                data.services.map((service) => (
                  <ServiceCard key={service.key} service={service} canManage={data.canManage} reachable={reachable} paypalConnected={paypalConnected} />
                ))
              )}
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </PageSurface>
  );
}
