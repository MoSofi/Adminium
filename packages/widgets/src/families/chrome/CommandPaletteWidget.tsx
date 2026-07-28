/**
 * `command-palette` (annex §11) — ⌘K modal: live substring filter over an index,
 * grouped results in fixed order, keyboard navigation, ↵ executes/navigates,
 * match highlighting, footer key legend, empty state. The generator builds its
 * index from tables, recent records, metrics and actions (annex §11
 * auto-instantiation: "the app shell always mounts … `command-palette`").
 *
 * Wraps @adminium/ui's `CommandPalette` + `useCommandK`, which own the dialog
 * shell, the `aria-activedescendant` combobox semantics, the ↑↓-wrap keyboard
 * model, match filtering and the footer legend. This file adds the `record-list`
 * index binding, the fixed group ordering, and `drill-through` on select.
 *
 * SELF-MOUNTING (`placement: 'overlay'`): the widget binds ⌘K itself rather than
 * exposing an `open` prop, because `WidgetProps` has no channel for host-owned
 * open state — mounting the widget IS wiring the hotkey. It renders nothing
 * until triggered.
 */

import { CommandPalette, useCommandK } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useCallback, useMemo, useState } from 'react';

import { chromeIcon } from './chrome-icons.js';
import { COMMAND_GROUPS, DEFAULT_COMMAND_GROUP_ORDER, isSafeHref, oneOf, recordRowsOf, stringField } from './chrome-lib.js';
import type { CommandGroupKey } from './chrome-lib.js';
import { commandPaletteConfigSchema, commandPaletteDemoData } from './chrome-config.js';
import type { CommandPaletteConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { commandPaletteConfigSchema, commandPaletteDemoData };
export type { CommandPaletteConfig };

export interface CommandEntry {
  id: string;
  group: CommandGroupKey;
  label: string;
  sub?: string | undefined;
  icon?: string | undefined;
  href?: string | undefined;
  shortcut?: string | undefined;
}

/** Developer fallbacks (English); the dashboard passes translated labels via config. */
const DEFAULT_GROUP_LABELS: Record<CommandGroupKey, string> = {
  actions: 'Actions',
  navigate: 'Navigate',
  recent: 'Recent',
  pages: 'Pages',
  metrics: 'Metrics',
  people: 'People',
  records: 'Records',
};

/**
 * The localized group headings: bundle strings under an `I18nProvider`, the
 * English `DEFAULT_GROUP_LABELS` otherwise. Config `groupLabels` still win
 * key-by-key at the call site.
 */
function useCommandGroupLabels(): Record<CommandGroupKey, string> {
  const t = useMaybeT();
  return useMemo(
    () => ({
      actions: t('ui:widgets.chrome.commandPalette.groupActions', DEFAULT_GROUP_LABELS.actions),
      navigate: t('ui:widgets.chrome.commandPalette.groupNavigate', DEFAULT_GROUP_LABELS.navigate),
      recent: t('ui:widgets.chrome.commandPalette.groupRecent', DEFAULT_GROUP_LABELS.recent),
      pages: t('ui:widgets.chrome.commandPalette.groupPages', DEFAULT_GROUP_LABELS.pages),
      metrics: t('ui:widgets.chrome.commandPalette.groupMetrics', DEFAULT_GROUP_LABELS.metrics),
      people: t('ui:widgets.chrome.commandPalette.groupPeople', DEFAULT_GROUP_LABELS.people),
      records: t('ui:widgets.chrome.commandPalette.groupRecords', DEFAULT_GROUP_LABELS.records),
    }),
    [t],
  );
}

/** Project the §3 `record-list` index payload onto palette entries. */
export function commandEntriesOf(data: unknown, config: CommandPaletteConfig): CommandEntry[] {
  const rows = recordRowsOf(data);
  const out: CommandEntry[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const href = stringField(row, config.hrefField);
    out.push({
      id: stringField(row, config.idField) ?? `cmd-${index}`,
      group: oneOf(row[config.groupField], COMMAND_GROUPS, 'navigate'),
      label,
      sub: stringField(row, config.subField),
      icon: stringField(row, config.iconField),
      ...(isSafeHref(href) ? { href } : {}),
      shortcut: stringField(row, config.shortcutField),
    });
  }
  return out;
}

/**
 * Bucket entries into the manifest's fixed group order (annex §11 "grouped
 * results in fixed order"). Groups the index carries but the order does not
 * render AFTER the ordered ones — a new index group must never vanish silently.
 * Empty groups are dropped.
 */
export function groupEntries(
  entries: readonly CommandEntry[],
  order: readonly CommandGroupKey[],
  maxPerGroup: number,
): { key: CommandGroupKey; entries: CommandEntry[] }[] {
  const byGroup = new Map<CommandGroupKey, CommandEntry[]>();
  const seen: CommandGroupKey[] = [];
  for (const entry of entries) {
    if (!byGroup.has(entry.group)) {
      byGroup.set(entry.group, []);
      seen.push(entry.group);
    }
    byGroup.get(entry.group)?.push(entry);
  }

  const ordered = new Set(order);
  const keys = [...order, ...seen.filter((key) => !ordered.has(key))];
  const out: { key: CommandGroupKey; entries: CommandEntry[] }[] = [];
  for (const key of keys) {
    const bucket = byGroup.get(key);
    if (bucket !== undefined && bucket.length > 0) out.push({ key, entries: bucket.slice(0, maxPerGroup) });
  }
  return out;
}

export function CommandPaletteWidget({ config, data, onEvent }: WidgetProps<CommandPaletteConfig>) {
  const t = useMaybeT();
  const groupLabelDefaults = useCommandGroupLabels();
  const [open, setOpen] = useState(false);
  // The hook re-registers on every identity change, so the toggle is memoized
  // to keep one listener for the widget's lifetime.
  const toggle = useCallback(() => setOpen((previous) => !previous), []);
  useCommandK(toggle);

  const entries = useMemo(() => commandEntriesOf(data, config), [data, config]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  const groups = useMemo(() => {
    const order = config.groupOrder ?? DEFAULT_COMMAND_GROUP_ORDER;
    return groupEntries(entries, order, config.maxPerGroup).map((group) => ({
      id: group.key,
      label: config.groupLabels?.[group.key] ?? groupLabelDefaults[group.key],
      items: group.entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        icon: chromeIcon(entry.icon),
        ...(entry.shortcut === undefined ? {} : { hint: entry.shortcut }),
        // The subtitle (a table name, "Opened yesterday") is real search
        // surface — feeding it to the filter is why "public.orders" finds Orders.
        ...(entry.sub === undefined ? {} : { keywords: [entry.sub] }),
      })),
    }));
  }, [entries, config.groupOrder, config.groupLabels, config.maxPerGroup, groupLabelDefaults]);

  return (
    <div data-widget="command-palette" data-testid={config.testId}>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        onSelect={(item) => {
          const href = byId.get(item.id)?.href;
          if (href !== undefined) onEvent({ type: 'drill-through', href });
        }}
        labels={{
          dialog: config.title ?? t('ui:widgets.chrome.commandPalette.title', 'Command palette'),
          placeholder: config.placeholder ?? t('ui:widgets.chrome.commandPalette.placeholder', 'Search actions, pages and records…'),
          navigate: config.navigateHint ?? t('ui:widgets.chrome.commandPalette.navigate', 'Navigate'),
          open: config.selectHint ?? t('ui:widgets.chrome.commandPalette.select', 'Open'),
          close: config.closeHint ?? t('ui:widgets.chrome.commandPalette.close', 'Close'),
          empty: (query) =>
            query === ''
              ? (config.emptyBody ?? t('ui:widgets.chrome.commandPalette.emptyBody', 'Start typing to search.'))
              : (config.emptyTitle ?? t('ui:widgets.chrome.commandPalette.emptyTitle', 'No results for "{query}"', { query })),
        }}
      />
    </div>
  );
}
