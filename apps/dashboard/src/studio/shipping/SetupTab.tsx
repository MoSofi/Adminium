// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shipping → Setup (comp states S01–S04).
 *
 *  - S01: one card per app, with the carrier it ships with. A carrier cannot be
 *    picked until a check of its key has passed.
 *  - S02: the guide and the key form. Steps Adminium cannot know are never
 *    ticked. The shape of a key is a hint: the server decides.
 *  - S03: the five results of a check, each with Check again.
 *  - S04: a locked carrier takes no key and has no switch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CircleCheckBig, CircleX, CloudOff, FlaskConical, Hash, Info, KeyRound, Lock, Package, PlugZap, RefreshCw, Search, Store, Truck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, IconTile, Input, Modal, ModalBody, ModalFooter, ModalHeader, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { AddOnSettingDeclaration } from '../add-ons/addOnsApi.js';
import { SHIPPING_LINKS } from './shippingLinks.js';
import {
  SHIPPING_QUERY_KEY,
  checkCarrier,
  expectedFieldsOf,
  isNetworkOff,
  keyInUseOf,
  otherAccountOf,
  refusalCode,
  saveCarrierKey,
  setActiveCarrier,
  shippingStatusKey,
  shippingTrackingQuery,
  type CarrierView,
  type KeyInUse,
  type OtherAccount,
  type ShippingApp,
  type ShippingStatus,
} from './shippingApi.js';
import { OutLink, SHIPPO_KEY, carrierBadge, carrierLine, carrierName, carrierStateOf, mayPick, refusalWords, rovingNext, useShippingFormat } from './shippingWords.js';

const fieldCaption = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle';
/** A control that stays focusable so its reason can be read, and looks unavailable. */
const offLook = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

// ─── S01: which carrier an app ships with ───────────────────────────────────

function CarrierRow({
  carrier,
  active,
  tabStop,
  describedBy,
  rowRef,
  onChoose,
  onKey,
  onMore,
}: {
  carrier: CarrierView;
  active: boolean;
  tabStop: boolean;
  describedBy: string;
  rowRef: (element: HTMLDivElement | null) => void;
  onChoose: () => void;
  onKey: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onMore: () => void;
}) {
  const state = carrierStateOf(carrier);
  const badge = carrierBadge(state);
  const name = carrierName(carrier);
  const can = mayPick(carrier);
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-[12px] border-[1.5px] px-3.5 py-3 ${active ? 'border-accent bg-accent-soft-solid' : 'border-border bg-surface'}`}
      data-testid={`shipping-row-${carrier.key}`}
    >
      <div
        ref={rowRef}
        role="radio"
        aria-checked={active}
        aria-disabled={can ? undefined : true}
        aria-describedby={describedBy}
        tabIndex={tabStop ? 0 : -1}
        onClick={onChoose}
        onKeyDown={onKey}
        className={`flex min-h-11 min-w-[200px] flex-1 items-center gap-3 rounded-[8px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${can ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      >
        <span aria-hidden="true" className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-accent' : 'border-border-strong'}`}>
          <span className={`size-2 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold">{name}</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <div id={describedBy} className="mt-0.5 text-[12.5px] text-fg-muted">
            {carrierLine(state, name)}
          </div>
        </div>
      </div>
      <Button variant="secondary" size="sm" iconRight={<ArrowRight className="size-3.5 rtl:-scale-x-100" />} onClick={onMore} data-testid={`shipping-more-${carrier.key}`}>
        {carrier.locked ? t('studio:shipping.shipWith.whyDemo', "Why it's a demo") : t('studio:shipping.shipWith.connection', 'Connection')}
      </Button>
    </div>
  );
}

export function ShipWithCard({ app, status, onOpenCarrier }: { app: ShippingApp; status: ShippingStatus; onOpenCarrier: (carrier: string) => void }) {
  const client = useQueryClient();
  const ids = useId();
  const rows = useRef(new Map<string, HTMLDivElement>());
  const [focused, setFocused] = useState<string | null>(null);
  const pick = useMutation({
    mutationFn: (carrier: string) => setActiveCarrier(app, carrier),
    onSuccess: (data) => client.setQueryData(shippingStatusKey(app), data),
  });
  // A real carrier reads first, and a locked demo after it, as the comp draws them.
  const listed = [...status.carriers].sort((a, b) => Number(a.locked) - Number(b.locked));
  const keys = listed.map((carrier) => carrier.key);
  const tabStop = focused !== null && keys.includes(focused) ? focused : (status.activeCarrier ?? keys[0] ?? '');
  const active = status.carriers.find((carrier) => carrier.key === status.activeCarrier) ?? null;
  const choose = (carrier: CarrierView) => {
    if (carrier.key === status.activeCarrier || !mayPick(carrier) || pick.isPending) return;
    pick.mutate(carrier.key);
  };
  const failedOn = status.carriers.find((carrier) => carrier.key === pick.variables);

  return (
    <Card padded={false} aria-labelledby={`${ids}-name`} data-testid={`shipping-app-${app.installId}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone="neutral" icon={<Store />} />
        <div className="min-w-[180px] flex-1">
          <h2 id={`${ids}-name`} className="text-[14.5px] font-bold tracking-[-.01em]">
            <bdi>{app.name}</bdi>
            {app.connectionName !== null ? <bdi className="ms-2 text-[12px] font-medium text-fg-muted">{app.connectionName}</bdi> : null}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">{t('studio:shipping.shipWith.subtitle', 'Choose which add-on this app buys labels with. One is active at a time.')}</p>
        </div>
        <Badge tone={active === null ? 'neutral' : 'accent'} data-testid={`shipping-active-${app.installId}`}>
          {active === null ? t('studio:shipping.shipWith.noneActive', 'No carrier chosen') : t('studio:shipping.shipWith.active', 'Ships with {name}', { name: carrierName(active) })}
        </Badge>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div role="radiogroup" aria-label={t('studio:shipping.shipWith.group', 'Ship with')} className="flex flex-col gap-2">
          {listed.map((carrier) => (
            <CarrierRow
              key={carrier.key}
              carrier={carrier}
              active={carrier.key === status.activeCarrier}
              tabStop={carrier.key === tabStop}
              describedBy={`${ids}-${carrier.key}-line`}
              rowRef={(element) => {
                if (element === null) rows.current.delete(carrier.key);
                else rows.current.set(carrier.key, element);
              }}
              onChoose={() => choose(carrier)}
              onMore={() => onOpenCarrier(carrier.key)}
              onKey={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  choose(carrier);
                  return;
                }
                const next = rovingNext(event, keys, carrier.key);
                if (next === null) return;
                event.preventDefault();
                setFocused(next);
                rows.current.get(next)?.focus();
              }}
            />
          ))}
        </div>
        {pick.isError ? <Alert tone="danger" role="alert" title={refusalWords(pick.error, failedOn === undefined ? app.name : carrierName(failedOn))} /> : null}
        {active !== null ? <OrderPreview app={app} carrier={active} /> : null}
      </div>
    </Card>
  );
}

/** How the choice reads on an order. Drawn, not a control. */
function OrderPreview({ app, carrier }: { app: ShippingApp; carrier: CarrierView }) {
  const name = carrierName(carrier);
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-dashed border-border-strong bg-surface-2 p-3.5">
      <span className={fieldCaption}>{t('studio:shipping.preview.heading', 'How this reads on {app}', { app: app.name })}</span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-bold">
          <Truck aria-hidden="true" className="size-3.5" />
          {t('studio:shipping.shipWith.active', 'Ships with {name}', { name })}
        </span>
        <span className="min-w-[200px] flex-1 text-[12.5px] text-fg-muted">
          {carrier.locked
            ? t('studio:shipping.preview.demo', "Demo only. Book on DHL's own site, then type the tracking number here.")
            : t('studio:shipping.preview.real', 'Staff choose from the rates {carrier} returns, then press Book this label.', { carrier: name })}
        </span>
        <span aria-hidden="true" className="inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-3.5 py-2 text-[12.5px] font-bold text-accent-fg opacity-85">
          {carrier.locked ? <Hash className="size-3.5" /> : <Search className="size-3.5" />}
          {carrier.locked ? t('studio:shipping.preview.addTracking', 'Add tracking number') : t('studio:shipping.preview.getRates', 'Get rates')}
        </span>
      </div>
    </div>
  );
}

// ─── S04: a locked carrier ──────────────────────────────────────────────────

export function LockedCarrierCard({ app, status, carrier, onDone, onOpenCarrier }: { app: ShippingApp; status: ShippingStatus; carrier: CarrierView; onDone: () => void; onOpenCarrier: (carrier: string) => void }) {
  const client = useQueryClient();
  const ids = useId();
  const shippo = status.carriers.find((one) => one.key === SHIPPO_KEY && !one.locked) ?? null;
  const use = useMutation({
    mutationFn: (key: string) => setActiveCarrier(app, key),
    onSuccess: (data) => {
      client.setQueryData(shippingStatusKey(app), data);
      onDone();
    },
  });
  return (
    <Card padded={false} aria-labelledby={ids} data-testid="shipping-locked-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone="neutral" icon={<Truck />} />
        <div className="min-w-[160px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={ids} tabIndex={-1} data-shipping-focus className="text-[14px] font-bold outline-none">
              {carrier.key === 'shipping-dhl' ? 'DHL' : carrier.name}
            </h2>
            <Badge tone="neutral">
              <Lock aria-hidden="true" className="size-[11px]" />
              {t('studio:shipping.state.demo', 'Demo')}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">{t('studio:shipping.locked.subtitle', 'Demo add-on. Books no real labels.')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3.5 p-5">
        <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3">
          <Lock aria-hidden="true" className="mt-px size-[18px] shrink-0 text-fg-muted" />
          <p className="text-[13.5px] leading-[1.55]">
            {t('studio:shipping.locked.sentence', "Real DHL booking is not available yet. This add-on is a demo. To ship now, use Shippo, or book on DHL's own site and type the tracking number.")}
          </p>
        </div>
        {use.isError ? <Alert tone="danger" role="alert" title={refusalWords(use.error, 'Shippo')} /> : null}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          {shippo !== null ? (
            <Button
              className="min-h-11"
              disabled={use.isPending}
              iconRight={<ArrowRight className="size-3.5 rtl:-scale-x-100" />}
              onClick={() => {
                // Not picked until its check has passed: until then this leads to where that is done.
                if (mayPick(shippo)) use.mutate(shippo.key);
                else onOpenCarrier(shippo.key);
              }}
            >
              {t('studio:shipping.locked.useShippo', 'Ship with Shippo')}
            </Button>
          ) : null}
          <OutLink href={SHIPPING_LINKS.dhlSite}>{t('studio:shipping.link.dhlSite', "DHL's own site")}</OutLink>
        </div>
      </div>
    </Card>
  );
}

// ─── The key form ───────────────────────────────────────────────────────────

/** Asked of a key whose field names the add-on list could not give: the server answers with the real ones. */
const UNNAMED_FIELD = 'key';

function looksLikeShippoKey(value: string): boolean {
  return /^shippo_(live|test)_\S+$/.test(value.trim());
}

function KeyForm({
  app,
  carrier,
  declared,
  replacing,
  onSaved,
  onKeepCurrent,
  onKeyInUse,
}: {
  app: ShippingApp;
  carrier: CarrierView;
  declared: readonly AddOnSettingDeclaration[];
  replacing: boolean;
  onSaved: (data: ShippingStatus) => void;
  onKeepCurrent: () => void;
  onKeyInUse: (use: KeyInUse) => void;
}) {
  const ids = useId();
  const name = carrierName(carrier);
  const isShippo = carrier.key === SHIPPO_KEY;
  // Held only while the form needs it: dropped on every final answer, and with the form.
  const [values, setValues] = useState<Record<string, string>>({});
  const [names, setNames] = useState<readonly string[]>(() => (declared.length > 0 ? declared.map((field) => field.key) : [UNNAMED_FIELD]));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [emptyField, setEmptyField] = useState<string | null>(null);
  const [asking, setAsking] = useState<OtherAccount | null>(null);

  // A server's answer opens the account dialog, so it has no trigger to hand focus back to.
  const wasAsking = useRef(false);
  const firstField = `${ids}-${names[0] ?? ''}`;
  useEffect(() => {
    if (asking !== null) {
      wasAsking.current = true;
      return;
    }
    if (!wasAsking.current) return;
    wasAsking.current = false;
    const timer = window.setTimeout(() => document.getElementById(firstField)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [asking, firstField]);

  const labelOf = (field: string): string => {
    if (names.length === 1) return t('studio:shipping.key.label', '{carrier} API key', { carrier: name });
    return declared.find((one) => one.key === field)?.label?.fallback ?? field;
  };

  async function send(fields: Record<string, string>, confirm: boolean): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const data = await saveCarrierKey(app, carrier.key, fields, confirm);
      setValues({});
      setAsking(null);
      onSaved(data);
    } catch (error) {
      const other = otherAccountOf(error);
      if (other !== null) {
        // The one answer that keeps the key: the person is asked, and the same paste is sent again.
        setAsking(other);
        return;
      }
      setAsking(null);
      const expected = expectedFieldsOf(error);
      if (expected !== null && expected.length > 0 && names.length === 1 && names[0] === UNNAMED_FIELD && fields[UNNAMED_FIELD] !== undefined) {
        const pasted = fields[UNNAMED_FIELD];
        setNames(expected);
        if (expected.length === 1) {
          // The paste moves to its real field name: a confirmation below reads it from there.
          const named = { [expected[0]!]: pasted };
          setValues(named);
          await send(named, confirm);
          return;
        }
        setValues({});
        return;
      }
      const inUse = keyInUseOf(error);
      if (inUse !== null) {
        setValues({});
        onKeyInUse(inUse);
        return;
      }
      // A carrier that did not answer said nothing about the key, so the paste stays for Try again.
      const code = refusalCode(error);
      if (code !== 'CARRIER_UNAVAILABLE' && code !== 'CARRIER_BAD_ANSWER' && code !== null) setValues({});
      setProblem(refusalWords(error, name));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const missing = names.find((field) => (values[field] ?? '').trim() === '');
    if (missing !== undefined) {
      setEmptyField(missing);
      return;
    }
    setEmptyField(null);
    void send(Object.fromEntries(names.map((field) => [field, (values[field] ?? '').trim()])), false);
  }

  const firstValue = values[names[0] ?? ''] ?? '';
  const shapeHint = isShippo && names.length === 1 && firstValue.trim() !== '' && !looksLikeShippoKey(firstValue);

  return (
    <form className="flex flex-col gap-2" onSubmit={submit} data-testid="shipping-key-form" noValidate>
      {names.map((field, index) => {
        const inputId = `${ids}-${field}`;
        const noteId = `${inputId}-note`;
        const isEmpty = emptyField === field;
        return (
          <div key={field} className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[12.5px] font-bold">
              {labelOf(field)}
            </label>
            <Input
              id={inputId}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              dir="ltr"
              autoFocus={index === 0 && replacing}
              className="min-h-11 font-mono font-medium"
              placeholder={isShippo && names.length === 1 ? 'shippo_live_…' : undefined}
              value={values[field] ?? ''}
              aria-invalid={isEmpty || problem !== null ? 'true' : 'false'}
              aria-describedby={noteId}
              onChange={(event) => {
                const next = event.target.value;
                setValues((held) => ({ ...held, [field]: next }));
                setProblem(null);
                if (isEmpty) setEmptyField(null);
              }}
            />
            <span id={noteId} className="flex flex-col gap-0.5 text-[11.5px] text-fg-subtle">
              <span>{t('studio:shipping.key.hint', 'After saving, only the last four characters are shown.')}</span>
              {index === 0 && shapeHint ? (
                <span data-testid="shipping-key-shape">{t('studio:shipping.key.shape', 'This does not look like a Shippo key. They start with shippo_live_ or shippo_test_. Shippo decides when you save.')}</span>
              ) : null}
              {isEmpty ? (
                <span className="text-[12px] font-semibold text-danger" role="alert">
                  {t('studio:shipping.key.empty', 'Paste your {carrier} key.', { carrier: name })}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
      {problem !== null ? (
        <p role="alert" className="text-[12px] font-semibold text-danger" data-testid="shipping-key-error">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-11" disabled={busy} data-testid="shipping-key-save">
          {busy ? <Spinner size="sm" /> : null}
          {busy ? t('studio:shipping.key.saving', 'Checking with {carrier}…', { carrier: name }) : t('studio:shipping.key.save', 'Save key')}
        </Button>
        {replacing ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              setValues({});
              onKeepCurrent();
            }}
            data-testid="shipping-key-keep"
          >
            {t('studio:shipping.key.keep', 'Keep current key')}
          </Button>
        ) : null}
      </div>
      <Modal
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAsking(null);
            setValues({});
          }
        }}
      >
        <ModalHeader title={t('studio:shipping.other.title', 'This key opens a different {carrier} account', { carrier: name })} closeLabel={t('studio:shipping.close', 'Close')} />
        <ModalBody className="flex flex-col gap-3 text-[13px]" data-testid="shipping-other-account">
          <p>{t('studio:shipping.other.body', 'Labels bought from now on are billed to the new account. Labels already bought stay on the old one, and this key cannot reach them.')}</p>
          {asking?.fromHint != null ? (
            <p className="text-fg-muted">
              {t('studio:shipping.other.current', 'The key in use now ends in')}{' '}
              <span dir="ltr" className="font-mono font-medium">
                {asking.fromHint}
              </span>
            </p>
          ) : null}
          <p className="text-fg-muted">{t('studio:shipping.other.kept', 'Nothing has changed yet. The current key stays in force until you confirm.')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setAsking(null);
              setValues({});
            }}
          >
            {t('studio:shipping.key.keep', 'Keep current key')}
          </Button>
          <Button
            disabled={busy}
            data-testid="shipping-other-confirm"
            onClick={() => void send(Object.fromEntries(names.map((field) => [field, (values[field] ?? '').trim()])), true)}
          >
            {t('studio:shipping.other.confirm', 'Use the new account')}
          </Button>
        </ModalFooter>
      </Modal>
    </form>
  );
}

// ─── S03: what a check said ─────────────────────────────────────────────────

type Result = 'live' | 'test' | 'bad' | 'none' | 'no-answer' | 'network-off';
/** What the last check said that the saved account does not record. */
type Transient = 'bad' | 'no-answer' | 'network-off' | null;

function resultOf(carrier: CarrierView, transient: Transient): Result | null {
  if (transient !== null) return transient;
  const account = carrier.account;
  if (account === null) return null;
  if (account.state === 'refused') return 'bad';
  if (account.carriers.length === 0) return 'none';
  return account.mode;
}

function CheckAgain({ busy, onCheck, primary }: { busy: boolean; onCheck: () => void; primary?: boolean }) {
  return (
    <Button
      variant={primary === true ? 'primary' : 'secondary'}
      className="min-h-11"
      disabled={busy}
      aria-busy={busy}
      iconLeft={busy ? <Spinner size="sm" /> : <RefreshCw className="size-3.5" />}
      onClick={onCheck}
      data-testid="shipping-check-again"
    >
      {busy ? t('studio:shipping.check.busy', 'Checking…') : t('studio:shipping.check.again', 'Check again')}
    </Button>
  );
}

function ResultBox({ tone, icon, children }: { tone: 'pos' | 'warn' | 'danger' | 'neutral'; icon: ReactNode; children: ReactNode }) {
  const surface = { pos: 'bg-pos-soft', warn: 'bg-warn-soft', danger: 'bg-danger-soft', neutral: 'border border-border bg-surface-2' }[tone];
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 ${surface}`}>
      <span aria-hidden="true" className="shrink-0 [&_svg]:size-5">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

function CheckResult({
  result,
  carrier,
  status,
  busy,
  onCheck,
  onReplace,
  replaceLockId,
  onUse,
  useBusy,
}: {
  result: Result;
  carrier: CarrierView;
  status: ShippingStatus;
  busy: boolean;
  onCheck: () => void;
  onReplace: () => void;
  /** The id of the sentence saying why the key cannot change, while it cannot. */
  replaceLockId: string | null;
  onUse: () => void;
  useBusy: boolean;
}) {
  const format = useShippingFormat();
  const name = carrierName(carrier);
  const countryCode = status.shipFrom?.country ?? null;
  const country = countryCode === null ? null : format.country(countryCode);
  const carriers = format.list(carrier.account?.carriers ?? []);
  const isShippo = carrier.key === SHIPPO_KEY;
  const isActive = status.activeCarrier === carrier.key;
  const replaceProps = replaceLockId === null ? {} : { 'aria-disabled': true as const, 'aria-describedby': replaceLockId };

  if (result === 'live') {
    return (
      <ResultBox tone="pos" icon={<CircleCheckBig className="text-pos" />}>
        <p className="text-[14px] font-bold" data-testid="shipping-result-live">
          {country === null
            ? t('studio:shipping.check.liveNoCountry', 'Live key. These carriers answer: {list}.', { list: carriers })
            : t('studio:shipping.check.live', 'Live key. These carriers answer for {country}: {list}.', { country, list: carriers })}
        </p>
        {isActive ? (
          <p className="text-[12.5px] text-fg-muted">{t('studio:shipping.check.liveActive', 'Staff who may buy labels can now get rates on orders.')}</p>
        ) : (
          <>
            <p className="text-[12.5px] text-fg-muted">{t('studio:shipping.check.liveChoose', 'The key works. Choose {carrier} under Ship with to use it.', { carrier: name })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="min-h-11" disabled={useBusy} onClick={onUse} data-testid="shipping-use-carrier">
                {t('studio:shipping.check.useCarrier', 'Ship with {carrier}', { carrier: name })}
              </Button>
              <CheckAgain busy={busy} onCheck={onCheck} />
            </div>
          </>
        )}
        {isActive ? (
          <div className="mt-1">
            <CheckAgain busy={busy} onCheck={onCheck} />
          </div>
        ) : null}
      </ResultBox>
    );
  }

  if (result === 'test') {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-warn bg-warn-soft px-4 py-3.5" data-testid="shipping-result-test">
        <div className="flex items-start gap-2.5">
          <FlaskConical aria-hidden="true" className="size-5 shrink-0 text-warn" />
          <div className="flex flex-col gap-[3px]">
            <p className="text-[14px] font-extrabold">{t('studio:shipping.check.testTitle', 'Test key. Nothing will be delivered')}</p>
            <p className="text-[12.5px] text-fg-muted">
              {country === null
                ? t('studio:shipping.check.testBodyNoCountry', 'Labels bought with it are samples. No tracking number reaches an order or a customer. These carriers answer in test: {list}.', { list: carriers })
                : t('studio:shipping.check.testBody', 'Labels bought with it are samples. No tracking number reaches an order or a customer. These carriers answer for {country} in test: {list}.', { country, list: carriers })}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface p-3.5">
          <div>
            <div className={fieldCaption}>{t('studio:shipping.check.nextStep', 'Next step')}</div>
            <h3 className="mt-0.5 text-[14px] font-bold">{t('studio:shipping.check.goLive', 'Go live')}</h3>
          </div>
          <ol className="flex flex-col gap-2">
            {[
              t('studio:shipping.goLive.step1', 'In Shippo, open Settings, then API.'),
              t('studio:shipping.goLive.step2', 'Copy the live key. It starts with shippo_live_.'),
              t('studio:shipping.goLive.step3', 'Press Replace with a live key below and paste it.'),
              t('studio:shipping.goLive.step4', 'Check connection again.'),
            ].map((text, index) => (
              <li key={text} className="flex items-start gap-2.5">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[10.5px] font-semibold text-fg-muted">{format.number(index + 1)}</span>
                <span className="text-[13px] leading-normal">{text}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <Button className={`min-h-11 ${offLook}`} iconLeft={<KeyRound className="size-3.5" />} onClick={onReplace} data-testid="shipping-replace-live" {...replaceProps}>
              {t('studio:shipping.check.replaceLive', 'Replace with a live key')}
            </Button>
            <CheckAgain busy={busy} onCheck={onCheck} />
            {isShippo ? <OutLink href={SHIPPING_LINKS.api}>{t('studio:shipping.link.api', 'Shippo API settings')}</OutLink> : null}
          </div>
        </div>
      </div>
    );
  }

  if (result === 'bad') {
    return (
      <ResultBox tone="danger" icon={<CircleX className="text-danger" />}>
        <p className="text-[14px] font-bold" data-testid="shipping-result-bad">
          {t('studio:shipping.check.bad', '{carrier} did not accept this key.', { carrier: name })}
        </p>
        <p className="text-[12.5px] text-fg-muted">
          {isShippo
            ? t('studio:shipping.check.badBody', "Copy the key again from Shippo's API settings, with nothing before or after it. If the key was deleted in Shippo, create a new one and paste it here.")
            : t('studio:shipping.check.badBodyOther', 'Copy the key again, with nothing before or after it, and paste it here.')}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <Button className={`min-h-11 ${offLook}`} onClick={onReplace} data-testid="shipping-paste-new" {...replaceProps}>
            {t('studio:shipping.check.pasteNew', 'Paste a new key')}
          </Button>
          <CheckAgain busy={busy} onCheck={onCheck} />
          {isShippo ? <OutLink href={SHIPPING_LINKS.api}>{t('studio:shipping.link.api', 'Shippo API settings')}</OutLink> : null}
        </div>
      </ResultBox>
    );
  }

  if (result === 'none') {
    return (
      <ResultBox tone="warn" icon={<Truck className="text-warn" />}>
        <p className="text-[14px] font-bold" data-testid="shipping-result-none">
          {country === null
            ? t('studio:shipping.check.noneNoCountry', '{carrier} has no carrier on this account. Connect your own carrier account in {carrier}, then check again.', { carrier: name })
            : t('studio:shipping.check.none', '{carrier} has no carrier for {country} on this account. Connect your own carrier account in {carrier}, then check again.', { carrier: name, country })}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <CheckAgain busy={busy} onCheck={onCheck} />
          {isShippo ? <OutLink href={SHIPPING_LINKS.carriers}>{t('studio:shipping.link.carriers', 'Carrier accounts in Shippo')}</OutLink> : null}
        </div>
      </ResultBox>
    );
  }

  // Never reads as a bad key: nothing was learned about it.
  return (
    <ResultBox tone="neutral" icon={<CloudOff className="text-fg-muted" />}>
      <p className="text-[14px] font-bold" data-testid="shipping-result-no-answer">
        {result === 'network-off'
          ? t('studio:shipping.error.networkOff', 'This server is set to work without the internet, so no carrier can be asked.')
          : t('studio:shipping.check.noAnswer', '{carrier} did not answer. Try again.', { carrier: name })}
      </p>
      <p className="text-[12.5px] text-fg-muted">{t('studio:shipping.check.noAnswerBody', 'This says nothing about your key. It stays as it was.')}</p>
      <div className="mt-1">
        <CheckAgain busy={busy} onCheck={onCheck} />
      </div>
    </ResultBox>
  );
}

// ─── S02 and S03: one carrier's connection ──────────────────────────────────

export function KeyCarrierCard({
  app,
  status,
  carrier,
  declared,
  onOpenTracking,
}: {
  app: ShippingApp;
  status: ShippingStatus;
  carrier: CarrierView;
  declared: readonly AddOnSettingDeclaration[];
  onOpenTracking: () => void;
}) {
  const client = useQueryClient();
  const ids = useId();
  const format = useShippingFormat();
  const name = carrierName(carrier);
  const isShippo = carrier.key === SHIPPO_KEY;
  const [replaceOpen, setReplaceOpen] = useState(false);
  // A refusal that arrived before the status said so. The status is what normally holds the key.
  const [refusedLock, setRefusedLock] = useState<KeyInUse | null>(null);
  const [transient, setTransient] = useState<Transient>(null);

  const check = useMutation({
    mutationFn: () => checkCarrier(app, carrier.key),
    onMutate: () => setTransient(null),
    onSuccess: async (answer) => {
      setTransient(answer.outcome === 'unreachable' ? 'no-answer' : answer.outcome === 'refused' && carrier.account === null ? 'bad' : null);
      await client.invalidateQueries({ queryKey: shippingStatusKey(app) });
    },
    onError: (error) => {
      if (isNetworkOff(error)) setTransient('network-off');
      else if (refusalCode(error) === 'CARRIER_UNAVAILABLE' || refusalCode(error) === 'CARRIER_BAD_ANSWER') setTransient('no-answer');
    },
  });
  const use = useMutation({
    mutationFn: () => setActiveCarrier(app, carrier.key),
    onSuccess: (data) => client.setQueryData(shippingStatusKey(app), data),
  });
  // The server remembers that an address ended, so this holds on any visit.
  const tracking = useQuery({ ...shippingTrackingQuery(app, carrier.key), enabled: carrier.connected });
  const addressGone = tracking.data?.webhook.supported === true && tracking.data.webhook.ended && tracking.data.webhook.publicAddress;
  const keyLock = carrier.openBookings.count > 0 ? carrier.openBookings : refusedLock;
  const replacing = replaceOpen && keyLock === null;

  const hasKey = carrier.connected;
  const showForm = !hasKey || replacing;
  const result = resultOf(carrier, transient);
  const state = carrierStateOf(carrier);
  const badge = carrierBadge(state);
  const hint = carrier.account?.keyHint ?? null;
  const knownDone = (hasKey ? 1 : 0) + (carrier.account?.state === 'ok' ? 1 : 0);
  const checkedOk = carrier.account?.state === 'ok';

  const startReplace = () => {
    if (keyLock !== null) return;
    setReplaceOpen(true);
  };

  const lockNotice =
    keyLock === null ? null : (
      <div id={`${ids}-lock`} role="status" className="flex flex-col gap-1 text-[12px] text-fg-muted" data-testid="shipping-key-locked">
        <p>{t('studio:shipping.key.inUse', 'This key cannot change while a booking on it has no final answer.')}</p>
        {keyLock.orders.length > 0 ? (
          <p>
            {t('studio:shipping.key.inUseOrders', 'Orders:')}{' '}
            <span dir="ltr" className="font-mono font-medium text-fg">
              {format.list(keyLock.orders)}
            </span>
            {keyLock.count > keyLock.orders.length ? ` ${t('studio:shipping.key.inUseMore', 'and {count} more', { count: format.number(keyLock.count - keyLock.orders.length) })}` : ''}
          </p>
        ) : (
          <p data-testid="shipping-key-locked-unnamed">
            {t('studio:shipping.key.inUseUnnamed', '{count, plural, one {# booking holds it, on an order you cannot open here.} other {# bookings hold it, on orders you cannot open here.}}', { count: keyLock.count })}
          </p>
        )}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRefusedLock(null);
              void client.invalidateQueries({ queryKey: shippingStatusKey(app) });
            }}
          >
            {t('studio:shipping.key.tryAgain', 'Try again')}
          </Button>
        </div>
      </div>
    );

  const keyRow = (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] font-bold">{t('studio:shipping.key.label', '{carrier} API key', { carrier: name })}</span>
        <span dir="ltr" className="rounded-sm bg-surface-3 px-[9px] py-1 font-mono text-[12px] font-medium" data-testid="shipping-key-hint">
          {hint ?? '••••'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className={offLook}
          aria-disabled={keyLock !== null ? true : undefined}
          aria-describedby={keyLock !== null ? `${ids}-lock` : undefined}
          onClick={startReplace}
          data-testid="shipping-key-replace"
        >
          {t('studio:shipping.key.replace', 'Replace')}
        </Button>
      </div>
      {lockNotice}
    </div>
  );

  const keyForm = (
    <KeyForm
      app={app}
      carrier={carrier}
      declared={declared}
      replacing={replacing}
      onKeepCurrent={() => setReplaceOpen(false)}
      onKeyInUse={(inUse) => {
        setRefusedLock(inUse);
        setReplaceOpen(false);
        void client.invalidateQueries({ queryKey: shippingStatusKey(app) });
      }}
      onSaved={(data) => {
        client.setQueryData(shippingStatusKey(app), data);
        void client.invalidateQueries({ queryKey: [...SHIPPING_QUERY_KEY, 'tracking', app.installId] });
        setTransient(null);
        setRefusedLock(null);
        setReplaceOpen(false);
      }}
    />
  );

  // While a key cannot change, the form is not offered: the reason and the orders are.
  const form = keyLock !== null && !hasKey ? lockNotice : keyForm;

  const disclosure = (
    <p className="flex items-start gap-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] leading-normal">
      <Info aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-info" />
      <span>
        {isShippo
          ? t('studio:shipping.disclosure', 'Labels are bought on your Shippo account and billed to you. Customer names, addresses and, when a carrier needs it, phone numbers are sent to Shippo and the carrier.')
          : t('studio:shipping.disclosureOther', 'Labels are bought on your {carrier} account and billed to you. Customer names, addresses and, when a carrier needs it, phone numbers are sent to {carrier} and the carrier.', { carrier: name })}
        {status.international ? ` ${t('studio:shipping.disclosureCustoms', 'For parcels going abroad, goods descriptions and declared values also go to {carrier} and the carrier.', { carrier: name })}` : null}
      </span>
    </p>
  );

  const checkButton = (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <Button
        className={`min-h-11 ${offLook}`}
        aria-disabled={hasKey ? undefined : true}
        aria-busy={check.isPending}
        aria-describedby={hasKey ? undefined : `${ids}-why`}
        disabled={check.isPending}
        iconLeft={check.isPending ? <Spinner size="sm" /> : <PlugZap className="size-3.5" />}
        onClick={() => {
          if (hasKey) check.mutate();
        }}
        data-testid="shipping-check"
      >
        {check.isPending ? t('studio:shipping.check.busy', 'Checking…') : t('studio:shipping.check.button', 'Check connection')}
      </Button>
      {hasKey ? null : (
        <span id={`${ids}-why`} className="text-[12px] text-fg-muted">
          {t('studio:shipping.check.saveFirst', 'Save a key first.')}
        </span>
      )}
      {check.isError && transient === null ? (
        <p role="alert" className="basis-full text-[12px] font-semibold text-danger">
          {refusalWords(check.error, name)}
        </p>
      ) : null}
    </div>
  );

  const countryCode = status.shipFrom?.country ?? null;
  const steps: { title: string; body: string; link?: { href: string; label: string }; done: boolean; current: boolean; extra?: ReactNode }[] = isShippo
    ? [
        {
          title: t('studio:shipping.step.account', 'Create your Shippo account'),
          body: t('studio:shipping.step.accountBody', "Sign up on Shippo's site with the shop's own email. The account belongs to the shop, not to Adminium."),
          link: { href: SHIPPING_LINKS.signUp, label: t('studio:shipping.link.open', 'Open Shippo') },
          done: false,
          current: false,
        },
        {
          title: t('studio:shipping.step.payment', 'Add a payment method in Shippo'),
          body: t('studio:shipping.step.paymentBody', 'Shippo charges this card or bank account for every label you buy. Carriers can add charges later, for example for a heavier parcel.'),
          link: { href: SHIPPING_LINKS.billing, label: t('studio:shipping.link.billing', 'Shippo billing settings') },
          done: false,
          current: false,
        },
        {
          title: t('studio:shipping.step.key', 'Create an API key and paste it here'),
          body: t('studio:shipping.step.keyBody', 'In Shippo, open Settings, then API, and create a live key. Copy it and paste it below.'),
          link: { href: SHIPPING_LINKS.api, label: t('studio:shipping.link.api', 'Shippo API settings') },
          done: hasKey && !replacing,
          current: !hasKey || replacing,
          extra: (
            <div className="mt-1 flex flex-col gap-2.5">
              {disclosure}
              {showForm ? form : keyRow}
            </div>
          ),
        },
        {
          title: t('studio:shipping.step.check', 'Check connection'),
          body:
            countryCode === null
              ? t('studio:shipping.step.checkBodyNoCountry', 'Adminium asks Shippo which carriers answer for this shop.')
              : t('studio:shipping.step.checkBody', 'Adminium asks Shippo which carriers answer for {country}.', { country: format.country(countryCode) }),
          link: { href: SHIPPING_LINKS.carriers, label: t('studio:shipping.link.carriers', 'Carrier accounts in Shippo') },
          done: checkedOk && !replacing,
          current: hasKey && !checkedOk && !replacing,
          extra: checkButton,
        },
      ]
    : [];

  return (
    <Card padded={false} aria-labelledby={ids} data-testid={`shipping-carrier-${carrier.key}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone="neutral" icon={<Package />} />
        <div className="min-w-[160px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={ids} tabIndex={-1} data-shipping-focus className="text-[14px] font-bold outline-none">
              {name}
            </h2>
            <Badge tone={badge.tone} data-testid="shipping-carrier-badge">
              {badge.label}
            </Badge>
          </div>
          {isShippo ? <p className="mt-0.5 text-[11.5px] text-fg-subtle">{t('studio:shipping.shippo.subtitle', 'Labels from many carriers, on your own Shippo account')}</p> : null}
        </div>
      </div>

      {showForm || result === null ? (
        isShippo ? (
          <>
            <div className="flex flex-col gap-2.5 border-b border-border p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={fieldCaption}>{t('studio:shipping.step.heading', 'Setup checklist')}</span>
                {/* Counts only what Adminium can know: a key saved and a check passed. */}
                <span className="ms-auto font-mono text-[11.5px] font-medium text-fg-subtle" data-testid="shipping-known-count">
                  {t('studio:shipping.step.known', '{done} of {total} confirmed here', { done: format.number(knownDone), total: format.number(2) })}
                </span>
              </div>
              <ol className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
                {steps.map((step, index) => (
                  <li key={step.title} className={`flex items-start gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px] leading-[1.4] ${step.current ? 'bg-accent-soft-solid font-bold text-fg' : step.done ? 'font-semibold text-fg-muted' : 'font-semibold text-fg-subtle'}`}>
                    <StepDot n={index + 1} done={step.done} current={step.current} size="sm" />
                    <span>{step.title}</span>
                  </li>
                ))}
              </ol>
            </div>
            <ol className="m-0 list-none p-0">
              {steps.map((step, index) => (
                <li key={step.title} className={`flex items-start gap-3.5 border-b border-border px-5 py-[18px] last:border-b-0 ${step.current ? 'bg-surface-2' : ''}`}>
                  <StepDot n={index + 1} done={step.done} current={step.current} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                      <div className={fieldCaption}>{t('studio:shipping.step.word', 'Step {n}', { n: format.number(index + 1) })}</div>
                      <h3 className="mt-0.5 text-[14px] font-bold">{step.title}</h3>
                      <p className="mt-0.5 text-[12.5px] text-fg-muted">{step.body}</p>
                    </div>
                    {step.link !== undefined ? <OutLink href={step.link.href}>{step.link.label}</OutLink> : null}
                    {step.extra}
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="flex flex-col gap-3.5 p-5">
            {disclosure}
            {showForm ? form : keyRow}
            {checkButton}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3.5 p-5">
          {keyRow}
          <CheckResult
            result={result}
            carrier={carrier}
            status={status}
            busy={check.isPending}
            onCheck={() => check.mutate()}
            onReplace={startReplace}
            replaceLockId={keyLock === null ? null : `${ids}-lock`}
            onUse={() => use.mutate()}
            useBusy={use.isPending}
          />
          {use.isError ? <Alert tone="danger" role="alert" title={refusalWords(use.error, name)} /> : null}
          {check.isError && transient === null ? <Alert tone="danger" role="alert" title={refusalWords(check.error, name)} /> : null}
          {addressGone ? (
            <Alert
              tone="warn"
              data-testid="shipping-address-gone"
              title={t('studio:shipping.tracking.goneTitle', 'The webhook address stopped working when the key changed')}
              body={t('studio:shipping.tracking.goneBody', 'Make a new address, then paste it into {carrier}. Until then, tracking changes only when someone presses Refresh.', { carrier: name })}
              action={
                <Button variant="secondary" size="sm" onClick={onOpenTracking}>
                  {t('studio:shipping.tracking.goTo', 'Open Tracking')}
                </Button>
              }
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

function StepDot({ n, done, current, size }: { n: number; done: boolean; current: boolean; size: 'sm' | 'md' }) {
  const format = useShippingFormat();
  const box = size === 'sm' ? 'size-5 text-[10.5px]' : 'size-6 text-[11px]';
  const tone = done ? 'bg-pos-soft text-pos' : current ? 'bg-accent text-accent-fg' : 'border-[1.5px] border-border-strong text-fg-subtle';
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-mono font-semibold ${box} ${tone}`}>
      {done ? <Check aria-label={t('studio:shipping.step.done', 'Done')} className="size-3" /> : format.number(n)}
    </span>
  );
}

/** The way back from a carrier's card to the list of apps: the comp's frame did this, and a product needs it. */
export function BackToShipWith({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="size-3.5 rtl:-scale-x-100" />} onClick={onBack} data-testid="shipping-back">
        {t('studio:shipping.back', 'Back to Ship with')}
      </Button>
    </div>
  );
}
