// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/pages/new` — create a page, with the template's shape beside the
 * form.
 *
 * Was a modal. A modal was the wrong container once the template choice needed
 * explaining: it cannot afford a second column, so the preview had nowhere to
 * go, and the one control that most needs a picture was the one reduced to a
 * word. A route also gives the screen a URL to link, reload and come back to.
 */

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  isTableBoundTemplate,
  type PagePaddingConfig,
  type PageWidthConfig,
} from '@adminium/engine/config';
import { Alert, Button, Card, CardBody, FormField, Input, InputGroup, Select } from '@adminium/ui';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { templateFitQuery } from './fitApi.js';
import { TableRemedies, type RelatedChoice } from './TableRemedies.js';
import { IconPicker } from './IconPicker.js';
import { PageEditorLayout, templateTitle } from './PageEditorLayout.js';
import { PaddingField } from './PaddingField.js';
import { WidthField } from './WidthField.js';
import {
  NAV_GROUPS,
  PAGE_URL_PREFIX,
  createPage,
  invalidatePages,
  slugify,
  slugifyInput,
  studioPagesQuery,
  type NavGroup,
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

export function NewPageScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  // Until the admin edits the address it follows the title, which is what makes
  // "Ops overview" become `ops-overview` without a second field to fill. Once
  // touched it stops following, so a deliberate address survives a title tweak.
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState('page-crud');
  const [navGroup, setNavGroup] = useState<NavGroup>('workspace');
  const [icon, setIcon] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  // `null` = no override: the new page follows its template's gutter.
  const [padding, setPadding] = useState<PagePaddingConfig | null>(null);
  const [width, setWidth] = useState<PageWidthConfig | null>(null);
  // Remedy 2: the page is bound to a table LINKED to the one the operator
  // picked, titled through the key. Remembered with the table it came from,
  // so the choice can be explained and undone; cleared by any other table
  // choice, because the key it names belongs to this binding only.
  const [related, setRelated] = useState<RelatedChoice | null>(null);
  const chooseTable = (next: string | null): void => {
    setRelated(null);
    setTable(next);
  };

  // Existing pages, for the duplicate-address check. Already cached by the list
  // screen the admin arrived from, so this is normally free.
  const existing = useQuery(studioPagesQuery());
  const connections = useQuery({
    queryKey: ['studio', 'connections'] as const,
    queryFn: studioApi.listConnections,
  });

  const bindable = isTableBoundTemplate(template);
  const rows = connections.data ?? [];
  // One connection is the overwhelming norm, so pre-select it rather than
  // making "None" a step to undo.
  const effectiveConnectionId = connectionId ?? (rows.length === 1 ? (rows[0]?.id ?? null) : null);
  const schema = useQuery({
    queryKey: ['studio', 'schema', effectiveConnectionId] as const,
    queryFn: () => studioApi.getSchema(effectiveConnectionId as string),
    enabled: bindable && effectiveConnectionId !== null,
    retry: false,
  });

  // The same query the fit panel reads (react-query dedupes on the key), so the
  // panel's explanation and the submit button's verdict are one answer. Asking
  // separately is how a screen ends up explaining a problem beside a button
  // that would have worked.
  const fit = useQuery({
    ...templateFitQuery({
      connectionId: effectiveConnectionId ?? '',
      table: table ?? '',
      template,
    }),
    // Not asked while titled through a key: the report describes the table
    // ALONE, which is exactly what the operator stepped around — it would
    // refuse, and block Create, for a page the server will compose.
    enabled: bindable && effectiveConnectionId !== null && table !== null && related === null,
  });

  const pickable = (schema.data?.model.tables ?? []).filter(
    (candidate) => candidate.system !== true,
  );
  // "I have no table yet but I want a calendar": with nothing to pick, the
  // picker is a dead end and the new-table entry is the only way forward.
  const noTables = schema.data !== undefined && pickable.length === 0;
  const typedSlug = slugTouched ? slug : slugify(title);
  const finalSlug = slugify(typedSlug);
  const slugTaken =
    finalSlug.length > 0 && (existing.data ?? []).some((page) => page.slug === finalSlug);

  const create = useMutation({
    mutationFn: () =>
      createPage({
        slug: finalSlug,
        title: title.trim(),
        template,
        navGroup,
        ...(icon === '' ? {} : { icon }),
        ...(bindable && table !== null ? { connectionId: effectiveConnectionId, table } : {}),
        ...(bindable && related !== null ? { titleThrough: related.offer.via } : {}),
        ...(padding === null ? {} : { padding }),
        ...(width === null ? {} : { width }),
      }),
    onSuccess: async () => {
      await invalidatePages(client);
      await navigate({ to: '/studio/pages' });
    },
  });

  // A table-bound template with no table composes NOTHING: the create route
  // falls through to `buildUserPageEnvelope`, whose body is an empty layout,
  // and board/calendar/scheduler render an empty layout as a blank page. The
  // field used to say "you can bind it later" and nothing ever said how, so
  // the table is required here for the ten templates that are built from one.
  // The API still accepts an unbound page — `EmptyLayoutNotice` is the
  // backstop for the ones already stored, and for callers that are not this
  // screen.
  const needsTable = bindable && table === null;
  // Only a DEFINITE no blocks the button. A pending or failed fit check leaves
  // Create live: the create route runs the same check and refuses with the same
  // reason, so a check that cannot answer must not become a second way to be
  // stuck on a screen whose whole job is to get people unstuck.
  const fitRefuses = related === null && fit.data?.satisfied === false;
  const canSubmit =
    title.trim().length > 0 && finalSlug.length > 0 && !slugTaken && !needsTable && !fitRefuses;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  }

  return (
    <PageEditorLayout
      heading={t('studio:pages.create.title', 'New page')}
      subheading={t(
        'studio:pages.create.subtitle',
        'Pick what this page shows and how it looks.',
      )}
      template={template}
      previewTitle={title}
      previewIcon={icon}
      previewTable={bindable ? table : null}
      actions={
        <>
          {create.isError ? (
            <Alert
              tone="danger"
              data-testid="studio-pages-create-error"
              title={t('studio:pages.create.failed', 'The page could not be created')}
              body={create.error instanceof Error ? create.error.message : ''}
            />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => void navigate({ to: '/studio/pages' })}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              form="studio-page-create"
              disabled={!canSubmit}
              loading={create.isPending}
              data-testid="studio-pages-create-submit"
            >
              {t('studio:pages.create.submit', 'Create page')}
            </Button>
          </div>
        </>
      }
    >
      <Card>
        <CardBody>
          <form id="studio-page-create" className="flex flex-col gap-4" onSubmit={submit}>
            <FormField
              label={t('studio:pages.field.template', 'Template')}
              helper={t(
                'studio:pages.field.templateHint',
                'Decides what the page can hold. You can change it later.',
              )}
            >
              <Select
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value);
                  setRelated(null);
                }}
                data-testid="studio-pages-template"
              >
                {/* page-record is a crud page's child route, not a page of
                    its own — offering it here would create dead-end shells
                    (`standalone: false`). */}
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
              <FormField
                label={t('studio:pages.field.table', 'Table')}
                required
                helper={
                  rows.length === 0
                    ? t(
                        'studio:pages.field.tableNoConnection',
                        'Connect a database first — this page is built from one of its tables.',
                      )
                    : effectiveConnectionId === null
                      ? t('studio:pages.field.tableNeedsConnection', 'Pick a data source first.')
                      : t('studio:pages.field.tableCreateHint', 'The table this page reads.')
                }
              >
                <Select
                  value={table ?? ''}
                  disabled={effectiveConnectionId === null || schema.isPending}
                  onChange={(event) => {
                    setConnectionId(effectiveConnectionId);
                    chooseTable(event.target.value === '' ? null : event.target.value);
                  }}
                  data-testid="studio-pages-create-table"
                >
                  {/* Not `tableNone`'s "Not bound": on THIS screen the empty
                      value is a prompt, not a state you may leave it in. The
                      edit screen keeps the other wording, where unbinding is
                      still a thing an admin may do. */}
                  <option value="">{t('studio:pages.field.tableChoose', 'Choose a table…')}</option>
                  {pickable.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {`${candidate.schema}.${candidate.name}`}
                      </option>
                    ))}
                </Select>
              </FormField>
            ) : null}

            {bindable && effectiveConnectionId !== null ? (
              <TableRemedies
                connectionId={effectiveConnectionId}
                template={template}
                table={table}
                related={related}
                noTables={noTables}
                onChooseTable={(next) => {
                  setConnectionId(effectiveConnectionId);
                  chooseTable(next);
                }}
                onChooseRelated={(choice) => {
                  setConnectionId(effectiveConnectionId);
                  setTable(choice.offer.tableId);
                  setRelated(choice);
                }}
              />
            ) : null}

            {bindable && rows.length > 1 ? (
              <FormField label={t('studio:pages.field.connection', 'Data source')}>
                <Select
                  value={effectiveConnectionId ?? ''}
                  onChange={(event) => {
                    setConnectionId(event.target.value === '' ? null : event.target.value);
                    chooseTable(null);
                  }}
                  data-testid="studio-pages-connection"
                >
                  <option value="">{t('studio:pages.field.connectionNone', 'None')}</option>
                  {rows.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <FormField
              label={t('studio:pages.field.title', 'Title')}
              helper={t('studio:pages.field.titleHint', 'Shown in the sidebar and the page header.')}
            >
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
                data-testid="studio-pages-title"
              />
            </FormField>

            <FormField
              label={t('studio:pages.field.slug', 'Page address')}
              helper={t(
                'studio:pages.field.slugHint',
                'Lowercase letters, numbers and dashes. Just the last part — the rest of the address is added for you.',
              )}
              {...(slugTaken
                ? {
                    error: t(
                      'studio:pages.field.slugTaken',
                      'Another page already uses this address.',
                    ),
                  }
                : {})}
            >
              <InputGroup
                prefix={PAGE_URL_PREFIX}
                mono
                value={typedSlug}
                error={slugTaken}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(slugifyInput(event.target.value));
                }}
                data-testid="studio-pages-slug"
              />
            </FormField>

            <FormField
              label={t('studio:pages.field.icon', 'Icon')}
              helper={t('studio:pages.field.iconHint', 'Shown beside the page name in the sidebar.')}
            >
              <IconPicker
                value={icon}
                onChange={setIcon}
                label={t('studio:pages.field.iconPick', 'Choose the page icon')}
                testId="studio-pages-create-icon"
              />
            </FormField>

            <FormField
              label={t('studio:pages.field.group', 'Sidebar group')}
              helper={t('studio:pages.field.groupHint', 'Which section of the sidebar it appears in.')}
            >
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

            <PaddingField
              value={padding}
              onChange={setPadding}
            />
            <WidthField value={width} onChange={setWidth} />
          </form>
        </CardBody>
      </Card>
    </PageEditorLayout>
  );
}
