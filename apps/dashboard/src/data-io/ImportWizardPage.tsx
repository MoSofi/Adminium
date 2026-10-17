// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's Import page: the import wizard (`ImportWizard.tsx`, which
 * knows nothing of the dashboard) with what the dashboard gives it — its own
 * client for the server's import doors, the job's live channel, its words,
 * and the choice of table.
 *
 * Target selection rides the nav tree — the owner's own pages and each
 * installed app's, under the app's name: picking a table page lazily fetches
 * its envelope (`pageQuery`) and reads `source.connectionId`/`source.table` +
 * `config.columns[]` — no admin-only schema endpoint involved, so the wizard
 * works for anyone holding the per-table import grant. Who holds that grant is
 * not told to the browser (neither the session's reply nor a page's says it),
 * so every table page the person sees is offered and the server's refusal is
 * said in words, by the page's name.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Select } from '@adminium/ui';

import { appSectionsOf, bootstrapQuery, flattenNav, type BootstrapData, type NavItem } from '../app/bootstrap.js';
import { createRealtimeClient } from '../app/ws.js';
import { pageQuery } from '../api/pages.js';
import { t } from '../i18n/t.js';
import { dataIoApi } from './api.js';
import { ImportWizard, type ImportClient, type ImportTarget } from './ImportWizard.js';

export { statsConsistent, type ImportTarget } from './ImportWizard.js';

export interface ImportWizardPageProps {
  /** Pre-resolved target (the `page-wizard` binding passes the envelope's). */
  initialTarget?: ImportTarget | undefined;
  /** The target column lines are matched on, chosen already (the kit's `matchOn`); the person may still change it. */
  matchOn?: string | undefined;
}

/**
 * The wizard's client here: the dashboard's own, and a running job heard of
 * on the realtime channel `jobs:<id>`. What is heard only hurries the asking,
 * so a browser with no socket falls back to the wizard's own asking.
 */
const CLIENT: ImportClient = {
  ...dataIoApi,
  watchJob: (jobId, changed) => {
    const live = createRealtimeClient({ channels: [`jobs:${jobId}`], onEvent: changed });
    live.start();
    return () => {
      live.stop();
    };
  },
};

function targetColumnsOf(config: Record<string, unknown>): { key: string; label?: string }[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label?: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = (entry as Record<string, unknown>)['name'];
    const label = (entry as Record<string, unknown>)['label'];
    if (typeof name === 'string' && name.length > 0) {
      out.push(typeof label === 'string' ? { key: name, label } : { key: name });
    }
  }
  return out;
}

/** A page over a table: a page of an add-on's own code, or one bound to no table, is nothing to import into. */
const isTablePage = (item: NavItem): boolean => item.addOnPage === undefined && item.sourceTable !== null && item.sourceTable !== '';

/** The table pages a person may pick: their own first, then each installed app's under its name. */
export function importTargetGroups(bootstrap: BootstrapData | undefined): { key: string; label: string | null; items: NavItem[] }[] {
  if (bootstrap === undefined) return [];
  const seen = new Set<string>();
  const fresh = (items: NavItem[]): NavItem[] =>
    items.filter((item) => {
      if (!isTablePage(item) || seen.has(item.pageId)) return false;
      seen.add(item.pageId);
      return true;
    });
  const groups = [{ key: '', label: null as string | null, items: fresh(flattenNav(bootstrap.nav)) }];
  for (const section of appSectionsOf(bootstrap)) {
    groups.push({ key: `${section.kind ?? 'app'}:${section.appKey}`, label: section.label, items: fresh(section.groups.flatMap((group) => group.items)) });
  }
  return groups.filter((group) => group.items.length > 0);
}

export function ImportWizardPage({ initialTarget, matchOn }: ImportWizardPageProps) {
  const queryClient = useQueryClient();
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });

  const [target, setTarget] = useState<ImportTarget | null>(initialTarget ?? null);
  // The page the target was picked by: what the picker shows, and what a refusal names.
  const [targetPageId, setTargetPageId] = useState('');
  const [targetError, setTargetError] = useState<{ title: string; body?: string } | null>(null);

  const targetGroups = useMemo(() => importTargetGroups(boot.data), [boot.data]);
  const navItems = useMemo(() => targetGroups.flatMap((group) => group.items), [targetGroups]);
  // A target that came resolved (the `page-wizard` binding's) is shown by the page of its table, when there is one.
  const chosenPage =
    navItems.find((item) => item.pageId === targetPageId) ??
    (target === null || targetPageId !== ''
      ? undefined
      : navItems.find((item) => item.sourceTable === target.table && (item.connectionId ?? target.connectionId) === target.connectionId));
  const targetName = chosenPage === undefined ? (target?.table ?? '') : t(chosenPage.labelKey, chosenPage.fallback);

  // --- target picker (upload step) --------------------------------------------

  const pickTarget = useCallback(
    async (item: NavItem) => {
      setTargetError(null);
      // The page picked, then the other pages of its table: a board or a calendar over a table is not its list, and
      // the list (the page that says which columns the table has) is what the person meant by it.
      const candidates = [
        item,
        ...navItems.filter(
          (other) => other.pageId !== item.pageId && typeof item.sourceTable === 'string' && other.sourceTable === item.sourceTable && (other.connectionId ?? null) === (item.connectionId ?? null),
        ),
      ];
      try {
        for (const candidate of candidates) {
          const doc = await queryClient.ensureQueryData(pageQuery(candidate.pageId));
          if (doc.status !== 'ok' || doc.page.template !== 'page-crud') continue;
          const { table, connectionId } = doc.page.source;
          if (typeof table !== 'string' || table === '' || typeof connectionId !== 'string') continue;
          setTarget({ connectionId, table, columns: targetColumnsOf(doc.page.config) });
          setTargetPageId(candidate.pageId);
          return;
        }
      } catch (error) {
        setTarget(null);
        setTargetPageId('');
        setTargetError({ title: t('dataio:import.targetFailed', 'That page could not be opened.'), ...(error instanceof Error && error.message !== '' ? { body: error.message } : {}) });
        return;
      }
      setTarget(null);
      setTargetPageId('');
      setTargetError({ title: t('dataio:import.notATable', 'That page is not a table — pick a table page to import into.') });
    },
    [queryClient, navItems],
  );

  return (
    <ImportWizard
      client={CLIENT}
      t={t}
      target={target}
      targetName={targetName}
      {...(matchOn === undefined ? {} : { matchOn })}
      targetPicker={
        <>
          <label className="flex max-w-md flex-col gap-1.5">
            <span className="text-body-sm font-medium text-fg">
              {t('dataio:import.targetLabel', 'Target table')}
            </span>
            <Select
              value={chosenPage?.pageId ?? ''}
              data-testid="import-target"
              onChange={(event) => {
                const item = navItems.find((nav) => nav.pageId === event.currentTarget.value);
                if (item !== undefined) void pickTarget(item);
              }}
            >
              {/* A target that is no page of the list (the binding's own table) is named by its table: there is no page to name it by. */}
              <option value="">
                {target === null || chosenPage !== undefined ? t('dataio:import.targetPlaceholder', 'Choose a table page…') : target.table}
              </option>
              {targetGroups.map((group) => {
                const options = group.items.map((item) => (
                  <option key={item.pageId} value={item.pageId}>
                    {t(item.labelKey, item.fallback)}
                  </option>
                ));
                // The owner's own pages stand first, under no heading; an app's under its name.
                return group.label === null ? options : <optgroup key={group.key} label={group.label}>{options}</optgroup>;
              })}
            </Select>
          </label>
          {targetError !== null ? <Alert tone="warn" title={targetError.title} {...(targetError.body === undefined ? {} : { body: targetError.body })} /> : null}
        </>
      }
    />
  );
}
