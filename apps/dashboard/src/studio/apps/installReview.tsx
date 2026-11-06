// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The review of an app file before it is installed or updated, ported from
 * `Install Your Own App.dc.html` (Y-A2) and the install parts of
 * `Apps Per Database.dc.html` (Y-A5).
 *
 * Each card is one section of the comp's "Check before you install": where the
 * file came from (with the fingerprint, compared here in the browser), the
 * tables already here used all at once, page addresses already taken, the
 * rules that would send data out, the look and languages of the whole server,
 * the screens warning, and what is filled in after the install. Each answer is
 * the server's own field; nothing here decides what the install does.
 *
 * The install wizard and the update dialog both build from these cards, so a
 * file reads the same whether it is installed or updated.
 *
 * ─── Departures from the comp ──────────────────────────────────────────────
 *
 *  **R1 — a table that can't be reused stops the install.** The comp offers
 *  "Leave orders out of the app", which switches Install back on. The plan has
 *  no install-time leave-out: the card says why, and the ways forward are to
 *  rename the table here or to save the app again without it.
 *
 *  **R2 — "Rename the page here", not "Rename the app's page".** A taken page
 *  address is answered by moving the page that is here to a new address, so
 *  the app's page takes its own. That is the only rename the server makes; the
 *  button names what it does, and the new address is typed beside it.
 *
 *  **R3 — rule and email names are keys.** The plan names a rule, a schedule
 *  or a mail by the key it has in the file, never by its title, so the lists
 *  show the key in mono where the comp shows "'Post wholesale orders to Slack'".
 *
 *  **R4 — the email diff is a summary.** The plan carries an edited system
 *  email's subject before and after, and which blocks were added, removed or
 *  changed — not its rendered HTML. The diff shows those, not two previews.
 *
 *  **R5 — a system email with no link is not ticked.** The server applies an
 *  edited email when every link host in it is ticked; one with no link goes
 *  with the part. It reads "It has no links, so it is applied with this part"
 *  instead of a tick that would change nothing.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Checkbox, IconTile, Input, MonoText } from '@adminium/ui';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  FileBadge,
  HardDrive,
  ListChecks,
  Lock,
  MonitorSmartphone,
  Package,
  Palette,
  Send,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { namesList, readerTag, sentence } from './addOnWords.js';
import type { AfterInstallItem, AppInstallPlan, InstallAnswers, InstanceEmail, InstancePart, PageClash } from './appsApi.js';

// `leading-[normal]`: the comp renders at `normal`, and this system's `leading-normal` is 1.5.
const SECTION = 'flex flex-col gap-3.5 rounded-[14px] border border-border bg-surface p-5 leading-[normal] shadow-sm';
const SECTION_TITLE = 'text-[14.5px] font-bold tracking-[-0.01em]';
const CHIP = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11.5px] font-bold leading-[normal]';

function Mono({ children }: { children: ReactNode }) {
  return <MonoText className="font-semibold text-fg">{children}</MonoText>;
}

function SectionHead({ icon, title, count }: { icon: ReactNode; title: string; count?: number | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-[9px]">
      <span aria-hidden className="flex text-accent">
        {icon}
      </span>
      <h3 className={SECTION_TITLE}>{title}</h3>
      {count === undefined ? null : <MonoText className={`${CHIP} bg-surface-3 text-fg-muted`}>{count}</MonoText>}
    </div>
  );
}

/** "1 Nov 2026" in the reader's language. */
export function savedDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(readerTag(), { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

// ── The fingerprint ────────────────────────────────────────────────────────

/** A pasted fingerprint, as compared: `sha512-` and its base64, with no space around it. */
function normalFingerprint(value: string): string {
  return value.trim();
}

/** Whether a typed fingerprint is this file's. An empty field matches nothing and holds nothing. */
export function fingerprintMatches(typed: string, integrity: string): boolean {
  const value = normalFingerprint(typed);
  return value !== '' && integrity !== '' && value === integrity;
}

/** Install waits while the field holds a fingerprint that is not this file's, until it is cleared or matches. */
export function fingerprintHolds(typed: string, integrity: string): boolean {
  return normalFingerprint(typed) !== '' && !fingerprintMatches(typed, integrity);
}

/**
 * "Where it came from": the app, its version, "Your own app", where and when it
 * was made, the warning for a file nobody else checked, and the fingerprint
 * check, compared in this browser against the file's own (`sha512-` + base64).
 */
export function WhereItCameFrom({
  name,
  version,
  madeAt,
  publisher,
  integrity,
  fingerprint,
  onFingerprint,
  fieldId,
  compact = false,
  badge,
  chip,
}: {
  name: string;
  version: string;
  madeAt: AppInstallPlan['madeAt'];
  /** The manifest's publisher, for a file not made on an Adminium. */
  publisher?: { id: string; name: string } | undefined;
  /** The uploaded file's own fingerprint; '' when nothing was uploaded (no field then). */
  integrity: string;
  fingerprint: string;
  onFingerprint: (value: string) => void;
  /** The field's id, so a footer reason can point at it. */
  fieldId?: string | undefined;
  /** Inside the update dialog: no section title. */
  compact?: boolean | undefined;
  /** In place of "Your own app" (a workspace file says "Workspace file"). */
  badge?: string | undefined;
  /** In place of the version chip (a workspace file says "{n} apps"). */
  chip?: string | undefined;
}) {
  const own = madeAt !== undefined;
  const generated = useId();
  const field = fieldId ?? `${generated}-fp`;
  const resultId = `${field}-result`;
  // What Check said, for the field as it was checked. Typing again clears it.
  const [result, setResult] = useState<'none' | 'ok' | 'bad'>('none');
  const check = () => setResult(normalFingerprint(fingerprint) === '' ? 'none' : fingerprintMatches(fingerprint, integrity) ? 'ok' : 'bad');
  return (
    <section className={compact ? 'flex flex-col gap-3.5' : SECTION} data-part="where-it-came-from">
      {compact ? null : <SectionHead icon={<FileBadge className="size-[17px]" />} title={t('studio:hostedApps.review.source.title', 'Where it came from')} />}
      <div className="flex flex-wrap items-center gap-[13px]">
        <IconTile tone="accent" className="size-10 [&_svg]:size-5">
          <Package aria-hidden />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{name}</span>
            {chip === undefined ? <MonoText className={`${CHIP} bg-surface-3 text-fg-muted`}>{version}</MonoText> : null}
            {own ? (
              <span className={`${CHIP} bg-accent-soft text-accent`}>
                <HardDrive aria-hidden className="size-3" />
                {badge ?? t('studio:hostedApps.review.source.badge', 'Your own app')}
              </span>
            ) : null}
            {chip === undefined ? null : <span className={`${CHIP} bg-surface-3 text-fg-muted`}>{chip}</span>}
          </div>
          <div className="mt-[3px] text-[12.5px] text-fg-muted">
            {own
              ? madeAt.label === null
                ? sentence('studio:hostedApps.review.source.madeOn', 'Made on {date} · Adminium {version}', {
                    date: <MonoText>{savedDate(madeAt.savedAt)}</MonoText>,
                    version: <MonoText>{madeAt.adminiumVersion}</MonoText>,
                  })
                : sentence(
                    'studio:hostedApps.review.source.madeAt',
                    'Made at {label} on {date} · Adminium {version}',
                    { date: <MonoText>{savedDate(madeAt.savedAt)}</MonoText>, version: <MonoText>{madeAt.adminiumVersion}</MonoText> },
                    { label: madeAt.label },
                  )
              : publisher === undefined
                ? null
                : t('studio:hostedApps.review.source.publisher', 'Published by {publisher}', { publisher: publisher.name })}
          </div>
        </div>
      </div>
      {own ? (
        <div className="flex items-start gap-[11px] rounded-[10px] border border-warn/25 bg-warn-soft px-[15px] py-[13px]">
          <ShieldAlert aria-hidden className="mt-px size-[17px] shrink-0 text-warn" />
          <p className="flex-1 text-[12.5px] leading-[1.5] text-fg">
            {t(
              'studio:hostedApps.review.source.warning',
              'It was saved on another Adminium server, not on adminium.dev. Install it only if you know who saved it.',
            )}
          </p>
        </div>
      ) : null}
      {integrity === '' ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3.5" data-part="fingerprint">
          <label htmlFor={field} className="text-[12.5px] font-bold">
            {own
              ? t('studio:hostedApps.review.fingerprint.label', 'Check against the fingerprint shown when it was saved')
              : t('studio:hostedApps.review.fingerprint.labelRelease', 'Check against the fingerprint published with the release')}
          </label>
          <div className="flex gap-2">
            <Input
              id={field}
              value={fingerprint}
              placeholder="sha512-…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={result === 'bad' ? true : undefined}
              aria-describedby={resultId}
              className="min-w-0 flex-1 font-mono text-xs"
              onChange={(event) => {
                onFingerprint(event.currentTarget.value);
                setResult('none');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                check();
              }}
            />
            <Button variant="secondary" onClick={check}>
              {t('studio:hostedApps.review.fingerprint.check', 'Check')}
            </Button>
          </div>
          <div id={resultId} role="status" aria-live="polite" className="flex items-center gap-2 text-[12.5px] font-semibold">
            {result === 'ok' ? (
              <>
                <CircleCheck aria-hidden className="size-4 shrink-0 text-pos" />
                <span className="text-pos">
                  {own
                    ? t('studio:hostedApps.review.fingerprint.ok', 'Matches. This is the file that was saved.')
                    : t('studio:hostedApps.review.fingerprint.okRelease', 'Matches. This is the file that was published.')}
                </span>
              </>
            ) : result === 'bad' ? (
              <>
                <CircleX aria-hidden className="size-4 shrink-0 text-danger" />
                <span className="text-danger">
                  {own
                    ? t('studio:hostedApps.review.fingerprint.bad', 'Does not match. This is not the file that was saved.')
                    : t('studio:hostedApps.review.fingerprint.badRelease', 'Does not match. This is not the file that was published.')}
                </span>
              </>
            ) : (
              <span className={`${CHIP} bg-surface-3 text-[11.5px] text-fg-muted`}>
                <CircleDashed aria-hidden className="size-3" />
                {t('studio:hostedApps.review.fingerprint.none', 'Not checked')}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Use the existing tables ────────────────────────────────────────────────

/** The tables of the app that are here already: taken by name, or an earlier install's that it found as they were. */
export function existingTables(plan: AppInstallPlan): NonNullable<AppInstallPlan['tables']> {
  return (plan.tables ?? []).filter((table) => table.class === 'taken' || (table.class === 'own-leftover' && table.adopted === true));
}

/** The tables that stop "Use the existing tables", each with the server's reason. */
export function unusableTables(plan: AppInstallPlan): AppInstallPlan['problems'] {
  return plan.problems.filter((problem) => problem.code === 'EXISTING_TABLE_UNUSABLE');
}

/**
 * "30 tables already exist here with these names" and the one button that
 * uses them all as they are, with their rows. Never a rename. A table that
 * can't be used so stops the install, by name, with no way to leave it out.
 */
export function ExistingTablesCard({
  plan,
  used,
  busy,
  onUse,
  onChange,
}: {
  plan: AppInstallPlan;
  /** The check was made with `existing: "use"`. */
  used: boolean;
  busy: boolean;
  onUse: () => void;
  onChange: () => void;
}) {
  const existing = existingTables(plan);
  const unusable = unusableTables(plan);
  const status = useRef<HTMLDivElement | null>(null);
  const wasUsed = useRef(used);
  // Focus follows the press to what it did (the comp's status after Use the existing tables).
  useEffect(() => {
    if (used && !wasUsed.current) status.current?.focus();
    wasUsed.current = used;
  }, [used]);
  if (existing.length === 0) return null;
  return (
    <div data-part="existing-tables" className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-surface px-[15px] py-3.5 leading-[normal] shadow-sm">
      {!used ? (
        <>
          <p className="text-[13px] font-bold">
            {t(
              'studio:hostedApps.review.existing.title',
              '{count, plural, one {# table already exists here with this name.} other {# tables already exist here with these names.}}',
              { count: existing.length },
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" className="border-accent text-accent" disabled={busy} onClick={onUse}>
              {t('studio:hostedApps.review.existing.use', 'Use the existing tables')}
            </Button>
            <span className="text-xs text-fg-muted">
              {t('studio:hostedApps.review.existing.useNote', 'Uses them as they are, with their rows. Never renames them.')}
            </span>
          </div>
        </>
      ) : unusable.length === 0 ? (
        <div ref={status} tabIndex={-1} role="status" className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-pos outline-none">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">
            {t(
              'studio:hostedApps.review.existing.used',
              '{count, plural, one {# used as it is · 0 changes to it} other {# used as they are · 0 changes to them}}',
              { count: existing.length },
            )}
          </span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onChange}>
            {t('studio:hostedApps.review.change', 'Change')}
          </Button>
        </div>
      ) : (
        <div ref={status} tabIndex={-1} role="alert" className="flex flex-col gap-2 outline-none">
          {unusable.map((problem) => (
            <div key={problem.table} className="rounded-[10px] border border-danger/25 bg-danger-soft px-[15px] py-[11px] text-[12.5px] leading-[1.5]">
              <p className="font-bold text-danger">
                {sentence('studio:hostedApps.review.existing.cannot', '{table} can’t be used as it is.', { table: <Mono>{tableName(plan, problem.table)}</Mono> })}
              </p>
              <p className="mt-1 text-fg-muted">{problem.message}</p>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="flex-1">{t('studio:hostedApps.review.existing.cannotHelp', 'Rename the table here, or save the app again without it.')}</span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onChange}>
              {t('studio:hostedApps.review.change', 'Change')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A table's real name by its short name, for a sentence about it. */
function tableName(plan: AppInstallPlan, ref: string): string {
  return plan.tables?.find((table) => table.ref === ref)?.table ?? plan.names?.[ref] ?? ref;
}

// ── Page addresses already taken ───────────────────────────────────────────

export type PageAnswer = NonNullable<InstallAnswers['pages']>[string];

/** The address suggested for the page here when it moves out of the way. */
export function movedAddress(page: string): string {
  return `${page}-old`.slice(0, 64);
}

/** The clashes nobody has answered yet: each holds Install. */
export function unansweredClashes(plan: AppInstallPlan, answers: InstallAnswers['pages']): PageClash[] {
  return (plan.pageClashes ?? []).filter((clash) => answers?.[clash.page] === undefined);
}

/**
 * "3 pages have names already used here": per page, replace one nobody edited,
 * rename the one here out of the way, or skip the app's page. Install waits
 * until each one has a choice. A choice shows what it does, with Change.
 */
export function PageClashesCard({
  clashes,
  answers,
  busy,
  onAnswer,
  onRenameTo,
}: {
  clashes: readonly PageClash[];
  answers: InstallAnswers['pages'];
  busy: boolean;
  /** `undefined` takes the answer back ("Change"). */
  onAnswer: (page: string, answer: PageAnswer | undefined) => void;
  /** The address typed for the page here, before it is checked again. */
  onRenameTo: (page: string, to: string) => void;
}) {
  // Focus follows a pick to Change, and Change to the first choice (the comp's focus moves).
  const [focus, setFocus] = useState<{ page: string; to: 'change' | 'first' } | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement | null>());
  useEffect(() => {
    if (focus === null) return;
    refs.current.get(`${focus.page}:${focus.to}`)?.focus();
  });
  if (clashes.length === 0) return null;
  return (
    <section className={SECTION} data-part="page-clashes">
      <SectionHead
        icon={<TriangleAlert className="size-[17px]" />}
        title={t('studio:hostedApps.review.pages.title', '{count, plural, one {# page has a name already used here} other {# pages have names already used here}}', {
          count: clashes.length,
        })}
      />
      <ul className="flex flex-col">
        {clashes.map((clash) => {
          const answer = answers?.[clash.page];
          const fieldId = `page-clash-${clash.page}`;
          return (
            <li key={clash.page} data-testid={`page-clash-${clash.page}`} className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-[13px]">
                  <span className="font-bold">{clash.title}</span>{' '}
                  <span className="text-fg-muted">
                    {clash.untouched
                      ? t('studio:hostedApps.review.pages.untouched', '— the page here is as Adminium made it.')
                      : t('studio:hostedApps.review.pages.changed', '— changed here.')}
                  </span>
                </span>
                <MonoText className="text-[11.5px] text-fg-subtle">/p/{clash.page}</MonoText>
                <span className="ms-auto flex flex-wrap items-center gap-2">
                  {answer === undefined ? (
                    clash.offers.map((offer, index) => (
                      <Button
                        key={offer}
                        ref={(node) => {
                          if (index === 0) refs.current.set(`${clash.page}:first`, node);
                        }}
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setFocus({ page: clash.page, to: 'change' });
                          onAnswer(clash.page, offer === 'rename-existing' ? { action: 'rename-existing', to: movedAddress(clash.page) } : { action: offer });
                        }}
                      >
                        {offer === 'replace'
                          ? t('studio:hostedApps.review.pages.replace', 'Replace it')
                          : offer === 'rename-existing'
                            ? t('studio:hostedApps.review.pages.rename', 'Rename the page here')
                            : t('studio:hostedApps.review.pages.skip', 'Skip it')}
                      </Button>
                    ))
                  ) : (
                    <>
                      <span className="text-[12.5px] font-semibold text-fg-muted">
                        {answer.action === 'replace'
                          ? t('studio:hostedApps.review.pages.replaced', 'Replaced by the app’s page.')
                          : answer.action === 'skip'
                            ? t('studio:hostedApps.review.pages.skipped', 'Skipped. The page here stays.')
                            : sentence('studio:hostedApps.review.pages.renamed', 'The page here moves to {address}.', {
                                address: <Mono>/p/{answer.to}</Mono>,
                              })}
                      </span>
                      <Button
                        ref={(node) => {
                          refs.current.set(`${clash.page}:change`, node);
                        }}
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setFocus({ page: clash.page, to: 'first' });
                          onAnswer(clash.page, undefined);
                        }}
                      >
                        {t('studio:hostedApps.review.change', 'Change')}
                      </Button>
                    </>
                  )}
                </span>
              </div>
              {answer?.action === 'rename-existing' ? (
                <div className="flex flex-col gap-1.5 ps-0.5">
                  <label htmlFor={fieldId} className="text-[11.5px] font-bold text-fg-muted">
                    {t('studio:hostedApps.review.pages.renameField', 'New address for the page here')}
                  </label>
                  <Input
                    id={fieldId}
                    value={answer.to}
                    disabled={busy}
                    className="max-w-[320px] font-mono text-[13px]"
                    onChange={(event) => onRenameTo(clash.page, event.currentTarget.value)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Rules that send data out ───────────────────────────────────────────────

/** The rules that would send data out, each with how: they arrive switched off and empty. */
export function outsideRules(items: readonly AfterInstallItem[] | undefined): { item: string; webhook: boolean; address: boolean }[] {
  const byRule = new Map<string, { item: string; webhook: boolean; address: boolean }>();
  for (const entry of items ?? []) {
    if (entry.kind !== 'webhook' && entry.kind !== 'address') continue;
    const rule = byRule.get(entry.item) ?? { item: entry.item, webhook: false, address: false };
    if (entry.kind === 'webhook') rule.webhook = true;
    else rule.address = true;
    byRule.set(entry.item, rule);
  }
  return [...byRule.values()];
}

export function OutsideAddressesCard({ items, forUpdate = false }: { items: readonly AfterInstallItem[] | undefined; forUpdate?: boolean }) {
  const rules = outsideRules(items);
  if (rules.length === 0) return null;
  return (
    <section className={SECTION} data-part="outside-addresses">
      <SectionHead icon={<Send className="size-[17px]" />} title={t('studio:hostedApps.review.outside.title', 'These rules would send data out')} count={forUpdate ? rules.length : undefined} />
      <p className="text-[12.5px] leading-[1.5] text-fg-muted">
        {forUpdate
          ? t('studio:hostedApps.review.outside.bodyUpdate', 'A new one arrives switched off and empty. One already here keeps its address.')
          : t('studio:hostedApps.review.outside.body', 'They arrive switched off and empty. Someone who manages automations can turn them on.')}
      </p>
      <ul className="flex flex-col">
        {rules.map((rule) => (
          <li key={rule.item} className="flex flex-wrap items-center gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">
              <MonoText className="block text-[13px] font-bold">{rule.item}</MonoText>
              <span className="mt-0.5 block text-xs text-fg-muted">
                {[
                  rule.webhook ? t('studio:hostedApps.review.outside.webhook', 'sends to a web address · address left empty') : null,
                  rule.address ? t('studio:hostedApps.review.outside.address', 'emails a fixed address · address left empty') : null,
                ]
                  .filter((line) => line !== null)
                  .join(' · ')}
              </span>
            </span>
            <Badge tone="neutral" className="px-[9px] py-[3px] leading-[normal]">
              {t('studio:hostedApps.review.outside.off', 'Off')}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The look and languages (the deployment-wide part) ──────────────────────

export interface InstanceAnswers {
  ticked: boolean;
  /** Per email id: whether it is to be applied. */
  emails: Record<string, boolean>;
  /** Per email id: the link hosts ticked, one by one. */
  hosts: Record<string, string[]>;
}

export const NO_INSTANCE_ANSWERS: InstanceAnswers = { ticked: false, emails: {}, hosts: {} };

/** What the install or update sends of the part: nothing unless ticked, and only the hosts of the emails ticked. */
export function instanceAnswersOf(part: InstancePart | undefined, answers: InstanceAnswers): Pick<InstallAnswers, 'instance' | 'instanceHosts'> {
  if (part === undefined || !answers.ticked) return {};
  const hosts: Record<string, string[]> = {};
  for (const email of part.systemEmails) {
    if (email.hosts.length === 0 || answers.emails[email.id] !== true) continue;
    hosts[email.id] = (answers.hosts[email.id] ?? []).filter((host) => email.hosts.includes(host));
  }
  return { instance: true, ...(Object.keys(hosts).length === 0 ? {} : { instanceHosts: hosts }) };
}

function valueWords(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
}

/**
 * "Also apply the look and languages": off by default, and only for someone
 * who may change the server's settings. Each edited system email is ticked on
 * its own, never by the main tick, and each link host in it one by one.
 */
export function InstanceCard({ part, answers, onAnswers }: { part: InstancePart; answers: InstanceAnswers; onAnswers: (next: InstanceAnswers) => void }) {
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const allowed = bootstrap === undefined ? false : holdsSystemAction(bootstrap, 'settings.manage');
  const lockId = useId();
  const tickId = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const live = allowed && answers.ticked;
  return (
    <section className={SECTION} data-part="instance">
      <SectionHead icon={<Palette className="size-[17px]" />} title={t('studio:hostedApps.review.instance.title', 'The look and languages')} />
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={tickId}
          checked={answers.ticked}
          disabled={!allowed}
          aria-describedby={allowed ? undefined : lockId}
          onCheckedChange={(next) => onAnswers({ ...answers, ticked: next === true })}
          className="mt-px"
        />
        <label htmlFor={tickId} className="text-[13px] font-bold">
          {t('studio:hostedApps.review.instance.tick', 'Also apply the look and languages')}
        </label>
      </div>
      {allowed ? null : (
        <p id={lockId} className="flex items-center gap-2 text-xs text-fg-muted">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          {t('studio:hostedApps.review.instance.locked', 'Ask someone who manages settings to apply this part.')}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-[12px] bg-surface-2 px-[15px] py-3.5">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-fg-subtle">
          {t('studio:hostedApps.review.instance.what', 'What’s in it')}
        </div>
        {part.files.length === 0 && part.settings.length === 0 ? null : (
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
            {part.files.map((file) => (
              <li key={`f:${file.setting}`} className="flex items-center gap-1.5">
                <span className="text-fg-muted">{file.setting}</span>
                <MonoText className="text-xs">{file.file}</MonoText>
              </li>
            ))}
            {part.settings.map((setting) => (
              <li key={`s:${setting.key}`} className="flex items-center gap-1.5">
                <span className="text-fg-muted">{setting.key}</span>
                <MonoText className="text-xs">{valueWords(setting.to)}</MonoText>
              </li>
            ))}
          </ul>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
          {part.languages.on.length === 0 ? null : (
            <span>{t('studio:hostedApps.review.instance.languagesOn', 'Languages switched on: {languages}', { languages: part.languages.on.join(', ') })}</span>
          )}
          {part.languages.off.length === 0 ? null : (
            <span>{t('studio:hostedApps.review.instance.languagesOff', 'Languages switched off: {languages}', { languages: part.languages.off.join(', ') })}</span>
          )}
          {part.wording.changed === 0 ? null : (
            <span>{t('studio:hostedApps.review.instance.wording', '{count, plural, one {# edited wording} other {# edited wordings}}', { count: part.wording.changed })}</span>
          )}
          {part.systemEmails.length === 0 ? null : (
            <span>{t('studio:hostedApps.review.instance.emails', 'System emails changed: {count}', { count: part.systemEmails.length })}</span>
          )}
        </p>
        {part.systemEmails.length === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {part.systemEmails.map((email) => (
              <InstanceEmailRow
                key={email.id}
                email={email}
                live={live}
                ticked={answers.emails[email.id] === true}
                hosts={answers.hosts[email.id] ?? []}
                open={open[email.id] === true}
                onOpen={() => setOpen((rows) => ({ ...rows, [email.id]: rows[email.id] !== true }))}
                onTick={(next) => onAnswers({ ...answers, emails: { ...answers.emails, [email.id]: next } })}
                onHosts={(next) => onAnswers({ ...answers, hosts: { ...answers.hosts, [email.id]: next } })}
              />
            ))}
          </ul>
        )}
        {part.left.length === 0 ? null : (
          <div className="text-xs text-fg-muted">
            <span className="font-bold">{t('studio:hostedApps.review.instance.left', 'Not taken here:')}</span>{' '}
            {part.left.map((left) => `${left.item} (${left.reason})`).join('; ')}
          </div>
        )}
      </div>
      <p className="text-xs leading-[1.5] text-fg-subtle">
        {t('studio:hostedApps.review.instance.caption', 'Passwords, keys and email server settings are never in the file. You can undo this part from the app’s page.')}
      </p>
    </section>
  );
}

function InstanceEmailRow({
  email,
  live,
  ticked,
  hosts,
  open,
  onOpen,
  onTick,
  onHosts,
}: {
  email: InstanceEmail;
  /** The main tick is on, and this person may apply the part. */
  live: boolean;
  ticked: boolean;
  hosts: readonly string[];
  open: boolean;
  onOpen: () => void;
  onTick: (next: boolean) => void;
  onHosts: (next: string[]) => void;
}) {
  const tickId = useId();
  const diffId = useId();
  const name = (
    <>
      <span className="font-bold">{email.key}</span> <MonoText className="text-xs text-fg-muted">{email.locale}</MonoText>
    </>
  );
  return (
    <li className="rounded-[10px] border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5 text-[12.5px]">
        {email.hosts.length === 0 ? (
          <span className="flex-1">{name}</span>
        ) : (
          <>
            <Checkbox id={tickId} checked={ticked} disabled={!live} onCheckedChange={(next) => onTick(next === true)} />
            <label htmlFor={tickId} className="flex-1">
              {name}
            </label>
          </>
        )}
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={diffId} onClick={onOpen}>
          {open ? t('studio:hostedApps.review.instance.hideChanges', 'Hide changes') : t('studio:hostedApps.review.instance.showChanges', 'Show changes')}
        </Button>
      </div>
      {email.hosts.length === 0 ? (
        <p className="mt-1.5 text-xs text-fg-muted">{t('studio:hostedApps.review.instance.noLinks', 'It has no links, so it is applied with this part.')}</p>
      ) : (
        <fieldset className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <legend className="float-start me-1 text-fg-muted">{t('studio:hostedApps.review.instance.links', 'Links in this email go to:')}</legend>
          {email.hosts.map((host) => {
            const id = `${tickId}-${host}`;
            return (
              <span key={host} className="inline-flex items-center gap-1.5">
                <Checkbox
                  id={id}
                  checked={hosts.includes(host)}
                  disabled={!live || !ticked}
                  onCheckedChange={(next) => onHosts(next === true ? [...hosts, host] : hosts.filter((other) => other !== host))}
                />
                <label htmlFor={id}>
                  <MonoText>{host}</MonoText>
                </label>
              </span>
            );
          })}
        </fieldset>
      )}
      {open ? (
        <div id={diffId} className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs text-fg-muted">
          {email.subject === null ? null : (
            <p>
              {sentence('studio:hostedApps.review.instance.subject', 'Subject: {from} → {to}', {
                from: <span className="text-fg">{email.subject.from}</span>,
                to: <span className="font-semibold text-fg">{email.subject.to}</span>,
              })}
            </p>
          )}
          <p>
            {t('studio:hostedApps.review.instance.blocks', 'Blocks: {added} added · {removed} removed · {changed} changed', {
              added: email.blocks.added.length,
              removed: email.blocks.removed.length,
              changed: email.blocks.changed.length,
            })}
          </p>
          {email.preheaderChanged ? <p>{t('studio:hostedApps.review.instance.preheader', 'Preview text changed')}</p> : null}
          {email.footerChanged ? <p>{t('studio:hostedApps.review.instance.footer', 'Footer changed')}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

// ── Screens ────────────────────────────────────────────────────────────────

export function ScreensWarning() {
  return (
    <section className={SECTION} data-part="screens">
      <SectionHead icon={<MonitorSmartphone className="size-[17px]" />} title={t('studio:hostedApps.review.screens.title', 'Screens')} />
      <div className="flex items-start gap-[11px] rounded-[10px] border border-warn/25 bg-warn-soft px-[15px] py-[13px] text-[12.5px] leading-[1.5]">
        <ShieldAlert aria-hidden className="mt-px size-[17px] shrink-0 text-warn" />
        <p>
          <span className="font-bold">{t('studio:hostedApps.review.screens.lead', 'This app has its own screens.')}</span>{' '}
          {t('studio:hostedApps.review.screens.body', 'They run with the rights of whoever opens them. Install it only if you trust who saved it.')}
        </p>
      </div>
    </section>
  );
}

// ── After you install ──────────────────────────────────────────────────────

/** Each thing to fill in after the install, in words; senders and schedules counted together, a role's grants once. */
export function afterInstallLines(items: readonly AfterInstallItem[] | undefined): { key: string; words: ReactNode }[] {
  const list = items ?? [];
  const lines: { key: string; words: ReactNode }[] = [];
  const mono = (value: string) => <Mono>{value}</Mono>;
  const once = new Set<string>();
  for (const entry of list) {
    const same = list.filter((other) => other.kind === entry.kind);
    if (entry.kind === 'sender' || entry.kind === 'recipients' || entry.kind === 'system-grant') {
      const grouped = entry.kind === 'system-grant' ? `${entry.kind}:${entry.item}` : entry.kind;
      if (once.has(grouped)) continue;
      once.add(grouped);
    }
    const key = `${entry.kind}:${entry.item}:${entry.field}`;
    switch (entry.kind) {
      case 'webhook':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.webhook', 'The web address of the rule {item}', { item: mono(entry.item) }) });
        break;
      case 'address':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.address', 'Who the rule {item} emails', { item: mono(entry.item) }) });
        break;
      case 'document':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.document', 'The document the rule {item} makes', { item: mono(entry.item) }) });
        break;
      case 'delivery':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.delivery', 'Where the document {item} is mailed', { item: mono(entry.item) }) });
        break;
      case 'payment-key':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.paymentKey', 'The keys of the payment service {item}', { item: mono(entry.item) }) });
        break;
      case 'bank-account':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.bankAccount', 'The bank account for {item}', { item: mono(entry.item) }) });
        break;
      case 'recipients':
        lines.push({
          key,
          words: sentence(
            'studio:hostedApps.review.after.recipients',
            '{count, plural, one {Who receives the scheduled report {item}} other {Who receives the # scheduled reports}}',
            { item: mono(entry.item) },
            { count: same.length },
          ),
        });
        break;
      case 'sender':
        lines.push({
          key,
          words: sentence(
            'studio:hostedApps.review.after.sender',
            '{count, plural, one {The sender address of the email {item}} other {The sender address for # email templates}}',
            { item: mono(entry.item) },
            { count: same.length },
          ),
        });
        break;
      case 'system-grant':
        lines.push({ key, words: sentence('studio:hostedApps.review.after.systemGrant', 'The {item} role’s console rights', { item: mono(entry.item) }) });
        break;
    }
  }
  return lines;
}

export function AfterInstallCard({ items }: { items: readonly AfterInstallItem[] | undefined }) {
  const lines = afterInstallLines(items);
  if (lines.length === 0) return null;
  return (
    <section className={SECTION} data-part="after-install">
      <SectionHead icon={<ListChecks className="size-[17px]" />} title={t('studio:hostedApps.review.after.title', 'After you install')} count={lines.length} />
      <ul className="flex flex-col gap-1.5 ps-1 text-[13px]">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-fg-subtle" />
            <span>{line.words}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">{t('studio:hostedApps.review.after.note', 'These stay on the app’s page until they are done.')}</p>
    </section>
  );
}

// ── Refusals ───────────────────────────────────────────────────────────────

/** One refusal: it replaces the review, with no Install button. */
export function RefusalCard({ title, children, onBack }: { title: string; children: ReactNode; onBack?: (() => void) | undefined }) {
  return (
    <div role="alert" data-part="refusal" className="flex max-w-[560px] flex-col gap-3 rounded-[14px] border border-danger/25 bg-surface p-5 leading-[normal] shadow-sm">
      <div className="flex items-center gap-2.5">
        <CircleX aria-hidden className="size-[18px] shrink-0 text-danger" />
        <h2 className="text-[14.5px] font-bold">{title}</h2>
      </div>
      <p className="text-[13px] leading-[1.55] text-fg-muted">{children}</p>
      {onBack === undefined ? null : (
        <Button variant="secondary" className="self-start" onClick={onBack}>
          {t('studio:hostedApps.refusal.back', 'Back')}
        </Button>
      )}
    </div>
  );
}

/** The refusals an upload answers before anything is staged, said per database, or null for another error. */
export function uploadRefusal(code: string, details: unknown): { title: string; body: ReactNode } | null {
  const said = (details ?? {}) as {
    reason?: unknown;
    offered?: unknown;
    installed?: unknown;
    key?: unknown;
    connectionName?: unknown;
    minAdminiumVersion?: unknown;
    serverVersion?: unknown;
  };
  const reason = typeof said.reason === 'string' ? said.reason : code;
  if (reason === 'VERSION_OLDER' && Array.isArray(said.installed)) {
    const copies = (said.installed as { connectionName: string; version: string }[]).map((copy) =>
      t('studio:hostedApps.refusal.older.copy', '{database} already has {version}', { database: copy.connectionName, version: copy.version }),
    );
    return {
      title: t('studio:hostedApps.refusal.older.title', 'An older file'),
      body: t('studio:hostedApps.refusal.older.body', '{copies}. The file is the older {version}.', {
        copies: namesList(copies),
        version: typeof said.offered === 'string' ? said.offered : '',
      }),
    };
  }
  if (reason === 'LINEAGE_DIFFERS' && typeof said.connectionName === 'string') {
    return {
      title: t('studio:hostedApps.refusal.lineage.title', 'A different app with this key'),
      body: sentence(
        'studio:hostedApps.refusal.lineage.body',
        'This server already has a different {key}, on {database}. Save this one with another key.',
        { key: <Mono>{typeof said.key === 'string' ? said.key : ''}</Mono>, database: <Mono>{said.connectionName}</Mono> },
      ),
    };
  }
  if (reason === 'REQUIRES_NEWER_ADMINIUM' && typeof said.minAdminiumVersion === 'string') {
    return {
      title: t('studio:hostedApps.refusal.newer.title', 'Needs a newer Adminium'),
      body: sentence('studio:hostedApps.refusal.newer.body', 'This file needs Adminium {needed} or newer. This server runs {running}.', {
        needed: <Mono>{said.minAdminiumVersion}</Mono>,
        running: <Mono>{typeof said.serverVersion === 'string' ? said.serverVersion : '—'}</Mono>,
      }),
    };
  }
  return null;
}

/** A self-made file going back onto the database it was saved from: refused (it would run every rule twice). */
export function savedFromHere(plan: AppInstallPlan): boolean {
  return plan.problems.some((problem) => problem.code === 'SAVED_FROM_HERE');
}

/** "Choose what to do with Orders and Customers." and the other reasons Install waits, first one first; null when none. */
export function reviewHold(input: {
  plan: AppInstallPlan;
  pages: InstallAnswers['pages'];
  fingerprint: string;
  integrity: string;
}): string | null {
  if (fingerprintHolds(input.fingerprint, input.integrity)) {
    return t('studio:hostedApps.review.fingerprint.hold', 'The fingerprint does not match. Clear it, or paste the one shown when it was saved.');
  }
  const unusable = unusableTables(input.plan)[0];
  if (unusable !== undefined) {
    return t('studio:hostedApps.review.existing.cannot', '{table} can’t be used as it is.', { table: tableName(input.plan, unusable.table) });
  }
  const waiting = unansweredClashes(input.plan, input.pages);
  if (waiting.length > 0) {
    return t('studio:hostedApps.review.pages.hold', 'Choose what to do with {pages}.', { pages: namesList(waiting.map((clash) => clash.title)) });
  }
  return null;
}

/** The footer's reason Install waits, tied to the disabled button by id. */
export function HoldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} data-part="review-hold" className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-warn">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** The workspaces a database is in, as chips: the tile's letters and the name. */
export function WorkspaceChips({ workspaces }: { workspaces: readonly { id: string; name: string; initials: string }[] }) {
  if (workspaces.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {workspaces.map((workspace) => (
        <span key={workspace.id} className={`${CHIP} bg-surface-3 font-semibold text-fg-muted`}>
          <span aria-hidden className="grid size-4 place-items-center rounded-[4px] bg-accent-soft text-[9px] font-extrabold text-accent">
            {workspace.initials}
          </span>
          {workspace.name}
        </span>
      ))}
    </span>
  );
}

