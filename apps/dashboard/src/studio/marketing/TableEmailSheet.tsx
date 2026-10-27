// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "E-mail settings for {table}": a people table's e-mail sheet (comp
 * `Email To Contacts.dc.html` 7a / 7b 962-1012), a 500px side sheet from the
 * inline end, opened from the send dialog's Table field and from the foot of
 * its table list.
 *
 *  - "Can be e-mailed from campaigns": off keeps the table out of every
 *    campaign (it leaves the send dialog's list); the sheet still opens to
 *    switch it back on;
 *  - "E-mail column" and "Name column": the app declares them; the owner may
 *    pick another text column (an address column only among those they see
 *    in clear);
 *  - "Existing customers": shown only where the app declares the opt-out mark
 *    and who counts as a customer. Turned on, it asks "Who counts as a
 *    customer" (the app's column, shown as it is) and the required tick "I
 *    offered a way to say no when we took their address": Save stays disabled
 *    until it is ticked, and the server refuses "on" without it as well.
 *
 * Its words are the Studio's: it waits for them itself, so any screen may open
 * it (through `TableEmailSheetLazy`, `./tableEmailSheetLazy.ts`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, Handshake, Settings2, Type } from 'lucide-react';
import { Suspense, use, useState, type ReactNode } from 'react';
import { Alert, Button, Drawer, DrawerBody, DrawerFooter, DrawerHeader, Select, Spinner, Switch } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { useAppToasts } from '../../pages/toasts.js';
import { studioMessagesReady } from '../studioMessages.js';
import { putExistingCustomers, putTableSheet, tableSheetQuery, type TableEmailSheetData } from './marketingApi.js';

/** The guide's part on the existing-customers basis. */
export const EXISTING_CUSTOMERS_GUIDE = 'guides/email/campaigns/#existing-customers';

export interface TableEmailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** The table's id, as the send dialog's list names it. */
  table: string;
  /** Told after a save, with the sheet as it now stands (the send dialog re-reads its list). */
  onSaved?: ((sheet: TableEmailSheetData) => void) | undefined;
}

export function TableEmailSheet(props: TableEmailSheetProps): ReactNode {
  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange} className="w-[500px] leading-[normal]" aria-describedby={undefined}>
      {props.open ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner size="md" />
            </div>
          }
        >
          <SheetWords>
            <SheetContent {...props} />
          </SheetWords>
        </Suspense>
      ) : null}
    </Drawer>
  );
}

function SheetWords({ children }: { children: ReactNode }): ReactNode {
  use(studioMessagesReady());
  return children;
}

function SheetContent({ onOpenChange, connectionId, table, onSaved }: TableEmailSheetProps): ReactNode {
  const query = useQuery(tableSheetQuery(connectionId, table));
  const close = t('studio:marketingMail.close', 'Close');
  if (query.isError) {
    const refused = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 409);
    return (
      <>
        <DrawerHeader icon={<Settings2 />} title={t('studio:marketingMail.sheet.titlePlain', 'E-mail settings')} closeLabel={close} />
        <DrawerBody>
          <Alert
            tone={refused ? 'warn' : 'danger'}
            title={
              refused
                ? t('studio:marketingMail.sheet.refused', 'You can’t change the e-mail settings of this table.')
                : t('studio:marketingMail.sheet.loadFailed', 'These settings could not be loaded. Try again.')
            }
          />
        </DrawerBody>
      </>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }
  return <SheetForm key={`${query.data.canEmail}|${query.data.email}|${query.data.name ?? ''}|${query.data.existingCustomers.on}`} sheet={query.data} onOpenChange={onOpenChange} onSaved={onSaved} />;
}

/** The comp's picker field: icon, value, and the native list under it. */
function ColumnPicker({ label, icon, value, options, onChange, testId }: { label: string; icon: ReactNode; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; testId: string }): ReactNode {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-body-sm font-bold text-fg">{label}</span>
      <span className="relative flex items-center">
        <span aria-hidden className="pointer-events-none absolute start-[11px] text-fg-muted [&_svg]:size-[15px]">
          {icon}
        </span>
        <Select value={value} onChange={(event) => onChange(event.target.value)} className="ps-8" wrapperClassName="w-full" data-testid={testId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </span>
    </label>
  );
}

function SheetForm({ sheet, onOpenChange, onSaved }: { sheet: TableEmailSheetData; onOpenChange: (open: boolean) => void; onSaved?: ((sheet: TableEmailSheetData) => void) | undefined }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [canEmail, setCanEmail] = useState(sheet.canEmail);
  const [email, setEmail] = useState(sheet.email);
  const [name, setName] = useState(sheet.name ?? '');
  const offered = sheet.existingCustomers.offered;
  const [existing, setExisting] = useState(sheet.existingCustomers.on);
  const [ticked, setTicked] = useState(sheet.existingCustomers.on);
  const [saving, setSaving] = useState(false);

  const addressColumns = sheet.columns.filter((column) => column.address).map((column) => ({ value: column.name, label: column.label }));
  const nameColumns = [...(sheet.name === null ? [{ value: '', label: '\u2014' }] : []), ...sheet.columns.map((column) => ({ value: column.name, label: column.label }))];
  const tableChanged = canEmail !== sheet.canEmail || email !== sheet.email || name !== (sheet.name ?? '');
  const existingChanged = offered && (existing !== sheet.existingCustomers.on || (existing && ticked !== sheet.existingCustomers.on));
  // On needs the tick: the comp's Save stays disabled until it is ticked.
  const blocked = offered && existing && !ticked;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      let now = sheet;
      if (tableChanged) now = await putTableSheet({ connectionId: sheet.connectionId, table: sheet.table, canEmail, email, name: name === '' ? null : name });
      if (existingChanged && canEmail) {
        const switched = await putExistingCustomers({ connectionId: sheet.connectionId, table: sheet.table, on: existing, optOutOffered: existing && ticked });
        now = { ...now, existingCustomers: switched };
      }
      queryClient.setQueryData(tableSheetQuery(sheet.connectionId, sheet.table).queryKey, now);
      // The send dialog's list and every other reader of the tables follow.
      await queryClient.invalidateQueries({ queryKey: ['email-audience'] });
      onSaved?.(now);
      toasts.push({ variant: 'success', title: t('studio:marketingMail.sheet.saved', 'E-mail settings saved.') });
      onOpenChange(false);
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.sheet.saveFailed', 'The settings were not saved. Try again.') });
    } finally {
      setSaving(false);
    }
  }

  const switchRow = (label: string, checked: boolean, onChange: (next: boolean) => void, disabled = false): ReactNode => (
    <div className="flex items-start gap-3">
      <div className="flex-1 text-body font-bold text-fg">{label}</div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );

  return (
    <>
      <DrawerHeader
        icon={<Settings2 />}
        title={t('studio:marketingMail.sheet.title', 'E-mail settings for {table}', { table: sheet.label })}
        subtitle={t('studio:marketingMail.sheet.subtitle', '{table} — {app}', { table: sheet.label, app: sheet.appName })}
        closeLabel={t('studio:marketingMail.close', 'Close')}
        className="items-center py-[18px]"
      />
      <DrawerBody className="flex flex-col gap-[18px] py-[18px]" data-testid="table-email-sheet">
        {switchRow(t('studio:marketingMail.sheet.canEmail', 'Can be e-mailed from campaigns'), canEmail, setCanEmail)}
        <div className="grid grid-cols-2 gap-3">
          <ColumnPicker label={t('studio:marketingMail.sheet.emailColumn', 'E-mail column')} icon={<AtSign />} value={email} options={addressColumns} onChange={setEmail} testId="sheet-email-column" />
          <ColumnPicker label={t('studio:marketingMail.sheet.nameColumn', 'Name column')} icon={<Type />} value={name} options={nameColumns} onChange={setName} testId="sheet-name-column" />
        </div>
        {offered ? (
          <>
            <div className="h-px bg-border" />
            <fieldset disabled={!canEmail} className="flex flex-col gap-[18px] disabled:opacity-60" data-part="existing-customers">
              <div className="flex flex-col gap-2.5">
                <span className="text-micro uppercase text-fg-subtle">{t('studio:marketingMail.sheet.existingHeading', 'Existing customers')}</span>
                {switchRow(t('studio:marketingMail.sheet.existing', 'Existing customers may get marketing mail without ticking a box'), existing, (next) => {
                  setExisting(next);
                  if (!next) setTicked(false);
                }, !canEmail)}
                <p className="text-body-sm text-fg-muted">
                  {t(
                    'studio:marketingMail.sheet.existingBody',
                    'In the UK, the EU and Canada (for two years after a purchase) you may e-mail your own customers about similar things if you offered a way to say no when you took their address, and in every mail. It does not apply everywhere:',
                  )}{' '}
                  <a href={docsUrl(EXISTING_CUSTOMERS_GUIDE)} target="_blank" rel="noreferrer" className="font-bold text-accent hover:underline">
                    {t('studio:marketingMail.sheet.guide', 'check the guide')}
                  </a>
                  .
                </p>
              </div>
              {existing ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-body-sm font-bold text-fg">{t('studio:marketingMail.sheet.customer', 'Who counts as a customer')}</span>
                    <div className="flex items-center gap-2 rounded-[10px] border border-border-strong bg-surface-2 px-[11px] py-[9px] text-body text-fg" data-testid="sheet-customer">
                      <Handshake aria-hidden className="size-[15px] shrink-0 text-fg-muted" />
                      <span className="flex-1">{sheet.customer?.label ?? '—'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ticked}
                    aria-required="true"
                    onClick={() => setTicked((prev) => !prev)}
                    data-testid="sheet-tick"
                    className="flex items-start gap-2.5 rounded-[10px] border border-border-strong bg-surface-2 p-3 text-start text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span aria-hidden className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded-sm ${ticked ? 'bg-accent text-accent-fg' : 'border-[1.5px] border-border-strong bg-surface'}`}>
                      {ticked ? <Check className="size-[13px]" /> : null}
                    </span>
                    <span className="flex-1 text-body">{t('studio:marketingMail.sheet.tick', 'I offered a way to say no when we took their address')}</span>
                  </button>
                </>
              ) : null}
            </fieldset>
          </>
        ) : null}
      </DrawerBody>
      <DrawerFooter className="gap-[9px] py-[14px]">
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
          {t('studio:marketingMail.cancel', 'Cancel')}
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={blocked} data-testid="sheet-save">
          {t('studio:marketingMail.sheet.save', 'Save')}
        </Button>
      </DrawerFooter>
    </>
  );
}
