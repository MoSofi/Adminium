// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install's table check, and the three screens that follow the Install
 * press — ported from `Installed Apps.dc.html`'s install view.
 *
 * The check is the server's plan, shown table by table: a table the app will
 * create, one it made on an earlier install and takes back, one it shares
 * with another app, and one whose name somebody else already holds. Only the
 * last asks a question, and the install waits for the answer.
 *
 * ─── Departures from the comp ──────────────────────────────────────────────
 *
 *  **Row counts.** The comp prints "1,102 rows" beside a table from an earlier
 *  install. The plan reads each table's columns, not its rows, and counting
 *  every table's rows to draw one label is a full scan on a large table; the
 *  label is left out.
 *
 *  **Installing.** The comp animates each row from waiting to done. The install
 *  is one request that answers when it has finished, so there is nothing to
 *  animate from: the screen lists the steps it runs, in order, under one
 *  spinner. The comp's Roles and Browser key rows join when the install makes
 *  roles and keys.
 *
 *  **Checking again.** The comp's prefix field says the tables "will be checked
 *  again". A changed answer changes what the install would do, so the check is
 *  re-run before Install is offered: a pick re-checks at once, and a typed
 *  name or prefix turns Install into "Check again" until it has been.
 */
import type { ReactNode } from 'react';
import { Badge, Button, MonoText, RadioCard, RadioGroup, Spinner } from '@adminium/ui';
import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleAlert,
  Link2,
  Plus,
  RotateCcw,
  RotateCw,
  Table2,
  TriangleAlert,
  X,
} from 'lucide-react';

import { t } from '../../i18n/t.js';
import {
  ddlPreview,
  type AppInstallPlan,
  type InstallStoppedDetails,
  type PlannedAppTable,
} from './appsApi.js';

/** What the operator picked for one taken table. */
export type TakenPick = 'reuse' | 'rename-existing' | 'alt-prefix';

const MARK = '\u2063';

/**
 * A translated sentence with one value drawn in mono, as the comp draws a
 * connection or a table inside running text. The value is interpolated as a
 * marker and the sentence split around it, so translators keep the whole
 * sentence and its word order.
 */
function withMono(key: string, fallback: string, name: string, value: string, args: Record<string, unknown> = {}): ReactNode {
  const marker = `${MARK}${name}${MARK}`;
  const parts = t(key, fallback, { ...args, [name]: marker }).split(marker);
  return parts.map((part, index) => (
    <span key={index}>
      {part}
      {index < parts.length - 1 ? (
        <MonoText className="font-semibold text-fg">{value}</MonoText>
      ) : null}
    </span>
  ));
}

/** The prefix a real table carries in front of its short name, or ''. */
export function prefixOf(table: PlannedAppTable): string {
  return table.table.endsWith(table.ref) ? table.table.slice(0, table.table.length - table.ref.length) : '';
}

/** A prefix to suggest in place of the one that collided: `pos_` → `pos2_`. */
export function suggestedPrefix(appKey: string, current: string): string {
  const base = current === '' ? `${appKey.replace(/-/g, '_')}_` : current;
  return base.replace(/_$/, '2_');
}

/** The problems a table card shows itself, rather than the refusal list above. */
export function isCardProblem(plan: AppInstallPlan, problem: AppInstallPlan['problems'][number]): boolean {
  return problem.code === 'TABLE_TAKEN' && (plan.tables ?? []).some((table) => table.ref === problem.table);
}

// `leading-[normal]` throughout: the comp renders at `normal`, and this system's `leading-normal` is 1.5.
const PILL = 'inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[10.5px] font-bold leading-[normal]';

export interface TableCheckProps {
  plan: AppInstallPlan & { tables: PlannedAppTable[] };
  appName: string;
  connectionName: string;
  open: Record<string, boolean>;
  onToggle: (ref: string) => void;
  picks: Record<string, TakenPick>;
  onPick: (ref: string, pick: TakenPick) => void;
  renameTo: Record<string, string>;
  onRenameTo: (ref: string, value: string) => void;
  prefix: string;
  onPrefix: (value: string) => void;
  /** Set when the check was made with a different prefix; offers the usual one back. */
  altPrefixInUse: string | null;
  onUsualPrefix: () => void;
  busy: boolean;
  /** False inside a dialog that has its own title. */
  heading?: boolean | undefined;
  /**
   * False for an update: its tables stay where they are, so a different
   * prefix for the whole app is an uninstall and an install, not a choice.
   */
  allowAltPrefix?: boolean | undefined;
}

export function TableCheck(props: TableCheckProps) {
  const { plan } = props;
  const count = (klass: PlannedAppTable['class']) => plan.tables.filter((table) => table.class === klass).length;
  const fresh = count('new');
  const earlier = count('own-leftover');
  const shared = count('shared');
  const taken = count('taken');

  return (
    <div className="flex flex-col gap-4">
      {props.heading === false ? null : (
        <div>
          <h2 className="text-[19px] font-extrabold leading-[normal] tracking-[-0.025em]">
            {t('studio:hostedApps.install.check.title', 'Check the tables')}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.55] text-fg-muted">
            {withMono(
              'studio:hostedApps.install.check.hint',
              '{app} will create these in {connection}. Nothing changes until you press Install.',
              'connection',
              props.connectionName,
              { app: props.appName },
            )}
          </p>
        </div>
      )}

      <div
        data-part="check-summary"
        className="flex flex-wrap items-center gap-2 rounded-[12px] bg-surface-3 px-3.5 py-[11px]"
      >
        {fresh === 0 ? null : (
          <span className={`${PILL} bg-surface text-fg-muted`}>
            <Plus aria-hidden className="size-[13px]" />
            {t('studio:hostedApps.install.check.summaryNew', '{count} new', { count: fresh })}
          </span>
        )}
        {earlier === 0 ? null : (
          <span className={`${PILL} bg-accent-soft text-accent`}>
            <RotateCcw aria-hidden className="size-[13px]" />
            {t('studio:hostedApps.install.check.summaryEarlier', '{count} from your earlier install', {
              count: earlier,
            })}
          </span>
        )}
        {shared === 0 ? null : (
          <span className={`${PILL} bg-info-soft text-info`}>
            <Link2 aria-hidden className="size-[13px]" />
            {t('studio:hostedApps.install.check.summaryShared', '{count} shared with another app', {
              count: shared,
            })}
          </span>
        )}
        {taken === 0 ? null : (
          <span className={`${PILL} bg-warn-soft text-warn`}>
            <TriangleAlert aria-hidden className="size-[13px]" />
            {t('studio:hostedApps.install.check.summaryTaken', '{count, plural, one {# name taken} other {# names taken}}', { count: taken })}
          </span>
        )}
        {props.altPrefixInUse === null ? null : (
          <span className="ms-auto flex items-center gap-2 text-xs text-fg-muted">
            {withMono(
              'studio:hostedApps.install.check.altPrefixInUse',
              'Checked with the prefix {prefix}.',
              'prefix',
              props.altPrefixInUse,
            )}
            <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onUsualPrefix}>
              {t('studio:hostedApps.install.check.usualPrefix', 'Use the usual prefix')}
            </Button>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-[9px]">
        {plan.tables.map((table) => (
          <TableRow key={table.ref} table={table} {...props} />
        ))}
      </div>
    </div>
  );
}

function TableRow({ table, ...props }: TableCheckProps & { table: PlannedAppTable }) {
  const expanded = props.open[table.ref] === true;
  const undecided = table.action === 'undecided';
  const badge =
    table.class === 'new'
      ? { tone: 'neutral' as const, label: t('studio:hostedApps.install.check.badgeNew', 'New') }
      : table.class === 'own-leftover'
        ? {
            tone: 'accent' as const,
            label: t('studio:hostedApps.install.check.badgeEarlier', 'Yours from an earlier install'),
          }
        : table.class === 'shared'
          ? {
              tone: 'info' as const,
              label: t('studio:hostedApps.install.check.badgeShared', 'Shared with {app}', {
                app: table.sharedWith ?? '',
              }),
            }
          : { tone: 'warn' as const, label: t('studio:hostedApps.install.check.badgeTaken', 'Name taken') };

  return (
    <div
      data-testid={`check-table-${table.ref}`}
      className={`overflow-hidden rounded-[13px] border bg-surface shadow-sm ${
        undecided ? 'border-warn/40' : 'border-border'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => props.onToggle(table.ref)}
        className="flex w-full flex-wrap items-center gap-3 px-[15px] py-3 text-start"
      >
        <Table2 aria-hidden className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-[130px] flex-1">
          <span className="block text-[13px] font-bold leading-[normal] tracking-[-0.01em]">{table.ref}</span>
          <MonoText className="mt-0.5 block text-[11.5px] leading-[normal] text-fg-muted">{table.table}</MonoText>
        </span>
        <MonoText className="shrink-0 text-[11.5px] leading-[normal] text-fg-subtle">
          {t('studio:hostedApps.install.check.columns', '{count, plural, one {# column} other {# columns}}', { count: table.columns.length })}
        </MonoText>
        <Badge tone={badge.tone} className="px-[9px] py-[3px] leading-[normal]">
          {badge.label}
        </Badge>
        {expanded ? (
          <ChevronUp aria-hidden className="size-4 shrink-0 text-fg-subtle" />
        ) : (
          <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-subtle" />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-border bg-surface-2 px-[15px] py-3.5">
          {table.class === 'new' ? <NewTable table={table} /> : null}
          {table.class === 'own-leftover' || table.class === 'shared' ? (
            <SelectedChoice
              title={t('studio:hostedApps.install.check.keep', 'Use it and keep its data')}
              body={
                <>
                  {table.class === 'shared'
                    ? t(
                        'studio:hostedApps.install.check.sharedNote',
                        '{app} uses this table too. Both apps keep reading and writing the same rows.',
                        { app: table.sharedWith ?? '' },
                      )
                    : table.adopted === true
                      ? t(
                          'studio:hostedApps.install.check.adoptedNote',
                          'An earlier install of {app} used this table as it found it.',
                          { app: props.appName },
                        )
                      : t(
                          'studio:hostedApps.install.check.earlierNote',
                          'Adminium made this table on an earlier install of {app}.',
                          { app: props.appName },
                        )}{' '}
                  <EditsNote table={table} />
                </>
              }
            />
          ) : null}
          {table.class === 'taken' ? <TakenChoices table={table} {...props} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function NewTable({ table }: { table: PlannedAppTable }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {table.columns.map((column) => (
          <span
            key={column.ref}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-[9px] py-1 font-mono text-[11.5px]"
          >
            <span className="font-semibold">{column.ref}</span>
            <span className="text-fg-subtle">{column.type}</span>
          </span>
        ))}
      </div>
      <div className="mb-[7px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-fg-subtle">
        {t('studio:hostedApps.install.check.createPreview', 'Create preview')}
      </div>
      <pre className="overflow-x-auto rounded-[10px] bg-fg px-3.5 py-3 font-mono text-[11.5px] leading-[1.65] text-surface">
        <code>{ddlPreview({ ref: table.table, columns: table.columns })}</code>
      </pre>
    </>
  );
}

/** The comp's fixed, already-selected choice card. */
function SelectedChoice({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="flex items-start gap-[11px] rounded-[12px] border-[1.5px] border-accent bg-surface px-[15px] py-[13px]">
      <span
        aria-hidden
        className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent"
      >
        <span className="size-[7px] rounded-full bg-accent-fg" />
      </span>
      <div>
        <div className="text-[13px] font-bold">{title}</div>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-fg-muted">{body}</div>
      </div>
    </div>
  );
}

/** What using a table as it is changes about it, in one or two sentences. */
function EditsNote({ table }: { table: PlannedAppTable }) {
  const added = table.edits.filter((edit) => edit.kind === 'add-column').map((edit) => edit.column);
  const other = table.edits.filter((edit) => edit.kind !== 'add-column');
  return (
    <>
      {added.length === 0 ? null : (
        <>
          {t('studio:hostedApps.install.check.addsColumns', '{count, plural, one {Adds # column:} other {Adds # columns:}}', { count: added.length })}{' '}
          {added.map((column, index) => (
            <span key={column}>
              <MonoText className="font-semibold text-fg">{column}</MonoText>
              {index < added.length - 1 ? ', ' : '. '}
            </span>
          ))}
        </>
      )}
      {other.map((edit) => (
        <span key={`${edit.kind}:${edit.column}`}>
          {edit.kind === 'widen'
            ? withMono(
                'studio:hostedApps.install.check.widens',
                'Makes {column} wider, from {from} to {to}.',
                'column',
                edit.column,
                { from: edit.from ?? '', to: edit.to ?? '' },
              )
            : edit.kind === 'set-identity'
              ? withMono(
                  'studio:hostedApps.install.check.setIdentity',
                  '{column} numbers new rows by itself.',
                  'column',
                  edit.column,
                )
              : edit.kind === 'add-unique'
                ? edit.with === undefined || edit.with.length === 0
                  ? withMono('studio:hostedApps.install.check.addUnique', '{column} may no longer hold the same value twice.', 'column', edit.column)
                  : withMono(
                      'studio:hostedApps.install.check.addUniqueWith',
                      '{column} may no longer hold the same value twice for one {with}.',
                      'column',
                      edit.column,
                      { with: edit.with.join(', ') },
                    )
              : withMono(
                  'studio:hostedApps.install.check.enumValues',
                  '{column} also accepts {values}.',
                  'column',
                  edit.column,
                  { values: (edit.values ?? []).join(', ') },
                )}{' '}
        </span>
      ))}
      {t('studio:hostedApps.install.check.noLoss', 'No column is removed and no data is lost.')}
    </>
  );
}

function TakenChoices({ table, ...props }: TableCheckProps & { table: PlannedAppTable }) {
  const pick = props.picks[table.ref] ?? null;
  const problems = props.plan.problems.filter(
    (problem) => problem.table === table.ref && isCardProblem(props.plan, problem) && table.action !== 'undecided',
  );
  const choices: {
    value: TakenPick;
    title: string;
    note: string;
    disabled: boolean;
    field?: { label: string; value: string; onChange: (value: string) => void; note: string };
  }[] = [
    {
      value: 'reuse',
      title: t('studio:hostedApps.install.check.keep', 'Use it and keep its data'),
      note:
        table.reuseRefusal ??
        t(
          'studio:hostedApps.install.check.reuseNote',
          'The app reads and writes the rows already there.',
        ),
      disabled: !table.offers.includes('reuse'),
    },
    {
      value: 'rename-existing',
      title: t('studio:hostedApps.install.check.renameTitle', 'Rename the existing table out of the way'),
      note: t('studio:hostedApps.install.check.renameNote', 'A fresh {table} is created for the app.', {
        table: table.table,
      }),
      disabled: !table.offers.includes('rename-existing'),
      field: {
        label: t('studio:hostedApps.install.check.renameField', 'New name for the existing table'),
        value: props.renameTo[table.ref] ?? table.renameExistingTo ?? `${table.table}_old`,
        onChange: (value) => props.onRenameTo(table.ref, value),
        note: t(
          'studio:hostedApps.install.check.renameFieldNote',
          'Adminium repairs its own pages and rules that pointed at the old name.',
        ),
      },
    },
    {
      value: 'alt-prefix',
      title: t('studio:hostedApps.install.check.prefixTitle', 'Use a different prefix for this app'),
      note: t('studio:hostedApps.install.check.prefixNote', 'Applies to all of the app’s tables at once.'),
      disabled: !table.offers.includes('alt-prefix'),
      field: {
        label: t('studio:hostedApps.install.check.prefixField', 'Prefix'),
        value: props.prefix,
        onChange: props.onPrefix,
        note: t('studio:hostedApps.install.check.prefixFieldNote', '{count, plural, one {The table will be checked again.} other {All # tables will be checked again.}}', {
          count: props.plan.tables.length,
        }),
      },
    },
  ];
  const offered = props.allowAltPrefix === false ? choices.filter((choice) => choice.value !== 'alt-prefix') : choices;

  return (
    <>
      <p className="mb-[11px] text-[12.5px] leading-[1.55] text-fg-muted">
        {withMono(
          'studio:hostedApps.install.check.takenIntro',
          '{table} already exists and was made by hand. Pick what to do with it.',
          'table',
          table.table,
        )}
      </p>
      <RadioGroup
        value={pick ?? ''}
        onValueChange={(value) => props.onPick(table.ref, value as TakenPick)}
        disabled={props.busy}
        aria-label={t('studio:hostedApps.install.check.takenIntroShort', 'What to do with {table}', {
          table: table.table,
        })}
        className="flex flex-col gap-[9px]"
      >
        {offered.map((choice) => {
          const selected = pick === choice.value;
          return (
            <div
              key={choice.value}
              className={`overflow-hidden rounded-xl border-[1.5px] ${
                selected ? 'border-accent' : 'border-border'
              } ${choice.disabled ? 'bg-surface-2 opacity-[0.72]' : 'bg-surface'}`}
            >
              <RadioCard
                value={choice.value}
                disabled={choice.disabled}
                hideIndicator
                className="rounded-none border-0 bg-transparent px-[15px] py-[13px] disabled:opacity-100 data-[state=checked]:bg-transparent"
                icon={
                  <span
                    aria-hidden
                    className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full border border-border-strong bg-surface group-data-[state=checked]:border-transparent group-data-[state=checked]:bg-accent"
                  >
                    <span className="size-[7px] rounded-full bg-accent-fg opacity-0 group-data-[state=checked]:opacity-100" />
                  </span>
                }
                title={<span className="font-bold">{choice.title}</span>}
                description={<span className="text-xs leading-[1.5] text-fg-muted">{choice.note}</span>}
                trailing={
                  choice.disabled ? <Ban aria-hidden className="size-[15px] text-fg-subtle" /> : undefined
                }
              />
              {selected && choice.field !== undefined ? (
                <div className="px-[15px] pb-[13px] ps-11">
                  <label className="mb-1.5 block text-[11.5px] font-bold text-fg-muted">
                    {choice.field.label}
                    <input
                      value={choice.field.value}
                      onChange={(event) => choice.field?.onChange(event.currentTarget.value)}
                      disabled={props.busy}
                      className="mt-1.5 block w-full max-w-[320px] rounded-[9px] border border-border-strong bg-surface px-3 py-[9px] font-mono text-[13px] font-normal text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                    />
                  </label>
                  <div className="mt-[7px] text-[11.5px] leading-[1.5] text-fg-subtle">{choice.field.note}</div>
                </div>
              ) : null}
              {selected && choice.value === 'reuse' && table.action === 'reuse' ? (
                <div className="px-[15px] pb-[13px] ps-11 text-xs leading-[1.5] text-fg-muted">
                  <EditsNote table={table} />
                </div>
              ) : null}
            </div>
          );
        })}
      </RadioGroup>
      {problems.map((problem) => (
        <p key={problem.message} role="alert" className="mt-2 text-xs text-danger">
          {problem.message}
        </p>
      ))}
    </>
  );
}

/** The footer's left-hand line on the check step. */
export function CheckHint({
  plan,
  picks,
  dirty,
  forUpdate = false,
}: {
  plan: AppInstallPlan;
  picks: Record<string, TakenPick>;
  dirty: boolean;
  /** Worded for the update dialog, whose button says Update. */
  forUpdate?: boolean;
}) {
  // A table picked for but not yet checked is waiting on the check, not on a pick.
  const undecided = (plan.tables ?? []).find(
    (table) => table.action === 'undecided' && picks[table.ref] === undefined,
  );
  const warn = undecided !== undefined || dirty;
  const Icon = warn ? TriangleAlert : CircleAlert;
  return (
    <span
      data-part="check-hint"
      className={`inline-flex items-center gap-[7px] text-[12.5px] font-semibold ${warn ? 'text-warn' : 'text-fg-subtle'}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {undecided !== undefined
        ? forUpdate
          ? t('studio:hostedApps.update.pickFirst', 'Pick what to do with {table} before you update.', {
              table: undecided.table,
            })
          : t('studio:hostedApps.install.check.pickFirst', 'Pick what to do with {table} before you install.', {
              table: undecided.table,
            })
        : dirty
          ? forUpdate
            ? t('studio:hostedApps.update.checkFirst', 'Check the tables again before you update.')
            : t('studio:hostedApps.install.check.checkFirst', 'Check the tables again before you install.')
          : forUpdate
            ? t('studio:hostedApps.update.nothingYet', 'Nothing changes until you press Update.')
            : t('studio:hostedApps.install.check.nothingYet', 'Nothing changes until you press Install.')}
    </span>
  );
}

type RowState = 'done' | 'fail' | 'wait' | 'now';

function StepRow({ label, value, state }: { label: string; value: string; state: RowState }) {
  const tone =
    state === 'done'
      ? 'bg-pos-soft text-pos'
      : state === 'fail'
        ? 'bg-danger-soft text-danger'
        : state === 'now'
          ? 'bg-accent-soft text-accent'
          : 'bg-surface-3 text-fg-subtle';
  const Icon = state === 'done' ? Check : state === 'fail' ? X : Circle;
  return (
    <li className="flex items-center gap-3 border-b border-border px-[17px] py-[13px] last:border-b-0">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span
        className={`flex-1 text-[13px] font-semibold ${
          state === 'fail' ? 'text-danger' : state === 'wait' ? 'text-fg-subtle' : 'text-fg'
        }`}
      >
        {label}
      </span>
      <MonoText className="text-xs text-fg-subtle">{value}</MonoText>
    </li>
  );
}

const STEP_LIST = 'overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm';

/**
 * While the install request runs. The add-ons it needs go first — installed,
 * updated or connected before the app's tables, which may be built on them.
 */
export function Installing({
  appName,
  connectionName,
  addOnSteps = [],
}: {
  appName: string;
  connectionName: string;
  addOnSteps?: readonly { key: string; label: string }[];
}) {
  return (
    <div className="flex max-w-[520px] flex-col gap-3.5" aria-busy="true">
      <div>
        <h2 className="flex items-center gap-2 text-[19px] font-extrabold leading-[normal] tracking-[-0.025em]">
          {t('studio:hostedApps.install.running.title', 'Installing {app}', { app: appName })}
          <Spinner size="sm" />
        </h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          {withMono('studio:hostedApps.install.running.hint', 'Writing to {connection}.', 'connection', connectionName)}
        </p>
      </div>
      <ul className={STEP_LIST}>
        {addOnSteps.map((step) => (
          <StepRow key={step.key} label={step.label} value="" state="wait" />
        ))}
        <StepRow label={t('studio:hostedApps.install.running.tables', 'Tables')} value="" state="wait" />
        <StepRow label={t('studio:hostedApps.install.running.pages', 'Pages')} value="" state="wait" />
      </ul>
    </div>
  );
}

/** Which of the install's steps a stopped install got through; -1 is the add-ons, before the tables. */
function stoppedAt(stage: string): number {
  return stage === 'add-ons' ? -1 : stage === 'tables' || stage === 'introspect' ? 0 : stage === 'pages' ? 1 : 2;
}

/** A 409 `APP_INSTALL_INCOMPLETE`, and the two ways on from it. */
export function InstallStopped({
  details,
  busy,
  onRetry,
  onBack,
}: {
  details: InstallStoppedDetails;
  busy: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const failed = stoppedAt(details.stage);
  const stateOf = (index: number): RowState => (index < failed ? 'done' : index === failed ? 'fail' : 'wait');
  const valueOf = (index: number, done: string): string =>
    index < failed
      ? done
      : index === failed
        ? t('studio:hostedApps.install.stopped.failed', 'failed')
        : t('studio:hostedApps.install.stopped.notStarted', 'not started');
  const body =
    details.stage === 'add-ons'
      ? t('studio:appAddOns.stopped.atAddOns', 'Installing the add-ons it needs failed, so nothing after that ran.')
      : details.stage === 'tables'
      ? t('studio:hostedApps.install.stopped.atTables', 'Creating the tables failed, so nothing after that ran.')
      : details.stage === 'introspect'
        ? t(
            'studio:hostedApps.install.stopped.atIntrospect',
            'The tables were made. Reading them back failed, so nothing after that ran.',
          )
        : details.stage === 'pages'
          ? t(
              'studio:hostedApps.install.stopped.atPages',
              'The tables were made. Creating the pages failed, so nothing after that ran.',
            )
          : t('studio:hostedApps.install.stopped.atFinish', 'The tables and pages were made. Finishing the install failed.');

  return (
    <div className="flex max-w-[560px] flex-col gap-3.5" data-testid="install-stopped">
      <div className="flex items-start gap-[13px]">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-danger-soft text-danger">
          <CircleAlert aria-hidden className="size-[22px]" />
        </div>
        <div>
          <h2 className="text-[19px] font-extrabold leading-[normal] tracking-[-0.025em]">
            {t('studio:hostedApps.install.stopped.title', 'The install stopped part way')}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.55] text-fg-muted">{body}</p>
        </div>
      </div>
      <ul className={STEP_LIST}>
        {/* What the add-on steps did before the stop: kept, and not redone by "Try again". */}
        {(details.addOns?.installed ?? []).map((addOn) => (
          <StepRow
            key={`i:${addOn.key}`}
            label={t('studio:appAddOns.running.install', 'Installing {addOn}', { addOn: addOn.name })}
            state="done"
            value={`v${addOn.version}`}
          />
        ))}
        {(details.addOns?.updated ?? []).map((addOn) => (
          <StepRow
            key={`u:${addOn.key}`}
            label={t('studio:appAddOns.running.update', 'Updating {addOn}', { addOn: addOn.name })}
            state="done"
            value={`${addOn.from} → ${addOn.to}`}
          />
        ))}
        {(details.addOns?.attached ?? []).map((addOn) => (
          <StepRow
            key={`a:${addOn.key}`}
            label={t('studio:appAddOns.running.attach', 'Connecting {addOn}', { addOn: addOn.name })}
            state="done"
            value={t('studio:appAddOns.running.connected', 'connected')}
          />
        ))}
        {details.stage === 'add-ons' ? (
          <StepRow
            label={t('studio:appAddOns.title', 'Add-ons')}
            state="fail"
            value={t('studio:hostedApps.install.stopped.failed', 'failed')}
          />
        ) : null}
        <StepRow
          label={t('studio:hostedApps.install.running.tables', 'Tables')}
          state={stateOf(0)}
          value={valueOf(
            0,
            t('studio:hostedApps.install.stopped.created', '{count} created', { count: details.created.length }),
          )}
        />
        <StepRow
          label={t('studio:hostedApps.install.running.pages', 'Pages')}
          state={stateOf(1)}
          value={valueOf(1, t('studio:hostedApps.install.stopped.made', 'made'))}
        />
      </ul>
      <div role="alert" className="rounded-[12px] border border-danger/25 bg-danger-soft px-[15px] py-[13px]">
        <div className="mb-[5px] text-[12.5px] font-bold text-danger">
          {details.table === null
            ? t('studio:hostedApps.install.stopped.said', 'What the database said')
            : withMono(
                'studio:hostedApps.install.stopped.saidAbout',
                'What the database said about {table}',
                'table',
                details.table,
              )}
        </div>
        <MonoText className="block text-xs leading-[1.5] text-fg-muted">{details.cause}</MonoText>
      </div>
      <p className="text-xs text-fg-subtle">
        {t(
          'studio:hostedApps.install.stopped.resume',
          'Nothing was removed. Trying again finishes from where it stopped.',
        )}
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Button disabled={busy} onClick={onRetry}>
          {busy ? <Spinner size="sm" /> : <RotateCw aria-hidden className="size-4" />}
          {t('studio:hostedApps.install.stopped.retry', 'Try again')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          {t('studio:hostedApps.install.stopped.back', 'Back to Schema plan')}
        </Button>
      </div>
    </div>
  );
}
