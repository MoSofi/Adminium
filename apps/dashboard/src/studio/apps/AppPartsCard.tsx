// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app settings page's "Parts" card: the parts of the app its owner
 * switches on and off, and, in the install check, the ticks they start with.
 *
 * No design draws this card. It is built to the page's own patterns — the
 * Add-ons card's rows and the Screens card's switches — and where it departs
 * from them it says so:
 *
 *  1. A switch asks before it acts, both ways. Off first reads what is open in
 *     the part (rows part way through, rules that are on, people who would be
 *     left with nothing) and lists it; on says that nothing which happened
 *     meanwhile is caught up. The Screens card's switches act at once.
 *  2. A part that waits for an add-on shows a pill in place of a switch that
 *     could not do anything: the add-on is connected on the Add-ons card.
 *
 * Every row is the server's (`GET /apps/:key/parts`); the card decides nothing
 * about what "off" means.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Checkbox, Modal, ModalBody, ModalFooter, ModalHeader, Spinner, Switch } from '@adminium/ui';
import { LayoutGrid, Map as MapIcon, Power, PowerOff } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { appPartsKey, appPartsQuery, fetchAppPartOpen, setAppPart, type AppAddOnRow, type AppPart, type AppPartOpen, type PlanModule } from './appsApi.js';
import { manifestWords } from './addOnWords.js';

const CARD = 'rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm';
const PILL = 'gap-[5px] px-[9px] py-[3px] leading-[normal]';

/** What a part holds, in one line: its pages and rules, then its roles. */
function holdsWords(part: AppPart): string {
  const counts = [
    part.pages === 1 ? t('studio:appParts.onePage', '1 page') : t('studio:appParts.pages', '{n} pages', { n: part.pages }),
    ...(part.rules === 0 ? [] : [part.rules === 1 ? t('studio:appParts.oneRule', '1 rule on') : t('studio:appParts.rules', '{n} rules on', { n: part.rules })]),
  ].join(' · ');
  if (part.roles.length === 0) return counts;
  return `${counts} · ${t('studio:appParts.roles', 'Roles: {roles}', { roles: part.roles.map((role) => role.name).join(', ') })}`;
}

export function AppPartsCard({ appKey }: { appKey: string }) {
  const queryClient = useQueryClient();
  const parts = useQuery(appPartsQuery(appKey));
  const [asking, setAsking] = useState<{ part: AppPart; on: boolean; open: AppPartOpen | null } | null>(null);

  const ask = useMutation({
    mutationFn: async (input: { part: AppPart; on: boolean }) => ({ ...input, open: input.on ? null : await fetchAppPartOpen(appKey, input.part.id) }),
    onSuccess: (next) => setAsking(next),
  });

  const flip = useMutation({
    mutationFn: (input: { part: AppPart; on: boolean }) => setAppPart(appKey, input.part.id, input.on),
    onSuccess: async (next) => {
      queryClient.setQueryData(appPartsKey(appKey), next);
      setAsking(null);
      // Its pages and its roles moved: the sidebar, and what each person holds, are read again.
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['bootstrap'] }), queryClient.invalidateQueries({ queryKey: ['roles'] })]);
    },
  });

  // An app with no parts has no card.
  if (parts.data === undefined || parts.data.parts.length === 0) return null;
  const failure = ask.error ?? flip.error;

  return (
    <section className={CARD} data-testid="app-parts">
      <h3 className="mb-[6px] flex items-center gap-[9px]">
        <LayoutGrid aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-extrabold leading-[normal] tracking-[-0.01em]">{t('studio:appParts.title', 'Parts')}</span>
      </h3>
      <p className="mb-[13px] text-[12.5px] leading-[1.5] text-fg-muted">
        {t('studio:appParts.help', 'Switch off the parts this business does not use. A part that is off has no pages, rules or roles; its records stay.')}
      </p>
      <ul className="flex flex-col gap-[9px]">
        {parts.data.parts.map((part) => (
          <li key={part.id} className="flex items-start gap-3 rounded-[11px] border border-border px-3 py-2.5" data-part={part.id} data-on={part.on}>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold leading-[normal]">{part.label}</p>
              <p className="mt-1 text-xs leading-[1.5] text-fg-muted">{holdsWords(part)}</p>
              {part.waiting.length === 0 ? null : (
                <p className="mt-1 text-xs leading-[1.5] text-fg-muted" data-part="waiting">
                  {part.leftOut
                    ? t('studio:appParts.leftOut', 'Not set up yet. Connect {addOns} under Add-ons and it is put in.', { addOns: part.waiting.map((addOn) => addOn.name).join(', ') })
                    : t('studio:appParts.waiting', 'Off until {addOns} is connected, under Add-ons.', { addOns: part.waiting.map((addOn) => addOn.name).join(', ') })}
                </p>
              )}
            </div>
            {part.default === 'always' ? (
              <Badge tone="neutral" className={PILL}>
                {t('studio:appParts.always', 'Always on')}
              </Badge>
            ) : part.waiting.length > 0 ? (
              <Badge tone="warn" className={PILL}>
                {t('studio:appParts.needs', 'Needs an add-on')}
              </Badge>
            ) : (
              <span className="flex items-center gap-2">
                <Switch
                  checked={part.switch}
                  disabled={ask.isPending || flip.isPending}
                  aria-label={t('studio:appParts.switch', '{part}, on or off', { part: part.label })}
                  onCheckedChange={(next) => ask.mutate({ part, on: next })}
                />
                <span className={`min-w-6 text-xs font-extrabold ${part.switch ? 'text-accent' : 'text-fg-subtle'}`}>
                  {part.switch ? t('studio:appParts.on', 'On') : t('studio:appParts.off', 'Off')}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {failure === null ? null : (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {failure.message}
        </p>
      )}
      {asking === null ? null : (
        <Modal open onOpenChange={(next) => !next && !flip.isPending && setAsking(null)}>
          <ModalHeader
            icon={asking.on ? <Power /> : <PowerOff />}
            title={
              asking.on
                ? t('studio:appParts.onDialog.title', 'Switch on {part}?', { part: asking.part.label })
                : t('studio:appParts.offDialog.title', 'Switch off {part}?', { part: asking.part.label })
            }
            closeLabel={t('studio:appParts.dialogClose', 'Close')}
          />
          <ModalBody>
            {asking.on ? (
              <div className="flex flex-col gap-2 text-[13px] leading-[1.55] text-fg-muted" data-testid="part-on-dialog">
                <p>{t('studio:appParts.onDialog.back', 'Its pages, rules and roles are back at once. No update and no restart is needed.')}</p>
                <p className="font-semibold text-fg">
                  {t('studio:appParts.onDialog.noCatchUp', 'Nothing that happened while it was off is caught up: its rules did not run, and they will not run now for what was missed.')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[13px] leading-[1.55] text-fg-muted" data-testid="part-off-dialog">
                <p>{t('studio:appParts.offDialog.stops', 'Its pages leave the menu, its rules stop and its roles give nothing until it is switched on again.')}</p>
                <OpenList open={asking.open} />
                <p>{t('studio:appParts.offDialog.stays', 'Its records stay. A role of another part that reads them still does.')}</p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" disabled={flip.isPending} onClick={() => setAsking(null)}>
              {t('studio:appParts.cancel', 'Cancel')}
            </Button>
            <Button {...(asking.on ? {} : { variant: 'destructive' as const })} disabled={flip.isPending} onClick={() => flip.mutate({ part: asking.part, on: asking.on })}>
              {flip.isPending ? <Spinner size="sm" /> : null}
              {asking.on ? t('studio:appParts.onDialog.confirm', 'Switch on') : t('studio:appParts.offDialog.confirm', 'Switch off')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}

/** What is open in the part: listed before it is switched off, never a reason the switch refuses. */
function OpenList({ open }: { open: AppPartOpen | null }) {
  if (open === null) return null;
  const lines = [
    ...open.open.map((table) => t('studio:appParts.offDialog.openRows', '{n} not finished in {table}', { n: table.rows, table: table.label })),
    ...(open.rules === 0 ? [] : [open.rules === 1 ? t('studio:appParts.offDialog.oneRule', '1 rule that is on will stop') : t('studio:appParts.offDialog.rules', '{n} rules that are on will stop', { n: open.rules })]),
    ...(open.stranded === 0
      ? []
      : [
          open.stranded === 1
            ? t('studio:appParts.offDialog.oneStranded', '1 person will have nothing switched on for them')
            : t('studio:appParts.offDialog.stranded', '{n} people will have nothing switched on for them', { n: open.stranded }),
        ]),
  ];
  if (lines.length === 0) return <p>{t('studio:appParts.offDialog.nothingOpen', 'Nothing is open in it right now.')}</p>;
  return (
    <div>
      <p className="font-semibold text-fg">{t('studio:appParts.offDialog.open', 'Open in it right now:')}</p>
      <ul className="mt-1 list-disc ps-5" data-part="open">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

// ── The install check ───────────────────────────────────────────────────────

/** Whether a part starts on: the tick, else how it stands (an app already installed), else what the app says. */
export function partTicked(module: PlanModule, picks: Readonly<Record<string, boolean>>): boolean {
  if (module.default === 'always') return true;
  return picks[module.id] ?? module.on ?? module.default === 'on';
}

/** The install body's `modules`: every part that has a switch, as ticked. */
export function partChoicesOf(modules: readonly PlanModule[], picks: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(modules.filter((module) => module.default !== 'always').map((module) => [module.id, partTicked(module, picks)]));
}

/**
 * The install check's "Parts" card: a tick for each part that has a switch.
 * A part built on an add-on that is not ticked says it is left out, and which
 * add-on would put it in.
 */
export function PartsInstallCard({
  appName,
  modules,
  picks,
  addOns,
  onTick,
  busy,
}: {
  appName: string;
  modules: readonly PlanModule[];
  picks: Readonly<Record<string, boolean>>;
  addOns: readonly AppAddOnRow[];
  onTick: (id: string, next: boolean) => void;
  busy: boolean;
}) {
  const nameOf = (key: string) => addOns.find((row) => row.key === key)?.name ?? key;
  return (
    <section className="rounded-[14px] border border-border bg-surface p-[18px] shadow-sm" data-testid="install-parts">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <LayoutGrid aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{t('studio:appParts.title', 'Parts')}</span>
      </h3>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
        {t('studio:appParts.installHelp', 'Choose the parts of {app} to start with. Any of them can be switched on or off later, in the app’s settings.', { app: appName })}
      </p>
      <ul className="flex flex-col gap-2">
        {modules.map((module) => {
          const label = manifestWords(module.label);
          const always = module.default === 'always';
          return (
            <li key={module.id} data-part={module.id}>
              <label className={`flex items-start gap-2.5 ${always ? '' : 'cursor-pointer'}`}>
                <Checkbox
                  checked={partTicked(module, picks)}
                  disabled={always || busy}
                  aria-label={t('studio:appParts.installTick', 'Start with {part}', { part: label })}
                  onCheckedChange={(next) => onTick(module.id, next === true)}
                />
                <span className="text-[12.5px] leading-[1.5] text-fg-muted">
                  <span className="font-bold text-fg">{label}</span>
                  {always ? ` — ${t('studio:appParts.installAlways', 'always on')}` : null}
                  {module.roles.length === 0 ? null : (
                    <span className="block">{t('studio:appParts.roles', 'Roles: {roles}', { roles: module.roles.join(', ') })}</span>
                  )}
                  {module.needs.length === 0 ? null : (
                    <span className="block" data-part="needs">
                      {module.leftOut
                        ? t('studio:appParts.installLeftOut', 'Left out of this install: it needs {addOns}. Tick it under Add-ons, or connect it later and the part is put in.', {
                            addOns: module.needs.map(nameOf).join(', '),
                          })
                        : t('studio:appParts.installNeeds', 'Works with {addOns}, which is installed with the app.', { addOns: module.needs.map(nameOf).join(', ') })}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The install check's "Maps" card: asked once, for the whole install, by the
 * first app that shows maps. Ticked unless the installer says otherwise.
 */
export function MapsInstallCard({
  checked,
  onChange,
  server,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The map server this install uses, as the session says it; absent while maps are off (it is not said then). */
  server?: string | null | undefined;
}) {
  let host: string | null = null;
  try {
    host = server === null || server === undefined ? null : new URL(server).host;
  } catch {
    host = null;
  }
  return (
    <section className="rounded-[14px] border border-border bg-surface p-[18px] shadow-sm" data-testid="install-maps">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <MapIcon aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{t('studio:installMaps.title', 'Maps')}</span>
      </h3>
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
        <span className="text-[12.5px] leading-[1.5] text-fg-muted">
          <span className="font-bold text-fg">
            {host === null ? t('studio:installMaps.tick', 'Show maps (uses OpenFreeMap)') : t('studio:installMaps.tickHost', 'Show maps (uses {host})', { host })}
          </span>
          {' — '}
          {t(
            'studio:installMaps.note',
            'each person’s browser fetches the map’s pictures from the map server. It learns which area is looked at, and nothing about your records. This is one switch for every app here.',
          )}
        </span>
      </label>
    </section>
  );
}
