// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, MonoText, Tag } from '@adminium/ui';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { useState } from 'react';

import { accordionListConfigSchema, accordionListDemoData } from './tables-tail-config.js';
import type { AccordionListConfig } from './tables-tail-config.js';
import { resolveLocale, stringField, tailRowsOf, tailToneOf, toggleOpen } from './tables-tail-lib.js';
import type { AccordionRow } from './tables-tail-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { accordionListConfigSchema, accordionListDemoData };
export type { AccordionListConfig, AccordionRow };

/**
 * `accordion-list` (annex §3) — expandable rows, single- or multi-open: a header
 * with a method/status chip plus a body panel carrying prose and/or a key-value
 * detail block (API & Backend's endpoint accordion, the Landing/Pricing FAQs).
 *
 * Native `<button>` headers with `aria-expanded` + `aria-controls`, so the rows
 * are keyboard- and screen-reader-operable for free; the panel is UNMOUNTED
 * rather than hidden when collapsed, so a collapsed body is never reachable by
 * Tab or found by an in-page search.
 *
 * Open state is client-only view state — expanding a row is not a mutation and
 * emits no event.
 */

export interface AccordionListProps {
  rows: readonly AccordionRow[];
  /** Single-open (annex "exclusive") vs. multi-open. */
  exclusive?: boolean | undefined;
  /** Row ids expanded on first render (annex `defaultOpen`). */
  defaultOpen?: readonly string[] | undefined;
  glyph?: 'chevron' | 'plus-minus' | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

export function AccordionList({
  rows,
  exclusive = false,
  defaultOpen,
  glyph = 'chevron',
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: AccordionListProps) {
  const t = useMaybeT();
  const known = new Set(rows.map((row) => row.id));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const initial = (defaultOpen ?? []).filter((id) => known.has(id));
    // `exclusive` mode can only ever have one row open — honour the first
    // configured id rather than silently rendering an impossible state.
    return new Set(exclusive ? initial.slice(0, 1) : initial);
  });
  // Locale normalization at the boundary: the row copy is host-supplied, but a
  // schema-valid `format.locale: ''` must not reach a locale-sensitive call.
  void resolveLocale(locale);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.tables.accordionList.emptyTitle', 'Nothing to expand')}
        body={emptyBody ?? t('ui:widgets.tables.accordionList.emptyBody', 'Entries will appear here once there are any.')}
      />
    );
  }

  return (
    <div data-widget="accordion-list" data-testid={testId} className="h-full overflow-auto p-2">
      {rows.map((row) => {
        const expanded = open.has(row.id);
        const panelId = `accordion-panel-${row.id}`;
        const Glyph = glyph === 'chevron' ? ChevronDown : expanded ? Minus : Plus;
        return (
          <div
            key={row.id}
            data-part="accordion-row"
            data-expanded={expanded ? '' : undefined}
            className="border-b border-border last:border-b-0"
          >
            <h3>
              <button
                type="button"
                data-part="accordion-header"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen((current) => toggleOpen(current, row.id, exclusive))}
                className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {row.badge !== undefined && (
                  <Tag mono tone={tailToneOf(row.badgeTone, 'info')} className="shrink-0 uppercase">
                    {row.badge}
                  </Tag>
                )}
                <MonoText className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">
                  {row.header}
                </MonoText>
                {/*
                  The chevron rotates on expand; `plus-minus` swaps the glyph
                  instead, so it must not also rotate. No mirroring either — a
                  vertical chevron is direction-neutral.
                */}
                <Glyph
                  aria-hidden="true"
                  className={`size-4 shrink-0 text-fg-subtle transition-transform duration-150 ${
                    glyph === 'chevron' && expanded ? '-rotate-180' : ''
                  }`}
                />
              </button>
            </h3>
            {expanded && (
              <div id={panelId} data-part="accordion-panel" className="space-y-2 px-2 pb-3 pt-0.5">
                {row.body !== undefined && <p className="text-body-sm leading-relaxed text-fg-muted">{row.body}</p>}
                {row.fields !== undefined && row.fields.length > 0 && (
                  <dl className="divide-y divide-border rounded-md border border-border bg-surface-2">
                    {row.fields.map((field) => (
                      <div key={field.label} className="flex items-baseline gap-3 px-2.5 py-1.5">
                        {/* `asChild` merges the mono styling INTO the <dt>, so the
                            definition list keeps its required dl > (div >) dt/dd
                            structure instead of nesting them inside a <span>. */}
                        <MonoText asChild className="w-28 shrink-0 text-caption font-semibold text-fg">
                          <dt>{field.label}</dt>
                        </MonoText>
                        {field.mono === true ? (
                          <MonoText asChild className="min-w-0 flex-1 text-caption text-fg-muted">
                            <dd>{field.value}</dd>
                          </MonoText>
                        ) : (
                          <dd className="min-w-0 flex-1 text-caption text-fg-muted">{field.value}</dd>
                        )}
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Project an untrusted `record-list` onto `AccordionRow`s (04 §3). */
export function accordionRowsOf(data: unknown): AccordionRow[] {
  return tailRowsOf(data).map((row, index): AccordionRow => {
    const rawFields = row.fields;
    const fields = Array.isArray(rawFields)
      ? rawFields
          .filter((field): field is Record<string, unknown> => typeof field === 'object' && field !== null)
          .map((field) => ({
            label: stringField(field, 'label') ?? '',
            value: stringField(field, 'value') ?? '',
            mono: field.mono === true,
          }))
          .filter((field) => field.label !== '')
      : undefined;
    return {
      id: String(row.id ?? `row-${index}`),
      header: stringField(row, 'header') ?? stringField(row, 'title') ?? `#${index + 1}`,
      badge: stringField(row, 'badge') ?? stringField(row, 'method'),
      badgeTone: stringField(row, 'badgeTone'),
      body: stringField(row, 'body') ?? stringField(row, 'description'),
      ...(fields === undefined || fields.length === 0 ? {} : { fields }),
    };
  });
}

export function AccordionListWidget({ config, data }: WidgetProps<AccordionListConfig>) {
  return (
    <AccordionList
      rows={accordionRowsOf(data)}
      exclusive={config.exclusive}
      defaultOpen={config.defaultOpen}
      glyph={config.glyph}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
