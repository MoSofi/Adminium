// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The secondary "Save as app" beside "Install an app" (`Save As App.dc.html`
 * board 1a).
 *
 * With one database it opens the quick save on it; with several it first
 * asks "Save which database?", every database once with its workspace chips,
 * the current workspace's first while the server shows one at a time.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@adminium/ui';
import { FileArchive } from 'lucide-react';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { connectionsQuery } from '../hub/connectionsQuery.js';
import { engineName } from './SaveAppWizard.js';
import { useCurrentWorkspace } from '../../workspaces/current.js';
import { saveDatabases } from './saveAppDatabases.js';

export function SaveAsAppButton({ onSave, size = 'sm' }: { onSave: (connectionId: string) => void; size?: 'sm' | 'md' }) {
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const { currentWorkspaceId } = useCurrentWorkspace();
  const databases = saveDatabases(connections, bootstrap, currentWorkspaceId);
  const label = t('studio:saveApp.entry.button', 'Save as app');

  if (databases.length <= 1) {
    const only = databases[0];
    return (
      <Button size={size} variant="secondary" disabled={only === undefined} onClick={() => only !== undefined && onSave(only.connection.id)}>
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="secondary">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>{t('studio:saveApp.entry.which', 'Save which database?')}</DropdownMenuLabel>
        {databases.map(({ connection, workspaces, other }) => (
          <DropdownMenuItem key={connection.id} icon={<FileArchive className="size-4" />} onSelect={() => onSave(connection.id)} className="items-start">
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[13px] font-semibold">{connection.name}</span>
              <span className="text-xs text-fg-muted">
                {engineName(connection.engine)} ·{' '}
                {t('studio:saveApp.entry.tables', '{count, plural, one {# table} other {# tables}}', { count: connection.tableCount ?? 0 })}
              </span>
              {workspaces.length > 0 || other ? (
                <span className="flex flex-wrap gap-1 pt-0.5">
                  {workspaces.map((name) => (
                    <Badge key={name}>{name}</Badge>
                  ))}
                  {other ? <Badge>{t('studio:saveApp.database.other', 'Other databases')}</Badge> : null}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
