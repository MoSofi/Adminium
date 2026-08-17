/**
 * `/audit` — the audit log, and the missing consumer of `routes/audit`, which
 * has been registered and enforcing `system:audit:read` since M7 with no screen
 * behind it. Every mutation in the product writes a row here; until now nobody
 * could read one without a database client.
 *
 * WHAT THE DRAWER IS FOR. A list of "someone changed something" is a compliance
 * checkbox, not a tool. The row that matters is the one where you need to know
 * WHAT changed, so the drawer renders the stored `{ before, after }` images
 * field by field, marks the fields that actually differ, and says so out loud
 * when the server truncated the payload at the §3.11 16 KB cap — an unmarked
 * partial diff is a diff that lies by omission.
 *
 * The dotted `action` verb (`role.permission.change`) renders VERBATIM in mono
 * rather than through a lookup: the verb vocabulary is open (every route picks
 * its own), so a translation table would silently fall back to a raw key for
 * any action added after it was written, and `adminium/no-dynamic-i18n-key`
 * correctly forbids assembling the key at runtime. The localized half is the
 * CATEGORY, which is a closed enum.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  FormField,
  Input,
  KeyValueList,
  MonoText,
  SearchInput,
  Select,
  Spinner,
  Tag,
} from '@adminium/ui';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import { formatStamp } from '../team/teamApi.js';
import {
  AUDIT_CATEGORIES,
  EMPTY_AUDIT_FILTERS,
  auditQuery,
  diffRows,
  entityRows,
  isTruncated,
  type AuditCategory,
  type AuditEntryDto,
  type AuditFilters,
} from './auditApi.js';

function categoryLabel(category: AuditCategory): string {
  switch (category) {
    case 'auth':
      return t('audit.category.auth', 'Sign-in & accounts');
    case 'data':
      return t('audit.category.data', 'Records');
    case 'schema':
      return t('audit.category.schema', 'Schema');
    case 'settings':
      return t('audit.category.settings', 'Settings');
    case 'rbac':
      return t('audit.category.rbac', 'Roles & permissions');
    case 'connection':
      return t('audit.category.connection', 'Connections');
    case 'llm':
      return t('audit.category.llm', 'AI assist');
    case 'automation':
      return t('audit.category.automation', 'Automations');
    case 'export':
      return t('audit.category.export', 'Imports & exports');
    case 'system':
      return t('audit.category.system', 'System');
  }
}

function actorKindLabel(kind: AuditEntryDto['actorKind']): string {
  switch (kind) {
    case 'user':
      return t('audit.actor.user', 'User');
    case 'api-key':
      return t('audit.actor.apiKey', 'API key');
    case 'system':
      return t('audit.actor.system', 'System');
    case 'automation':
      return t('audit.actor.automation', 'Automation');
  }
}

export function AuditLogPage(): ReactNode {
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  // Not a suspense query: the filter bar writes the query key on every
  // keystroke, and a suspense hook would throw the whole screen — filter bar
  // included — to the route fallback each time, so the control you are typing
  // into disappears from under the cursor.
  const entries = useInfiniteQuery(auditQuery(filters));
  const [open, setOpen] = useState<AuditEntryDto | null>(null);

  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const rows = useMemo(() => entries.data?.pages.flatMap((page) => page.entries) ?? [], [entries.data]);
  const filtered =
    filters.category !== '' || filters.actorId !== '' || filters.from !== '' || filters.to !== '';

  return (
    <PageSurface className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageActions
        title={t('audit.title', 'Audit log')}
        subtitle={t('audit.subtitle', 'Every change made in this workspace, who made it, and what it changed.')}
      />

      <Card padded={false}>
        <CardHeader className="flex flex-wrap items-end gap-3">
          <Select
            wrapperClassName="w-52"
            value={filters.category}
            aria-label={t('audit.filterCategory', 'Filter by category')}
            onChange={(event) =>
              setFilters({ ...filters, category: event.target.value as AuditCategory | '' })
            }
          >
            <option value="">{t('audit.filterCategoryAny', 'Any category')}</option>
            {AUDIT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category)}
              </option>
            ))}
          </Select>

          <SearchInput
            className="min-w-52 flex-1"
            value={filters.actorId}
            placeholder={t('audit.filterActor', 'Actor id')}
            aria-label={t('audit.filterActor', 'Actor id')}
            onChange={(event) => setFilters({ ...filters, actorId: event.target.value })}
            onClear={() => setFilters({ ...filters, actorId: '' })}
            clearLabel={t('common.clear', 'Clear')}
          />

          <FormField className="w-40" label={t('audit.filterFrom', 'From')}>
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </FormField>
          <FormField className="w-40" label={t('audit.filterTo', 'To')}>
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </FormField>
        </CardHeader>
        <CardBody className="p-0">
          {entries.isPending ? (
            <div className="flex items-center justify-center gap-2 p-8 text-body-sm text-fg-muted">
              <Spinner size="sm" />
              {t('common.loading', 'Loading')}
            </div>
          ) : entries.isError ? (
            <div className="p-4">
              <Alert
                role="alert"
                tone="danger"
                data-testid="audit-list-error"
                title={t('audit.listFailed.title', 'Could not load the audit log')}
                body={entries.error.message}
                action={
                  <Button variant="secondary" size="sm" onClick={() => void entries.refetch()}>
                    {t('common.retry', 'Retry')}
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              preset={filtered ? 'no-matches' : 'no-data'}
              icon={<ScrollText />}
              title={
                filtered
                  ? t('audit.empty.filtered.title', 'Nothing matches these filters')
                  : t('audit.empty.title', 'Nothing has been logged yet')
              }
              body={
                filtered
                  ? t('audit.empty.filtered.body', 'Widen the date range or clear the category filter.')
                  : t('audit.empty.body', 'Changes to data, schema, settings and permissions land here as they happen.')
              }
              data-testid="audit-empty"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm" data-testid="audit-table">
                <thead>
                  <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('audit.column.when', 'When')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('audit.column.actor', 'Actor')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('audit.column.category', 'Category')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('audit.column.action', 'Action')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-bold">
                      {t('audit.column.details', 'Details')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 last:border-0" data-testid="audit-row">
                      <td className="px-4 py-2.5 whitespace-nowrap text-fg-muted">
                        {formatStamp(entry.createdAt, localeTag)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-fg">{entry.actorLabel}</span>
                          <span className="truncate text-caption text-fg-subtle">
                            {actorKindLabel(entry.actorKind)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag>{categoryLabel(entry.category)}</Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <MonoText className="text-caption">{entry.action}</MonoText>
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(entry)}>
                          {t('audit.action.view', 'View')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {entries.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={entries.isFetchingNextPage}
            onClick={() => void entries.fetchNextPage()}
            data-testid="audit-load-more"
          >
            {t('audit.loadMore', 'Load older entries')}
          </Button>
        </div>
      ) : null}

      <EntryDrawer entry={open} localeTag={localeTag} onClose={() => setOpen(null)} />
    </PageSurface>
  );
}

/** The before/after drawer. `entry === null` keeps it closed and unmounted. */
function EntryDrawer(props: {
  entry: AuditEntryDto | null;
  localeTag: string;
  onClose: () => void;
}): ReactNode {
  const { entry } = props;
  const diff = useMemo(() => (entry === null ? [] : diffRows(entry.changes)), [entry]);
  const resource = useMemo(() => (entry === null ? [] : entityRows(entry.entity)), [entry]);
  if (entry === null) return null;

  return (
    <Drawer
      open
      size="lg"
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DrawerHeader
        title={<MonoText>{entry.action}</MonoText>}
        subtitle={t('audit.drawer.subtitle', '{actor} · {when}', {
          actor: entry.actorLabel,
          when: formatStamp(entry.createdAt, props.localeTag) ?? '',
        })}
        closeLabel={t('common.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-5">
        <KeyValueList
          items={[
            { label: t('audit.drawer.category', 'Category'), value: categoryLabel(entry.category) },
            { label: t('audit.drawer.actorKind', 'Actor type'), value: actorKindLabel(entry.actorKind) },
            {
              label: t('audit.drawer.actorId', 'Actor id'),
              value: entry.actorId ?? t('audit.drawer.none', 'None'),
              mono: true,
            },
            {
              label: t('audit.drawer.ip', 'IP address'),
              value: entry.ip ?? t('audit.drawer.none', 'None'),
              mono: true,
            },
            {
              label: t('audit.drawer.requestId', 'Request id'),
              value: entry.requestId ?? t('audit.drawer.none', 'None'),
              mono: true,
            },
            ...(entry.connectionId === null
              ? []
              : [
                  {
                    label: t('audit.drawer.connection', 'Connection'),
                    value: entry.connectionId,
                    mono: true,
                  },
                ]),
          ]}
        />

        {entry.userAgent === null ? null : (
          <section className="flex flex-col gap-2">
            <h3 className="text-section text-fg">{t('audit.drawer.userAgent', 'User agent')}</h3>
            <MonoText className="break-all text-caption text-fg-muted">{entry.userAgent}</MonoText>
          </section>
        )}

        {resource.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h3 className="text-section text-fg">{t('audit.drawer.resource', 'Resource')}</h3>
            <KeyValueList
              items={resource.map((row) => ({ label: row.field, value: row.value, mono: true }))}
            />
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-section flex-1 text-fg">{t('audit.drawer.changes', 'Changes')}</h3>
            {isTruncated(entry.changes) ? (
              <Badge tone="warn" data-testid="audit-truncated">
                {t('audit.drawer.truncated', 'Truncated at 16 KB')}
              </Badge>
            ) : null}
          </div>
          {diff.length === 0 ? (
            <p className="text-body-sm text-fg-muted">
              {t('audit.drawer.noChanges', 'This action recorded no before/after images.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm" data-testid="audit-diff">
                <thead>
                  <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                    <th scope="col" className="py-2 pe-3 text-start font-bold">
                      {t('audit.drawer.field', 'Field')}
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start font-bold">
                      {t('audit.drawer.before', 'Before')}
                    </th>
                    <th scope="col" className="py-2 text-start font-bold">
                      {t('audit.drawer.after', 'After')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((row) => (
                    <tr key={row.field} className="border-b border-border/60 align-top last:border-0">
                      <td className="py-1.5 pe-3 text-fg-muted">{row.field}</td>
                      <td className="py-1.5 pe-3">
                        <DiffCell value={row.before} changed={row.changed} tone="before" />
                      </td>
                      <td className="py-1.5">
                        <DiffCell value={row.after} changed={row.changed} tone="after" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </DrawerBody>
    </Drawer>
  );
}

/**
 * One diff cell. `null` means the field was absent from that image (a create
 * has no `before`, a delete no `after`) — rendered as a dash, which must not
 * look like the string "null", a value that a field can genuinely hold.
 */
function DiffCell(props: { value: string | null; changed: boolean; tone: 'before' | 'after' }): ReactNode {
  if (props.value === null) {
    return (
      <span aria-hidden className="text-fg-subtle">
        —
      </span>
    );
  }
  return (
    <MonoText
      className={
        props.changed
          ? props.tone === 'before'
            ? 'break-all text-caption text-danger'
            : 'break-all text-caption text-pos'
          : 'break-all text-caption text-fg-muted'
      }
    >
      {props.value}
    </MonoText>
  );
}
