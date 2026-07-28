/**
 * `shortcuts-panel` (annex §11) — keyboard shortcuts cheat sheet: categorized
 * groups of label + keycap combos, modifier and sequential "then" chords.
 * Evidence: Shortcuts Panel, Metrics Dashboard.
 *
 * `static` by contract (annex §11: "static groups of {label, keys[],
 * isSequence}") — the HOST owns the live shortcut manager and passes the
 * registered set in as config, so the panel can never drift from a hardcoded
 * list of its own.
 *
 * The `MOD` key token is resolved to the platform glyph at render (`⌘` on macOS,
 * `Ctrl` elsewhere) from `config.modKey`, which the host sets — the widget does
 * not sniff the platform (annex §11 "Keycaps localize per platform").
 */

import { Kbd } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo } from 'react';

import { DEFAULT_SHORTCUT_GROUPS, shortcutsPanelConfigSchema, shortcutsPanelDemoData } from './chrome-config.js';
import type { ShortcutsPanelConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { shortcutsPanelConfigSchema, shortcutsPanelDemoData, DEFAULT_SHORTCUT_GROUPS };
export type { ShortcutsPanelConfig };

/** The token a shortcut definition uses for "the platform's primary modifier". */
export const MOD_TOKEN = 'MOD';

/** Resolve `MOD` to the platform glyph; every other key renders verbatim. */
export function displayKey(key: string, modKey: string): string {
  return key === MOD_TOKEN ? modKey : key;
}

export interface ShortcutEntry {
  label: string;
  keys: readonly string[];
  isSequence?: boolean | undefined;
}

export interface ShortcutGroup {
  group: string;
  entries: readonly ShortcutEntry[];
}

/**
 * The localized built-in cheat sheet: bundle strings under an `I18nProvider`,
 * the English `DEFAULT_SHORTCUT_GROUPS` copy otherwise (chord keys and
 * structure always come from the const — only the visible labels localize).
 * Host-supplied config `groups` bypass this entirely.
 */
export function useDefaultShortcutGroups(): ShortcutGroup[] {
  const t = useMaybeT();
  return useMemo(() => {
    const groupLabels: Record<string, string> = {
      General: t('ui:widgets.chrome.shortcutsPanel.generalGroupLabel', 'General'),
      Navigation: t('ui:widgets.chrome.shortcutsPanel.navigationGroupLabel', 'Navigation'),
      Records: t('ui:widgets.chrome.shortcutsPanel.recordsGroupLabel', 'Records'),
    };
    const entryLabels: Record<string, string> = {
      'Open command palette': t('ui:widgets.chrome.shortcutsPanel.openCommandPaletteLabel', 'Open command palette'),
      'Search': t('ui:widgets.chrome.shortcutsPanel.searchLabel', 'Search'),
      'Show shortcuts': t('ui:widgets.chrome.shortcutsPanel.showShortcutsLabel', 'Show shortcuts'),
      'Go to dashboard': t('ui:widgets.chrome.shortcutsPanel.goToDashboardLabel', 'Go to dashboard'),
      'Go to orders': t('ui:widgets.chrome.shortcutsPanel.goToOrdersLabel', 'Go to orders'),
      'New record': t('ui:widgets.chrome.shortcutsPanel.newRecordLabel', 'New record'),
      'Save': t('ui:widgets.chrome.shortcutsPanel.saveLabel', 'Save'),
      'Undo': t('ui:widgets.chrome.shortcutsPanel.undoLabel', 'Undo'),
    };
    return DEFAULT_SHORTCUT_GROUPS.map((group) => ({
      group: groupLabels[group.group] ?? group.group,
      entries: group.entries.map((entry) => ({ ...entry, label: entryLabels[entry.label] ?? entry.label })),
    }));
  }, [t]);
}

export interface ShortcutsPanelViewProps {
  groups: readonly ShortcutGroup[];
  modKey?: string | undefined;
  footerHint?: string | undefined;
  emptyTitle?: string | undefined;
  testId?: string | undefined;
}

export function ShortcutsPanelView({
  groups,
  modKey = '⌘',
  footerHint,
  emptyTitle,
  testId,
}: ShortcutsPanelViewProps) {
  const t = useMaybeT();
  if (groups.length === 0) {
    return (
      <p className="px-4 pb-4 text-body-sm text-fg-muted">
        {emptyTitle ?? t('ui:widgets.chrome.shortcutsPanel.emptyTitle', 'No shortcuts registered.')}
      </p>
    );
  }

  return (
    <div data-widget="shortcuts-panel" data-testid={testId} className="h-full overflow-y-auto px-4 pb-4">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.group} data-part="shortcut-group">
            <h3 className="mb-2 text-caption font-bold uppercase tracking-wide text-fg-subtle">{group.group}</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {group.entries.map((entry) => (
                <li key={entry.label} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body-sm text-fg-muted">{entry.label}</span>
                  <span data-part="keycaps" className="flex shrink-0 items-center gap-1">
                    {entry.keys.map((key, index) => (
                      // Keys can legitimately repeat within a chord (e.g. "G then G"),
                      // so the index is part of the identity here.
                      <span key={`${key}-${index}`} className="flex items-center gap-1">
                        {index > 0 && entry.isSequence === true && (
                          <span className="text-caption text-fg-subtle">
                            {t('ui:widgets.chrome.shortcutsPanel.then', 'then')}
                          </span>
                        )}
                        <Kbd>{displayKey(key, modKey)}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {footerHint !== undefined && <p className="mt-4 text-caption text-fg-subtle">{footerHint}</p>}
    </div>
  );
}

export function ShortcutsPanelWidget({ config }: WidgetProps<ShortcutsPanelConfig>) {
  const defaultGroups = useDefaultShortcutGroups();
  return (
    <ShortcutsPanelView
      groups={config.groups ?? defaultGroups}
      modKey={config.modKey}
      footerHint={config.footerHint}
      emptyTitle={config.emptyTitle}
      testId={config.testId}
    />
  );
}
