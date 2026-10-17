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
 *  3. A part built on an add-on is drawn under that add-on, connected or not
 *     (the install canvas's boxes); under the parts, the roles left with
 *     nothing to open while every part of theirs is off.
 *
 * Every row is the server's (`GET /apps/:key/parts`); the card decides nothing
 * about what "off" means.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Checkbox, Modal, ModalBody, ModalFooter, ModalHeader, Spinner, Switch } from '@adminium/ui';
import { LayoutGrid, Map as MapIcon, Power, PowerOff } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { appPartsKey, appPartsQuery, fetchAppPartOpen, setAppPart, type AppAddOnRow, type AppPart, type AppPartOpen, type PlanModule, type PlanWhole } from './appsApi.js';
import { manifestWords, namesList } from './addOnWords.js';

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

/** The parts built on add-ons, grouped by the add-ons they need, in the order the parts come. */
function groupsOf(parts: readonly AppPart[]): { key: string; names: string[]; connected: boolean; parts: AppPart[] }[] {
  const out: { key: string; names: string[]; connected: boolean; parts: AppPart[] }[] = [];
  for (const part of parts) {
    const needs = part.needs ?? [];
    if (needs.length === 0) continue;
    const key = needs.map((addOn) => addOn.key).join('+');
    const group = out.find((one) => one.key === key) ?? out[out.push({ key, names: needs.map((addOn) => addOn.name), connected: true, parts: [] }) - 1]!;
    group.parts.push(part);
    if (part.waiting.length > 0) group.connected = false;
  }
  return out;
}

/** The app's roles every part of which is off now: left with nothing to open. A role of no part is never one. */
export function strandedRoles(parts: readonly AppPart[]): string[] {
  const of = new Map<string, { name: string; on: boolean }>();
  for (const part of parts) {
    for (const role of part.roles) {
      const seen = of.get(role.slug) ?? { name: role.name, on: false };
      of.set(role.slug, { name: seen.name, on: seen.on || part.on });
    }
  }
  return [...of.values()].filter((role) => !role.on).map((role) => role.name);
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
  const stranded = strandedRoles(parts.data.parts);

  const item = (part: AppPart) => (
    <li key={part.id} className="flex items-start gap-3 rounded-[11px] border border-border bg-surface px-3 py-2.5" data-part={part.id} data-on={part.on}>
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
  );

  return (
    <section className={CARD} data-testid="app-parts">
      <h3 className="mb-[6px] flex items-center gap-[9px]">
        <LayoutGrid aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-extrabold leading-[normal] tracking-[-0.01em]">{t('studio:appParts.title', 'Parts')}</span>
      </h3>
      <p className="mb-[13px] text-[12.5px] leading-[1.5] text-fg-muted">
        {t('studio:appParts.help', 'Switch off the parts this business does not use. A part that is off has no pages, rules or roles; its records stay.')}
      </p>
      <ul className="flex flex-col gap-[9px]">{parts.data.parts.filter((part) => (part.needs ?? []).length === 0).map(item)}</ul>
      {groupsOf(parts.data.parts).map((group) => (
        <div key={group.key} className="mt-[9px] rounded-[11px] border border-border bg-surface-2 px-3 py-2.5" data-part-addon={group.key}>
          <p className="text-[13px] leading-[normal] text-fg-muted">
            <span className="font-bold text-fg">{namesList(group.names)}</span> · {t('studio:appParts.groupAddOn', 'add-on')}
          </p>
          <p className="mb-2 mt-1 text-xs leading-[1.5] text-fg-muted" data-part="addon-state">
            {group.connected
              ? t('studio:appParts.groupConnected', 'Connected: the parts below work with it.')
              : t('studio:appParts.groupNotConnected', 'Not connected: the parts below wait for it. Connect it under Add-ons and they are put in.')}
          </p>
          <ul className="flex flex-col gap-[9px]">{group.parts.map(item)}</ul>
        </div>
      ))}
      {stranded.length === 0 ? null : (
        <p role="status" className="mt-3 rounded-[10px] bg-warn-soft px-3 py-2 text-xs font-bold leading-[1.5] text-warn" data-part="stranded">
          {t('studio:appParts.installStranded', '{roles} {count, plural, one {is} other {are}} left with nothing to open with these parts.', { roles: namesList(stranded), count: stranded.length })}
        </p>
      )}
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

/** Whether a part comes on with this install: ticked, and not left out for an add-on that is not ticked. */
export function partStartsOn(module: PlanModule, picks: Readonly<Record<string, boolean>>): boolean {
  return !module.leftOut && partTicked(module, picks);
}

/**
 * What the ticks would make, worked out (never an example): the tables the
 * install makes, the roles offered (a role of no part, or of a part that
 * starts on) and the rules (of no part, or of a part that starts on); and the
 * roles of the app left with nothing to open, every part of theirs being off.
 * Null without the server's `whole` (an older server): nothing is guessed.
 */
export function partsSummary(
  modules: readonly PlanModule[],
  picks: Readonly<Record<string, boolean>>,
  whole: PlanWhole | undefined,
  tables: number,
): { tables: number; roles: number; rules: number; stranded: string[] } | null {
  if (whole === undefined) return null;
  const on = new Set(modules.filter((module) => partStartsOn(module, picks)).map((module) => module.id));
  const offered = whole.roles.filter((role) => role.parts.length === 0 || role.parts.some((part) => on.has(part)));
  return {
    tables,
    roles: offered.length,
    rules: whole.rules + modules.filter((module) => on.has(module.id)).reduce((sum, module) => sum + (module.rules ?? 0), 0),
    stranded: whole.roles.filter((role) => role.parts.length > 0 && !role.parts.some((part) => on.has(part))).map((role) => role.name),
  };
}

/**
 * The install check's "Parts" card: a tick for each part that has a switch.
 * The parts that wait for an add-on are drawn under that add-on, which is
 * ticked on the Add-ons card: unticked, they are left out and say what they
 * wait for. Under them, the roles the ticks leave with nothing to open, and
 * what the install will make, worked out from the ticks.
 */
export function PartsInstallCard({
  appName,
  modules,
  picks,
  addOns,
  onTick,
  busy,
  whole,
  tables,
}: {
  appName: string;
  modules: readonly PlanModule[];
  picks: Readonly<Record<string, boolean>>;
  addOns: readonly AppAddOnRow[];
  onTick: (id: string, next: boolean) => void;
  busy: boolean;
  /** The app's roles and rules of no part (`plan.whole`); absent from an older server. */
  whole?: PlanWhole | undefined;
  /** The tables this install makes, with the add-ons ticked: the app's and theirs. */
  tables: number;
}) {
  const nameOf = (key: string) => addOns.find((row) => row.key === key)?.name ?? key;
  const fixed = modules.filter((module) => module.default === 'always').map((module) => manifestWords(module.label));
  // The add-ons parts wait for, each once, in the order the parts name them.
  const groups: string[][] = [];
  for (const module of modules) if (module.needs.length > 0 && !groups.some((needs) => needs.join('+') === module.needs.join('+'))) groups.push(module.needs);
  const summary = partsSummary(modules, picks, whole, tables);

  const row = (module: PlanModule) => {
    const label = manifestWords(module.label);
    const always = module.default === 'always';
    return (
      <li key={module.id} data-part={module.id}>
        <label className={`flex items-start gap-2.5 ${always || module.leftOut ? '' : 'cursor-pointer'}`}>
          <Checkbox
            checked={partStartsOn(module, picks)}
            disabled={always || module.leftOut || busy}
            aria-label={t('studio:appParts.installTick', 'Start with {part}', { part: label })}
            onCheckedChange={(next) => onTick(module.id, next === true)}
          />
          <span className="text-[12.5px] leading-[1.5] text-fg-muted">
            <span className={`font-bold ${module.leftOut ? 'text-fg-subtle' : 'text-fg'}`}>{label}</span>
            {always ? ` — ${t('studio:appParts.installAlways', 'always on')}` : null}
            {module.roles.length === 0 ? null : <span className="block">{t('studio:appParts.roles', 'Roles: {roles}', { roles: module.roles.join(', ') })}</span>}
            {module.leftOut ? (
              <span className="block" data-part="needs">
                {t('studio:appParts.installWaiting', 'Waiting for the {addOns} add-on.', { addOns: namesList(module.needs.map(nameOf)) })}
              </span>
            ) : null}
          </span>
        </label>
      </li>
    );
  };

  return (
    <section className="rounded-[14px] border border-border bg-surface p-[18px] shadow-sm" data-testid="install-parts">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <LayoutGrid aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{t('studio:appParts.title', 'Parts')}</span>
      </h3>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
        {fixed.length === 0
          ? t('studio:appParts.installCount', '{count, plural, one {# part.} other {# parts.}}', { count: modules.length })
          : t('studio:appParts.installCountFixed', '{count, plural, one {# part.} other {# parts.}} {fixed} {always, plural, one {is} other {are}} always part of it.', {
              count: modules.length,
              fixed: namesList(fixed),
              always: fixed.length,
            })}{' '}
        {t('studio:appParts.installHelp', 'Choose the parts of {app} to start with. Any of them can be switched on or off later, in the app’s settings.', { app: appName })}
      </p>
      <ul className="flex flex-col gap-2">{modules.filter((module) => module.needs.length === 0).map(row)}</ul>
      {groups.map((needs) => {
        const ticked = modules.some((module) => module.needs.join('+') === needs.join('+') && !module.leftOut);
        return (
          <div key={needs.join('+')} className="mt-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5" data-part-addon={needs.join('+')}>
            <p className="text-[12.5px] leading-[1.5] text-fg-muted">
              <span className="font-bold text-fg">{namesList(needs.map(nameOf))}</span> · {t('studio:appParts.groupAddOn', 'add-on')}
            </p>
            <p className="mb-1.5 text-[11.5px] leading-[1.45] text-fg-subtle" data-part="addon-state">
              {ticked
                ? t('studio:appParts.groupTicked', 'Ticked under Add-ons: the parts below come with it.')
                : t('studio:appParts.groupWaiting', 'Not ticked under Add-ons: the parts below wait for it. Tick it there, or connect it later and they are put in.')}
            </p>
            <ul className="flex flex-col gap-2 ps-[30px]">{modules.filter((module) => module.needs.join('+') === needs.join('+')).map(row)}</ul>
          </div>
        );
      })}
      {summary === null || summary.stranded.length === 0 ? null : (
        <p role="status" className="mt-3 rounded-[10px] bg-warn-soft px-3 py-2 text-xs font-bold leading-[1.5] text-warn" data-part="stranded">
          {t('studio:appParts.installStranded', '{roles} {count, plural, one {is} other {are}} left with nothing to open with these parts.', { roles: namesList(summary.stranded), count: summary.stranded.length })}
        </p>
      )}
      {summary === null ? null : (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[1.5]" data-part="will-make">
          <span className="font-bold text-fg-muted">{t('studio:appParts.willMake', 'Will make')}</span>
          <span aria-live="polite" className="font-mono font-semibold text-fg">
            {t('studio:appParts.willMakeCounts', '{tables, plural, one {# table} other {# tables}}, {roles, plural, one {# role} other {# roles}}, {rules, plural, one {# rule} other {# rules}}', {
              tables: summary.tables,
              roles: summary.roles,
              rules: summary.rules,
            })}
          </span>
        </p>
      )}
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
