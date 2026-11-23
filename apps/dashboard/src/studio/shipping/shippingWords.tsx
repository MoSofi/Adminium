// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Shipping page's shared words, formats and small parts.
 *
 * Words are switches rather than assembled keys: a key built at runtime is
 * invisible to the extractor and to the parity gate. A refusal is said by its
 * stable code, and a carrier's own sentence is never shown.
 */
import { ExternalLink } from 'lucide-react';
import { useMemo, type KeyboardEvent, type ReactNode } from 'react';

import { useLocaleTag } from '../../add-ons/locale.js';
import { t } from '../../i18n/t.js';
import { isNetworkOff, refusalCode, type CarrierView, type LabelSize } from './shippingApi.js';

export const SHIPPO_KEY = 'shipping-shippo';

/** The company's plain name. A locked DHL always says it is a demo. */
export function carrierName(carrier: Pick<CarrierView, 'key' | 'name' | 'locked'>): string {
  if (carrier.key === SHIPPO_KEY) return 'Shippo';
  if (carrier.locked) return t('studio:shipping.carrier.demoName', '{name} (demo)', { name: carrier.key === 'shipping-dhl' ? 'DHL' : carrier.name });
  return carrier.name;
}

export type CarrierState = 'off' | 'demo' | 'none' | 'unchecked' | 'refused' | 'test' | 'live';

export function carrierStateOf(carrier: CarrierView): CarrierState {
  if (!carrier.on) return 'off';
  if (carrier.locked) return 'demo';
  if (!carrier.connected) return 'none';
  if (carrier.account === null) return 'unchecked';
  if (carrier.account.state === 'refused') return 'refused';
  return carrier.account.mode;
}

/** A locked carrier runs its demo and takes no key; any other needs a check that passed. */
export function mayPick(carrier: CarrierView): boolean {
  return carrier.on && (carrier.locked || carrier.account?.state === 'ok');
}

type BadgeTone = 'neutral' | 'info' | 'danger' | 'warn' | 'pos';

export function carrierBadge(state: CarrierState): { label: string; tone: BadgeTone } {
  switch (state) {
    case 'off':
      return { label: t('studio:shipping.state.off', 'Switched off'), tone: 'neutral' };
    case 'demo':
      return { label: t('studio:shipping.state.demo', 'Demo'), tone: 'neutral' };
    case 'none':
      return { label: t('studio:shipping.state.none', 'Not connected'), tone: 'neutral' };
    case 'unchecked':
      return { label: t('studio:shipping.state.unchecked', 'Not checked'), tone: 'info' };
    case 'refused':
      return { label: t('studio:shipping.state.refused', 'Not accepted'), tone: 'danger' };
    case 'test':
      return { label: t('studio:shipping.state.test', 'Test key'), tone: 'warn' };
    case 'live':
      return { label: t('studio:shipping.state.live', 'Connected'), tone: 'pos' };
  }
}

export function carrierLine(state: CarrierState, name: string): string {
  switch (state) {
    case 'off':
      return t('studio:shipping.line.off', 'Switched off for this app.');
    case 'demo':
      return t('studio:shipping.line.demo', 'Books no real labels. You type the tracking number.');
    case 'none':
      return t('studio:shipping.line.none', 'Add a {carrier} key before you can ship with it.', { carrier: name });
    case 'unchecked':
      return t('studio:shipping.line.unchecked', 'Key saved. Check the connection before you can ship with it.');
    case 'refused':
      return t('studio:shipping.line.refused', '{carrier} did not accept this key. Paste a new one before you can ship with it.', { carrier: name });
    case 'test':
      return t('studio:shipping.line.test', 'Connected · Test key');
    case 'live':
      return t('studio:shipping.line.live', 'Connected · Live key');
  }
}

export function sizeLabel(size: LabelSize): string {
  switch (size) {
    case 'a4':
      return 'A4';
    case 'a6':
      return 'A6';
    case '4x6':
      return t('studio:shipping.size.fourBySix', '4×6 in');
  }
}

export function sizeLine(size: LabelSize): string {
  switch (size) {
    case 'a4':
      return t('studio:shipping.size.a4Line', 'Office inkjet and laser printers, on plain A4 paper.');
    case 'a6':
      return t('studio:shipping.size.a6Line', 'Desktop label printers and sticky A6 labels.');
    case '4x6':
      return t('studio:shipping.size.fourBySixLine', 'Thermal label printers that take 4 × 6 in rolls or stacks.');
  }
}

/** What a refusal means here, by its code. */
export function refusalWords(error: unknown, carrier: string): string {
  if (isNetworkOff(error)) return t('studio:shipping.error.networkOff', 'This server is set to work without the internet, so no carrier can be asked.');
  switch (refusalCode(error)) {
    case 'APP_NOT_UPDATED':
      return t('studio:shipping.error.appNotUpdated', 'Update this app before connecting a carrier.');
    case 'KEY_REFUSED':
      return t('studio:shipping.error.keyRefused', '{carrier} did not accept this key. Nothing was saved.', { carrier });
    case 'CARRIER_UNAVAILABLE':
    case 'CARRIER_BAD_ANSWER':
      return t('studio:shipping.error.noAnswer', '{carrier} did not answer. Nothing was changed. Try again.', { carrier });
    case 'KEY_FIELDS':
      return t('studio:shipping.error.keyFields', 'This key is made of other fields. Reload the page and try again.');
    case 'CARRIER_LOCKED':
      return t('studio:shipping.error.locked', '{carrier} runs as a demo for now, so it takes no key.', { carrier });
    case 'CARRIER_NOT_INSTALLED':
      return t('studio:shipping.error.notInstalled', '{carrier} is not attached to this app any more.', { carrier });
    case 'CARRIER_SWITCHED_OFF':
      return t('studio:shipping.error.switchedOff', '{carrier} is switched off for this app.', { carrier });
    case 'CARRIER_NO_CREDENTIAL':
      return t('studio:shipping.error.noKey', 'Save a {carrier} key first.', { carrier });
    case 'CARRIER_NOT_CHECKED':
      return t('studio:shipping.error.notChecked', 'Check the {carrier} connection first.', { carrier });
    case 'CARRIER_NOT_LOADED':
    case 'CARRIER_NO_FACTORY':
    case 'CARRIER_NO_CHECK':
      return t('studio:shipping.error.notLoaded', '{carrier} could not be loaded on this server.', { carrier });
    case 'CARRIER_SERVER_WIDE':
      return t('studio:shipping.error.serverWide', '{carrier} is kept for the whole server, so it takes no key for one shop.', { carrier });
    case 'NO_PUBLIC_ADDRESS':
      return t('studio:shipping.error.noPublicAddress', 'This server needs a public https address before {carrier} can call it. The address you have keeps working.', { carrier });
    case 'TRACKING_NO_WEBHOOK':
      return t('studio:shipping.error.noWebhook', '{carrier} does not send tracking updates to a webhook.', { carrier });
    default:
      return t('studio:shipping.error.generic', 'That did not work. Try again.');
  }
}

/** Figures, dates, lists and countries in the viewer's language. Digits stay Latin, as every figure in the product. */
export function useShippingFormat() {
  const tag = useLocaleTag();
  return useMemo(
    () => ({
      number: (value: number) => new Intl.NumberFormat(tag, { numberingSystem: 'latn' }).format(value),
      when: (at: number) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(new Date(at)),
      list: (items: readonly string[]) => new Intl.ListFormat(tag, { style: 'short', type: 'unit' }).format(items),
      country: (code: string) => {
        try {
          return new Intl.DisplayNames([tag], { type: 'region' }).of(code) ?? code;
        } catch {
          return code;
        }
      },
      /** The currency's own sign, or its code when it has none here. */
      currencySign: (currency: string) => {
        try {
          const parts = new Intl.NumberFormat(tag, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
          return parts.find((part) => part.type === 'currency')?.value ?? currency;
        } catch {
          return currency;
        }
      },
    }),
    [tag],
  );
}

/** A link out of Adminium: no referrer, and a screen reader is told it opens a new tab. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-bold text-accent underline-offset-2 hover:underline">
      {children}
      <ExternalLink aria-hidden="true" className="size-[13px] rtl:-scale-x-100" />
      <span className="sr-only">{t('studio:shipping.link.newTab', '(opens in a new tab)')}</span>
    </a>
  );
}

/**
 * The next key an arrow, Home or End moves to, or null for any other key.
 * Arrows only MOVE here: choosing a carrier clears its quotes and a size is
 * saved, so neither happens because a keyboard passed over a row.
 */
export function rovingNext(event: KeyboardEvent<HTMLElement>, keys: readonly string[], current: string): string | null {
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const forward = ['ArrowDown', rtl ? 'ArrowLeft' : 'ArrowRight'];
  const back = ['ArrowUp', rtl ? 'ArrowRight' : 'ArrowLeft'];
  const at = keys.indexOf(current);
  if (forward.includes(event.key)) return keys[(at + 1) % keys.length] ?? null;
  if (back.includes(event.key)) return keys[(at - 1 + keys.length) % keys.length] ?? null;
  if (event.key === 'Home') return keys[0] ?? null;
  if (event.key === 'End') return keys[keys.length - 1] ?? null;
  return null;
}
