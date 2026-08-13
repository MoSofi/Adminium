/**
 * Widget palette (04-widget-registry.md §6.2 "Adding widgets"): a family-grouped,
 * searchable drawer where every entry is a live demo-data preview of the widget.
 * Selecting an entry inserts that widget into the layout at first-fit. Entries
 * are ordinary buttons (keyboard-navigable); the preview inside each is
 * decorative (`aria-hidden`), the button carries the accessible name.
 */

import { useMemo, useState } from 'react';
import type { WidgetDefinition, WidgetFamily } from '@adminium/widgets';
import { Drawer, DrawerBody, DrawerHeader, SearchInput } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import {
  filterPaletteGroups,
  paletteGroups,
  paletteWidgetCount,
  type PaletteGroup,
} from './widgetCatalog.js';
import { humanize, widgetNameKey } from './text.js';
import { WidgetPreview } from './WidgetPreview.js';

export interface WidgetPaletteProps {
  open: boolean;
  onClose: () => void;
  onInsert: (definition: WidgetDefinition) => void;
  /** Registry override (tests / manifest host); defaults to the global registry. */
  registry?: ReadonlyMap<string, WidgetDefinition> | undefined;
}

export function widgetDisplayName(definition: WidgetDefinition): string {
  return t(widgetNameKey(definition.descriptionKey), humanize(definition.id));
}

/**
 * Widget family → literal bundle key (10-i18n-theming.md §2.5). The family axis
 * is closed (`WIDGET_FAMILIES`), so `satisfies` turns a new family into a
 * compile error here instead of a raw `builder.families.<new>` heading in the
 * palette.
 */
const FAMILY_LABEL_KEY = {
  kpi: 'builder.families.kpi',
  charts: 'builder.families.charts',
  tables: 'builder.families.tables',
  feeds: 'builder.families.feeds',
  calendar: 'builder.families.calendar',
  boards: 'builder.families.boards',
  geo: 'builder.families.geo',
  media: 'builder.families.media',
  communication: 'builder.families.communication',
  forms: 'builder.families.forms',
  chrome: 'builder.families.chrome',
  system: 'builder.families.system',
  domain: 'builder.families.domain',
} as const satisfies Record<WidgetFamily, string>;

export function familyLabel(family: PaletteGroup['family']): string {
  return t(FAMILY_LABEL_KEY[family], humanize(family));
}

export function WidgetPalette({ open, onClose, onInsert, registry }: WidgetPaletteProps) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => paletteGroups(registry), [registry]);
  const visible = useMemo(
    () => filterPaletteGroups(groups, query, widgetDisplayName),
    [groups, query],
  );
  const total = paletteWidgetCount(groups);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
    >
      <DrawerHeader
        title={t('builder.palette.title', 'Add a widget')}
        subtitle={t('builder.palette.count', '{count} widgets', { count: total })}
        closeLabel={t('common.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-5">
        <SearchInput
          value={query}
          aria-label={t('builder.palette.searchLabel', 'Search widgets')}
          placeholder={t('builder.palette.searchPlaceholder', 'Search widgets…')}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearLabel={t('builder.palette.clear', 'Clear search')}
        />

        {visible.length === 0 ? (
          <p className="text-body-sm text-fg-muted" role="status">
            {t('builder.palette.noResults', 'No widgets match “{query}”.', { query })}
          </p>
        ) : (
          visible.map((group) => (
            <section key={group.family} className="flex flex-col gap-2">
              <h3 className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
                {familyLabel(group.family)}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {group.widgets.map((definition) => {
                  const name = widgetDisplayName(definition);
                  return (
                    <button
                      key={definition.id}
                      type="button"
                      aria-label={t('builder.palette.add', 'Add {name}', { name })}
                      className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-2 text-start transition hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onClick={() => onInsert(definition)}
                    >
                      <WidgetPreview definition={definition} />
                      <span className="truncate px-1 text-body-sm font-medium text-fg">{name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </DrawerBody>
    </Drawer>
  );
}
