// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/pages/$pageId` — edit a page, with the template's shape beside the
 * form.
 *
 * Was a drawer. The drawer had outgrown itself: identity, nav placement, data
 * source and the whole column manager in one scrolling column, with the save
 * button pinned below a screenful of content it could not see. Same split as
 * the create screen, for the same reason — the template choice is the one that
 * needs a picture — plus the page's contents editor under the form.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  isTableBoundTemplate,
  type PagePaddingConfig,
  type PageWidthConfig,
} from '@adminium/engine/config';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  InputGroup,
  Select,
  Spinner,
  Switch,
} from '@adminium/ui';
import { ExternalLink } from 'lucide-react';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { pageQuery } from '../../api/pages.js';
import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { ColumnManager, type ColumnsDraft } from './ColumnManager.js';
import { IconPicker } from './IconPicker.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { PageEditorLayout, templateTitle } from './PageEditorLayout.js';
import { PaddingField } from './PaddingField.js';
import { WidthField } from './WidthField.js';
import {
  NAV_GROUPS,
  PAGE_URL_PREFIX,
  invalidatePages,
  isNavGroup,
  slugify,
  slugifyInput,
  studioPagesQuery,
  updatePage,
  type NavGroup,
  type PageSummaryDto,
} from './pagesApi.js';

const GROUP_LABEL_KEY: Record<NavGroup, string> = {
  workspace: 'nav.group.workspace',
  library: 'nav.group.library',
  planning: 'nav.group.planning',
  people: 'nav.group.people',
  account: 'nav.group.account',
};

const GROUP_FALLBACK: Record<NavGroup, string> = {
  workspace: 'Workspace',
  library: 'Library',
  planning: 'Planning',
  people: 'People',
  account: 'Account',
};

export function EditPageScreen({ pageId }: { pageId: string }) {
  const list = useQuery(studioPagesQuery());
  const page = (list.data ?? []).find((row) => row.id === pageId);

  if (list.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );
  }
  if (page === undefined) {
    return (
      <PageSurface width="narrow">
        <Alert
          tone="warn"
          data-testid="studio-pages-missing"
          title={t('studioPages.editor.missing', 'That page no longer exists')}
          body={t(
            'studioPages.editor.missingBody',
            'It may have been deleted, or removed by a regeneration run.',
          )}
        />
      </PageSurface>
    );
  }

  // Keyed on the row so every field's initial state is re-derived if the page
  // changes underneath (a regeneration, another admin) instead of showing the
  // previous page's values in a form that would then save them.
  return <EditPageForm key={`${page.id}:${page.revision}`} page={page} />;
}

function EditPageForm({ page }: { page: PageSummaryDto }) {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [navGroup, setNavGroup] = useState<NavGroup>(
    isNavGroup(page.navGroup) ? page.navGroup : 'workspace',
  );
  const [isEnabled, setIsEnabled] = useState(page.isEnabled);
  const [template, setTemplate] = useState(page.type);
  const [connectionId, setConnectionId] = useState<string | null>(page.connectionId);
  // `undefined` = not edited; the displayed value falls back to the document's
  // stored table, which arrives later than the row does.
  const [table, setTable] = useState<string | null | undefined>(undefined);
  // Same "not edited yet" convention: padding lives in the ENVELOPE, not the
  // list row, so it is unknown until `pageQuery` resolves. `null` inside the
  // edited state means a deliberate "back to the template default".
  const [padding, setPadding] = useState<PagePaddingConfig | null | undefined>(undefined);
  const [width, setWidth] = useState<PageWidthConfig | null | undefined>(undefined);

  const document = useQuery(pageQuery(page.id));
  const connections = useQuery({
    queryKey: ['studio', 'connections'] as const,
    queryFn: studioApi.listConnections,
  });

  const bindable = isTableBoundTemplate(template);
  const schema = useQuery({
    queryKey: ['studio', 'schema', connectionId] as const,
    queryFn: () => studioApi.getSchema(connectionId as string),
    enabled: bindable && connectionId !== null,
    retry: false,
  });

  const storedTable =
    document.data?.status === 'ok' ? (document.data.page.source.table ?? null) : null;
  const effectiveTable = table === undefined ? storedTable : table;
  const storedPadding =
    document.data?.status === 'ok' ? (document.data.page.padding ?? null) : null;
  const effectivePadding = padding === undefined ? storedPadding : padding;
  // Compared by value: the custom pair is a fresh object on every keystroke, so
  // identity would mark the form dirty even after typing the stored number back.
  const paddingChanged =
    padding !== undefined && JSON.stringify(padding) !== JSON.stringify(storedPadding);
  const storedWidth =
    document.data?.status === 'ok' ? (document.data.page.width ?? null) : null;
  const effectiveWidth = width === undefined ? storedWidth : width;
  // A plain `!==` here, unlike padding above: width is a string union, so there
  // is no fresh-object-per-keystroke problem to compare around.
  const widthChanged = width !== undefined && width !== storedWidth;
  const finalSlug = slugify(slug);
  const slugChanged = finalSlug !== page.slug;

  const sourceChanged =
    template !== page.type ||
    connectionId !== page.connectionId ||
    (table !== undefined && table !== storedTable);

  // The columns draft the ColumnManager reports (null = clean). ONE "Save
  // changes" persists both halves — the old per-card "Save columns" next to
  // this button silently discarded whichever draft the other one didn't cover.
  const [columnsDraft, setColumnsDraft] = useState<ColumnsDraft | null>(null);
  // Revision already advanced by a columns save whose identity half then
  // failed — the retry must If-Match the moved revision, not the stale row's.
  const savedRevision = useRef<number | null>(null);

  const identityDirty =
    title.trim() !== page.title ||
    finalSlug !== page.slug ||
    (icon.trim() === '' ? null : icon.trim()) !== (page.icon ?? null) ||
    navGroup !== (isNavGroup(page.navGroup) ? page.navGroup : 'workspace') ||
    isEnabled !== page.isEnabled ||
    sourceChanged ||
    paddingChanged ||
    widthChanged;

  const save = useMutation({
    mutationFn: async () => {
      let expectedRevision = savedRevision.current ?? page.revision;
      if (columnsDraft !== null) {
        const updated = await columnsDraft.save(expectedRevision);
        savedRevision.current = updated.revision;
        expectedRevision = updated.revision;
      }
      if (!identityDirty && columnsDraft !== null) return;
      await updatePage(page.id, {
        title: title.trim(),
        slug: finalSlug,
        icon: icon.trim() === '' ? null : icon.trim(),
        navGroup,
        isEnabled,
        // Only when something about the body actually changed — otherwise every
        // rename would recompose and throw away hand-edited columns.
        ...(sourceChanged ? { template, connectionId, table: effectiveTable } : {}),
        // Sent only when touched: an untouched page must keep following its
        // template default rather than having today's default frozen into it.
        ...(paddingChanged ? { padding: effectivePadding } : {}),
        ...(widthChanged ? { width: effectiveWidth } : {}),
        expectedRevision,
      });
    },
    onSuccess: async () => {
      await invalidatePages(client);
      await navigate({ to: '/studio/pages' });
    },
  });

  const isCrud = template === 'page-crud';

  return (
    <PageEditorLayout
      heading={t('studioPages.editor.title', 'Edit page')}
      subheading={page.title}
      template={template}
      previewTitle={title}
      previewIcon={icon}
      previewTable={bindable ? effectiveTable : null}
      previewAction={
        <Button variant="secondary" size="sm" iconLeft={<ExternalLink className="size-4" />} asChild>
          <Link to="/p/$slug" params={{ slug: page.slug }}>
            {t('studioPages.editor.openPage', 'Open page')}
          </Link>
        </Button>
      }
      actions={
        <>
          {save.isError ? (
            <Alert
              tone="danger"
              data-testid="studio-pages-save-error"
              title={t('studioPages.editor.saveFailed', 'Changes could not be saved')}
              body={save.error instanceof Error ? save.error.message : ''}
            />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => void navigate({ to: '/studio/pages' })}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={
                title.trim().length === 0 ||
                finalSlug.length === 0 ||
                (!identityDirty && columnsDraft === null)
              }
              data-testid="studio-pages-save"
            >
              {t('studioPages.editor.save', 'Save changes')}
            </Button>
          </div>
        </>
      }
    >
      {page.origin === 'generated' ? (
        <Alert
          tone="info"
          data-testid="studio-pages-generated-note"
          title={t('studioPages.editor.generated.title', 'This page was generated from your schema')}
          body={t(
            'studioPages.editor.generated.body',
            'Your changes survive regeneration. Deleting only lasts until the next run recreates it.',
          )}
        />
      ) : null}

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('studioPages.editor.data', 'Data')}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <FormField label={t('studioPages.field.template', 'Template')}>
            <Select
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              data-testid="studio-pages-template"
            >
              {/* Same filter as NewPageScreen: page-record is a crud page's
                  child route, never a standalone template choice (30 D3). */}
              {pageTemplateDefinitions
                .filter((definition) => definition.standalone !== false)
                .map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {templateTitle(definition.id)}
                  </option>
                ))}
            </Select>
          </FormField>

          {bindable ? (
            <>
              {(connections.data ?? []).length > 1 ? (
                <FormField label={t('studioPages.field.connection', 'Data source')}>
                  <Select
                    value={connectionId ?? ''}
                    onChange={(event) => {
                      setConnectionId(event.target.value === '' ? null : event.target.value);
                      setTable(null);
                    }}
                  >
                    <option value="">{t('studioPages.field.connectionNone', 'None')}</option>
                    {(connections.data ?? []).map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              <FormField
                label={t('studioPages.field.table', 'Table')}
                {...(connectionId === null
                  ? {
                      helper: t(
                        'studioPages.field.tableNeedsConnection',
                        'Pick a data source first.',
                      ),
                    }
                  : {})}
              >
                <Select
                  value={effectiveTable ?? ''}
                  disabled={connectionId === null || schema.isPending}
                  onChange={(event) =>
                    setTable(event.target.value === '' ? null : event.target.value)
                  }
                  data-testid="studio-pages-table"
                >
                  <option value="">{t('studioPages.field.tableNone', 'Not bound')}</option>
                  {(schema.data?.model.tables ?? [])
                    .filter((candidate) => candidate.system !== true)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {`${candidate.schema}.${candidate.name}`}
                      </option>
                    ))}
                </Select>
              </FormField>

              {schema.isError ? (
                <Alert
                  tone="warn"
                  title={t('studioPages.editor.schemaFailed', 'Tables could not be listed')}
                  body={t(
                    'studioPages.editor.schemaFailedBody',
                    'This connection may not have been analysed yet. Run introspection from Studio → Data connections.',
                  )}
                />
              ) : null}
            </>
          ) : (
            <Alert
              tone="info"
              data-testid="studio-pages-not-bindable"
              title={t('studioPages.editor.notBindable', 'This template is not bound to one table')}
              body={t(
                'studioPages.editor.notBindableBody',
                'Its contents are built widget by widget instead. Open the page and use Edit to add them.',
              )}
            />
          )}

          {sourceChanged ? (
            <Alert
              tone="warn"
              data-testid="studio-pages-recompose-warning"
              title={t('studioPages.editor.recompose', 'This page will be rebuilt')}
              body={t(
                'studioPages.editor.recomposeBody',
                'Saving rebuilds the contents. Column and widget edits here are lost.',
              )}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('studioPages.editor.details', 'Details')}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <FormField label={t('studioPages.field.title', 'Title')}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </FormField>

          <FormField
            label={t('studioPages.field.slug', 'Page address')}
            {...(slugChanged
              ? {
                  error: t(
                    'studioPages.field.slugWarning',
                    'Changing the address breaks existing links and bookmarks to this page.',
                  ),
                }
              : {})}
          >
            <InputGroup
              prefix={PAGE_URL_PREFIX}
              mono
              value={slug}
              error={slugChanged}
              onChange={(event) => setSlug(slugifyInput(event.target.value))}
              data-testid="studio-pages-slug"
            />
          </FormField>

          <FormField
            label={t('studioPages.field.icon', 'Icon')}
            helper={t('studioPages.field.iconHint', 'Shown beside the page name in the sidebar.')}
          >
            <IconPicker
              value={icon}
              onChange={setIcon}
              label={t('studioPages.field.iconPick', 'Choose the page icon')}
              testId="studio-pages-icon"
            />
          </FormField>

          <FormField label={t('studioPages.field.group', 'Sidebar group')}>
            <Select
              value={navGroup}
              onChange={(event) => setNavGroup(event.target.value as NavGroup)}
              data-testid="studio-pages-group"
            >
              {NAV_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(GROUP_LABEL_KEY[group], GROUP_FALLBACK[group])}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('studioPages.field.visible', 'Show in sidebar')}
            helper={t(
              'studioPages.field.visibleHint',
              'A hidden page stays reachable at its URL for anyone who has the link.',
            )}
          >
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </FormField>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">
            {t('studioPages.editor.appearance', 'Appearance')}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <PaddingField
            value={effectivePadding}
            onChange={setPadding}
          />
          <WidthField value={effectiveWidth} onChange={setWidth} />
        </CardBody>
      </Card>

      {/*
        Columns, and only for `page-crud`. This replaced a "Page contents" card
        that existed for every template: on a widget-built page its whole
        content was a sentence saying so plus an "Open page" button, which now
        lives on the preview where it belongs. A card whose body is an apology
        for having no body is worse than no card.
      */}
      {isCrud ? (
        <Card padded={false}>
          <CardHeader>
            <h2 className="text-section text-fg">{t('studioPages.editor.columns', 'Columns')}</h2>
          </CardHeader>
          <CardBody>
            {document.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner size="sm" />
              </div>
            ) : null}

            {document.isError ? (
              <Alert
                tone="warn"
                title={t('studioPages.editor.contentUnavailable', 'Page contents could not be loaded')}
                body={t(
                  'studioPages.editor.contentUnavailableBody',
                  'The details above can still be saved.',
                )}
              />
            ) : null}

            {document.isSuccess && document.data.status !== 'ok' ? (
              <Alert
                tone="warn"
                title={t(
                  'studioPages.editor.contentInvalid',
                  'This page\u2019s configuration is not readable',
                )}
                body={t(
                  'studioPages.editor.contentInvalidBody',
                  'It was written by a newer version, or it is malformed. Regenerate the page or delete it.',
                )}
              />
            ) : null}

            {document.isSuccess && document.data.status === 'ok' ? (
              sourceChanged ? (
                // Editing columns that are about to be recomposed away would be
                // work thrown out by the save the admin already has pending.
                <p className="text-body-sm text-fg-muted">
                  {t(
                    'studioPages.editor.itemsPending',
                    'Save the change above first \u2014 the contents are rebuilt from it.',
                  )}
                </p>
              ) : (
                <ColumnManager
                  pageId={page.id}
                  config={document.data.page.config}
                  source={{
                    connectionId: document.data.page.source.connectionId,
                    table: document.data.page.source.table ?? null,
                  }}
                  onDraft={setColumnsDraft}
                />
              )
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </PageEditorLayout>
  );
}
