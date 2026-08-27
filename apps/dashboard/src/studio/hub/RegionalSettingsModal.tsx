// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Regional settings" — the timezone and currency a connection's database
 * belongs to (28-T34).
 *
 * ─── Why this screen had to exist ────────────────────────────────────────────
 *
 * The server has carried `timezone`/`currency` on a connection since migration
 * `0015_connection_tenant_config` and `PATCH /connections/:id` has accepted
 * both since the same change, while hosted app surfaces sent operators here by
 * name — "Set one on the connection in Adminium (Connections → this database)".
 * Nothing rendered the field, so that sentence pointed at a screen that did not
 * exist and the only way to satisfy it was a hand-written PATCH. This is that
 * screen. (Those surfaces no longer REFUSE over a missing zone; they render in
 * UTC and say so. The field still decides what every date on them means.)
 *
 * ─── Why the reader's zone is never the answer ───────────────────────────────
 *
 * The tempting default is `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * evaluated HERE, and it is always wrong: that is the reader's zone, not the
 * business's. A London studio's invoices read by someone in Berlin would
 * silently shift by an hour and still look like data. So this screen proposes
 * nothing, and "Not set" is a real, selectable state that clears the field.
 *
 * The server does seed its own zone at create time (meta wave 0018) — one
 * value for the tenant rather than one per reader — and that seed arrives here
 * LABELLED, so it can be shown as the unconfirmed guess it is instead of
 * passing for a decision. Confirming it is what `guessed` below is about.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Combobox,
  FormField,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  type ComboboxOption,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { studioApi, type ConnectionDto } from '../api.js';

/**
 * The empty option's value.
 *
 * `Combobox` only ever emits the value of a row the user committed — it has no
 * clear affordance of its own — so "Not set" has to BE a row. The empty string
 * is safe as its sentinel because no IANA zone or ISO-4217 code is empty, and
 * it maps to the `null` the server reads as "clear this field".
 */
const UNSET = '';

/**
 * Built once per session, not per render.
 *
 * `Intl.supportedValuesOf('timeZone')` is ~420 entries and each description
 * costs a `DateTimeFormat` construction, so doing this in a `useMemo` would
 * still pay ~420 of them every time the modal is opened. The lists cannot
 * change while the tab is open, so a module-level cache is the honest scope.
 */
let timezoneCache: ComboboxOption[] | null = null;
let currencyCache: ComboboxOption[] | null = null;

/**
 * `supportedValuesOf` is ES2022 and present in every browser the dashboard
 * supports, but a missing implementation must degrade to "you can still keep
 * what you have" rather than to an empty list that silently offers only
 * "Not set" — which would read as "this instance has no zones".
 */
function supported(key: 'timeZone' | 'currency'): string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? [...Intl.supportedValuesOf(key)] : [];
  } catch {
    return [];
  }
}

/** `Europe/London` → `GMT+1`, for the second line of the option row. */
function offsetLabel(zone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return undefined;
  }
}

function timezoneOptions(): ComboboxOption[] {
  timezoneCache ??= supported('timeZone').map((zone) => {
    const offset = offsetLabel(zone);
    return { value: zone, label: zone, ...(offset === undefined ? {} : { description: offset }) };
  });
  return timezoneCache;
}

function currencyOptions(): ComboboxOption[] {
  currencyCache ??= (() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(['en'], { type: 'currency' });
    } catch {
      names = null;
    }
    return supported('currency').map((code) => {
      const name = names?.of(code);
      // `of()` echoes the code back when it knows no name; a row reading
      // "USD / USD" is noise, so only keep a description that adds something.
      return {
        value: code,
        label: code,
        ...(name === undefined || name === code ? {} : { description: name }),
      };
    });
  })();
  return currencyCache;
}

/**
 * The saved value, prepended when the browser's own list does not contain it.
 *
 * Without this, a zone the server accepted but this runtime does not enumerate
 * (an older ICU, or a link like `Asia/Calcutta`) would render as an empty
 * control — which looks exactly like "not set" and invites an operator to
 * overwrite a correct value with a different one.
 */
function withCurrent(options: ComboboxOption[], current: string | null): ComboboxOption[] {
  if (current === null || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

export interface RegionalSettingsModalProps {
  connection: ConnectionDto;
  onClose: () => void;
  /** Invalidates the connections query; awaited before the modal closes. */
  onSaved: () => void | Promise<void>;
}

export function RegionalSettingsModal({ connection, onClose, onSaved }: RegionalSettingsModalProps) {
  const [timezone, setTimezone] = useState<string | null>(connection.timezone);
  const [currency, setCurrency] = useState<string | null>(connection.currency);

  const zones = useMemo(
    () => withCurrent(timezoneOptions(), connection.timezone),
    [connection.timezone],
  );
  const currencies = useMemo(
    () => withCurrent(currencyOptions(), connection.currency),
    [connection.currency],
  );

  const notSet = t('studio.hub.regional.notSet', 'Not set');
  const unsetRow: ComboboxOption = { value: UNSET, label: notSet };

  /**
   * The stored zone is the server's own, seeded at create and confirmed by
   * nobody (meta wave 0018). It is a plausible value — which is exactly why it
   * is said out loud here rather than rendered as though someone picked it.
   */
  const guessed = connection.timezone !== null && connection.timezoneSource === 'host';

  const save = useMutation({
    mutationFn: () =>
      /*
       * Only what CHANGED, with one deliberate exception. The server reads an
       * omitted field as "leave it alone" and an explicit null as "clear it",
       * and sending both every time would turn a currency-only edit into a
       * rewrite of the zone — harmless today, and exactly the kind of thing
       * that stops being harmless once anything audits these fields.
       *
       * The exception is a guessed zone. Saving it UNCHANGED is how an operator
       * says "that one is right", and the write is what retires the `host`
       * label. Without it a correct guess could never be confirmed: the badge
       * would outlive the only answer that resolves it.
       */
      studioApi.patchConnection(connection.id, {
        ...(timezone === connection.timezone && !guessed ? {} : { timezone }),
        ...(currency === connection.currency ? {} : { currency }),
      }),
    onSuccess: onSaved,
  });

  // A guess is always saveable, because confirming it is a real edit even when
  // the value does not move.
  const dirty = guessed || timezone !== connection.timezone || currency !== connection.currency;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!dirty) return;
    save.mutate();
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
    >
      <ModalHeader
        title={t('studio.hub.regional.title', 'Regional settings')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form id="studio-regional-settings" className="flex flex-col gap-4" onSubmit={submit}>
          {guessed ? (
            <Alert
              tone="warn"
              title={t('studio.hub.regional.guessedTitle', 'This zone came from the server')}
              body={t(
                'studio.hub.regional.guessedBody',
                'Adminium filled it in from the machine it runs on, not from anyone here. Save to confirm it, or pick the zone this business actually keeps.',
              )}
            />
          ) : null}

          <p className="text-caption text-fg-muted">
            {t(
              'studio.hub.regional.intro',
              'These describe the business this database belongs to, not the person reading it. Apps served from Adminium read them from here.',
            )}
          </p>

          <FormField
            label={t('studio.hub.regional.timezone', 'Timezone')}
            helper={t(
              'studio.hub.regional.timezoneHelper',
              'Dates and times render in this zone. Apps hosted by Adminium fall back to UTC without one, and say on screen that they are doing it.',
            )}
          >
            <Combobox
              options={[unsetRow, ...zones]}
              value={timezone ?? UNSET}
              onValueChange={(next) => setTimezone(next === null || next === UNSET ? null : next)}
              emptyText={t('studio.hub.regional.noMatch', 'No matching zone')}
              placeholder={t('studio.hub.regional.timezonePlaceholder', 'Region/City')}
              mono
            />
          </FormField>

          <FormField
            label={t('studio.hub.regional.currency', 'Currency')}
            helper={t(
              'studio.hub.regional.currencyHelper',
              'Used to format money. Optional — leaving it unset affects formatting only.',
            )}
          >
            <Combobox
              options={[unsetRow, ...currencies]}
              value={currency ?? UNSET}
              onValueChange={(next) => setCurrency(next === null || next === UNSET ? null : next)}
              emptyText={t('studio.hub.regional.noMatchCurrency', 'No matching currency')}
              placeholder={t('studio.hub.regional.currencyPlaceholder', 'ISO-4217 code')}
              mono
            />
          </FormField>

          {save.isError ? (
            <Alert
              tone="danger"
              title={t('studio.hub.regional.failed', 'Regional settings could not be saved')}
              body={save.error instanceof Error ? save.error.message : ''}
            />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          form="studio-regional-settings"
          disabled={!dirty}
          loading={save.isPending}
          data-testid="regional-save"
        >
          {t('studio.hub.regional.save', 'Save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
