// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/payments` — where a shop sets up taking payments.
 *
 * Four tabs: Setup, Ways to pay, What can be paid and Pay page. Activity
 * joins them when it is built, never as a tab that opens onto nothing.
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
import { ArrowRight, Check, CircleCheck, Clock, Copy, CreditCard, Download, Ellipsis, ExternalLink, FileText, Globe, KeyRound, RotateCcw, ShieldAlert, TriangleAlert, Unplug, Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { ActivityTab } from './ActivityTab.js';
import { useActivityCount } from './activityApi.js';
import { PayablesTab } from './PayablesTab.js';
import { PayPageTab } from './PayPageTab.js';
import { WaysTab } from './WaysTab.js';
import {
  PAYMENTS_SETUP_QUERY_KEY,
  checkKeys,
  checklistProgress,
  choosePath,
  knownProvider,
  paymentsSetupQuery,
  saveField,
  saveRefusalOf,
  disconnectService,
  setLive,
  setStopped,
  startTestPayment,
  testPaymentQuery,
  type ChecklistStep,
  type FieldView,
  type KnownProvider,
  type ModeView,
  type MoneyAlarm,
  type PaymentMode,
  type Reachability,
  type StartedTestPayment,
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
  if (check.code === 'MODE_MISMATCH') {
    return (
      <Alert
        tone="danger"
        data-testid={`payments-${service.key}-${mode}-mode-mismatch`}
        title={
          mode === 'test'
            ? t('studio:payments.check.liveInTest', 'This key is for live payments, and this field is for the test key.')
            : t('studio:payments.check.testInLive', 'This key is for test payments, and this field is for the live key.')
        }
      />
    );
  }
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
      <div className="flex flex-col gap-1 text-[12.5px]" data-testid={`payments-${service.key}-${mode}-log`}>
        <p>
          {view.health?.lastEventAt != null
            ? t('studio:payments.webhook.last', 'Last event {when}, checked.', { when: when(view.health.lastEventAt) })
            : view.firstEventAt !== null
              ? t('studio:payments.webhook.arrived', 'The first event arrived {when}, checked.', { when: when(view.firstEventAt) })
              : mode === 'live'
                ? t('studio:payments.webhook.noLiveEvent', 'No live event has arrived yet.')
                : t('studio:payments.webhook.nothing', 'Nothing has reached this address yet. If you made the endpoint, check that your proxy lets it through.')}
        </p>
        {(view.health?.badThisHour ?? 0) > 0 ? (
          <p className="font-semibold text-danger" data-testid={`payments-${service.key}-${mode}-bad`}>
            {mode === 'live'
              ? t('studio:payments.webhook.badLive', '{count, plural, one {# event} other {# events}} arrived in the last hour but the signature did not match. Is this the secret from the endpoint page, for live mode?', { count: view.health?.badThisHour ?? 0 })
              : t('studio:payments.webhook.badTest', '{count, plural, one {# event} other {# events}} arrived in the last hour but the signature did not match. Is this the secret from the endpoint page, for test mode?', { count: view.health?.badThisHour ?? 0 })}
          </p>
        ) : null}
        {view.health?.caughtAt != null ? (
          <p className="text-warn" data-testid={`payments-${service.key}-${mode}-caught`}>
            {t('studio:payments.webhook.caught', 'Adminium found a payment {when} that no webhook had announced. The webhook is not reaching this server.', { when: when(view.health.caughtAt) })}
          </p>
        ) : null}
        {view.health?.slowed === true ? (
          <p className="text-fg-muted">{t('studio:payments.webhook.slowed', 'Adminium checks {provider} less often this month: it has used half of the reads {provider} allows.', { provider: name })}</p>
        ) : null}
        {movedFrom(view) !== null && view.webhookUrl !== null ? (
          <div className="flex flex-col gap-1 text-warn" data-testid={`payments-${service.key}-${mode}-moved`}>
            <p className="font-semibold">{t('studio:payments.webhook.moved', 'The webhook address changed. Update it at {provider}:', { provider: name })}</p>
            <div className="flex flex-wrap items-center gap-2 text-fg">
              <span dir="ltr" className="break-all font-mono text-[12.5px]">
                {view.webhookUrl}
              </span>
              <CopyButton text={view.webhookUrl} label={t('studio:payments.webhook.copyAddress', 'Copy the webhook address')} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Where the last event came, when that is no longer this mode's webhook address. */
function movedFrom(view: ModeView): string | null {
  const seen = view.health?.eventOrigin ?? null;
  if (seen === null || view.webhookUrl === null) return null;
  try {
    return new URL(view.webhookUrl).origin === seen ? null : seen;
  } catch {
    return null;
  }
}

// ─── Going live ─────────────────────────────────────────────────────────────

/** The live mode's state, and the switch that turns live payments on (it ends every test link). */
function LiveCard({ service, view, canManage }: { service: ServiceView; view: ModeView; canManage: boolean }) {
  const client = useQueryClient();
  const name = providerWord(knownProvider(service.key), service.name);
  const toggle = useMutation({
    mutationFn: (on: boolean) => setLive(service.key, on),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY }),
  });
  const box = (tone: 'pos' | 'warn' | 'info', title: string, body: string | null, testid: string) => (
    <div
      role="status"
      data-testid={testid}
      className={`flex flex-col gap-1 rounded-md border p-3 text-[12.5px] ${tone === 'pos' ? 'border-pos/30 bg-pos-soft' : tone === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-info/30 bg-info-soft'}`}
    >
      <p className="text-[13px] font-bold">{title}</p>
      {body === null ? null : <p className="text-fg-muted">{body}</p>}
    </div>
  );
  let state: ReactNode;
  if (!service.liveOn) {
    if (view.check?.ok !== true) return null;
    state = box('info', t('studio:payments.live.ready', 'The live key works'), t('studio:payments.live.readyBody', 'Turning on live payments sends customers to real payments. Every test link stops working then.'), `payments-${service.key}-live-ready`);
  } else if (view.firstPaymentAt !== null) {
    state = box('pos', t('studio:payments.live.on', 'Live is on'), t('studio:payments.live.firstPayment', 'First live payment arrived {when}', { when: when(view.firstPaymentAt) }), `payments-${service.key}-live-on`);
  } else if (view.firstEventAt !== null) {
    state = box('pos', t('studio:payments.live.on', 'Live is on'), null, `payments-${service.key}-live-on`);
  } else {
    state = box('warn', t('studio:payments.live.unproven', 'Live is on, but the webhook is not proven yet.'), t('studio:payments.live.unprovenBody', 'Adminium checks {provider} more often until the first live event arrives.', { provider: name }), `payments-${service.key}-live-unproven`);
  }
  return (
    <div className="flex flex-col gap-2">
      {state}
      {canManage ? (
        <div>
          {service.liveOn ? (
            <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(false)} data-testid={`payments-${service.key}-live-off`}>
              {t('studio:payments.live.turnOff', 'Turn off live payments')}
            </Button>
          ) : (
            <Button disabled={toggle.isPending} onClick={() => toggle.mutate(true)} data-testid={`payments-${service.key}-live-turn-on`}>
              {t('studio:payments.live.turnOn', 'Turn on live payments')}
            </Button>
          )}
        </div>
      ) : null}
      {toggle.isError ? <Alert tone="danger" role="alert" title={errorText(toggle.error)} /> : null}
    </div>
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
      {mode === 'test' && canManage && view.check?.ok === true ? <TestPaymentCard service={service} /> : null}
      {mode === 'live' ? <LiveCard service={service} view={view} canManage={canManage} /> : null}
    </section>
  );
}

// ─── Send a test payment ────────────────────────────────────────────────────

function testAmount(amount: string, currency: string): string {
  try {
    const decimals = (amount.split('.')[1] ?? '').length;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals, numberingSystem: 'latn' }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

/** A pretend invoice of one unit, paid on the real pay page in a new tab, and the round trip shown here. */
function TestPaymentCard({ service }: { service: ServiceView }) {
  const provider = knownProvider(service.key);
  const [started, setStarted] = useState<StartedTestPayment | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const trip = useQuery(testPaymentQuery(started?.rowKey ?? null));
  const name = providerWord(provider, service.name);

  async function send(): Promise<void> {
    setFailed(null);
    // Opened at once, so no pop-up blocker takes it for an unasked window.
    const opened = window.open('about:blank', '_blank');
    try {
      const made = await startTestPayment(service.key);
      setStarted(made);
      if (opened === null) window.open(made.url, '_blank');
      else opened.location.href = made.url;
    } catch (error) {
      opened?.close();
      setFailed(errorText(error));
    }
  }

  const data = trip.data;
  const done = data?.recorded === true;
  const amount = started === null ? testAmount('1.00', 'EUR') : testAmount(started.amount, started.currency);
  return (
    <div className="flex flex-col gap-3" data-testid={`payments-${service.key}-test-payment`}>
      <div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="min-w-[240px] max-w-full flex-1">
          <h4 className="text-[14px] font-bold">{t('studio:payments.test.title', 'Send a test payment')}</h4>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:payments.test.intro', 'Opens the pay page for a pretend {amount} invoice in a new tab.', { amount })}</p>
        </div>
        <Button iconRight={<ExternalLink className="size-4" />} onClick={() => void send()} data-testid={`payments-${service.key}-test-send`}>
          {t('studio:payments.test.send', 'Send a test payment')}
        </Button>
      </div>
      {failed !== null ? <Alert tone="danger" role="alert" title={failed} /> : null}
      {started !== null && !done ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <Spinner size="sm" />
          <p className="min-w-[240px] flex-1 text-[13px]">
            {provider === 'paypal'
              ? t('studio:payments.test.waitingPaypal', 'Waiting for the payment on the pay page. A test payment needs a sandbox buyer login: Testing tools → Sandbox accounts on the PayPal developer site.')
              : t('studio:payments.test.waitingStripe', 'Waiting for the payment on the pay page. Use the Stripe test card {card}.', { card: '4242 4242 4242 4242' })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => window.open(started.url, '_blank')}>
            {t('studio:payments.test.again', 'Open the pay page again')}
          </Button>
        </div>
      ) : null}
      {data !== undefined && done ? (
        <div role="status" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-4 shadow-sm" data-testid={`payments-${service.key}-test-trip`}>
          <ol className="flex flex-wrap items-stretch gap-2">
            <li className="flex min-w-[170px] flex-1 items-start gap-2 rounded-md bg-pos-soft p-3 text-[13px]">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden="true" />
              <span>{t('studio:payments.test.took', '{service} took {amount} (Test)', { service: name, amount: testAmount(data.taken?.amount ?? data.amount, data.taken?.currency ?? data.currency) })}</span>
            </li>
            <li aria-hidden="true" className="flex items-center text-fg-subtle">
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            </li>
            <li className={`flex min-w-[170px] flex-1 items-start gap-2 rounded-md p-3 text-[13px] ${data.webhookArrived ? 'bg-pos-soft' : 'bg-warn-soft'}`}>
              {data.webhookArrived ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />}
              <span>{data.webhookArrived ? t('studio:payments.test.webhook', 'the webhook arrived') : t('studio:payments.test.noWebhook', 'no webhook arrived: the payment was found by asking')}</span>
            </li>
            <li aria-hidden="true" className="flex items-center text-fg-subtle">
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            </li>
            <li className="flex min-w-[240px] flex-[1.6] items-start gap-2 rounded-md border border-dashed border-border-strong bg-surface-2 p-3 text-[13px]">
              <FileText className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden="true" />
              <span>
                {data.paidWith === null
                  ? t('studio:payments.test.wouldRecord', 'this is what would be recorded: one payment of {amount}.', { amount: testAmount(data.taken?.amount ?? data.amount, data.currency) })
                  : t('studio:payments.test.wouldRecordWith', 'this is what would be recorded: one payment of {amount}, {paidWith}.', { amount: testAmount(data.taken?.amount ?? data.amount, data.currency), paidWith: data.paidWith })}
              </span>
            </li>
          </ol>
          <p className="text-[12.5px] font-semibold text-fg-muted">{t('studio:payments.test.nothingWritten', 'Nothing was written to your tables.')}</p>
        </div>
      ) : null}
    </div>
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
        aria-labelledby={`path-${service.key}`}
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
      {pick.isError ? <Alert tone="danger" role="alert" title={errorText(pick.error)} data-testid={`payments-${service.key}-path-error`} /> : null}
      {guide.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-[12.5px]" data-testid={`payments-${service.key}-guide`}>
          {guide.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {service.path === 'app' ? (
        <>
          {canManage ? (
            <div>
              {/* The zip is this install's own app: its id is made once and kept, so every download is the same app. */}
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download className="size-4" />}
                onClick={() => window.location.assign(`/api/v1/payments/services/${encodeURIComponent(service.key)}/key-app`)}
                data-testid={`payments-${service.key}-key-app`}
              >
                {t('studio:payments.path.app.download', 'Download the app template')}
              </Button>
            </div>
          ) : null}
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.path.app.note', 'Upload once in your test account and once in your live account.')}</p>
        </>
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
      {toggle.isError && !confirming ? <Alert tone="danger" role="alert" title={errorText(toggle.error)} data-testid={`${id}-error`} /> : null}
      <Modal open={confirming} onOpenChange={(open) => (open ? null : setConfirming(false))}>
        <ModalHeader title={t('studio:payments.stop.confirmTitle', 'Stop new payments?')} closeLabel={t('studio:payments.close', 'Close')} />
        <ModalBody>
          <p className="text-[13px]">
            {t('studio:payments.stop.confirmBody', 'Customers cannot start a payment with {service} until you turn this off again. Payments already on their way still finish, and refunds still work.', {
              service: service.name,
            })}
          </p>
          {toggle.isError ? <Alert tone="danger" role="alert" title={errorText(toggle.error)} /> : null}
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

// ─── Disconnect ─────────────────────────────────────────────────────────────

/** Stop new payments (the key stays to finish and refund), or remove the keys from this server. */
function DisconnectDialog({ service, open, onClose }: { service: ServiceView; open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const name = providerWord(knownProvider(service.key), service.name);
  const [choice, setChoice] = useState<'stop' | 'remove'>('stop');
  const [settle, setSettle] = useState(false);
  const waiting = service.waiting ?? 0;
  const refundable = service.refundable ?? 0;
  const run = useMutation({
    mutationFn: () => disconnectService(service.key, choice, settle),
    onSuccess: async () => {
      onClose();
      await client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY });
    },
  });
  const blocked = choice === 'remove' && waiting > 0 && !settle;
  return (
    <Modal open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <ModalHeader title={t('studio:payments.disconnect.title', 'Disconnect {provider}?', { provider: name })} closeLabel={t('studio:payments.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4">
        {waiting > 0 || refundable > 0 ? (
          <ul className="flex flex-col gap-1 text-[13px]" data-testid={`payments-${service.key}-disconnect-counts`}>
            {waiting > 0 ? <li>{t('studio:payments.disconnect.waiting', '{count, plural, one {# payment is} other {# payments are}} still waiting for the bank', { count: waiting })}</li> : null}
            {refundable > 0 ? <li>{t('studio:payments.disconnect.refundable', '{count, plural, one {# payment} other {# payments}} can still be refunded', { count: refundable })}</li> : null}
          </ul>
        ) : null}
        <RadioGroup aria-label={t('studio:payments.disconnect.choice', 'What to do')} value={choice} onValueChange={(next) => (next === 'stop' || next === 'remove' ? setChoice(next) : null)}>
          <Radio
            value="stop"
            label={t('studio:payments.disconnect.stop', 'Stop new payments')}
            description={t('studio:payments.disconnect.stopBody', 'No new payments start. Adminium keeps the key to finish the waiting payments and to give refunds.')}
          />
          <Radio
            value="remove"
            label={t('studio:payments.disconnect.remove', 'Remove keys')}
            description={t('studio:payments.disconnect.removeBody', 'Deletes the {provider} keys from this server. Adminium can no longer finish payments or give refunds.', { provider: name })}
          />
        </RadioGroup>
        {choice === 'remove' && waiting > 0 ? (
          <div className="flex flex-col gap-2 rounded-md bg-warn-soft p-3 text-[12.5px]">
            <p>{t('studio:payments.disconnect.removeWaiting', '{count, plural, one {# payment is} other {# payments are}} still waiting for the bank. Remove the keys anyway? They will need settling by hand.', { count: waiting })}</p>
            <div className="flex items-center gap-2">
              <Checkbox id={`payments-${service.key}-settle`} checked={settle} onCheckedChange={(next) => setSettle(next === true)} />
              <label htmlFor={`payments-${service.key}-settle`} className="font-semibold">
                {t('studio:payments.disconnect.settle', 'Yes, remove the keys and settle {count, plural, one {the # payment} other {the # payments}} by hand', { count: waiting })}
              </label>
            </div>
          </div>
        ) : null}
        {choice === 'remove' ? (
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.disconnect.roll', 'Removing the key here does not cancel it at {provider}. To be safe, roll the key in your {provider} dashboard.', { provider: name })}</p>
        ) : null}
        {run.isError ? <Alert tone="danger" role="alert" title={errorText(run.error)} /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('studio:payments.disconnect.cancel', 'Cancel')}
        </Button>
        <Button variant={choice === 'remove' ? 'destructive' : 'primary'} disabled={blocked || run.isPending} onClick={() => run.mutate()} data-testid={`payments-${service.key}-disconnect-confirm`}>
          {choice === 'remove' ? t('studio:payments.disconnect.remove', 'Remove keys') : t('studio:payments.disconnect.stop', 'Stop new payments')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** The card's menu: check the saved keys again, and disconnect. */
function ServiceMenu({ service }: { service: ServiceView }) {
  const client = useQueryClient();
  const [disconnecting, setDisconnecting] = useState(false);
  const recheck = useMutation({
    mutationFn: async () => {
      for (const mode of ['test', 'live'] as const) {
        const keys = service[mode].fields.filter((field) => !field.webhook);
        if (keys.length > 0 && keys.every((field) => field.set)) await checkKeys(service.key, mode);
      }
    },
    onSettled: async () => client.invalidateQueries({ queryKey: PAYMENTS_SETUP_QUERY_KEY }),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('studio:payments.menuLabel', 'More for {service}', { service: service.name })} data-testid={`payments-${service.key}-menu`}>
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<RotateCcw className="size-4" />} disabled={recheck.isPending} onSelect={() => recheck.mutate()}>
            {t('studio:payments.menu.check', 'Check keys again')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Unplug className="size-4" />} destructive onSelect={() => setDisconnecting(true)} data-testid={`payments-${service.key}-disconnect`}>
            {t('studio:payments.menu.disconnect', 'Disconnect…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DisconnectDialog key={String(disconnecting)} service={service} open={disconnecting} onClose={() => setDisconnecting(false)} />
    </>
  );
}

/** Past a minute apart, signatures are near their five-minute limit: the server's clock needs setting. */
function ClockWarning({ service }: { service: ServiceView }) {
  const skew = service.clockSkewMs ?? null;
  if (skew === null || Math.abs(skew) <= 60_000) return null;
  const name = providerWord(knownProvider(service.key), service.name);
  return (
    <Alert
      tone="warn"
      icon={<Clock />}
      data-testid={`payments-${service.key}-clock`}
      title={t('studio:payments.clock.title', "This server's clock is {seconds} seconds off the {provider} clock.", { seconds: Math.round(Math.abs(skew) / 1000), provider: name })}
      body={t('studio:payments.clock.body', 'Set the server time automatically (NTP). Past five minutes, payment messages from {provider} are refused.', { provider: name })}
    />
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
        {canManage && reachable ? <ServiceMenu service={service} /> : null}
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
            <ClockWarning service={service} />
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

// ─── Where the money goes: the alarms ───────────────────────────────────────

function alarmTitle(alarm: MoneyAlarm, services: ServiceView[]): string {
  const service = services.find((one) => one.key === alarm.service);
  const provider = service === undefined ? (alarm.service ?? '') : providerWord(knownProvider(service.key), service.name);
  switch (alarm.what) {
    case 'account':
      return t('studio:payments.alarm.account', 'The {provider} account changed from {from} to {to} {when}, by {by}.', { provider, from: alarm.from ?? '', to: alarm.to ?? '', when: when(alarm.at), by: alarm.by });
    case 'bank':
      return t('studio:payments.alarm.bank', 'The bank details for bank transfers changed {when}, by {by}.', { when: when(alarm.at), by: alarm.by });
    case 'pay-address':
      return t('studio:payments.alarm.address', 'Your pay address changed from {from} to {to} {when}, by {by}. Update the webhook address at Stripe and PayPal.', { from: alarm.from ?? '', to: alarm.to ?? '', when: when(alarm.at), by: alarm.by });
  }
}

function AlarmsCard({ alarms, services }: { alarms: MoneyAlarm[]; services: ServiceView[] }) {
  if (alarms.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('studio:payments.alarm.heading', 'Where the money goes changed')} data-testid="payments-alarms">
      {alarms.map((alarm) => (
        <Alert
          key={`${alarm.what}-${String(alarm.at)}`}
          tone="warn"
          icon={<ShieldAlert />}
          data-testid={`payments-alarm-${alarm.what}`}
          title={alarmTitle(alarm, services)}
          body={t('studio:payments.alarm.emailed', 'Everyone who manages payments was emailed.')}
        />
      ))}
    </section>
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

  // Which tab: the one asked for in the address (the hub's "need a look" opens Activity), else Setup.
  const [tab, setTab] = useState<string>(() => (new URLSearchParams(window.location.search).get('tab') === 'activity' ? 'activity' : 'setup'));
  const shownTab = tab;
  const activityCount = useActivityCount(data !== undefined);

  // Every tab reads the setup first; while it is loading or has failed, each says so.
  const loadState = (tab: string): ReactNode =>
    setup.isPending ? (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    ) : setup.isError ? (
      <Alert
        tone="danger"
        role="alert"
        data-testid={tab === 'setup' ? 'payments-load-error' : `payments-load-error-${tab}`}
        title={t('studio:payments.loadFailed', 'Payments could not be loaded')}
        body={
          setup.error instanceof ApiError && setup.error.status === 403
            ? t('studio:payments.forbidden', 'Seeing payments needs the “Set up payments” or the “See payment activity” permission.')
            : errorText(setup.error)
        }
      />
    ) : null;

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:payments.title', 'Payments')}
        subtitle={t('studio:payments.subtitle', 'Take payments for invoices and other records. The money goes straight to your own Stripe or PayPal account; Adminium never holds it.')}
      />
      <Tabs value={shownTab} onValueChange={setTab}>
        <TabsList aria-label={t('studio:payments.title', 'Payments')}>
          <TabsTrigger value="setup">{t('studio:payments.tab.setup', 'Setup')}</TabsTrigger>
          <TabsTrigger value="ways">{t('studio:payments.tab.ways', 'Ways to pay')}</TabsTrigger>
          <TabsTrigger value="payables">{t('studio:payments.tab.payables', 'What can be paid')}</TabsTrigger>
          <TabsTrigger value="page">{t('studio:payments.tab.page', 'Pay page')}</TabsTrigger>
          <TabsTrigger value="activity" data-testid="payments-tab-activity">
            {t('studio:payments.tab.activity', 'Activity')}
            {activityCount > 0 ? (
              <span className="ms-1.5 rounded-full bg-surface-3 px-[7px] py-px font-mono text-[10.5px] font-bold text-fg-muted" data-testid="payments-activity-count">
                <span aria-hidden="true">{String(activityCount)}</span>
                <span className="sr-only">{t('studio:payments.activity.countLabel', '{count, plural, one {# needs a look} other {# need a look}}', { count: activityCount })}</span>
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="flex flex-col gap-5 pt-4">
          {loadState('setup')}
          {data !== undefined ? (
            <>
              {!data.canManage ? (
                <Alert tone="info" data-testid="payments-view-only" title={t('studio:payments.viewOnly', 'You can see how payments are set up, but not change it.')} />
              ) : null}
              <AlarmsCard alarms={data.alarms ?? []} services={data.services} />
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
        <TabsContent value="ways" className="pt-4">
          {data !== undefined ? <WaysTab services={data.services} canManage={data.canManage} /> : loadState('ways')}
        </TabsContent>
        <TabsContent value="payables" className="pt-4">
          {data !== undefined ? <PayablesTab canManage={data.canManage} /> : loadState('payables')}
        </TabsContent>
        <TabsContent value="page" className="pt-4">
          {data !== undefined ? <PayPageTab canManage={data.canManage} /> : loadState('page')}
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          {data !== undefined ? <ActivityTab services={data.services} canManage={data.canManage} onOpenSetup={() => setTab('setup')} /> : loadState('activity')}
        </TabsContent>
      </Tabs>
    </PageSurface>
  );
}
