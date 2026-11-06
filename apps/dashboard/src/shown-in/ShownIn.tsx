// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pieces of "Shown in", drawn as the Workspaces comp draws them:
 *
 * - {@link ShownInControl}: "All workspaces" / "Only these workspaces", and
 *   under the second a bordered list of the workspaces, each a box, its tile
 *   and its name (comp `s8`).
 * - {@link ShownInChips}: a list cell. "All workspaces" as an outlined chip
 *   with the layers glyph, or one chip per chosen workspace (comp `s5-mail`).
 * - {@link WorkspaceChip}: the comp's chip, a tile and a name on surface-3.
 * - {@link WorkspaceFilter}: a list's "Workspace" select (All in one menu).
 * - {@link HiddenHereNote}: a picker's chosen item that is not listed in the
 *   tab's workspace. It still sends; the note says where it is shown.
 * - {@link ShownOnlyInList}: what a workspace's delete leaves shown nowhere,
 *   for its confirm.
 *
 * Every tile has one style, whatever the workspace (no colour per
 * workspace), on the opaque chip tint. The words are a deferred group of
 * `common` (`shownIn`), so each piece waits for them before it draws.
 */
import { EyeOff, Layers } from 'lucide-react';
import { useId } from 'react';
import { Checkbox, Radio, RadioGroup, Select, cn } from '@adminium/ui';

import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { nextShownIn, type ShownIn } from './model.js';
import { OTHER_DATABASES, useShownInScope, type ShownInWorkspace } from './scope.js';

/** A workspace's initials tile: one style for every workspace. */
export function WorkspaceTile({ workspace, size = 'sm' }: { workspace: Pick<ShownInWorkspace, 'initials'>; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[6px] bg-accent-soft-solid text-[9.5px] font-extrabold text-accent',
        size === 'md' ? 'size-6' : 'size-[18px]',
      )}
    >
      {workspace.initials}
    </span>
  );
}

/** The comp's chip: tile + name on surface-3, 24 px tall. */
export function WorkspaceChip({ workspace }: { workspace: Pick<ShownInWorkspace, 'initials' | 'name'> }) {
  return (
    <span data-testid="workspace-chip" className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] bg-surface-3 pe-2 ps-[3px] text-[12px] font-bold leading-[normal] text-fg">
      <WorkspaceTile workspace={workspace} />
      {workspace.name}
    </span>
  );
}

/** A list's "Shown in" column header; the row it sits in gives it the header type. */
export function ShownInHeader() {
  useCommonWords();
  return <span role="columnheader">{t('shownIn.label', 'Shown in')}</span>;
}

/** The outlined chip of an item that is not a list of workspaces: "All workspaces", or "No workspace". */
function OutlinedChip({ icon, label, testId }: { icon: 'all' | 'none'; label: string; testId: string }) {
  const Glyph = icon === 'all' ? Layers : EyeOff;
  return (
    <span data-testid={testId} className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border-strong px-2 text-[12px] font-bold leading-[normal] text-fg-muted">
      <Glyph className="size-[13px] shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Where an item is listed, as chips. The chosen workspaces this person cannot see are left out. */
export function ShownInChips({ shownIn, className }: { shownIn: ShownIn | undefined; className?: string | undefined }) {
  useCommonWords();
  const scope = useShownInScope();
  if (shownIn === undefined || shownIn.mode === 'all') {
    return <OutlinedChip icon="all" label={t('shownIn.all', 'All workspaces')} testId="shown-in-all" />;
  }
  const chosen = scope.workspaces.filter((workspace) => shownIn.workspaceIds.includes(workspace.id));
  if (shownIn.workspaceIds.length === 0) return <OutlinedChip icon="none" label={t('shownIn.none', 'No workspace')} testId="shown-in-none" />;
  const unseen = shownIn.workspaceIds.length - chosen.length;
  return (
    <span data-testid="shown-in-chips" className={cn('flex flex-wrap gap-1.5', className)}>
      {chosen.map((workspace) => (
        <WorkspaceChip key={workspace.id} workspace={workspace} />
      ))}
      {unseen === 0 ? null : (
        <span className="inline-flex h-6 items-center whitespace-nowrap rounded-[6px] bg-surface-3 px-2 text-[12px] font-bold leading-[normal] text-fg-muted">
          {t('shownIn.unseenChip', '{count, plural, one {# other workspace} other {# other workspaces}}', { count: unseen })}
        </span>
      )}
    </span>
  );
}

export interface ShownInControlProps {
  value: ShownIn;
  onChange: (next: ShownIn) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** "Shown in" on an item's editor (comp `s8`): the two choices, and the workspaces under the second. */
export function ShownInControl({ value, onChange, disabled = false, className }: ShownInControlProps) {
  useCommonWords();
  const scope = useShownInScope();
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const unseen = value.workspaceIds.filter((one) => !scope.workspaces.some((workspace) => workspace.id === one)).length;
  const start = scope.currentWorkspaceId === OTHER_DATABASES ? null : scope.currentWorkspaceId;
  return (
    <div data-testid="shown-in-control" className={cn('leading-[normal]', className)}>
      <div id={labelId} className="mb-1 text-[12.5px] font-bold text-fg">
        {t('shownIn.label', 'Shown in')}
      </div>
      <RadioGroup
        aria-labelledby={labelId}
        value={value.mode}
        disabled={disabled}
        onValueChange={(mode) => onChange(nextShownIn(value, { mode: mode === 'chosen' ? 'chosen' : 'all' }, start))}
        className="gap-0"
      >
        <div className="py-1.5">
          <Radio value="all" label={t('shownIn.all', 'All workspaces')} data-testid="shown-in-mode-all" />
        </div>
        <div className="py-1.5">
          <Radio value="chosen" label={t('shownIn.chosen', 'Only these workspaces')} aria-controls={listId} data-testid="shown-in-mode-chosen" />
        </div>
      </RadioGroup>
      {value.mode === 'chosen' ? (
        <div id={listId} className="ms-7 mt-1.5">
          <ul className="m-0 list-none overflow-hidden rounded-[10px] border border-border p-0">
            {scope.workspaces.map((workspace, index) => {
              const boxId = `${id}-${workspace.id}`;
              return (
                <li key={workspace.id} className={cn('flex items-center gap-3 px-3.5 py-[11px]', index > 0 && 'border-t border-border')}>
                  <Checkbox
                    id={boxId}
                    data-testid="shown-in-workspace"
                    data-workspace-id={workspace.id}
                    checked={value.workspaceIds.includes(workspace.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(nextShownIn(value, { toggle: workspace.id, on: checked === true }, start))}
                  />
                  <WorkspaceTile workspace={workspace} size="md" />
                  <label htmlFor={boxId} className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg">
                    {workspace.name}
                  </label>
                </li>
              );
            })}
          </ul>
          {value.workspaceIds.length === unseen ? (
            <p data-testid="shown-in-none-hint" className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-muted">
              {t('shownIn.noneHint', 'Listed in no workspace. Tick one to list it there. Anything that already uses it still sends it.')}
            </p>
          ) : null}
          {unseen === 0 ? null : (
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-muted">
              {t('shownIn.unseen', '{count, plural, one {Also shown in # workspace you can’t see.} other {Also shown in # workspaces you can’t see.}}', { count: unseen })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A list's "Workspace" filter, drawn in All in one menu (comp `s5-mail`):
 * every workspace, and "Other databases" when that group is there. '' is
 * every workspace.
 */
export function WorkspaceFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  useCommonWords();
  const scope = useShownInScope();
  const id = useId();
  return (
    <div className="flex items-center gap-2 leading-[normal]" data-testid="workspace-filter">
      <label htmlFor={id} className="text-[12.5px] font-bold text-fg">
        {t('shownIn.filter.label', 'Workspace')}
      </label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 text-[12.5px]">
        <option value="">{t('shownIn.all', 'All workspaces')}</option>
        {scope.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
        {scope.otherDatabases ? <option value={OTHER_DATABASES}>{t('shownIn.filter.other', 'Other databases')}</option> : null}
      </Select>
    </div>
  );
}

/** The tab's workspace, when a list is narrowed to it (One at a time): the chip the comp draws under a Library page's title. */
export function CurrentWorkspaceChip() {
  useCommonWords();
  const scope = useShownInScope();
  if (!scope.active || scope.view !== 'one' || scope.currentWorkspaceId === null) return null;
  const current = scope.workspaces.find((workspace) => workspace.id === scope.currentWorkspaceId);
  return (
    <div data-testid="current-workspace-chip" className="mb-3 flex flex-wrap gap-1.5">
      {current === undefined ? <OutlinedChip icon="none" label={t('shownIn.filter.other', 'Other databases')} testId="current-other-databases" /> : <WorkspaceChip workspace={current} />}
    </div>
  );
}

/**
 * A picker's chosen item that is not listed in the tab's workspace. It is
 * not offered there, and it still sends: the note says so and shows where it
 * is listed.
 */
export function HiddenHereNote({ shownIn }: { shownIn: ShownIn }) {
  useCommonWords();
  const scope = useShownInScope();
  const here = scope.workspaces.find((workspace) => workspace.id === scope.currentWorkspaceId);
  return (
    <div data-testid="shown-in-hidden-note" className="mt-1.5 flex flex-col gap-1.5 text-[11.5px] leading-[1.45] text-fg-muted">
      <span>
        {here === undefined
          ? t('shownIn.hidden.other', 'Not listed here. Anything that uses it still sends it.')
          : t('shownIn.hidden.here', 'Not listed in {workspace}. Anything that uses it still sends it.', { workspace: here.name })}
      </span>
      <ShownInChips shownIn={shownIn} />
    </div>
  );
}

/** One item of a workspace's delete plan (`GET /workspaces/:id/delete-plan`, `shownOnlyIn`). */
export interface ShownOnlyInItem {
  kind: 'email-template' | 'report' | 'invoice';
  itemId: string;
  name: string;
}

function kindLabel(kind: ShownOnlyInItem['kind']): string {
  switch (kind) {
    case 'email-template':
      return t('shownIn.kind.emailTemplate', 'Email template');
    case 'report':
      return t('shownIn.kind.report', 'Report layout');
    case 'invoice':
      return t('shownIn.kind.invoice', 'Invoice layout');
  }
}

/**
 * For the delete-workspace confirm: the items this workspace alone lists.
 * After the delete they are listed in no workspace (never in all of them).
 * Draws nothing when there are none.
 */
export function ShownOnlyInList({ items }: { items: readonly ShownOnlyInItem[] }) {
  useCommonWords();
  if (items.length === 0) return null;
  return (
    <div data-testid="shown-only-in" className="mt-3 leading-[normal]">
      <p className="text-[13px] text-fg">
        {t('shownIn.deletePlan.lead', '{count, plural, one {# item is listed only here. After the delete it is listed in no workspace:} other {# items are listed only here. After the delete they are listed in no workspace:}}', { count: items.length })}
      </p>
      <ul className="m-0 mt-2 flex max-h-48 list-none flex-col overflow-auto rounded-[10px] border border-border p-0">
        {items.map((item, index) => (
          <li key={`${item.kind}:${item.itemId}`} data-testid="shown-only-in-item" className={cn('flex items-center gap-3 px-3.5 py-2.5', index > 0 && 'border-t border-border')}>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg">{item.name}</span>
            <span className="shrink-0 text-[11.5px] text-fg-muted">{kindLabel(item.kind)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-[1.45] text-fg-muted">
        {t('shownIn.deletePlan.after', 'They stay, and anything that uses them still sends them. You can choose new workspaces for them later.')}
      </p>
    </div>
  );
}
