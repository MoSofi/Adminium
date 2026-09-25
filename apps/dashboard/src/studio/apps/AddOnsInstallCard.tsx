// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's "Add-ons" card (`Installed Apps.dc.html`, the O3
 * additions): the add-ons the app names, one row each — ticked, what it is
 * (Required / Suggested / Needed for: …), where it comes from, why the app
 * wants it, and what installing the app will do to it.
 *
 * Every row is the server's (`POST /apps/plan` → `addOns[]`); this decides
 * nothing the server did not. What it does decide is what the install is SENT
 * with — which suggestions are ticked, and "Update it too" — and what holds the
 * Install button, in words, at the footer:
 *
 *  - a required add-on that cannot be had here;
 *  - one installed at a version the app does not work with, unless "Update it
 *    too" is ticked (and a version in range is on offer);
 *  - one that is in the add-on catalogue but not on this server yet — it is
 *    downloaded first, from its row, then the check is made again;
 *  - one whose own install plan is refused (a ticked suggestion can simply be
 *    unticked instead).
 *
 * Installing an add-on with the app is still installing it, so its own plan —
 * the tables it creates — is said in its row before anything happens (the
 * consent the Add-ons page asks for, folded into the app's).
 */
import { Button, Checkbox, Spinner } from '@adminium/ui';
import { ArrowRight, CircleAlert, Download, KeyRound, Link2, Minus, Puzzle, Table2, TriangleAlert } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { docsUrl } from '../../kb/docsLinks.js';
import type { AddOnChoice, AppAddOnRow } from './appsApi.js';
import {
  NeedPill,
  manifestWords,
  namesList,
  needsVersion,
  rangeFloor,
  sourceWords,
  unavailableSourceWords,
} from './addOnWords.js';

const CARD = 'rounded-[14px] border border-border bg-surface p-[18px] shadow-sm';

/** What the operator decided on the card: ticks, and "Update it too", by key. */
export interface AddOnPicks {
  ticked: Record<string, boolean>;
  update: Record<string, boolean>;
}

/** Whether the row goes with the app: always when required or already connected, else as ticked. */
export function isSelected(row: AppAddOnRow, picks: AddOnPicks): boolean {
  if (row.need === 'requires' || row.state === 'attached') return true;
  if (!selectable(row)) return false;
  return picks.ticked[row.key] ?? row.checked;
}

/** A suggestion that cannot be had here is never ticked. */
function selectable(row: AppAddOnRow): boolean {
  return row.state !== 'unavailable';
}

/** "Update it too", ticked by default. */
function updating(row: AppAddOnRow, picks: AddOnPicks): boolean {
  return picks.update[row.key] ?? true;
}

/**
 * What installing does to a selected row: nothing, attach, install or update.
 * An update left unticked never reaches here as a step: it holds the install
 * (see {@link addOnBlock}).
 */
function stepOf(row: AppAddOnRow, picks: AddOnPicks): AppAddOnRow['action'] {
  return isSelected(row, picks) ? row.action : null;
}

/** The install body's `addOns`: every add-on the install acts on, at the version the check showed. */
export function addOnChoicesOf(rows: readonly AppAddOnRow[], picks: AddOnPicks): AddOnChoice[] {
  const out: AddOnChoice[] = [];
  for (const row of rows) {
    const step = stepOf(row, picks);
    if (step === null) continue;
    const version = step === 'attach' ? row.installedVersion : row.offeredVersion;
    if (version === null) continue;
    out.push({ key: row.key, version, ...(step === 'update' ? { update: true } : {}) });
  }
  return out;
}

/** The install's add-on steps, in the order it takes them — the Installing screen's first rows. */
export function addOnStepsOf(rows: readonly AppAddOnRow[], picks: AddOnPicks): { key: string; label: string }[] {
  return rows.flatMap((row) => {
    const step = stepOf(row, picks);
    if (step === null) return [];
    const label =
      step === 'install'
        ? t('studio:appAddOns.running.install', 'Installing {addOn}', { addOn: row.name })
        : step === 'update'
          ? t('studio:appAddOns.running.update', 'Updating {addOn}', { addOn: row.name })
          : t('studio:appAddOns.running.attach', 'Connecting {addOn}', { addOn: row.name });
    return [{ key: row.key, label }];
  });
}

/** Problems the row already says in its own words (its state line), so not said twice. */
const SAID_BY_STATE = new Set(['ADD_ON_UNAVAILABLE', 'ADD_ON_OUT_OF_RANGE']);

/**
 * What holds the install, in words, for the footer — null when nothing does.
 * The first row that holds it speaks; the rest wait their turn.
 */
export function addOnBlock(appName: string, rows: readonly AppAddOnRow[], picks: AddOnPicks): string | null {
  for (const row of rows) {
    const required = row.need === 'requires';
    // A suggestion that cannot be had is never ticked; a requirement holds the install.
    if (row.state === 'unavailable') {
      if (required) {
        return t('studio:appAddOns.block.unavailable', '{app} needs {addOn}, which isn’t available here.', { app: appName, addOn: row.name });
      }
      continue;
    }
    if (!isSelected(row, picks)) continue;
    if (row.state === 'outdated') {
      if (row.action !== 'update') {
        return required
          ? t('studio:appAddOns.block.noVersion', '{app} needs {addOn} {version}, and no such version is available here.', {
              app: appName,
              addOn: row.name,
              version: versionWords(row.range),
            })
          : t('studio:appAddOns.block.untick', '{addOn} can’t be used with {app} here. Untick it to install {app} without it.', {
              app: appName,
              addOn: row.name,
            });
      }
      if (!updating(row, picks)) {
        return t('studio:appAddOns.block.tooOld', '{app} needs {addOn} {version}.', {
          app: appName,
          addOn: row.name,
          version: versionWords(row.range),
        });
      }
    }
    if ((row.action === 'install' || row.action === 'update') && !row.staged && stepOf(row, picks) !== null) {
      return t('studio:appAddOns.block.download', 'Download {addOn} first: it is in the add-on catalogue, not on this server yet.', {
        addOn: row.name,
      });
    }
    const problems = row.problems.filter((problem) => !SAID_BY_STATE.has(problem.code));
    if (problems.length > 0) {
      return required
        ? t('studio:appAddOns.block.problem', '{addOn} can’t be installed with {app}. Its row says why.', { app: appName, addOn: row.name })
        : t('studio:appAddOns.block.untick', '{addOn} can’t be used with {app} here. Untick it to install {app} without it.', {
            app: appName,
            addOn: row.name,
          });
    }
  }
  return null;
}

/** "1.1.0 or later", or the range. */
function versionWords(range: string): string {
  const floor = rangeFloor(range);
  return floor === null ? range : t('studio:appAddOns.orLater', '{version} or later', { version: floor });
}

export interface AddOnsInstallCardProps {
  appName: string;
  connectionName: string;
  rows: readonly AppAddOnRow[];
  picks: AddOnPicks;
  onTick: (key: string, next: boolean) => void;
  onUpdate: (key: string, next: boolean) => void;
  /** Whether the add-on catalogue is on here; null while unknown. */
  catalogueOn: boolean | null;
  /** A download under way from this card, and how far it is. */
  downloading: { key: string; pct: number } | null;
  onDownload: (row: AppAddOnRow) => void;
  busy: boolean;
  /** The add-on settings the app's roles would be given, by add-on key (`addOnGrants`). */
  grants?: readonly { roleName: string; addOn: string }[] | undefined;
}

export function AddOnsInstallCard(props: AddOnsInstallCardProps) {
  const { appName, rows } = props;
  return (
    <section className={CARD} data-testid="install-add-ons">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <Puzzle aria-hidden className="size-4 text-accent" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{t('studio:appAddOns.title', 'Add-ons')}</span>
      </h3>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
        {t('studio:appAddOns.intro', '{app} works with {count, plural, one {this add-on} other {these add-ons}}.', {
          app: appName,
          count: rows.length,
        })}
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <AddOnRow key={row.key} row={row} {...props} />
        ))}
      </ul>
      <p className="mt-2.5 text-[11.5px] leading-[1.45] text-fg-subtle">
        {t('studio:appAddOns.shared', 'Add-ons are shared. Any other app you install can use them too.')}
      </p>
    </section>
  );
}

type Tone = 'accent' | 'pos' | 'subtle' | 'danger' | 'warn';

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent',
  pos: 'text-pos',
  subtle: 'text-fg-subtle',
  danger: 'text-danger',
  warn: 'text-warn',
};

function AddOnRow({ row, ...props }: AddOnsInstallCardProps & { row: AppAddOnRow }) {
  const { appName, picks } = props;
  const required = row.need === 'requires';
  const selected = isSelected(row, picks);
  const locked = required || row.state === 'attached' || !selectable(row);
  const update = updating(row, picks);
  const outdated = row.state === 'outdated';
  const blocked = row.state === 'unavailable' || (outdated && selected && (row.action !== 'update' || !update));
  const tone: 'danger' | 'warn' | null = blocked && (required || selected || row.state !== 'unavailable') ? 'danger' : outdated && selected ? 'warn' : null;
  const rowClass =
    tone === 'danger'
      ? 'border-danger/30 bg-danger-soft'
      : tone === 'warn'
        ? 'border-warn/30 bg-warn-soft'
        : 'border-border bg-surface-2';
  const version = row.state === 'installed' || row.state === 'attached' ? null : row.offeredVersion;
  const source = row.state === 'unavailable' ? unavailableSourceWords(props.catalogueOn) : sourceWords(row.source);
  const meta = version === null ? source : t('studio:appAddOns.meta', 'v{version} · {source}', { version, source });
  const status = statusOf(row, selected, update, appName);
  const problems = row.problems.filter((problem) => !SAID_BY_STATE.has(problem.code));
  const downloading = props.downloading?.key === row.key ? props.downloading : null;
  const needsDownload = selected && (row.action === 'install' || (row.action === 'update' && update)) && !row.staged;
  // Settings are shared by every app the add-on serves, so a role given them is said before anyone agrees.
  const grantedRoles = (props.grants ?? []).filter((grant) => grant.addOn === row.key).map((grant) => grant.roleName);

  return (
    <li className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${rowClass}`} data-add-on={row.key} data-state={row.state}>
      <Checkbox
        className={`mt-px ${locked ? 'opacity-55' : ''} ${row.state === 'unavailable' && required ? 'border-danger/45' : ''}`}
        checked={selected}
        disabled={locked || props.busy}
        aria-label={row.name}
        onCheckedChange={(next) => props.onTick(row.key, next === true)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[7px]">
          <span className="text-[12.5px] font-bold">{row.name}</span>
          <NeedPill need={row.need} features={row.features} />
        </div>
        {meta === '' ? null : <p className="mt-[3px] text-[11.5px] leading-[1.45] text-fg-subtle">{meta}</p>}
        <p className="mt-1 text-[11.5px] leading-[1.45] text-fg-muted">{manifestWords(row.reason)}</p>
        {status === null ? null : (
          <p className={`mt-[7px] flex items-start gap-1.5 text-[11.5px] font-bold leading-[1.45] ${TONE_TEXT[status.tone]}`} data-part="add-on-status">
            <status.Icon aria-hidden className="mt-px size-[13px] shrink-0" />
            <span>{status.text}</span>
          </p>
        )}
        {selected && row.action === 'install' && row.plan !== null && row.plan !== undefined && row.plan.create.length > 0 ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-fg-muted" data-part="add-on-plan">
            <Table2 aria-hidden className="mt-px size-[13px] shrink-0 text-fg-subtle" />
            <span>
              {t('studio:appAddOns.plan.creates', 'Creates {count, plural, one {# table} other {# tables}} in {connection}: {tables}', {
                count: row.plan.create.length,
                connection: props.connectionName,
                tables: row.plan.create.map((table) => table.ref).join(', '),
              })}
            </span>
          </p>
        ) : null}
        {grantedRoles.length === 0 ? null : (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-fg-muted" data-part="add-on-grant">
            <KeyRound aria-hidden className="mt-px size-[13px] shrink-0 text-fg-subtle" />
            <span>
              {t(
                'studio:appAddOns.grant',
                '{roles} will be able to change its settings, which every app it serves shares.',
                { roles: namesList(grantedRoles) },
              )}
            </span>
          </p>
        )}
        {selected && problems.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1" data-part="add-on-problems">
            {problems.map((problem) => (
              <li key={`${problem.code}:${problem.message}`} className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-danger">
                <CircleAlert aria-hidden className="mt-px size-[13px] shrink-0" />
                <span>{problem.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {row.state === 'unavailable' || (outdated && row.action !== 'update') ? (
          <a
            href={docsUrl('self-hosting/installing-add-ons')}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-[5px] text-xs font-bold text-accent"
          >
            {t('studio:appAddOns.howTo', 'How to add an add-on')}
            <ArrowRight aria-hidden className="size-[13px] rtl:-scale-x-100" />
          </a>
        ) : null}
        {outdated && row.action === 'update' && selected ? (
          <div className="mt-[9px] flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex cursor-pointer items-start gap-[9px]">
              <Checkbox checked={update} disabled={props.busy} onCheckedChange={(next) => props.onUpdate(row.key, next === true)} />
              <span className="text-[12.5px] font-bold">{t('studio:appAddOns.updateToo', 'Update it too')}</span>
            </label>
            {row.usedBy.length === 0 ? null : (
              <span className="text-[11.5px] text-fg-subtle" data-part="add-on-used-by">
                {t('studio:appAddOns.alsoUsedBy', 'Also used by {apps}', { apps: namesList(row.usedBy.map((use) => use.appName)) })}
              </span>
            )}
          </div>
        ) : null}
        {needsDownload ? (
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <Button size="sm" variant="secondary" disabled={props.busy} onClick={() => props.onDownload(row)}>
              {downloading === null ? <Download aria-hidden className="size-3.5" /> : <Spinner size="sm" />}
              {t('studio:appAddOns.download', 'Download it')}
            </Button>
            {downloading === null ? null : (
              <span role="status" className="text-[11.5px] text-fg-muted">
                {t('studio:appAddOns.downloading', 'Downloading… {pct}%', { pct: Math.round(downloading.pct) })}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The row's state line: what installing the app will do to it, or why it can't. */
function statusOf(
  row: AppAddOnRow,
  selected: boolean,
  update: boolean,
  appName: string,
): { text: string; tone: Tone; Icon: typeof Download } | null {
  switch (row.state) {
    case 'attached':
      return { text: t('studio:appAddOns.status.attached', 'Already connected to {app}', { app: appName }), tone: 'pos', Icon: Link2 };
    case 'installed':
      return selected
        ? {
            text: t('studio:appAddOns.status.willConnect', 'Installed · v{version} · will be connected to {app}', {
              version: row.installedVersion ?? '',
              app: appName,
            }),
            tone: 'pos',
            Icon: Link2,
          }
        : {
            text: t('studio:appAddOns.status.wontConnect', 'Installed · v{version} · won’t be connected', { version: row.installedVersion ?? '' }),
            tone: 'subtle',
            Icon: Minus,
          };
    case 'absent':
      if (!selected) return null;
      return row.staged
        ? { text: t('studio:appAddOns.status.willInstall', 'Will be installed'), tone: 'accent', Icon: Download }
        : {
            text: t('studio:appAddOns.status.downloadFirst', 'Will be installed, once it is downloaded from the add-on catalogue'),
            tone: 'accent',
            Icon: Download,
          };
    case 'unavailable':
      return {
        text: t('studio:appAddOns.status.unavailable', '{addOn} isn’t available on this Adminium', { addOn: row.name }),
        tone: 'danger',
        Icon: CircleAlert,
      };
    case 'outdated':
      if (!selected) {
        return {
          text: t('studio:appAddOns.status.wontConnect', 'Installed · v{version} · won’t be connected', { version: row.installedVersion ?? '' }),
          tone: 'subtle',
          Icon: Minus,
        };
      }
      return {
        text: t('studio:appAddOns.status.tooOld', 'Installed v{installed} — {need}', {
          installed: row.installedVersion ?? '',
          need: needsVersion(appName, row.range),
        }),
        tone: row.action === 'update' && update ? 'warn' : 'danger',
        Icon: TriangleAlert,
      };
  }
}
