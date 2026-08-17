// SPDX-License-Identifier: AGPL-3.0-only
import { Button, EmptyState, IconButton, IconTile, Input, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowUpRight, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { linkIcon } from './media-icons.js';
import { bindingSourceOf, displayUrl, fileRowsOf, stringField } from './media-lib.js';
import { linkListConfigSchema, linkListDemoData } from './media-config.js';
import type { LinkListConfig } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { linkListConfigSchema, linkListDemoData };
export type { LinkListConfig };

/**
 * `link-list` (annex §8) — reference-link rows: an icon chip, the title, the mono
 * URL, an external-link arrow, a hover delete, and an inline add-composer. The
 * read-only "resources" variant (`editable: false`) is what Workspace Onboarding
 * and the 404 quick-links render; the auto-instantiation target for URL columns
 * (annex §8).
 *
 * SAFETY: rows carry URLs from a database column — untrusted input. Only
 * `http(s)` links become anchors (a `javascript:`/`data:` URL would otherwise be
 * a stored-XSS sink via `href`); anything else renders as inert text. External
 * links always get `rel="noreferrer noopener"` so the target can never reach back
 * through `window.opener`.
 */

export interface ReferenceLink {
  id: string;
  title: string;
  url: string;
}

export interface LinkListProps {
  links: readonly ReferenceLink[];
  editable?: boolean | undefined;
  newTab?: boolean | undefined;
  addLabel?: string | undefined;
  titlePlaceholder?: string | undefined;
  urlPlaceholder?: string | undefined;
  submitLabel?: string | undefined;
  deleteLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onAdd?: ((link: { title: string; url: string }) => void) | undefined;
  onDelete?: ((link: ReferenceLink) => void) | undefined;
  testId?: string | undefined;
}

/** Only `http(s)` URLs may become an `href` — everything else renders inert. */
export function isSafeHref(url: string): boolean {
  try {
    const protocol = new URL(url, 'https://placeholder.invalid').protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function LinkList({
  links,
  editable = false,
  newTab = true,
  addLabel,
  titlePlaceholder,
  urlPlaceholder,
  submitLabel,
  deleteLabel,
  emptyTitle,
  emptyBody,
  onAdd,
  onDelete,
  testId,
}: LinkListProps) {
  const t = useMaybeT();
  const resolvedAddLabel = addLabel ?? t('ui:widgets.media.addLink', 'Add link');
  const resolvedTitlePlaceholder = titlePlaceholder ?? t('ui:widgets.media.linkTitlePlaceholder', 'Title');
  const resolvedUrlPlaceholder = urlPlaceholder ?? t('ui:widgets.media.linkUrlPlaceholder', 'https://…');
  const resolvedSubmitLabel = submitLabel ?? t('ui:widgets.media.add', 'Add');
  const resolvedDeleteLabel = deleteLabel ?? t('ui:widgets.media.remove', 'Remove');
  const resolvedEmptyTitle = emptyTitle ?? t('ui:widgets.media.linkList.emptyTitle', 'No links yet');
  const resolvedEmptyBody = emptyBody ?? t('ui:widgets.media.linkList.emptyBody', 'Reference links will appear here.');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const submit = (): void => {
    const nextTitle = title.trim();
    const nextUrl = url.trim();
    if (nextUrl === '') return;
    onAdd?.({ title: nextTitle === '' ? nextUrl : nextTitle, url: nextUrl });
    setTitle('');
    setUrl('');
    setComposing(false);
  };

  if (links.length === 0 && !editable) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={resolvedEmptyTitle}
        body={resolvedEmptyBody}
      />
    );
  }

  return (
    <div data-widget="link-list" data-testid={testId} className="flex h-full flex-col">
      {editable && (
        <div className="border-b border-border p-2">
          {composing ? (
            <div className="flex items-center gap-2" data-part="link-composer">
              <Input
                autoFocus
                value={title}
                aria-label={resolvedTitlePlaceholder}
                placeholder={resolvedTitlePlaceholder}
                onChange={(event) => setTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                  if (event.key === 'Escape') setComposing(false);
                }}
                className="flex-1"
              />
              <Input
                value={url}
                aria-label={resolvedUrlPlaceholder}
                placeholder={resolvedUrlPlaceholder}
                onChange={(event) => setUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                  if (event.key === 'Escape') setComposing(false);
                }}
                className="flex-[1.3] font-mono"
              />
              <Button size="sm" onClick={submit} data-part="link-submit">
                {resolvedSubmitLabel}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" iconLeft={<Plus />} onClick={() => setComposing(true)} data-part="link-add">
              {resolvedAddLabel}
            </Button>
          )}
        </div>
      )}

      {links.length === 0 ? (
        <EmptyState
          compact
          preset="no-data"
          title={resolvedEmptyTitle}
          body={resolvedEmptyBody}
        />
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-auto p-2">
          {links.map((link) => {
            const safe = isSafeHref(link.url);
            const body = (
              <>
                <IconTile size="md" tone="neutral" icon={linkIcon()} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-bold text-fg">{link.title}</span>
                  <MonoText className="block truncate text-caption text-accent">{displayUrl(link.url)}</MonoText>
                </span>
              </>
            );
            return (
              <li
                key={link.id}
                data-part="link-row"
                data-unsafe={safe ? undefined : ''}
                className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-surface-2"
              >
                {safe ? (
                  <a
                    href={link.url}
                    {...(newTab ? { target: '_blank' } : {})}
                    rel="noreferrer noopener"
                    className={
                      'flex min-w-0 flex-1 items-center gap-3 rounded-md ' +
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                    }
                  >
                    {body}
                  </a>
                ) : (
                  // Non-http(s) URL from an untrusted column: show it, never link it.
                  <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
                )}
                {editable && (
                  <IconButton
                    size="sm"
                    data-part="link-delete"
                    label={resolvedDeleteLabel}
                    onClick={() => onDelete?.(link)}
                    className="opacity-0 transition-opacity duration-100 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3.5" />
                  </IconButton>
                )}
                {safe && <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle rtl:-scale-x-100" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Project an untrusted `record-list` onto `ReferenceLink`s via the field naming. */
export function referenceLinksOf(data: unknown, config: LinkListConfig): ReferenceLink[] {
  return fileRowsOf(data).map((row, index): ReferenceLink => {
    const id = stringField(row, config.idField) ?? `link-${index}`;
    const url = stringField(row, config.urlField) ?? '';
    return { id, title: stringField(row, config.titleField) ?? url, url };
  });
}

export function LinkListWidget({ config, data, onEvent }: WidgetProps<LinkListConfig>) {
  const source = bindingSourceOf(config.binding);
  return (
    <LinkList
      links={referenceLinksOf(data, config)}
      // Editing is a write: only offer it when there is a table to write to.
      editable={config.editable && source !== null}
      newTab={config.newTab}
      {...(config.addLabel === undefined ? {} : { addLabel: config.addLabel })}
      {...(config.titlePlaceholder === undefined ? {} : { titlePlaceholder: config.titlePlaceholder })}
      {...(config.urlPlaceholder === undefined ? {} : { urlPlaceholder: config.urlPlaceholder })}
      {...(config.submitLabel === undefined ? {} : { submitLabel: config.submitLabel })}
      {...(config.deleteLabel === undefined ? {} : { deleteLabel: config.deleteLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onAdd={(link) => {
        if (source === null) return;
        onEvent({
          type: 'mutate',
          intent: 'insert',
          connectionId: source.connectionId,
          table: source.table,
          values: { [config.titleField]: link.title, [config.urlField]: link.url },
        });
      }}
      onDelete={(link) => {
        if (source === null) return;
        onEvent({
          type: 'mutate',
          intent: 'delete',
          connectionId: source.connectionId,
          table: source.table,
          recordId: link.id,
        });
      }}
    />
  );
}
