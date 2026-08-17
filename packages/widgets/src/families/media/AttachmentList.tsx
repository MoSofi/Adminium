// SPDX-License-Identifier: AGPL-3.0-only
import { EmptyState, IconButton, IconTile, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Download, Trash2 } from 'lucide-react';

import { fileIconFor } from './media-icons.js';
import {
  FILE_KIND_TONE,
  bindingSourceOf,
  fileRowsOf,
  formatSize,
  kindOf,
  numberField,
  resolveLocale,
  stringField,
} from './media-lib.js';
import { attachmentListConfigSchema, attachmentListDemoData } from './media-config.js';
import type { AttachmentListConfig } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { attachmentListConfigSchema, attachmentListDemoData };
export type { AttachmentListConfig };

/**
 * `attachment-list` (annex §8) — file rows: a type-colour-coded icon chip, the
 * filename, a mono size, and hover download/delete actions. The detail-page /
 * rail counterpart of `file-browser` (Chat shared files, Vision Board files,
 * Report Builder attachments block), and the auto-instantiation target for a
 * `bytea`/storage-URL column or one named `file|attachment|…` (annex §8).
 *
 * Delete emits a `mutate` intent; download emits `drill-through` on the row's
 * URL. The widget never writes and never fetches (08 §2.11 — no files routes
 * yet); the host owns both.
 */

export interface Attachment {
  id: string;
  name: string;
  size?: number | undefined;
  type?: string | undefined;
  mime?: string | undefined;
  url?: string | undefined;
}

export interface AttachmentListProps {
  items: readonly Attachment[];
  actions?: readonly ('download' | 'delete')[] | undefined;
  typeIconMap?: Record<string, string> | undefined;
  limit?: number | undefined;
  locale?: string | undefined;
  downloadLabel?: string | undefined;
  deleteLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onDownload?: ((item: Attachment) => void) | undefined;
  onDelete?: ((item: Attachment) => void) | undefined;
  testId?: string | undefined;
}

export function AttachmentList({
  items,
  actions = ['download'],
  typeIconMap,
  limit = 8,
  locale,
  downloadLabel,
  deleteLabel,
  emptyTitle,
  emptyBody,
  onDownload,
  onDelete,
  testId,
}: AttachmentListProps) {
  const t = useMaybeT();
  const resolvedDownloadLabel = downloadLabel ?? t('ui:widgets.media.download', 'Download');
  const resolvedDeleteLabel = deleteLabel ?? t('ui:widgets.media.delete', 'Delete');
  const tag = resolveLocale(locale);
  const slice = items.slice(0, limit);

  if (slice.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.media.attachmentList.emptyTitle', 'No attachments')}
        body={emptyBody ?? t('ui:widgets.media.attachmentList.emptyBody', 'Files attached to this record will appear here.')}
      />
    );
  }

  return (
    <ul data-widget="attachment-list" data-testid={testId} className="h-full space-y-0.5 overflow-auto p-2">
      {slice.map((item) => {
        const kind = kindOf(item.type, item.mime, item.name);
        const size = formatSize(item.size, tag);
        return (
          <li
            key={item.id}
            data-part="attachment-row"
            data-kind={kind}
            className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-surface-2"
          >
            <IconTile size="md" tone={FILE_KIND_TONE[kind]} icon={fileIconFor(item.type, item.mime, item.name, typeIconMap)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-bold text-fg">{item.name}</p>
              {size !== undefined && <MonoText className="text-caption text-fg-subtle">{size}</MonoText>}
            </div>
            {/*
              Actions are revealed on hover/focus but must never be
              keyboard-unreachable: `opacity-0` still leaves them focusable, and
              `focus-within` brings them back into view when tabbed to.
            */}
            {actions.includes('download') && (
              <IconButton
                size="sm"
                data-part="attachment-download"
                label={resolvedDownloadLabel}
                onClick={() => onDownload?.(item)}
                className="opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Download className="size-3.5" />
              </IconButton>
            )}
            {actions.includes('delete') && (
              <IconButton
                size="sm"
                data-part="attachment-delete"
                label={resolvedDeleteLabel}
                onClick={() => onDelete?.(item)}
                className="opacity-0 transition-opacity duration-100 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Project an untrusted `record-list` onto `Attachment`s via the field naming. */
export function attachmentsOf(data: unknown, config: AttachmentListConfig): Attachment[] {
  return fileRowsOf(data).map((row, index): Attachment => {
    const id = stringField(row, config.idField) ?? `attachment-${index}`;
    return {
      id,
      name: stringField(row, config.nameField) ?? id,
      size: numberField(row, config.sizeField),
      type: stringField(row, config.typeField),
      mime: stringField(row, config.mimeField),
      url: stringField(row, config.urlField),
    };
  });
}

export function AttachmentListWidget({ config, data, onEvent }: WidgetProps<AttachmentListConfig>) {
  const source = bindingSourceOf(config.binding);
  return (
    <AttachmentList
      items={attachmentsOf(data, config)}
      actions={config.actions}
      limit={config.limit}
      {...(config.typeIconMap === undefined ? {} : { typeIconMap: config.typeIconMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.downloadLabel === undefined ? {} : { downloadLabel: config.downloadLabel })}
      {...(config.deleteLabel === undefined ? {} : { deleteLabel: config.deleteLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onDownload={(item) => {
        const href = item.url ?? config.href;
        if (href !== undefined) onEvent({ type: 'drill-through', href });
      }}
      onDelete={(item) => {
        if (source === null) return; // unbound: nothing to delete from
        onEvent({
          type: 'mutate',
          intent: 'delete',
          connectionId: source.connectionId,
          table: source.table,
          recordId: item.id,
        });
      }}
    />
  );
}
