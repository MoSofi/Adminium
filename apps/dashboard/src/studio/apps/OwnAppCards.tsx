// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The cards an app's page gains for an app someone made (`Your Own App
 * Page.dc.html`) and for one copy of an app installed on several databases
 * (`Apps Per Database.dc.html`):
 *
 *  - **After you install**: what the file could not carry (a web address, a
 *    sender, recipients, a role's console rights), one row each, ticked off
 *    when done. The server ticks what it can see done; a person ticks the
 *    rest, and only the rows whose right they hold. Hide appears once
 *    everything is done, and is kept on the install.
 *  - **The look and languages**: what the file's server-wide part wrote, with
 *    Undo for someone who manages settings.
 *  - **What it added**: the install's own pages, email templates, scheduled
 *    reports and roles.
 *  - **Edit these screens**: "Make it editable here", for a file that carries
 *    its screens' source, on a server with a project folder.
 *
 * Every read and write names the install (`useInstallId`).
 */
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, MonoText, ProgressBar, cn } from '@adminium/ui';
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Check,
  CheckCircle2,
  FileCode2,
  Files,
  ImageIcon,
  Info,
  Languages,
  ListTodo,
  Lock,
  Mail,
  Palette,
  Settings2,
  ShieldCheck,
  Type,
  Undo2,
} from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { getI18nInstance, t } from '../../i18n/t.js';
import {
  APPS_QUERY_KEY,
  afterInstallKey,
  afterInstallQuery,
  appLookKey,
  appLookQuery,
  appOverviewKey,
  editableKey,
  editableQuery,
  hideAfterInstall,
  makeEditable,
  tickAfterInstall,
  undoAppLook,
  type AfterInstallEntry,
  type AfterInstallList,
  type AppLook,
  type AppOverview,
  type EditableState,
  type LookGroup,
} from './appsApi.js';
import { CARD, CardTitle } from './appPageParts.js';
import { useInstallId } from './installScope.js';

function formatters() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

const ROW_BUTTON = 'h-auto gap-1.5 rounded-[10px] px-3.5 py-2 font-bold leading-[normal]';

/** A sentence with its counts in mono, as the comps set every figure. */
export function monoDigits(text: string): ReactNode {
  const parts = text.split(/(\d+)/);
  return parts.length === 1 ? text : parts.map((part, index) => (index % 2 === 1 ? <MonoText key={index}>{part}</MonoText> : part));
}

// ── After you install ────────────────────────────────────────────────────────

/**
 * One row of the list. The comp says some things once for many items ("Set
 * the sender address for 8 email templates", "Choose who receives the 3
 * scheduled reports"), so a row is a group: every sender together, every
 * scheduled report together, each other item by what it belongs to.
 */
export interface AfterInstallRow {
  key: string;
  kind: string;
  items: AfterInstallEntry[];
  done: boolean;
  canTick: boolean;
  right: string;
  doneBy: { name: string; at: number | null } | null;
  /** Done because the server sees it done, with nobody's tick. */
  seen: boolean;
  link: AfterInstallEntry['link'];
}

/** The list's rows, in the server's order. */
export function afterInstallRows(items: readonly AfterInstallEntry[]): AfterInstallRow[] {
  const rows = new Map<string, AfterInstallEntry[]>();
  for (const item of items) {
    const key = item.kind === 'sender' || item.kind === 'recipients' ? item.kind : `${item.kind}\u0000${item.item}`;
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  return [...rows.entries()].map(([key, group]) => {
    const ticked = group.filter((item) => item.doneBy !== null).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0];
    const done = group.every((item) => item.done);
    return {
      key,
      kind: group[0]!.kind,
      items: group,
      done,
      canTick: group.every((item) => item.canTick),
      right: group.find((item) => !item.canTick)?.right ?? group[0]!.right,
      doneBy: done && ticked?.doneBy != null ? { name: ticked.doneBy.name, at: ticked.doneAt } : null,
      seen: done && group.every((item) => item.seen),
      link: group[0]!.link,
    };
  });
}

/** What a row asks for, in a sentence. */
export function afterInstallText(row: AfterInstallRow): string {
  const first = row.items[0]!;
  const name = first.name ?? first.item;
  const count = row.items.length;
  switch (row.kind) {
    case 'webhook':
      return /header/i.test(first.field)
        ? t('studio:apps.afterInstall.item.webhookHeader', "Fill in the header value of '{name}'", { name })
        : t('studio:apps.afterInstall.item.webhook', "Add the web address to '{name}'", { name });
    case 'address':
      return t('studio:apps.afterInstall.item.address', "Add the email address to '{name}'", { name });
    case 'document':
      return t('studio:apps.afterInstall.item.document', "Choose the document '{name}' sends", { name });
    case 'delivery':
      return t('studio:apps.afterInstall.item.delivery', "Choose where '{name}' is mailed", { name });
    case 'recipients':
      return t('studio:apps.afterInstall.item.recipients', '{count, plural, one {Choose who receives the scheduled report} other {Choose who receives the # scheduled reports}}', { count });
    case 'sender':
      return t('studio:apps.afterInstall.item.sender', '{count, plural, one {Set the sender address for # email template} other {Set the sender address for # email templates}}', { count });
    case 'payment-key':
      return t('studio:apps.afterInstall.item.paymentKey', "Add the keys for '{name}'", { name });
    case 'bank-account':
      return t('studio:apps.afterInstall.item.bankAccount', "Add the bank account for '{name}'", { name });
    case 'system-grant':
      return t('studio:apps.afterInstall.item.systemGrant', 'Give the {name} role its console rights', { name });
    default:
      return t('studio:apps.afterInstall.item.other', "Fill in '{name}'", { name });
  }
}

/** Where a row is done, as a link's words. */
function linkText(to: NonNullable<AfterInstallEntry['link']>['to']): string {
  switch (to) {
    case 'automation':
      return t('studio:apps.afterInstall.link.automation', 'Open the rule');
    case 'email-templates':
      return t('studio:apps.afterInstall.link.emailTemplates', 'Open email settings');
    case 'reports':
      return t('studio:apps.afterInstall.link.reports', 'Open reports');
    case 'roles':
      return t('studio:apps.afterInstall.link.roles', 'Open roles');
    case 'payments':
      return t('studio:apps.afterInstall.link.payments', 'Open payments');
    case 'documents':
      return t('studio:apps.afterInstall.link.documents', 'Open documents');
    default:
      return t('studio:apps.afterInstall.link.settings', 'Open settings');
  }
}

/** "Needs someone who manages …", from the right a row needs. */
export function needsWords(right: string): string {
  if (right.includes('automations')) return t('studio:apps.afterInstall.needs.automations', 'Needs someone who manages automations');
  if (right.includes('settings')) return t('studio:apps.afterInstall.needs.settings', 'Needs someone who manages settings');
  if (right.includes('reports')) return t('studio:apps.afterInstall.needs.reports', 'Needs someone who manages reports');
  if (right.includes('roles')) return t('studio:apps.afterInstall.needs.roles', 'Needs someone who manages roles');
  if (right.includes('payments')) return t('studio:apps.afterInstall.needs.payments', 'Needs someone who manages payments');
  return t('studio:apps.afterInstall.needs.apps', 'Needs someone who manages apps');
}

function RowLink({ link }: { link: NonNullable<AfterInstallEntry['link']> }) {
  const className = 'inline-flex w-fit items-center gap-[5px] text-[12.5px] font-bold leading-[normal] text-accent hover:underline';
  const body = (
    <>
      {linkText(link.to)}
      <ArrowRight aria-hidden className="size-[13px] rtl:-scale-x-100" />
    </>
  );
  switch (link.to) {
    case 'automation':
      return (
        <Link to="/automations" search={link.id === undefined ? {} : { rule: link.id }} className={className}>
          {body}
        </Link>
      );
    case 'email-templates':
      return link.id === undefined ? (
        <Link to="/email-templates" className={className}>
          {body}
        </Link>
      ) : (
        <Link to="/email-templates/$id" params={{ id: link.id }} className={className}>
          {body}
        </Link>
      );
    case 'roles':
      return (
        <Link to="/settings/roles" className={className}>
          {body}
        </Link>
      );
    case 'payments':
      return (
        <Link to="/studio/payments" className={className}>
          {body}
        </Link>
      );
    case 'documents':
      return (
        <Link to="/studio/documents" className={className}>
          {body}
        </Link>
      );
    case 'reports':
      // The scheduled reports' own list (the Account rows' "Scheduled reports").
      return (
        <a href="/reports" className={className}>
          {body}
        </a>
      );
    default:
      return (
        <Link to="/studio/settings" className={className}>
          {body}
        </Link>
      );
  }
}

/**
 * The comp's square tick: a real checkbox (`role="checkbox"`), 18 px drawn on
 * a 24 px target. A row whose right the reader lacks is `aria-disabled` and
 * described by its "Needs someone who…" line.
 */
function Tick({ checked, label, disabled, describedBy, onToggle }: { checked: boolean; label: string; disabled: boolean; describedBy?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      className="-m-[3px] flex size-6 shrink-0 items-center justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-[18px] items-center justify-center rounded-[6px] border',
          checked ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-surface text-transparent',
          disabled ? 'opacity-60' : '',
        )}
      >
        <Check className="size-[13px]" strokeWidth={2.5} />
      </span>
    </button>
  );
}

export function AfterInstallCard({ appKey, onNotice }: { appKey: string; onNotice: (message: string) => void }) {
  const install = useInstallId();
  const queryClient = useQueryClient();
  const query = useQuery(afterInstallQuery(appKey, install));
  const headingId = useId();
  const put = (next: AfterInstallList): void => {
    queryClient.setQueryData(afterInstallKey(appKey, install), next);
    // The page's activity says who did it.
    void queryClient.invalidateQueries({ queryKey: appOverviewKey(appKey, install) });
  };
  const tick = useMutation({
    mutationFn: async (input: { row: AfterInstallRow; done: boolean }) => {
      let last: AfterInstallList | null = null;
      for (const item of input.row.items) {
        if (item.done === input.done && !(input.done === false && item.seen)) continue;
        last = await tickAfterInstall(appKey, item.id, input.done, install);
      }
      return last;
    },
    onSuccess: (next) => {
      if (next !== null) put(next);
    },
  });
  const hide = useMutation({
    mutationFn: () => hideAfterInstall(appKey, true, install),
    onSuccess: (next) => {
      put(next);
      onNotice(t('studio:apps.afterInstall.hidden', 'After you install is hidden'));
    },
  });

  if (query.data === undefined || query.data.items.length === 0 || query.data.hidden) return null;
  const rows = afterInstallRows(query.data.items);
  const done = rows.filter((row) => row.done).length;
  const allSet = done === rows.length;
  const formatter = formatters();
  const progressText = t('studio:apps.afterInstall.count', '{done} of {total} done', { done, total: rows.length });

  return (
    <section className={CARD} aria-labelledby={headingId} data-testid="after-install">
      {allSet ? (
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-pos-soft text-pos">
            <CheckCircle2 className="size-[18px]" />
          </span>
          <div className="min-w-[160px] flex-1">
            <h3 id={headingId} className="text-sm font-bold leading-[normal]">
              {t('studio:apps.afterInstall.allSet', 'All set')}
            </h3>
            <p className="text-[12.5px] leading-[normal] text-fg-muted">
              {t('studio:apps.afterInstall.allSetBody', 'Every step after installing is done.')}
            </p>
          </div>
          <Button variant="secondary" className={ROW_BUTTON} disabled={hide.isPending} onClick={() => hide.mutate()}>
            {t('studio:apps.afterInstall.hide', 'Hide')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-[9px]">
            <span aria-hidden className="text-accent [&_svg]:size-4">
              <ListTodo />
            </span>
            <h3 id={headingId} className="text-sm font-extrabold leading-[normal] tracking-[-0.01em]">
              {t('studio:apps.afterInstall.title', 'After you install')}
            </h3>
            <span className="ms-auto text-xs font-bold leading-[normal] text-fg-muted">{monoDigits(progressText)}</span>
          </div>
          <ProgressBar
            size="sm"
            animated={false}
            value={done}
            max={rows.length}
            label={t('studio:apps.afterInstall.title', 'After you install')}
            aria-valuetext={progressText}
          />
          <ul className="flex flex-col">
            {rows.map((row, index) => {
              const noteId = `${headingId}-needs-${String(index)}`;
              return (
                <li key={row.key} className={cn('flex items-start gap-2.5 py-3', index === 0 ? '' : 'border-t border-border')} data-testid="after-install-row">
                  <Tick
                    checked={row.done}
                    label={afterInstallText(row)}
                    disabled={!row.canTick || tick.isPending}
                    {...(row.canTick ? {} : { describedBy: noteId })}
                    onToggle={() => tick.mutate({ row, done: !row.done })}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <div className={cn('text-[13px] font-semibold leading-[1.45]', row.done ? 'text-fg-muted line-through' : '')}>{monoDigits(afterInstallText(row))}</div>
                    {row.done ? (
                      <div className="flex items-center gap-1.5 text-[11.5px] leading-[normal] text-pos">
                        <CheckCircle2 aria-hidden className="size-3" />
                        <span>
                          {row.doneBy === null
                            ? t('studio:apps.afterInstall.seenDone', 'Done')
                            : t('studio:apps.afterInstall.doneBy', 'Done by {name} {when}', {
                                name: row.doneBy.name,
                                when: row.doneBy.at === null ? '' : formatter.relative(row.doneBy.at),
                              })}
                        </span>
                      </div>
                    ) : null}
                    {row.canTick ? null : (
                      <div id={noteId} className="flex items-center gap-1.5 text-[11.5px] leading-[normal] text-fg-subtle">
                        <Lock aria-hidden className="size-3" />
                        {needsWords(row.right)}
                      </div>
                    )}
                    {row.done || row.link === null ? null : <RowLink link={row.link} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {tick.error === null ? null : (
            <p role="alert" className="text-xs text-danger">
              {tick.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ── The look and languages ───────────────────────────────────────────────────

/** "logo, colours, 2 languages, 12 wordings, 2 system emails". */
function lookParts(look: AppLook): string[] {
  const parts: string[] = [];
  if (look.logo) parts.push(t('studio:apps.look.part.logo', 'logo'));
  if (look.colours) parts.push(t('studio:apps.look.part.colours', 'colours'));
  if (look.languages.length > 0) parts.push(t('studio:apps.look.part.languages', '{count, plural, one {# language} other {# languages}}', { count: look.languages.length }));
  if (look.wordings > 0) parts.push(t('studio:apps.look.part.wordings', '{count, plural, one {# wording} other {# wordings}}', { count: look.wordings }));
  if (look.systemEmails > 0) parts.push(t('studio:apps.look.part.systemEmails', '{count, plural, one {# system email} other {# system emails}}', { count: look.systemEmails }));
  if (look.settings > 0) parts.push(t('studio:apps.look.part.settings', '{count, plural, one {# setting} other {# settings}}', { count: look.settings }));
  return parts;
}

/** A language tag in the reader's language: `de-DE` → "German". */
function languageName(tag: string): string {
  try {
    const names = new Intl.DisplayNames([getI18nInstance()?.language ?? 'en-US'], { type: 'language' });
    return names.of(tag.split('-')[0] ?? tag) ?? tag;
  } catch {
    return tag;
  }
}

export function LookCard({ appKey, appName, onNotice }: { appKey: string; appName: string; onNotice: (message: string) => void }) {
  const install = useInstallId();
  const queryClient = useQueryClient();
  const query = useQuery(appLookQuery(appKey, install));
  const [asking, setAsking] = useState(false);
  const undo = useMutation({
    mutationFn: () => undoAppLook(appKey, install),
    onSuccess: async () => {
      setAsking(false);
      onNotice(t('studio:apps.look.undone', 'The look and languages are back to what was here before'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appLookKey(appKey, install) }),
        queryClient.invalidateQueries({ queryKey: appOverviewKey(appKey, install) }),
        // The menu's name, the logo and the words come with the bootstrap.
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });
  const look = query.data?.look ?? null;
  if (look === null) return null;
  const date = new Intl.DateTimeFormat(getI18nInstance()?.language ?? 'en-US', { day: 'numeric', month: 'short' }).format(look.appliedAt);
  const changed = new Set<LookGroup>(look.changed);
  const confirmList: { group: LookGroup; icon: ReactNode; text: ReactNode; shown: boolean }[] = [
    { group: 'logo', icon: <ImageIcon />, text: t('studio:apps.look.row.logo', 'Logo'), shown: look.logo },
    { group: 'colours', icon: <Palette />, text: t('studio:apps.look.row.colours', 'Colours'), shown: look.colours },
    {
      group: 'languages',
      icon: <Languages />,
      text: t('studio:apps.look.row.languages', '{count, plural, one {# language · {names}} other {# languages · {names}}}', {
        count: look.languages.length,
        names: look.languages.map(languageName).join(', '),
      }),
      shown: look.languages.length > 0,
    },
    { group: 'wordings', icon: <Type />, text: t('studio:apps.look.row.wordings', '{count, plural, one {# wording} other {# wordings}}', { count: look.wordings }), shown: look.wordings > 0 },
    { group: 'systemEmails', icon: <Mail />, text: t('studio:apps.look.row.systemEmails', '{count, plural, one {# system email} other {# system emails}}', { count: look.systemEmails }), shown: look.systemEmails > 0 },
    { group: 'settings', icon: <Settings2 />, text: t('studio:apps.look.row.settings', '{count, plural, one {# setting} other {# settings}}', { count: look.settings }), shown: look.settings > 0 },
  ];
  return (
    <section className={cn(CARD, 'flex flex-wrap items-start gap-3 py-4')} data-testid="app-look">
      <span aria-hidden className="mt-0.5 text-accent [&_svg]:size-4">
        <Palette />
      </span>
      <div className="min-w-[200px] flex-1">
        <h3 className="mb-[3px] text-sm font-bold leading-[normal]">{t('studio:apps.look.title', 'The look and languages')}</h3>
        <p className="text-[12.5px] leading-[1.5] text-fg-muted">
          {monoDigits(t('studio:apps.look.body', 'Applied from the file on {date}: {parts}.', { date, parts: lookParts(look).join(', ') }))}
        </p>
      </div>
      {look.canUndo ? (
        <Button variant="secondary" className={ROW_BUTTON} onClick={() => setAsking(true)}>
          <Undo2 aria-hidden className="size-[15px]" />
          {t('studio:apps.look.undo', 'Undo')}
        </Button>
      ) : null}
      {asking ? (
        <Modal open onOpenChange={(next) => !next && setAsking(false)}>
          <ModalHeader
            icon={<Undo2 />}
            title={t('studio:apps.look.confirmTitle', 'Put back what was here before?')}
            subtitle={t('studio:apps.look.confirmSubtitle', 'The look and languages · {app}', { app: appName })}
            closeLabel={t('studio:appSettings.close', 'Close')}
          />
          <ModalBody className="flex flex-col gap-3.5">
            <p className="text-[13px] leading-[1.5] text-fg-muted">
              {t('studio:apps.look.confirmBody', 'These were applied from the file on {date}. Undo puts back what this server had before.', { date })}
            </p>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {confirmList
                .filter((entry) => entry.shown)
                .map((entry, index) => (
                  <li key={entry.group} className={cn('flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] leading-[normal]', index === 0 ? '' : 'border-t border-border')}>
                    <span aria-hidden className="text-fg-subtle [&_svg]:size-[15px]">
                      {entry.icon}
                    </span>
                    <span className="flex-1">{entry.text}</span>
                    {changed.has(entry.group) ? (
                      <span className="text-xs text-fg-subtle">{t('studio:apps.look.changedSince', 'changed since, left as they are')}</span>
                    ) : null}
                  </li>
                ))}
            </ul>
            <p className="text-xs text-fg-subtle">{t('studio:apps.look.untouched', 'Pages, rules and data are not touched.')}</p>
            {undo.error === null ? null : <Alert tone="danger" role="alert" title={undo.error.message} />}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t('studio:appSettings.cancel', 'Cancel')}
            </Button>
            <Button disabled={undo.isPending} onClick={() => undo.mutate()}>
              <Undo2 aria-hidden className="size-[15px]" />
              {t('studio:apps.look.putBack', 'Put it back')}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </section>
  );
}

// ── What it added ────────────────────────────────────────────────────────────

export function WhatItAddedCard({ overview, intro, note }: { overview: AppOverview; intro: ReactNode | null; note?: ReactNode | null }) {
  const added = overview.added;
  if (added === undefined) return null;
  const rows: { icon: ReactNode; label: string; count: number }[] = [
    { icon: <Files />, label: t('studio:apps.added.pages', 'Pages'), count: added.pages },
    { icon: <Mail />, label: t('studio:apps.added.emailTemplates', 'Email templates'), count: added.emailTemplates },
    { icon: <CalendarClock />, label: t('studio:apps.added.scheduledReports', 'Scheduled reports'), count: added.scheduledReports },
    { icon: <ShieldCheck />, label: t('studio:apps.added.roles', 'Roles'), count: added.roles },
  ].filter((row) => row.count > 0);
  return (
    <section className={CARD} data-testid="app-added">
      <CardTitle icon={<Boxes />}>{t('studio:apps.added.title', 'What it added')}</CardTitle>
      {intro === null ? null : <p className="mb-3.5 text-[12.5px] leading-[normal] text-fg-muted">{intro}</p>}
      {note === null || note === undefined ? null : (
        <div role="note" className="mb-3.5 flex items-start gap-[11px] rounded-[10px] border border-info/25 bg-info-soft px-[15px] py-[13px] text-[12.5px] leading-[1.5]">
          <Info aria-hidden className="mt-px size-[17px] shrink-0 text-info" />
          <span>{note}</span>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-fg-muted">{t('studio:apps.added.nothing', 'Nothing of its own yet.')}</p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-border">
          {rows.map((row, index) => (
            <li key={row.label} className={cn('flex items-center gap-2.5 px-3.5 py-[11px] text-[13px] leading-[normal]', index === 0 ? '' : 'border-t border-border')}>
              <span aria-hidden className="text-fg-subtle [&_svg]:size-[15px]">
                {row.icon}
              </span>
              <span className="flex-1 text-fg-muted">{row.label}</span>
              <MonoText className="font-bold">{String(row.count)}</MonoText>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Edit these screens ───────────────────────────────────────────────────────

/** The refusal of Make it editable here, said; null when it is offered. */
export function editableRefusal(state: EditableState, appName: string): string | null {
  switch (state.reason) {
    case 'FOLDER_EXISTS':
      return t('studio:apps.editable.folderExists', '{folder} already exists here. Rename or remove that folder first.', { folder: state.folder });
    case 'SEVERAL_INSTALLS':
      return t('studio:apps.editable.severalInstalls', '{app} is installed on {count, plural, one {# database} other {# databases}}. Remove the others first.', {
        app: appName,
        count: state.installs ?? 2,
      });
    case 'NO_PROJECT':
      return t('studio:apps.editable.noProject', 'Editing screens needs a project folder. Open this server with the Designer to make one.');
    default:
      return null;
  }
}

/** "apps/fernhill-shop", in mono, inside a sentence. */
function FolderWords({ text, folder }: { text: string; folder: string }) {
  const MARK = '\u0001';
  const [before = '', after = ''] = text.replace(folder, MARK).split(MARK);
  return (
    <>
      {before}
      <MonoText>{folder}</MonoText>
      {after}
    </>
  );
}

export function EditScreensCard({ appKey, appName, serverName, onNotice }: { appKey: string; appName: string; serverName: string; onNotice: (message: string) => void }) {
  const install = useInstallId();
  const queryClient = useQueryClient();
  const query = useQuery(editableQuery(appKey, install));
  const [asking, setAsking] = useState(false);
  const [made, setMade] = useState(false);
  const refusalId = useId();
  const make = useMutation({
    mutationFn: () => makeEditable(appKey, install),
    onSuccess: async () => {
      setAsking(false);
      setMade(true);
      onNotice(t('studio:apps.editable.done', '{app} is editable here', { app: appName }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: editableKey(appKey, install) }),
        queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY }),
      ]);
    },
  });
  const state = query.data;
  if (state === undefined || state.state === 'none') return null;
  // An app that came from the folder all along has no card; one made editable here says where it is now.
  if (state.reason === 'FROM_FOLDER') {
    if (!made) return null;
    return (
      <section className={CARD} data-testid="app-edit-screens">
        <CardTitle icon={<FileCode2 />}>{t('studio:apps.editable.title', 'Edit these screens')}</CardTitle>
        <div className="flex flex-col gap-2.5 text-[12.5px] leading-[1.5]">
          <span className="w-fit rounded-full bg-surface-3 px-2.5 py-0.5 text-[11.5px] font-bold text-fg-muted">
            <FolderWords folder={state.folder.replace(/\/$/, '')} text={t('studio:hostedApps.installed.fromFolder', 'From the folder {folder}', { folder: state.folder.replace(/\/$/, '') })} />
          </span>
          <p className="text-fg-muted">{t('studio:apps.editable.after', 'Open this server with the Designer to change the screens.')}</p>
        </div>
      </section>
    );
  }
  const refusal = editableRefusal(state, appName);
  // A server with no project folder: said, with nothing to press (the Designer makes one).
  const noProject = state.reason === 'NO_PROJECT';
  // Refused for a reason the person can fix: shown in the confirm, before anything is pressed.
  return (
    <section className={CARD} data-testid="app-edit-screens">
      <CardTitle icon={<FileCode2 />}>{t('studio:apps.editable.title', 'Edit these screens')}</CardTitle>
      {noProject ? (
        <p className="text-[12.5px] leading-[1.5] text-fg-muted">{refusal}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-[1.5] text-fg-muted">
            {t('studio:apps.editable.body', "The file has the source of these screens. Copy it into this server's project folder to change them in the Designer.")}
          </p>
          <Button variant="secondary" className={cn(ROW_BUTTON, 'w-fit')} onClick={() => setAsking(true)}>
            <FileCode2 aria-hidden className="size-[15px]" />
            {t('studio:apps.editable.action', 'Make it editable here')}
          </Button>
        </div>
      )}
      {asking ? (
        <Modal open onOpenChange={(next) => !next && setAsking(false)}>
          <ModalHeader
            icon={<FileCode2 />}
            title={t('studio:apps.editable.confirmTitle', 'Make {app} editable here?', { app: appName })}
            subtitle={serverName}
            closeLabel={t('studio:appSettings.close', 'Close')}
          />
          <ModalBody className="flex flex-col gap-3.5">
            <p className="text-[13px] leading-[1.5] text-fg-muted">
              <FolderWords
                folder={state.folder}
                text={t(
                  'studio:apps.editable.confirmBody',
                  "Its source is copied to {folder} so the Designer can change it. From then on the app comes from that folder: newer files of it can't be uploaded here.",
                  { folder: state.folder },
                )}
              />
            </p>
            {refusal === null ? null : <Alert id={refusalId} tone="danger" role="alert" title={refusal} />}
            {make.error === null ? null : <Alert tone="danger" role="alert" title={make.error.message} />}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t('studio:appSettings.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={refusal !== null || make.isPending}
              {...(refusal === null ? {} : { 'aria-describedby': refusalId })}
              onClick={() => make.mutate()}
            >
              {t('studio:apps.editable.confirm', 'Make it editable')}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </section>
  );
}
