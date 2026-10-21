// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Ways to pay.
 *
 * At the top, what a customer would be offered: a country, a currency and an
 * amount in, the ways out, worked out by the same rules the pay page uses
 * (asked of the server, never guessed here). Then one group per payment
 * service (its ways are the ones its account switched on; the service makes
 * the final choice for each customer) and one for the ways to pay by hand.
 * Each way has a switch and its rules (countries, currencies, smallest and
 * largest amount, which records it is for); a bank transfer also has its
 * accounts, one per currency.
 *
 * Apple Pay, Google Pay and Link cannot be left out of a single Stripe
 * checkout: they follow cards, or have no switch of their own. Their rows say
 * so, and their rules are not offered.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Banknote, CreditCard, Eye, Landmark, Plus, Trash2, Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ChipInput,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  EmptyState,
  FormField,
  IconButton,
  IconTile,
  Input,
  Select,
  Switch,
  Tag,
  Textarea,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import {
  NO_RULES,
  PAYMENTS_WAYS_QUERY_KEY,
  knownProvider,
  payPageQuery,
  paymentsPayablesQuery,
  paymentsWaysQuery,
  previewWays,
  providerMethodsQuery,
  removeWay,
  saveWay,
  type BankAccount,
  type ManualDetails,
  type ServiceView,
  type WayRules,
  type WayView,
} from './paymentsApi.js';
import { FOLLOWS_CARDS, PREVIEW_COUNTRIES, PREVIEW_CURRENCIES, countryName, money, wayName } from './paymentsWords.js';

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

function providerName(service: ServiceView): string {
  const provider = knownProvider(service.key);
  if (provider === 'stripe') return 'Stripe';
  if (provider === 'paypal') return 'PayPal';
  return service.name;
}

function toInput(way: WayView, patch: Partial<WayView> = {}) {
  const next = { ...way, ...patch };
  return { enabled: next.enabled, rules: next.rules, label: next.label, details: next.source === 'manual' ? ((next.details as ManualDetails | null) ?? null) : null, position: next.position };
}

/** "Germany, Austria · EUR · €10.00 to €150.00 · invoices only" — or "Any country · any currency". */
function rulesLine(rules: WayRules, onlyForNames: (id: string) => string): string {
  const parts: string[] = [];
  parts.push(rules.countries.length === 0 ? t('studio:payments.ways.anyCountry', 'Any country') : rules.countries.map(countryName).join(', '));
  parts.push(rules.currencies.length === 0 ? t('studio:payments.ways.anyCurrency', 'any currency') : rules.currencies.join(', '));
  if (rules.min !== null && rules.max !== null) parts.push(t('studio:payments.ways.between', '{min} to {max}', { min: rules.min, max: rules.max }));
  else if (rules.min !== null) parts.push(t('studio:payments.ways.fromMin', 'from {min}', { min: rules.min }));
  else if (rules.max !== null) parts.push(t('studio:payments.ways.upToMax', 'up to {max}', { max: rules.max }));
  if (rules.onlyFor.length > 0) parts.push(t('studio:payments.ways.onlyForLine', 'only for {list}', { list: rules.onlyFor.map(onlyForNames).join(', ') }));
  return parts.join(' · ');
}

// ─── What a customer sees ───────────────────────────────────────────────────

function CustomerPreview({ refreshKey }: { refreshKey: string }) {
  const [country, setCountry] = useState<string>('DE');
  const [currency, setCurrency] = useState<string>('EUR');
  const [amount, setAmount] = useState('120.00');
  const valid = /^\d+(\.\d+)?$/.test(amount);
  const preview = useQuery({
    queryKey: ['payments', 'ways', 'preview', country, currency, amount, refreshKey] as const,
    queryFn: () => previewWays({ country, currency, amount, kind: 'shape', profileId: null }),
    enabled: valid,
    retry: false,
  });
  const offered = preview.data ?? [];
  return (
    <Card data-testid="payments-ways-preview">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={<Eye />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:payments.ways.previewTitle', 'What a customer sees')}</h2>
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.ways.previewHelp', 'Pick a customer to check your rules.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <FormField label={t('studio:payments.ways.country', 'Country')} className="min-w-[160px] flex-1">
            <Select value={country} onChange={(event) => setCountry(event.target.value)} data-testid="payments-ways-preview-country">
              {PREVIEW_COUNTRIES.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:payments.ways.currency', 'Currency')} className="min-w-[120px]">
            <Select mono value={currency} onChange={(event) => setCurrency(event.target.value)} data-testid="payments-ways-preview-currency">
              {PREVIEW_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:payments.ways.amount', 'Amount')} className="min-w-[120px]" error={valid ? undefined : t('studio:payments.ways.amountInvalid', 'Write an amount such as 120.00.')}>
            <Input dir="ltr" inputMode="decimal" className="font-mono" value={amount} onChange={(event) => setAmount(event.target.value.trim())} data-testid="payments-ways-preview-amount" />
          </FormField>
        </div>
        <p aria-live="polite" className="text-[13px]" data-testid="payments-ways-preview-line">
          {!valid
            ? null
            : preview.isPending
              ? t('studio:payments.ways.previewChecking', 'Checking…')
              : preview.isError
                ? errorText(preview.error)
                : offered.length === 0
                  ? t('studio:payments.ways.previewNone', 'A customer in {country} paying {amount} for an invoice sees: no way to pay.', { country: countryName(country), amount: money(amount, currency) })
                  : t('studio:payments.ways.previewSees', 'A customer in {country} paying {amount} for an invoice sees: {list}.', {
                      country: countryName(country),
                      amount: money(amount, currency),
                      list: offered.map((one) => wayName(one)).join(', '),
                    })}
        </p>
      </CardBody>
    </Card>
  );
}

// ─── The rules drawer ───────────────────────────────────────────────────────

function RulesDrawer({ way, onClose, onlyForChoices, shopCountry }: { way: WayView; onClose: () => void; onlyForChoices: { id: string; name: string }[]; shopCountry: string | null }) {
  const client = useQueryClient();
  const [rules, setRules] = useState<WayRules>(way.rules);
  const decimal = (value: string | null) => value === null || /^\d+(\.\d+)?$/.test(value);
  const save = useMutation({
    mutationFn: () => saveWay(way.source, way.method, toInput(way, { rules })),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY });
      onClose();
    },
  });
  const ok = decimal(rules.min) && decimal(rules.max);
  const blank = (value: string) => (value.trim() === '' ? null : value.trim());
  return (
    <Drawer open size="md" onOpenChange={(next) => (next || save.isPending ? null : onClose())}>
      <DrawerHeader
        icon={<Landmark />}
        title={wayName(way)}
        subtitle={way.source === 'manual' ? t('studio:payments.ways.rulesKickerHand', 'Rules · By hand') : t('studio:payments.ways.rulesKicker', 'Rules')}
        closeLabel={t('studio:payments.close', 'Close')}
        data-testid="payments-ways-rules"
      />
      <DrawerBody className="flex flex-col gap-4">
        <FormField label={t('studio:payments.ways.countries', 'Countries')} helper={t('studio:payments.ways.countriesHelp', 'Two-letter codes, such as DE. None means any country.')}>
          <ChipInput
            value={rules.countries}
            validate={(chip) => /^[A-Za-z]{2}$/.test(chip)}
            onValueChange={(next) => setRules({ ...rules, countries: [...new Set(next.map((one) => one.toUpperCase()))] })}
            removeLabel={(chip) => t('studio:payments.ways.removeChip', 'Remove {item}', { item: chip })}
            placeholder={t('studio:payments.ways.addCountry', 'Add a country')}
            data-testid="payments-ways-rules-countries"
          />
        </FormField>
        <FormField label={t('studio:payments.ways.currencies', 'Currencies')} helper={t('studio:payments.ways.currenciesHelp', 'Three-letter codes, such as EUR. None means any currency.')}>
          <ChipInput
            value={rules.currencies}
            validate={(chip) => /^[A-Za-z]{3}$/.test(chip)}
            onValueChange={(next) => setRules({ ...rules, currencies: [...new Set(next.map((one) => one.toUpperCase()))] })}
            removeLabel={(chip) => t('studio:payments.ways.removeChip', 'Remove {item}', { item: chip })}
            placeholder={t('studio:payments.ways.addCurrency', 'Add a currency')}
            data-testid="payments-ways-rules-currencies"
          />
        </FormField>
        <div className="flex flex-wrap gap-3">
          <FormField label={t('studio:payments.ways.smallest', 'Smallest amount')} className="flex-1" error={decimal(rules.min) ? undefined : t('studio:payments.ways.amountInvalid', 'Write an amount such as 120.00.')}>
            <Input dir="ltr" inputMode="decimal" className="font-mono" placeholder={t('studio:payments.ways.none', 'None')} value={rules.min ?? ''} onChange={(event) => setRules({ ...rules, min: blank(event.target.value) })} />
          </FormField>
          <FormField label={t('studio:payments.ways.largest', 'Largest amount')} className="flex-1" error={decimal(rules.max) ? undefined : t('studio:payments.ways.amountInvalid', 'Write an amount such as 120.00.')}>
            <Input dir="ltr" inputMode="decimal" className="font-mono" placeholder={t('studio:payments.ways.none', 'None')} value={rules.max ?? ''} onChange={(event) => setRules({ ...rules, max: blank(event.target.value) })} />
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12.5px] font-semibold">{t('studio:payments.ways.onlyFor', 'Only for')}</legend>
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.ways.onlyForHelp', 'Leave every box empty to offer it for every record that can be paid.')}</p>
          {onlyForChoices.map((choice) => {
            const id = `payments-ways-only-${choice.id}`;
            return (
              <div key={choice.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={rules.onlyFor.includes(choice.id)}
                  onCheckedChange={(checked) =>
                    setRules({ ...rules, onlyFor: checked === true ? [...rules.onlyFor, choice.id] : rules.onlyFor.filter((one) => one !== choice.id) })
                  }
                />
                <label htmlFor={id} className="text-[13px]">
                  {choice.name}
                </label>
              </div>
            );
          })}
        </fieldset>
        <p className="rounded-md bg-surface-2 p-3 text-[12.5px] text-fg-muted">
          <span className="font-semibold">{t('studio:payments.ways.countrySource', 'Where the country comes from')}</span>{' '}
          {shopCountry === null
            ? t('studio:payments.ways.countrySourceNoShop', "The customer's country column. Set the shop's country on the Pay page tab for customers without one.")
            : t('studio:payments.ways.countrySourceShop', "The customer's country column, or the shop's country ({country}) when it is empty.", { country: countryName(shopCountry) })}
        </p>
        {save.isError ? <Alert tone="danger" role="alert" title={errorText(save.error)} /> : null}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('studio:payments.ways.cancel', 'Cancel')}
        </Button>
        <Button disabled={!ok || save.isPending} onClick={() => save.mutate()} data-testid="payments-ways-rules-save">
          {t('studio:payments.ways.saveRules', 'Save rules')}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

// ─── The bank transfer drawer ───────────────────────────────────────────────

const EMPTY_ACCOUNT = (currency: string): BankAccount => ({ currency, holder: '', iban: null, accountNumber: null, bic: null, sortCode: null, bank: null });

function BankDrawer({ way, onClose }: { way: WayView; onClose: () => void }) {
  const client = useQueryClient();
  const details = (way.details as ManualDetails | null) ?? {};
  const [accounts, setAccounts] = useState<BankAccount[]>(details.accounts ?? []);
  const [note, setNote] = useState(details.note ?? '');
  const [adding, setAdding] = useState('');
  const save = useMutation({
    mutationFn: () => saveWay(way.source, way.method, toInput(way, { details: { accounts, note: note.trim() === '' ? null : note.trim() } })),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY });
      onClose();
    },
  });
  const set = (index: number, patch: Partial<BankAccount>) => setAccounts(accounts.map((account, at) => (at === index ? { ...account, ...patch } : account)));
  const blank = (value: string) => (value.trim() === '' ? null : value.trim());
  const complete = accounts.every((account) => account.holder.trim() !== '' && (account.iban !== null || account.accountNumber !== null));
  return (
    <Drawer open size="md" onOpenChange={(next) => (next || save.isPending ? null : onClose())}>
      <DrawerHeader icon={<Landmark />} title={t('studio:payments.ways.bankTitle', 'Bank transfer')} subtitle={t('studio:payments.ways.bankKicker', 'Settings · By hand')} closeLabel={t('studio:payments.close', 'Close')} data-testid="payments-ways-bank" />
      <DrawerBody className="flex flex-col gap-4">
        <p className="text-[12.5px] text-fg-muted">{t('studio:payments.ways.bankEach', 'Each currency has its own account.')}</p>
        {accounts.map((account, index) => (
          <section key={account.currency} className="flex flex-col gap-3 rounded-md border border-border p-3" aria-label={account.currency} data-testid={`payments-ways-bank-${account.currency}`}>
            <div className="flex items-center gap-2">
              <Tag className="font-mono">{account.currency}</Tag>
              <Button variant="ghost" size="sm" iconLeft={<Trash2 className="size-4" />} onClick={() => setAccounts(accounts.filter((_, at) => at !== index))}>
                {t('studio:payments.ways.removeAccount', 'Remove the {currency} account', { currency: account.currency })}
              </Button>
            </div>
            <FormField label={t('studio:payments.ways.holder', 'Account holder')} required>
              <Input dir="auto" value={account.holder} onChange={(event) => set(index, { holder: event.target.value })} />
            </FormField>
            <FormField label={t('studio:payments.ways.iban', 'IBAN')}>
              <Input dir="ltr" className="font-mono" spellCheck={false} value={account.iban ?? ''} onChange={(event) => set(index, { iban: blank(event.target.value) })} />
            </FormField>
            <FormField label={t('studio:payments.ways.accountNumber', 'Account number')} helper={t('studio:payments.ways.accountNumberHelp', 'Only where there is no IBAN.')}>
              <Input dir="ltr" className="font-mono" spellCheck={false} value={account.accountNumber ?? ''} onChange={(event) => set(index, { accountNumber: blank(event.target.value) })} />
            </FormField>
            <div className="flex flex-wrap gap-3">
              <FormField label={t('studio:payments.ways.bic', 'BIC')} className="flex-1">
                <Input dir="ltr" className="font-mono" spellCheck={false} value={account.bic ?? ''} onChange={(event) => set(index, { bic: blank(event.target.value) })} />
              </FormField>
              <FormField label={t('studio:payments.ways.sortCode', 'Sort code')} className="flex-1">
                <Input dir="ltr" className="font-mono" spellCheck={false} value={account.sortCode ?? ''} onChange={(event) => set(index, { sortCode: blank(event.target.value) })} />
              </FormField>
            </div>
            <FormField label={t('studio:payments.ways.bank', 'Bank')}>
              <Input dir="auto" value={account.bank ?? ''} onChange={(event) => set(index, { bank: blank(event.target.value) })} />
            </FormField>
            <p className="text-[12.5px] text-fg-muted">{t('studio:payments.ways.bankShown', 'Customers paying in {currency} see these details on the pay page.', { currency: account.currency })}</p>
          </section>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t('studio:payments.ways.addCurrency', 'Add a currency')} className="w-32">
            <Input dir="ltr" className="font-mono uppercase" maxLength={3} value={adding} onChange={(event) => setAdding(event.target.value.toUpperCase())} data-testid="payments-ways-bank-add-currency" />
          </FormField>
          <Button
            variant="secondary"
            iconLeft={<Plus className="size-4" />}
            disabled={!/^[A-Z]{3}$/.test(adding) || accounts.some((account) => account.currency === adding)}
            onClick={() => {
              setAccounts([...accounts, EMPTY_ACCOUNT(adding)]);
              setAdding('');
            }}
          >
            {t('studio:payments.ways.addAccount', 'Add the account')}
          </Button>
        </div>
        <FormField label={t('studio:payments.ways.note', 'What the customer is told')} helper={t('studio:payments.ways.noteHelp', 'For example: Quote the invoice number as the reference.')}>
          <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </FormField>
        {!complete ? <p className="text-[12.5px] text-danger">{t('studio:payments.ways.bankIncomplete', 'Each account needs a holder and an IBAN or an account number.')}</p> : null}
        {save.isError ? <Alert tone="danger" role="alert" title={errorText(save.error)} /> : null}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('studio:payments.ways.cancel', 'Cancel')}
        </Button>
        <Button disabled={!complete || save.isPending} onClick={() => save.mutate()} data-testid="payments-ways-bank-save">
          {t('studio:payments.ways.saveBank', 'Save bank details')}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

// ─── One way ────────────────────────────────────────────────────────────────

function WayRow({
  way,
  canManage,
  first,
  last,
  onMove,
  onEditRules,
  onEditBank,
  onlyForName,
}: {
  way: WayView;
  canManage: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onEditRules: () => void;
  onEditBank: () => void;
  onlyForName: (id: string) => string;
}) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => saveWay(way.source, way.method, toInput(way, { enabled })),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY }),
  });
  const remove = useMutation({
    mutationFn: () => removeWay(way.source, way.method),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY }),
  });
  const name = wayName(way);
  const followsCards = way.source === 'payments-stripe' && FOLLOWS_CARDS.has(way.method);
  const id = `payments-way-${way.source}-${way.method}`;
  const accounts = way.method === 'bank-transfer' ? (((way.details as ManualDetails | null)?.accounts ?? []).map((account) => account.currency)) : [];
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0" data-testid={id}>
      {canManage ? (
        <Switch id={id + '-switch'} aria-label={name} checked={way.enabled} disabled={toggle.isPending} onCheckedChange={(next) => toggle.mutate(next)} />
      ) : (
        <Badge tone={way.enabled ? 'pos' : 'neutral'}>{way.enabled ? t('studio:payments.ways.on', 'On') : t('studio:payments.ways.off', 'Off')}</Badge>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold">{name}</span>
          <Tag>{way.source === 'manual' ? t('studio:payments.ways.tagHand', 'By hand') : way.source === 'payments-paypal' ? 'PayPal' : way.source === 'payments-stripe' ? 'Stripe' : way.source}</Tag>
        </div>
        <p className="text-[12.5px] text-fg-muted" data-testid={`${id}-rules`}>
          {followsCards ? t('studio:payments.ways.followsCards', 'It follows cards: it cannot be left out of one payment on its own. Switch it off in the Stripe dashboard.') : rulesLine(way.rules, onlyForName)}
        </p>
        {way.method === 'bank-transfer' ? (
          <p className="text-[12.5px] text-fg-muted">
            {accounts.length === 0 ? t('studio:payments.ways.noAccounts', 'No bank account yet: customers are shown nothing to pay into.') : t('studio:payments.ways.accounts', 'Accounts in {list}', { list: accounts.join(', ') })}
          </p>
        ) : null}
        {toggle.isError || remove.isError ? <p role="alert" className="text-[12.5px] text-danger">{errorText(toggle.error ?? remove.error)}</p> : null}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-1">
          {way.method === 'bank-transfer' ? (
            <Button variant="secondary" size="sm" onClick={onEditBank}>
              {t('studio:payments.ways.editDetails', 'Edit details')}
            </Button>
          ) : null}
          {followsCards ? null : (
            <Button variant="secondary" size="sm" onClick={onEditRules} aria-label={t('studio:payments.ways.editRulesOf', 'Edit the rules of {way}', { way: name })}>
              {t('studio:payments.ways.editRules', 'Edit rules')}
            </Button>
          )}
          <IconButton size="sm" tooltip disabled={first} label={t('studio:payments.ways.moveUp', 'Move {way} up', { way: name })} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton size="sm" tooltip disabled={last} label={t('studio:payments.ways.moveDown', 'Move {way} down', { way: name })} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </IconButton>
          {way.source === 'manual' ? (
            <IconButton size="sm" tooltip label={t('studio:payments.ways.remove', 'Remove {way}', { way: name })} disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="size-4" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ─── A service's group ──────────────────────────────────────────────────────

function ServiceGroup({ service, ways, canManage, rowProps }: { service: ServiceView; ways: WayView[]; canManage: boolean; rowProps: (way: WayView, index: number, list: WayView[]) => Parameters<typeof WayRow>[0] }) {
  const client = useQueryClient();
  const name = providerName(service);
  const [asking, setAsking] = useState(false);
  const methods = useQuery({ ...providerMethodsQuery(service.key), enabled: asking });
  const add = useMutation({
    mutationFn: async () => {
      const have = new Set(ways.map((one) => one.method));
      let position = ways.length;
      for (const method of methods.data?.methods ?? []) {
        if (have.has(method.id)) continue;
        await saveWay(service.key, method.id, { enabled: true, rules: NO_RULES, label: null, details: null, position: (position += 1) });
      }
    },
    onSuccess: async () => {
      setAsking(false);
      await client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY });
    },
  });
  // Once the service has said which ways its account switched on, add the missing ones.
  useEffect(() => {
    if (asking && methods.data !== undefined && !add.isPending && !add.isSuccess) add.mutate();
  }, [asking, methods.data, add]);
  return (
    <Card data-testid={`payments-ways-group-${service.key}`}>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={knownProvider(service.key) === 'paypal' ? <Wallet /> : <CreditCard />} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14.5px] font-bold">{t('studio:payments.ways.from', 'From {provider}', { provider: name })}</h2>
            <Badge tone={service.liveOn ? 'pos' : 'info'}>{service.liveOn ? t('studio:payments.mode.live', 'Live') : t('studio:payments.mode.test', 'Test')}</Badge>
          </div>
          <p className="text-[12.5px] text-fg-muted">
            {t('studio:payments.ways.providerNote', 'These are switched on in your {provider} dashboard. {provider} makes the final choice for each customer.', { provider: name })}
          </p>
        </div>
        {canManage ? (
          <Button variant="secondary" size="sm" iconLeft={<Plus className="size-4" />} disabled={asking} onClick={() => setAsking(true)}>
            {t('studio:payments.ways.addFromProvider', 'Add the ways {provider} has switched on', { provider: name })}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody>
        {methods.isError ? <Alert tone="danger" role="alert" title={errorText(methods.error)} /> : null}
        {ways.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{t('studio:payments.ways.noneFromProvider', 'No way to pay from {provider} is listed yet.', { provider: name })}</p>
        ) : (
          <ul>
            {ways.map((way, index) => (
              <WayRow key={`${way.source}:${way.method}`} {...rowProps(way, index, ways)} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

export function WaysTab({ services, canManage }: { services: ServiceView[]; canManage: boolean }): ReactNode {
  const client = useQueryClient();
  const list = useQuery(paymentsWaysQuery());
  const payables = useQuery(paymentsPayablesQuery());
  const page = useQuery(payPageQuery());
  const [rulesOf, setRulesOf] = useState<WayView | null>(null);
  const [bankOf, setBankOf] = useState<WayView | null>(null);
  const [adding, setAdding] = useState('');
  const ways = [...(list.data?.ways ?? [])].sort((a, b) => a.position - b.position);
  const manual = ways.filter((way) => way.source === 'manual');
  const missingManual = (list.data?.manualMethods ?? []).filter((method) => !manual.some((way) => way.method === method));

  const onlyForChoices = [
    { id: 'shape', name: t('studio:payments.ways.onlyShape', 'Invoices built on the invoice format') },
    { id: 'document', name: t('studio:payments.ways.onlyDocument', 'Invoices made on the Invoices page') },
    ...(payables.data?.profiles ?? []).map((profile) => ({ id: profile.id, name: profile.tableName.replace(/^[^.]+\./, '') })),
  ];
  const onlyForName = (id: string) => onlyForChoices.find((choice) => choice.id === id)?.name ?? id;

  const move = useMutation({
    mutationFn: async ({ group, index, direction }: { group: WayView[]; index: number; direction: -1 | 1 }) => {
      const other = group[index + direction];
      const way = group[index];
      if (other === undefined || way === undefined) return;
      await saveWay(way.source, way.method, toInput(way, { position: other.position }));
      await saveWay(other.source, other.method, toInput(other, { position: way.position === other.position ? way.position + direction : way.position }));
    },
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY }),
  });
  const addManual = useMutation({
    mutationFn: (method: string) => saveWay('manual', method, { enabled: true, rules: NO_RULES, label: null, details: method === 'bank-transfer' ? { accounts: [], note: null } : null, position: ways.length + 1 }),
    onSuccess: async () => {
      setAdding('');
      await client.invalidateQueries({ queryKey: PAYMENTS_WAYS_QUERY_KEY });
    },
  });

  const rowProps = (way: WayView, index: number, group: WayView[]) => ({
    way,
    canManage,
    first: index === 0,
    last: index === group.length - 1,
    onMove: (direction: -1 | 1) => move.mutate({ group, index, direction }),
    onEditRules: () => setRulesOf(way),
    onEditBank: () => setBankOf(way),
    onlyForName,
  });

  if (list.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (list.isError) return <Alert tone="danger" role="alert" title={errorText(list.error)} />;

  const refreshKey = ways.map((way) => `${way.source}:${way.method}:${String(way.enabled)}:${JSON.stringify(way.rules)}`).join('|');
  const empty = ways.length === 0 && services.length === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="payments-ways">
      <CustomerPreview refreshKey={refreshKey} />
      {empty ? (
        <EmptyState
          data-testid="payments-ways-empty"
          icon={<Banknote />}
          title={t('studio:payments.ways.emptyTitle', 'No ways to pay yet.')}
          body={t('studio:payments.ways.emptyBody', 'Connect Stripe or PayPal on Setup, or add a way to pay by hand.')}
        />
      ) : null}
      {services.map((service) => (
        <ServiceGroup key={service.key} service={service} ways={ways.filter((way) => way.source === service.key)} canManage={canManage} rowProps={rowProps} />
      ))}
      <Card data-testid="payments-ways-group-manual">
        <CardHeader className="flex flex-wrap items-center gap-3">
          <IconTile icon={<Landmark />} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-bold">{t('studio:payments.ways.byHand', 'By hand')}</h2>
            <p className="text-[12.5px] text-fg-muted">{t('studio:payments.ways.byHandNote', 'Ways the customer pays outside Adminium. Staff record the payment when it arrives.')}</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {manual.length === 0 ? <p className="text-[13px] text-fg-muted">{t('studio:payments.ways.noManual', 'No way to pay by hand yet.')}</p> : null}
          <ul>
            {manual.map((way, index) => (
              <WayRow key={`${way.source}:${way.method}`} {...rowProps(way, index, manual)} />
            ))}
          </ul>
          {canManage && missingManual.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <FormField label={t('studio:payments.ways.addHand', 'Add a way to pay by hand')} className="min-w-[200px]">
                <Select value={adding} onChange={(event) => setAdding(event.target.value)} data-testid="payments-ways-add-manual">
                  <option value="">{t('studio:payments.ways.choose', 'Choose…')}</option>
                  {missingManual.map((method) => (
                    <option key={method} value={method}>
                      {wayName({ source: 'manual', method, label: null })}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button iconLeft={<Plus className="size-4" />} disabled={adding === '' || addManual.isPending} onClick={() => addManual.mutate(adding)}>
                {t('studio:payments.ways.add', 'Add')}
              </Button>
            </div>
          ) : null}
          {addManual.isError || move.isError ? <p role="alert" className="text-[12.5px] text-danger">{errorText(addManual.error ?? move.error)}</p> : null}
        </CardBody>
      </Card>
      {rulesOf !== null ? <RulesDrawer way={rulesOf} onClose={() => setRulesOf(null)} onlyForChoices={onlyForChoices} shopCountry={page.data?.shopCountry ?? null} /> : null}
      {bankOf !== null ? <BankDrawer way={bankOf} onClose={() => setBankOf(null)} /> : null}
    </div>
  );
}
