// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pieces every card of an app's page is drawn with (`Installed Apps.dc.html`
 * and the own-app page comp): the card frame, its title row, a database's tag
 * and its workspace chips.
 */
import type { ReactNode } from 'react';
import { MonoText, cn, pascalCaseIconName, useLucideIcon } from '@adminium/ui';
import { Package } from 'lucide-react';

import type { BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';

/**
 * An app's glyph: the icon its manifest names (a self-made app's, a lucide
 * name), else the package glyph every app had. An unknown name, or one still
 * loading, draws the package too.
 */
export function AppIcon({ icon, className }: { icon?: string | undefined; className?: string }) {
  const glyph = useLucideIcon(icon === undefined || icon === '' ? '' : pascalCaseIconName(icon));
  const Glyph = icon === undefined || icon === '' || glyph == null ? Package : glyph;
  return <Glyph aria-hidden className={className} />;
}

export const CARD = 'rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm';

export function CardTitle({ icon, children, tone = 'accent', id }: { icon: ReactNode; children: ReactNode; tone?: 'accent' | 'danger' | 'subtle'; id?: string }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'subtle' ? 'text-fg-subtle' : 'text-accent';
  return (
    <h3 className="mb-[13px] flex items-center gap-[9px]" id={id}>
      <span aria-hidden className={`${color} [&_svg]:size-4`}>
        {icon}
      </span>
      <span className={`text-sm font-extrabold leading-[normal] tracking-[-0.01em] ${tone === 'danger' ? 'text-danger' : ''}`}>
        {children}
      </span>
    </h3>
  );
}

/** A workspace as a chip can draw it. */
export interface ChipWorkspace {
  id: string;
  name: string;
  initials: string;
  connectionIds: string[];
}

/**
 * The server's workspaces this person sees, read off the bootstrap reply.
 * Empty while the server has none: then no chip is drawn anywhere.
 */
export function workspacesOf(bootstrap: Pick<BootstrapData, 'workspaces'> | null | undefined): ChipWorkspace[] {
  return bootstrap?.workspaces?.workspaces ?? [];
}

/** The workspaces that hold a database, in their order. */
export function workspacesHolding(workspaces: readonly ChipWorkspace[], connectionId: string | null | undefined): ChipWorkspace[] {
  if (typeof connectionId !== 'string') return [];
  return workspaces.filter((workspace) => workspace.connectionIds.includes(connectionId));
}

/**
 * A workspace chip: its initials tile and its name. One style for every
 * workspace: the initials tell them apart.
 */
export function WorkspaceChip({ workspace, className }: { workspace: Pick<ChipWorkspace, 'name' | 'initials'>; className?: string }) {
  return (
    <span
      data-part="workspace-chip"
      className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface-3 pe-2 ps-[3px] text-[12px] font-bold leading-[normal] text-fg', className)}
    >
      <span aria-hidden="true" className="flex size-[18px] shrink-0 items-center justify-center rounded-sm bg-accent-soft-solid text-[9.5px] font-extrabold leading-[normal] text-accent">
        {workspace.initials}
      </span>
      {workspace.name}
    </span>
  );
}

/** Every workspace that holds the database, as chips; nothing for a database in none. */
export function WorkspaceChips({ workspaces, connectionId }: { workspaces: readonly ChipWorkspace[]; connectionId: string | null | undefined }) {
  const holders = workspacesHolding(workspaces, connectionId);
  if (holders.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-part="workspace-chips">
      {holders.map((workspace) => (
        <WorkspaceChip key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}

/** "on fernhill": which database an install is on, mono. */
export function OnDatabase({ name }: { name: string }) {
  return (
    <MonoText data-part="on-database" className="whitespace-nowrap rounded-[6px] bg-surface-3 px-[7px] py-0.5 text-[11.5px] font-semibold leading-[normal] text-fg-muted">
      {t('studio:apps.copies.on', 'on {database}', { database: name })}
    </MonoText>
  );
}
