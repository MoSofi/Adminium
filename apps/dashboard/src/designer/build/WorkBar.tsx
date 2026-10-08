// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one bar over the work area: its tabs, and after them what the open tab
 * needs. For the preview that is the side, the size, whose eyes it is, reload,
 * the address, the camera switch, "Open in a new tab" and "More".
 *
 * It draws the level it is given and decides nothing: the work area measures
 * it and picks the level (see `barLevel.ts`). `measuring` draws the same
 * boxes with nothing live in them, for the copy that is measured off-screen.
 */
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { Camera, ChevronDown, ExternalLink, Eye, IdCard, LayoutDashboard, Monitor, RotateCw, Smartphone, Tablet, UserRound } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, TabsList, TabsTrigger, Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { BarLevel } from './barLevel.js';
import { MENU_PANEL, MoreMenu, TOOL_ICON } from './MoreMenu.js';
import { RADIO_ROW, SideRows, type SideChoice } from './sideChoices.js';
import type { PreviewModel, PreviewSide, PreviewWidth } from './usePreview.js';

export interface WorkTab {
  value: string;
  label: string;
}

export function sideName(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.dashboard', 'Dashboard');
    case 'staff':
      return t('designer:preview.staff', 'Staff');
    case 'customer':
      return t('designer:preview.customer', 'Customer');
  }
}

function sideIcon(side: PreviewSide, size = 'size-3.5'): ReactNode {
  const Icon = side === 'dashboard' ? LayoutDashboard : side === 'staff' ? IdCard : UserRound;
  return <Icon aria-hidden="true" className={size} />;
}

const WIDTHS = [
  ['desktop', Monitor],
  ['tablet', Tablet],
  ['phone', Smartphone],
] as const;

function widthName(width: PreviewWidth): string {
  switch (width) {
    case 'desktop':
      return t('designer:preview.desktop', 'Desktop');
    case 'tablet':
      return t('designer:preview.tablet', 'Tablet');
    case 'phone':
      return t('designer:preview.phone', 'Phone');
  }
}

/**
 * Whose eyes the preview is: the owner's own for the dashboard, the app's
 * roles for the staff side, nobody for the customer side. A few words for the
 * bar, and the sentence behind them. `said` is both, for a screen reader and
 * for the chip once it is only its icon.
 */
export function seenAs(side: PreviewSide, roles: readonly string[] | null): { label: string; tip: string; said: string } {
  const both = (label: string, tip: string): { label: string; tip: string; said: string } => ({ label, tip, said: `${label}. ${tip}` });
  if (side === 'dashboard') return both(t('designer:preview.seenOwner', 'Seen as: owner'), t('designer:preview.seenOwnerTip', 'You, the owner.'));
  if (side === 'customer') return both(t('designer:preview.seenVisitor', 'Seen as: visitor'), t('designer:preview.seenVisitorTip', 'A visitor, not signed in.'));
  if (roles === null) return both(t('designer:preview.seenStaff', 'Seen as: staff'), t('designer:preview.seenStaffTip', 'Staff. A preview, not your own sign-in.'));
  if (roles.length === 0) return both(t('designer:preview.seenNoRole', 'Seen as: no role'), t('designer:preview.seenNoRoleTip', 'A person with no role yet. A preview.'));
  // The chip cuts a long list of roles short: its sentence says them all.
  const who = roles.join(', ');
  const tip = t('designer:preview.seenRolesTip', 'Seen as: {who}. A preview, not your own sign-in.', { who });
  return { label: t('designer:preview.seenRoles', 'Seen as: {who}', { who }), tip, said: tip };
}

const TRAY = 'flex shrink-0 gap-0.5 rounded-[10px] bg-surface-3 p-0.5';
const SEGMENT =
  'inline-flex h-7 shrink-0 items-center justify-center gap-[5px] whitespace-nowrap rounded-[8px] text-[12px] font-bold text-fg-muted hover:text-fg ' +
  'aria-checked:bg-surface aria-checked:text-fg aria-checked:shadow-card aria-checked:ring-1 aria-checked:ring-border focus-visible:outline-2 focus-visible:outline-accent';
const MENU_BUTTON =
  'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[9px] border border-border bg-surface text-[12px] font-bold text-fg hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent';
const TAB = '-mb-px min-h-[45px] whitespace-nowrap rounded-none border-b-2 px-2 pb-0 pt-0 text-[12.5px] font-bold data-[state=active]:font-extrabold';

/** One of a few, as a row of segments: arrow keys move through them, and the one chosen is the row's one tab stop. */
function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
  live,
}: {
  label: string | undefined;
  value: T;
  options: readonly { value: T; label: string; icon: ReactNode; iconOnly?: boolean }[];
  onChange: (value: T) => void;
  live: boolean;
}): ReactNode {
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    const at = options.findIndex((option) => option.value === value);
    const next = event.key === 'Home' ? options[0] : event.key === 'End' ? options.at(-1) : forward || back ? options[(at + (forward ? 1 : -1) + options.length) % options.length] : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={TRAY}>
      {options.map((option) => {
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-value={option.value}
            aria-checked={option.value === value}
            aria-label={option.iconOnly === true && live ? option.label : undefined}
            tabIndex={option.value === value ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`${SEGMENT} ${option.iconOnly === true ? 'w-[30px]' : 'px-[9px]'}`}
          >
            {option.icon}
            {option.iconOnly === true ? null : option.label}
          </button>
        );
        return option.iconOnly === true && live ? (
          <Tooltip key={option.value} content={option.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

export function WorkBar({
  tabs,
  tab,
  level,
  preview,
  address,
  end,
  endFills = false,
  onNotice,
  measuring = false,
  barRef,
}: {
  tabs: readonly WorkTab[];
  tab: string;
  level: BarLevel;
  preview: PreviewModel;
  /** The address bar, drawn by the work area: it fills what the bar has left. */
  address: ReactNode;
  /** What a tab other than the preview puts after the tabs. */
  end?: ReactNode;
  /** That part takes the room the bar has left (the Code tab's), instead of sitting at its end. */
  endFills?: boolean;
  /** A word for the person, said as the page says such things. */
  onNotice: (text: string) => void;
  measuring?: boolean;
  barRef?: Ref<HTMLDivElement>;
}): ReactNode {
  const live = !measuring;
  const rows = level === 4;
  const { side, sides, width, sees } = preview;
  // Before the first build, and on a live server, there is no preview to have tools for.
  const tools = tab === 'preview' && !preview.noPreview && preview.app !== null;
  const seen = seenAs(side, preview.ticket?.seenAs ?? null);
  const choices: SideChoice[] = sides.map((entry) => ({ value: entry, label: sideName(entry), icon: sideIcon(entry, 'size-[15px]') }));
  /** The measured copy is only boxes: it has no names for anything to find. */
  const name = (text: string): string | undefined => (live ? text : undefined);
  const tip = (content: string, element: ReactNode): ReactNode => (live ? <Tooltip content={content}>{element}</Tooltip> : element);
  const setSees = (on: boolean): void => {
    preview.setSees(on);
    onNotice(on ? t('designer:preview.sees', 'The Designer looks at the page after it builds') : t('designer:preview.seesNot', 'The Designer will not look at the page after it builds'));
  };

  const sideControl =
    sides.length < 2 || rows ? null : level <= 1 ? (
      <Segments
        label={name(t('designer:preview.side', 'Side'))}
        value={side}
        options={sides.map((entry) => ({ value: entry, label: sideName(entry), icon: sideIcon(entry) }))}
        onChange={preview.setSide}
        live={live}
      />
    ) : (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger aria-label={name(t('designer:preview.sideIs', 'Side: {side}', { side: sideName(side) }))} className={`${MENU_BUTTON} gap-1.5 pe-[7px] ps-[9px]`}>
          <span className="flex text-fg-muted">{sideIcon(side)}</span>
          <span>{sideName(side)}</span>
          <ChevronDown aria-hidden="true" className="size-[13px] text-fg-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={`${MENU_PANEL} w-[190px]`}>
          <DropdownMenuRadioGroup value={side} onValueChange={(value) => preview.setSide(value as PreviewSide)}>
            <SideRows sides={choices} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const SizeIcon = WIDTHS.find(([id]) => id === width)?.[1] ?? Monitor;
  const sizeIs = t('designer:preview.sizeIs', 'Size: {size}', { size: widthName(width) });
  const sizeControl = rows ? null : level <= 1 ? (
    <Segments
      label={name(t('designer:preview.size', 'Size'))}
      value={width}
      options={WIDTHS.map(([id, Icon]) => ({ value: id, label: widthName(id), icon: <Icon aria-hidden="true" className="size-3.5" />, iconOnly: true }))}
      onChange={preview.setWidth}
      live={live}
    />
  ) : (
    <DropdownMenu modal={false}>
      {tip(
        sizeIs,
        <DropdownMenuTrigger aria-label={name(sizeIs)} className={`${MENU_BUTTON} gap-[3px] pe-1.5 ps-2`}>
          <SizeIcon aria-hidden="true" className="size-3.5 text-fg-muted" />
          <ChevronDown aria-hidden="true" className="size-[13px] text-fg-subtle" />
        </DropdownMenuTrigger>,
      )}
      <DropdownMenuContent align="start" className={`${MENU_PANEL} w-[170px]`}>
        <DropdownMenuRadioGroup value={width} onValueChange={(value) => preview.setWidth(value as PreviewWidth)}>
          {WIDTHS.map(([id, Icon]) => (
            <DropdownMenuRadioItem key={id} value={id} className={RADIO_ROW}>
              <span className="flex items-center gap-[9px]">
                <Icon aria-hidden="true" className="text-fg-muted" />
                {widthName(id)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const chip = rows
    ? null
    : level <= 2
      ? tip(
          seen.tip,
          <span tabIndex={live ? 0 : -1} role="note" aria-label={name(seen.said)} className="inline-flex h-7 max-w-[178px] shrink-0 cursor-default items-center gap-[5px] whitespace-nowrap rounded-[8px] bg-surface-3 pe-2.5 ps-2 text-[12px] font-bold text-fg-muted focus-visible:outline-2 focus-visible:outline-accent">
            <Eye aria-hidden="true" className="size-3.5 shrink-0" />
            <span aria-hidden="true" className="overflow-hidden text-ellipsis">
              {seen.label}
            </span>
          </span>,
        )
      : tip(
          seen.said,
          <span tabIndex={live ? 0 : -1} role="img" aria-label={name(seen.said)} className="inline-flex h-7 w-[30px] shrink-0 cursor-default items-center justify-center rounded-[8px] bg-surface-3 text-fg-muted focus-visible:outline-2 focus-visible:outline-accent">
            <Eye aria-hidden="true" className="size-3.5" />
          </span>,
        );

  return (
    <div
      ref={barRef}
      data-part="work-bar"
      data-level={level}
      className={`flex min-h-[46px] shrink-0 items-center border-b border-border bg-surface leading-[normal] ${rows ? 'flex-wrap gap-x-2 gap-y-0 px-2.5' : 'gap-3 overflow-hidden px-3'}`}
    >
      {live ? (
        <TabsList aria-label={name(t('designer:work.label', 'Work area'))} className={`shrink-0 items-stretch gap-0.5 self-stretch border-b-0 ${rows ? 'basis-full' : ''}`}>
          {tabs.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className={TAB}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      ) : (
        <div className={`flex shrink-0 items-stretch gap-0.5 self-stretch ${rows ? 'basis-full' : ''}`}>
          {tabs.map((entry) => (
            <span key={entry.value} data-state={entry.value === tab ? 'active' : 'inactive'} className={`inline-flex items-center ${TAB}`}>
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {tools ? (
        <div className={`flex min-w-0 flex-1 items-center gap-[5px] ${rows ? 'basis-full py-2' : ''}`}>
          {sideControl}
          {sizeControl}
          {chip}
          {tip(
            t('designer:preview.reload', 'Reload'),
            <button type="button" onClick={preview.reload} aria-label={name(t('designer:preview.reloadPreview', 'Reload the preview'))} className={TOOL_ICON}>
              <RotateCw aria-hidden="true" className="size-3.5" />
            </button>,
          )}
          {address}
          {level === 0
            ? tip(
                t('designer:preview.sees', 'The Designer looks at the page after it builds'),
                <button
                  type="button"
                  aria-pressed={sees}
                  onClick={() => setSees(!sees)}
                  aria-label={name(t('designer:preview.sees', 'The Designer looks at the page after it builds'))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-transparent text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent/35 aria-pressed:bg-accent-soft aria-pressed:text-accent"
                >
                  <Camera aria-hidden="true" className="size-3.5" />
                </button>,
              )
            : null}
          {rows
            ? null
            : tip(
                t('designer:preview.newTab', 'Open in a new tab'),
                <button type="button" onClick={preview.openTab} aria-label={name(t('designer:preview.newTab', 'Open in a new tab'))} className={TOOL_ICON}>
                  <ExternalLink aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                </button>,
              )}
          {level === 0 ? null : live ? (
            <MoreMenu rows={rows} sides={choices} side={side} onSide={(value) => preview.setSide(value as PreviewSide)} seen={seen} sees={sees} onSees={setSees} onNewTab={preview.openTab} />
          ) : (
            <span className={TOOL_ICON} />
          )}
        </div>
      ) : null}

      {end === undefined || tab === 'preview' ? null : <div className={`flex min-w-0 items-center ${endFills ? 'flex-1' : 'ms-auto'} ${rows ? 'basis-full py-2' : ''}`}>{end}</div>}
    </div>
  );
}
