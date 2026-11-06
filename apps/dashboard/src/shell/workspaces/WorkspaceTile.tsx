// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's tile and chip.
 *
 * ONE STYLE FOR EVERY WORKSPACE: the accent tint and the workspace's
 * initials. The comps tinted a second workspace blue; a workspace has no
 * colour of its own to choose, and a third one would have had none, so the
 * initials are what tell them apart. "Other databases" is no workspace and
 * says so: a neutral tile with a database glyph.
 *
 * Sizes are the comp's: 32 (menu rows, the Workspaces card), 28 (the card,
 * dialog rows), 22 (a block's header), 18 (inside a chip), 38 (the New
 * workspace preview).
 */
import { Database } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { WorkspaceGroup } from './model.js';

const SIZES = {
  38: { box: 'size-[38px] rounded-md text-[12px]', glyph: 'size-[18px]' },
  32: { box: 'size-8 rounded-md text-[11px]', glyph: 'size-4' },
  28: { box: 'size-7 rounded-md text-[11px]', glyph: 'size-[15px]' },
  22: { box: 'size-[22px] rounded-sm text-[9.5px]', glyph: 'size-3' },
  18: { box: 'size-[18px] rounded-sm text-[9.5px]', glyph: 'size-[11px]' },
} as const;

export function WorkspaceTile({
  group,
  size,
  className,
}: {
  group: Pick<WorkspaceGroup, 'kind' | 'initials'>;
  size: keyof typeof SIZES;
  className?: string;
}) {
  const box = SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-part="workspace-tile"
      className={cn(
        'flex shrink-0 items-center justify-center font-extrabold leading-[normal]',
        box.box,
        group.kind === 'other' ? 'bg-surface-3 text-fg-muted' : 'bg-accent-soft-solid text-accent',
        className,
      )}
    >
      {group.kind === 'other' ? <Database className={box.glyph} /> : group.initials}
    </span>
  );
}

/** A group's name as the reader reads it: "Other databases" is the reader's words, a workspace's name is as typed. */
export function groupName(group: Pick<WorkspaceGroup, 'kind' | 'name'>): string {
  return group.kind === 'other' ? t('workspaces.other', 'Other databases') : group.name;
}

/** A workspace chip: its tile and name, on the neutral chip tint. */
export function WorkspaceChip({ group, className }: { group: Pick<WorkspaceGroup, 'kind' | 'initials' | 'name'>; className?: string }) {
  return (
    <span
      data-part="workspace-chip"
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface-3 pe-2 ps-[3px] text-[12px] font-bold leading-[normal] text-fg',
        className,
      )}
    >
      <WorkspaceTile group={group} size={18} />
      {groupName(group)}
    </span>
  );
}
