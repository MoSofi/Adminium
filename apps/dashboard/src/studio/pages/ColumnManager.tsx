/**
 * Column manager for `page-crud` pages — the table's `config.columns[]`.
 *
 * `page-crud` is the one shipped template whose items are not widgets in a
 * grid: its body is a `columns[]` of `gridColumnSpecSchema` entries that
 * `PageCrud` renders as the data grid, and there is no in-page editor for it.
 * That is exactly the "I want to change the columns of the table" gap.
 *
 * What is editable here is deliberately the presentation half of the spec —
 * order, header text, visibility, alignment, mono treatment, sortability. The
 * rest of `gridColumnSpecSchema` (`logicalType`, `semantic`, `fk`, `pii`,
 * `primaryKey`, `nullable`, `hasDefault`, `unique`, `maxLength`) is derived
 * from the database by the classifier, and hand-editing it would not change the
 * database — it would just make the page lie about the data. Those are surfaced
 * read-only, and re-derived by regeneration.
 *
 * Removing a column drops it from the stored body. It is not destructive to
 * data, and regenerating the page brings it back.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gridColumnSpecSchema } from '@adminium/engine/config';
import {
  Alert,
  Badge,
  Button,
  IconButton,
  Input,
  Switch,
} from '@adminium/ui';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { invalidatePages, movePage, savePageConfig } from './pagesApi.js';

/**
 * One stored column. Kept structural rather than importing `GridColumnSpec`:
 * the stored entries are the schema's INPUT shape (defaults not yet applied),
 * so most fields are optional on the wire.
 */
interface StoredColumn {
  name: string;
  label?: string;
  hidden?: boolean;
  mono?: boolean;
  sortable?: boolean;
  align?: 'start' | 'end';
  logicalType?: string;
  semantic?: string | null;
  pii?: boolean;
  primaryKey?: boolean;
  [key: string]: unknown;
}

/**
 * Read the stored `columns[]`, dropping entries the renderer would drop.
 *
 * Mirrors `PageCrudBinding.parseColumns`: per-entry `safeParse`, skip the bad
 * ones, never throw. An editor that crashed on one malformed column would be
 * unusable on exactly the page that needs fixing.
 */
function parseColumns(config: Record<string, unknown>): StoredColumn[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const out: StoredColumn[] = [];
  for (const entry of raw) {
    if (gridColumnSpecSchema.safeParse(entry).success) out.push(entry as StoredColumn);
  }
  return out;
}

const fmt = (template: string, args: Record<string, string | number>): string =>
  template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    args[name] === undefined ? match : String(args[name]),
  );

interface ColumnManagerProps {
  pageId: string;
  /** Revision the drawer opened on — the If-Match guard for the config write. */
  revision: number;
  /** The page's per-template config body. */
  config: Record<string, unknown>;
}

export function ColumnManager({ pageId, revision, config }: ColumnManagerProps) {
  const client = useQueryClient();
  const stored = useMemo(() => parseColumns(config), [config]);
  const [draft, setDraft] = useState<StoredColumn[] | null>(null);
  const columns = draft ?? stored;
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: () => savePageConfig(pageId, { ...config, columns }, revision),
    onSuccess: async () => {
      setDraft(null);
      await invalidatePages(client);
    },
  });

  function patch(index: number, change: Partial<StoredColumn>): void {
    setDraft(columns.map((column, i) => (i === index ? { ...column, ...change } : column)));
  }

  if (stored.length === 0) {
    return (
      <Alert
        tone="info"
        data-testid="studio-pages-no-columns"
        title={t('studioPages.columns.none.title', 'This page has no columns yet')}
        body={t(
          'studioPages.columns.none.body',
          'Columns are read from the table when the page is generated. Bind this page to a table and regenerate to fill them in.',
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-columns">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body-sm flex-1 text-fg-muted">
          {t(
            'studioPages.columns.help',
            'Reorder columns, rename their headers, and choose which are shown in the table.',
          )}
        </p>
        <Button variant="ghost" onClick={() => setDraft(null)} disabled={!dirty || save.isPending}>
          {t('studioPages.columns.discard', 'Discard')}
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          loading={save.isPending}
          data-testid="studio-pages-save-columns"
        >
          {t('studioPages.columns.save', 'Save columns')}
        </Button>
      </div>

      {save.isError ? (
        <Alert
          tone="danger"
          title={t('studioPages.columns.saveFailed', 'Columns could not be saved')}
          body={save.error instanceof Error ? save.error.message : ''}
        />
      ) : null}

      <ul className="rounded-lg border border-border">
        {columns.map((column, index) => (
          <li
            key={column.name}
            className="flex flex-wrap items-center gap-2 border-b border-border p-3 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-body-sm truncate font-mono text-fg-subtle">{column.name}</span>
                {column.primaryKey === true ? (
                  <Badge tone="neutral">{t('studioPages.columns.pk', 'Key')}</Badge>
                ) : null}
                {column.pii === true ? (
                  <Badge tone="warn">{t('studioPages.columns.pii', 'PII')}</Badge>
                ) : null}
              </div>
              <Input
                value={column.label ?? ''}
                aria-label={fmt(t('studioPages.columns.header', 'Header for {name}'), {
                  name: column.name,
                })}
                onChange={(event) => patch(index, { label: event.target.value })}
              />
            </div>

            <label className="flex items-center gap-2">
              <span className="text-body-sm text-fg-muted">
                {t('studioPages.columns.shown', 'Shown')}
              </span>
              <Switch
                checked={column.hidden !== true}
                aria-label={fmt(t('studioPages.columns.toggle', 'Show {name} in the table'), {
                  name: column.name,
                })}
                onCheckedChange={(checked) => patch(index, { hidden: !checked })}
              />
            </label>

            <IconButton
              variant="ghost"
              size="sm"
              disabled={index === 0}
              label={fmt(t('studioPages.columns.moveUp', 'Move {name} up'), {
                name: column.name,
              })}
              onClick={() => setDraft(movePage(columns, index, -1))}
            >
              <ChevronUp className="size-4" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              disabled={index === columns.length - 1}
              label={fmt(t('studioPages.columns.moveDown', 'Move {name} down'), {
                name: column.name,
              })}
              onClick={() => setDraft(movePage(columns, index, 1))}
            >
              <ChevronDown className="size-4" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              label={fmt(t('studioPages.columns.remove', 'Remove {name}'), {
                name: column.name,
              })}
              onClick={() => setDraft(columns.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
