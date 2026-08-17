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
import { isTableBoundTemplate, type PagePaddingConfig } from '@adminium/engine/config';
import { Alert, Button, Card, CardBody, FormField, Input, InputGroup, Select } from '@adminium/ui';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { IconPicker } from './IconPicker.js';
import { PageEditorLayout, templateTitle } from './PageEditorLayout.js';
import { PaddingField } from './PaddingField.js';
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
        ...(padding === null ? {} : { padding }),
      }),
    onSuccess: async () => {
      await invalidatePages(client);
      await navigate({ to: '/studio/pages' });
    },
  });

  const canSubmit = title.trim().length > 0 && finalSlug.length > 0 && !slugTaken;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  }

  return (
    <PageEditorLayout
      heading={t('studioPages.create.title', 'New page')}
      subheading={t(
        'studioPages.create.subtitle',
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
              title={t('studioPages.create.failed', 'The page could not be created')}
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
              {t('studioPages.create.submit', 'Create page')}
            </Button>
          </div>
        </>
      }
    >
      <Card>
        <CardBody>
          <form id="studio-page-create" className="flex flex-col gap-4" onSubmit={submit}>
            <FormField
              label={t('studioPages.field.template', 'Template')}
              helper={t(
                'studioPages.field.templateHint',
                'Decides what the page can hold. You can change it later.',
              )}
            >
              <Select
                value={template}
                onChange={(event) => setTemplate(event.target.value)}
                data-testid="studio-pages-template"
              >
                {pageTemplateDefinitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {templateTitle(definition.id)}
                  </option>
                ))}
              </Select>
            </FormField>

            {bindable ? (
              <FormField
                label={t('studioPages.field.table', 'Table')}
                helper={t(
                  'studioPages.field.tableCreateHint',
                  'The table this page reads. You can bind it later.',
                )}
              >
                <Select
                  value={table ?? ''}
                  disabled={effectiveConnectionId === null || schema.isPending}
                  onChange={(event) => {
                    setConnectionId(effectiveConnectionId);
                    setTable(event.target.value === '' ? null : event.target.value);
                  }}
                  data-testid="studio-pages-create-table"
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
            ) : null}

            {bindable && rows.length > 1 ? (
              <FormField label={t('studioPages.field.connection', 'Data source')}>
                <Select
                  value={effectiveConnectionId ?? ''}
                  onChange={(event) => {
                    setConnectionId(event.target.value === '' ? null : event.target.value);
                    setTable(null);
                  }}
                >
                  <option value="">{t('studioPages.field.connectionNone', 'None')}</option>
                  {rows.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <FormField
              label={t('studioPages.field.title', 'Title')}
              helper={t('studioPages.field.titleHint', 'Shown in the sidebar and the page header.')}
            >
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
                data-testid="studio-pages-title"
              />
            </FormField>

            <FormField
              label={t('studioPages.field.slug', 'Page address')}
              helper={t(
                'studioPages.field.slugHint',
                'Lowercase letters, numbers and dashes. Just the last part — the rest of the address is added for you.',
              )}
              {...(slugTaken
                ? {
                    error: t(
                      'studioPages.field.slugTaken',
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
              label={t('studioPages.field.icon', 'Icon')}
              helper={t('studioPages.field.iconHint', 'Shown beside the page name in the sidebar.')}
            >
              <IconPicker
                value={icon}
                onChange={setIcon}
                label={t('studioPages.field.iconPick', 'Choose the page icon')}
                testId="studio-pages-create-icon"
              />
            </FormField>

            <FormField
              label={t('studioPages.field.group', 'Sidebar group')}
              helper={t('studioPages.field.groupHint', 'Which section of the sidebar it appears in.')}
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
          </form>
        </CardBody>
      </Card>
    </PageEditorLayout>
  );
}
