// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Workspaces" on the new connection's source step (`Workspaces.dc.html`
 * §6e): a checkbox per workspace, on a server that has any. In One at a time
 * the tab's workspace is ticked to begin with ("The workspace you are in");
 * in All in one menu none is. Ticking none puts the database in "Other
 * databases". The choice is applied once the connection is made.
 */
import { useEffect, useId } from 'react';
import { Checkbox } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { WorkspaceTile } from '../../../shell/workspaces/WorkspaceTile.js';
import { useCurrentWorkspace } from '../../../workspaces/current.js';
import type { WizardState } from '../wizardState.js';

export function WorkspacesField({ state, onPatch }: { state: WizardState; onPatch: (patch: Partial<WizardState>) => void }) {
  const { workspaces, currentWorkspaceId, view } = useCurrentWorkspace();
  const ids = useId();
  const real = workspaces.filter((group) => group.kind === 'workspace');
  const start = view === 'one' && real.some((group) => group.id === currentWorkspaceId) ? [currentWorkspaceId!] : [];
  // Asked once: the step's first draw settles what is ticked to begin with.
  useEffect(() => {
    if (state.workspaceIds === undefined && real.length > 0) onPatch({ workspaceIds: start });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the first offer seeds the choice
  }, [real.length]);
  if (real.length === 0) return null;
  const picked = new Set(state.workspaceIds ?? start);
  return (
    <div role="group" aria-labelledby={`${ids}-label`} data-testid="connect-workspaces">
      <div id={`${ids}-label`} className="mb-1.5 text-[12px] font-semibold text-fg">
        {t('studio:hub.workspaces.title', 'Workspaces')}
      </div>
      <div className="divide-y divide-border rounded-md border border-border">
        {real.map((group) => (
          <div key={group.id} className="flex items-center gap-3 px-3.5 py-[11px]">
            <Checkbox
              id={`${ids}-${group.id}`}
              checked={picked.has(group.id)}
              aria-label={group.name}
              onCheckedChange={(next) => {
                const out = new Set(picked);
                if (next === true) out.add(group.id);
                else out.delete(group.id);
                onPatch({ workspaceIds: real.filter((one) => out.has(one.id)).map((one) => one.id) });
              }}
            />
            <label htmlFor={`${ids}-${group.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <WorkspaceTile group={group} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{group.name}</span>
                {view === 'one' && group.id === currentWorkspaceId ? (
                  <span className="mt-px block text-[11.5px] text-fg-subtle">{t('studio:hub.workspaces.youAreIn', 'The workspace you are in')}</span>
                ) : null}
              </span>
            </label>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-fg-subtle">{t('studio:hub.workspaces.tickNone', 'Tick none to put it in Other databases.')}</p>
    </div>
  );
}
