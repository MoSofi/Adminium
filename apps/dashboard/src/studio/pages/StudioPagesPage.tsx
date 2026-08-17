// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Pages (09 §8.1 addition; server surface = 08-server-api.md §2.6).
 *
 * The one place an admin can change WHICH pages the Generated App has, rather
 * than what is on one of them. Before this, pages could only be created by the
 * Engine's generation run, the connect wizard, or the LLM assistant — a title
 * typo meant regenerating, and the sidebar order was whatever the generator
 * emitted.
 *
 * Two tabs, because they are two different jobs:
 *
 * - **Pages** — the inventory. Create, rename, retitle, re-slug, enable/disable,
 *   duplicate, delete; open the item editor for one page's contents.
 * - **Sidebar** — the rail. Move pages within and between the five fixed nav
 *   groups. Kept separate because reordering is a whole-rail operation with one
 *   bulk save, and mixing it into a per-row list makes both worse.
 *
 * Reordering is driven by keyboard-reachable buttons over a pure index algebra
 * (`movePage`), not a pointer drag. That is the house pattern — see
 * `DocumentCanvas`'s block controls and the note in `families/domain/block-lib`
 * — and it is also forced: `@dnd-kit/sortable` is deliberately not a dependency
 * and `packages/widgets/src/qa/chunk-budget.test.ts` fails the build if it
 * appears. A pointer layer can drive the same `onReorder` callback later.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Spinner,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@adminium/ui';
import { ChevronDown, ChevronUp, MoreHorizontal, Plus } from 'lucide-react';

import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '../../app/api.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { t } from '../../i18n/t.js';
import { DuplicatePageModal } from './DuplicatePageModal.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { lucideByName } from '../../lib/lucide.js';
import {
  deletePage,
  groupPages,
  invalidatePages,
  movePage,
  saveNavOrder,
  studioPagesQuery,
  toNavOrderPayload,
  updatePage,
  type NavGroup,
  type PageSummaryDto,
} from './pagesApi.js';

/**
 * Nav-group labels, keyed exhaustively. `satisfies` means adding a sixth group
 * to `NAV_GROUPS` is a compile error here rather than a silently unlabelled
 * section — the same guard `SidebarNav` uses.
 */
const GROUP_LABEL_KEY = {
  workspace: 'nav.group.workspace',
  library: 'nav.group.library',
  planning: 'nav.group.planning',
  people: 'nav.group.people',
  account: 'nav.group.account',
} as const satisfies Record<NavGroup, string>;

const GROUP_FALLBACK = {
  workspace: 'Workspace',
  library: 'Library',
  planning: 'Planning',
  people: 'People',
  account: 'Account',
} as const satisfies Record<NavGroup, string>;

function groupLabel(key: NavGroup): string {
  return t(GROUP_LABEL_KEY[key], GROUP_FALLBACK[key]);
}

/** Origin → tone + label. See `PageOrigin` in pagesApi for why it matters. */
function originBadge(origin: string): { tone: 'neutral' | 'accent' | 'info'; label: string } {
  switch (origin) {
    case 'generated':
      return { tone: 'accent', label: t('studioPages.origin.generated', 'Generated') };
    case 'manifest':
      return { tone: 'info', label: t('studioPages.origin.manifest', 'Add-on') };
    case 'llm':
      return { tone: 'info', label: t('studioPages.origin.llm', 'Assistant') };
    case 'system':
      return { tone: 'neutral', label: t('studioPages.origin.system', 'System') };
    default:
      return { tone: 'neutral', label: t('studioPages.origin.user', 'Custom') };
  }
}

/** The repo's non-inflecting `{arg}` substitution (works pre-i18n-init too). */
function fmt(template: string, args: Record<string, string | number>): string {
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    args[name] === undefined ? match : String(args[name]),
  );
}

interface PageRowProps {
  page: PageSummaryDto;
  onEdit: (page: PageSummaryDto) => void;
  onDuplicate: (page: PageSummaryDto) => void;
  onDelete: (page: PageSummaryDto) => void;
  onToggle: (page: PageSummaryDto) => void;
  busy: boolean;
}

function PageRow({ page, onEdit, onDuplicate, onDelete, onToggle, busy }: PageRowProps) {
  const badge = originBadge(page.origin);
  const Icon = lucideByName(page.icon ?? 'file');
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      {/* A real link, not a button with a navigate handler: the editor has a
          URL now, so the row should be middle-clickable and copyable like any
          other navigation. */}
      <Link
        to="/studio/pages/$pageId"
        params={{ pageId: page.id }}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start"
      >
        <span className="text-body truncate text-fg">{page.title}</span>
        <span className="text-body-sm truncate font-mono text-fg-subtle">{`/p/${page.slug}`}</span>
      </Link>
      <Badge tone={badge.tone}>{badge.label}</Badge>
      <span className="text-body-sm hidden text-fg-subtle sm:inline">{page.type}</span>
      <StatusPill status={page.isEnabled ? 'active' : 'disabled'}>
        {page.isEnabled
          ? t('studioPages.status.live', 'Live')
          : t('studioPages.status.hidden', 'Hidden')}
      </StatusPill>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="ghost"
            label={fmt(t('studioPages.row.menu', 'Actions for {title}'), {
              title: page.title,
            })}
            disabled={busy}
          >
            <MoreHorizontal className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {/* A plain item, not `asChild` + `Link`: nesting a router Link inside
              a Radix menu item stopped the menu content rendering at all. The
              ROW above is the real link — middle-clickable, copyable — so this
              only needs to navigate. */}
          <DropdownMenuItem onSelect={() => onEdit(page)}>
            {t('studioPages.action.edit', 'Edit page')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicate(page)}>
            {t('studioPages.action.duplicate', 'Duplicate')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggle(page)}>
            {page.isEnabled
              ? t('studioPages.action.hide', 'Hide from sidebar')
              : t('studioPages.action.show', 'Show in sidebar')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDelete(page)}>
            {t('studioPages.action.delete', 'Delete page')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The sidebar organizer.
 *
 * Holds a local draft of the whole rail so a run of moves is one save rather
 * than one request per click — a drag across five positions would otherwise be
 * five bulk writes, each of which renumbers every sibling and invalidates the
 * bootstrap.
 */
function SidebarOrganizer({ pages }: { pages: readonly PageSummaryDto[] }) {
  const client = useQueryClient();
  const server = useMemo(() => groupPages(pages), [pages]);
  const [draft, setDraft] = useState<{ key: NavGroup; pages: PageSummaryDto[] }[] | null>(null);
  const groups = draft ?? server.groups;
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: () => saveNavOrder(toNavOrderPayload(groups)),
    onSuccess: async () => {
      setDraft(null);
      await invalidatePages(client);
    },
  });

  function reorder(groupKey: NavGroup, index: number, delta: number): void {
    setDraft(
      groups.map((group) =>
        group.key === groupKey ? { ...group, pages: movePage(group.pages, index, delta) } : group,
      ),
    );
  }

  /** Move a page to the end of another group — the cross-group affordance. */
  function refile(page: PageSummaryDto, target: NavGroup): void {
    setDraft(
      groups.map((group) => {
        if (group.key === target) return { ...group, pages: [...group.pages, page] };
        return { ...group, pages: group.pages.filter((row) => row.id !== page.id) };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body-sm flex-1 text-fg-muted">
          {t(
            'studioPages.sidebar.help',
            'Reorder pages within a group, or move one to another group. Changes apply to every user.',
          )}
        </p>
        <Button variant="ghost" onClick={() => setDraft(null)} disabled={!dirty || save.isPending}>
          {t('studioPages.sidebar.discard', 'Discard')}
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          loading={save.isPending}
          data-testid="studio-pages-save-order"
        >
          {t('studioPages.sidebar.save', 'Save order')}
        </Button>
      </div>

      {save.isError ? (
        <Alert
          tone="danger"
          title={t('studioPages.sidebar.saveFailed', 'The new order could not be saved')}
          body={save.error instanceof Error ? save.error.message : ''}
        />
      ) : null}

      {server.ungrouped.length > 0 ? (
        <Alert
          tone="warn"
          data-testid="studio-pages-ungrouped"
          title={t('studioPages.sidebar.ungrouped.title', 'Some pages are in no sidebar group')}
          body={t(
            'studioPages.sidebar.ungrouped.body',
            'These pages work at their URL but appear nowhere in the sidebar. Open each one and pick a group.',
          )}
        />
      ) : null}

      {groups.map((group) => (
        <Card key={group.key} padded={false}>
          <CardHeader>
            <h3 className="text-section text-fg">{groupLabel(group.key)}</h3>
          </CardHeader>
          <CardBody className="p-0">
            {group.pages.length === 0 ? (
              <p className="text-body-sm px-4 py-3 text-fg-subtle">
                {t('studioPages.sidebar.emptyGroup', 'No pages in this group.')}
              </p>
            ) : (
              <ul>
                {group.pages.map((page, index) => (
                  <li
                    key={page.id}
                    className="flex items-center gap-2 border-b border-border px-4 py-2 last:border-b-0"
                  >
                    <span className="text-body min-w-0 flex-1 truncate text-fg">{page.title}</span>
                    {!page.isEnabled ? (
                      <Badge tone="neutral">{t('studioPages.status.hidden', 'Hidden')}</Badge>
                    ) : null}
                    <IconButton
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      label={fmt(t('studioPages.sidebar.moveUp', 'Move {title} up'), {
                        title: page.title,
                      })}
                      onClick={() => reorder(group.key, index, -1)}
                    >
                      <ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      disabled={index === group.pages.length - 1}
                      label={fmt(t('studioPages.sidebar.moveDown', 'Move {title} down'), {
                        title: page.title,
                      })}
                      onClick={() => reorder(group.key, index, 1)}
                    >
                      <ChevronDown className="size-4" />
                    </IconButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={fmt(t('studioPages.sidebar.moveTo', 'Move {title} to a group'), {
                            title: page.title,
                          })}
                        >
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {groups
                          .filter((candidate) => candidate.key !== group.key)
                          .map((candidate) => (
                            <DropdownMenuItem
                              key={candidate.key}
                              onSelect={() => refile(page, candidate.key)}
                            >
                              {groupLabel(candidate.key)}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function StudioPagesPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const pages = useQuery(studioPagesQuery());
  const [duplicating, setDuplicating] = useState<PageSummaryDto | null>(null);
  const [deleting, setDeleting] = useState<PageSummaryDto | null>(null);

  const toggle = useMutation({
    mutationFn: (page: PageSummaryDto) =>
      updatePage(page.id, { isEnabled: !page.isEnabled, expectedRevision: page.revision }),
    onSuccess: () => invalidatePages(client),
  });

  const remove = useMutation({
    mutationFn: (page: PageSummaryDto) => deletePage(page.id),
    onSuccess: async () => {
      setDeleting(null);
      await invalidatePages(client);
    },
  });

  const rows = pages.data ?? [];

  return (
    <PageSurface className="mx-auto flex max-w-[1000px] flex-col gap-5">
      {/*
        Heading, subtitle and primary action all go to the TOPBAR — the shell
        renders an <h1> for every route regardless, so a second one here said
        "Pages" twice while the shell's copy said "Home". No `backTo`: this is
        a top-level Studio screen, not a sub-screen of one.
      */}
      <PageActions
        title={t('studioPages.title', 'Pages')}
        subtitle={t(
          'studioPages.subtitle',
          'Add, edit and organise the pages of your app, and the order they appear in the sidebar.',
        )}
      >
        <Button iconLeft={<Plus className="size-4" />} asChild data-testid="studio-pages-create">
          <Link to="/studio/pages/new">{t('studioPages.createButton', 'New page')}</Link>
        </Button>
      </PageActions>

      {pages.isError ? (
        <Alert
          tone="danger"
          data-testid="studio-pages-error"
          title={t('studioPages.loadFailed.title', 'Pages could not be loaded')}
          // A 403 is the expected failure — `pages.manage` is a new key that no
          // built-in role holds — so it gets the actionable message. Anything
          // else (a 404 from an older server, a 500) must NOT be reported as a
          // permission problem: that sends the admin to edit a role matrix that
          // was never the cause.
          body={
            pages.error instanceof ApiError && pages.error.status === 403
              ? t(
                  'studioPages.loadFailed.body',
                  'Managing pages needs the “Manage pages” permission. Ask an administrator to grant it to one of your roles.',
                )
              : pages.error instanceof Error
                ? pages.error.message
                : ''
          }
        />
      ) : null}

      {pages.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner size="md" />
        </div>
      ) : null}

      {pages.isSuccess ? (
        <Tabs defaultValue="inventory">
          <TabsList>
            <TabsTrigger value="inventory">
              {t('studioPages.tab.pages', 'All pages')}
            </TabsTrigger>
            <TabsTrigger value="sidebar">
              {t('studioPages.tab.sidebar', 'Sidebar order')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inventory">
            <Card padded={false}>
              <CardHeader className="flex items-center gap-3">
                <h2 className="text-section flex-1 text-fg">
                  {t('studioPages.list.title', 'Pages')}
                </h2>
                <span className="text-body-sm text-fg-subtle" data-testid="studio-pages-count">
                  {t(
                    'studioPages.list.count',
                    '{count, plural, one {# page} other {# pages}}',
                    { count: rows.length },
                  )}
                </span>
              </CardHeader>
              <CardBody className="p-0">
                {rows.length === 0 ? (
                  <EmptyState
                    compact
                    preset="no-data"
                    data-testid="studio-pages-empty"
                    title={t('studioPages.empty.title', 'No pages yet')}
                    body={t(
                      'studioPages.empty.body',
                      'Connect a database to generate pages automatically, or create one by hand.',
                    )}
                  />
                ) : (
                  <ul>
                    {rows.map((page) => (
                      <PageRow
                        key={page.id}
                        page={page}
                        onEdit={(target) =>
                          void navigate({
                            to: '/studio/pages/$pageId',
                            params: { pageId: target.id },
                          })
                        }
                        onDuplicate={setDuplicating}
                        onDelete={setDeleting}
                        onToggle={(target) => toggle.mutate(target)}
                        busy={toggle.isPending}
                      />
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="sidebar">
            <SidebarOrganizer pages={rows} />
          </TabsContent>
        </Tabs>
      ) : null}

      {duplicating !== null ? (
        <DuplicatePageModal
          page={duplicating}
          onClose={() => setDuplicating(null)}
          onDuplicated={async () => {
            setDuplicating(null);
            await invalidatePages(client);
          }}
        />
      ) : null}

      {deleting !== null ? (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title={t('studioPages.delete.title', 'Delete this page?')}
          // A generated page comes back on the next run; a custom one does not,
          // and deleting either destroys every saved view and personal layout
          // on it. Saying so is the difference between a confirm and a trap.
          body={
            deleting.origin === 'generated'
              ? t(
                  'studioPages.delete.bodyGenerated',
                  'This page was created by schema generation, so it will come back the next time you regenerate. Saved views and personal layouts on it are deleted for everyone.',
                )
              : t(
                  'studioPages.delete.body',
                  'This cannot be undone. Saved views and personal layouts on this page are deleted for everyone.',
                )
          }
          confirmWord={deleting.slug}
          promptLabel={fmt(
            t('studioPages.delete.prompt', 'Type {slug} to confirm'),
            { slug: deleting.slug },
          )}
          confirmLabel={t('studioPages.delete.confirm', 'Delete page')}
          cancelLabel={t('common.cancel', 'Cancel')}
          closeLabel={t('common.close', 'Close')}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          data-testid="studio-pages-delete-confirm"
        />
      ) : null}
    </PageSurface>
  );
}
