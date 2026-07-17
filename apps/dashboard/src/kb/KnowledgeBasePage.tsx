/**
 * `/help` — the in-app Knowledge Base (M10-T06; ports
 * `designs/Knowledge Base.dc.html`), annex §14 archetype `page-kb-docs`:
 * hero search + `card-gallery(categories)` + article list + `empty-state`.
 *
 * PORT NOTES (16-milestones §5 checklist).
 *
 * §5.1 keepers kept: the hero search over a local index, **category cards that
 * double as filter toggles** (`ia-mapping.md` §4 names this one), the
 * clear-filter affordance, the article rows with a category tag, and the
 * filtered empty state.
 *
 * §5.5 known defects / sample-domain fictions NOT copied:
 *   - **The "New article" authoring modal.** The comp is a help-centre CMS:
 *     write, categorize, publish. Adminium's docs live at docs.adminium.dev and
 *     are versioned with the code (14-docs-site.md); an in-app editor writing to
 *     a second, unversioned content store is a product we did not build. The
 *     header action links to the docs site instead.
 *   - **"142 articles · updated daily"** — a hardcoded number the comp's own
 *     8-item list contradicts. The count is derived from the index.
 *   - **View counts and read times** ("12.4k", "4 min"). There is no analytics
 *     pipeline behind them; they were plausible-looking fiction.
 *   - **The ⌘K keycap on the hero search.** In this app ⌘K opens the command
 *     palette (the Shortcuts Panel is the app-wide keybinding spec) — printing
 *     ⌘K on an input it does not focus teaches a shortcut that does something
 *     else. `/` (focus search) is the honest hint.
 */
import { ArrowUpRight, BookOpen, ExternalLink } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  EmptyState,
  IconTile,
  SearchInput,
  Tag,
  type Tone,
} from '@adminium/ui';
import { CardGallery, type GalleryCard } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import { DOCS_BASE_URL, DOCS_SEARCH_URL, docsUrl } from './docsLinks.js';
import {
  KB_ARTICLES,
  KB_CATEGORIES,
  countByCategory,
  filterArticles,
  type KbArticle,
  type KbCategoryId,
} from './articles.js';

/** Per-category tone — the comp's per-category colour, mapped onto tokens. */
const CATEGORY_TONE: Record<KbCategoryId, Tone> = {
  start: 'accent',
  connect: 'pos',
  api: 'info',
  security: 'warn',
  selfhost: 'accent',
  trouble: 'danger',
};

function categoryLabel(id: KbCategoryId): string {
  switch (id) {
    case 'start':
      return t('kb.category.start', 'Getting started');
    case 'connect':
      return t('kb.category.connect', 'Connecting data');
    case 'api':
      return t('kb.category.api', 'API & developers');
    case 'security':
      return t('kb.category.security', 'Security & access');
    case 'selfhost':
      return t('kb.category.selfhost', 'Self-hosting');
    case 'trouble':
      return t('kb.category.trouble', 'Troubleshooting');
  }
}

function resolveArticle(article: KbArticle): { title: string; excerpt: string } {
  return {
    title: t(article.titleKey, article.titleFallback),
    excerpt: t(article.excerptKey, article.excerptFallback),
  };
}

function ArticleRow({ article }: { article: KbArticle }): ReactNode {
  const { title, excerpt } = resolveArticle(article);
  return (
    <li data-testid="kb-article" data-article={article.id}>
      <a
        href={docsUrl(article.docsPath)}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex items-center gap-3.5 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        <IconTile size="md" tone={CATEGORY_TONE[article.category]} icon={<BookOpen />} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm font-semibold text-fg">{title}</span>
            <Tag tone="neutral">{categoryLabel(article.category)}</Tag>
          </span>
          <span className="truncate text-caption text-fg-muted">{excerpt}</span>
        </span>
        {/* Mirrors in RTL: rtl:-scale-x-100 flips the glyph's direction. */}
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 shrink-0 text-fg-subtle transition-colors group-hover:text-accent rtl:-scale-x-100"
        />
      </a>
    </li>
  );
}

export function KnowledgeBasePage(): ReactNode {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<KbCategoryId | null>(null);

  const counts = useMemo(() => countByCategory(KB_ARTICLES), []);

  const articles = useMemo(
    () => filterArticles(KB_ARTICLES, { category, query, resolve: resolveArticle }),
    [category, query],
  );

  const cards = useMemo<GalleryCard[]>(
    () =>
      KB_CATEGORIES.map((id) => ({
        id,
        title: categoryLabel(id),
        subtitle: t('kb.category.count', '{count, plural, one {# article} other {# articles}}', {
          count: counts.get(id) ?? 0,
        }),
        tone: CATEGORY_TONE[id],
        // The selected card announces itself — without it, a toggled filter is
        // invisible on the control that set it.
        ...(category === id
          ? { status: t('kb.category.selected', 'Filtering'), statusTone: 'accent' as const }
          : {}),
      })),
    [counts, category],
  );

  const filtered = category !== null || query.trim() !== '';

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-title text-fg">
            {t('kb.title', 'Knowledge Base')}
          </h1>
          <p className="text-body-sm text-fg-muted">
            {t('kb.subtitle', '{count, plural, one {# guide} other {# guides}} · full docs at docs.adminium.dev', {
              count: KB_ARTICLES.length,
            })}
          </p>
        </div>
        <div className="ms-auto">
          <Button asChild variant="outline" size="md">
            <a href={DOCS_BASE_URL} target="_blank" rel="noreferrer noopener">
              {t('kb.openDocs', 'Open the docs')}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      {/* Hero search */}
      <Card className="flex flex-col items-center gap-4 bg-gradient-to-b from-accent-soft to-surface py-8 text-center">
        <div className="flex flex-col gap-1.5">
          <p className="text-display text-fg">
            {t('kb.hero.title', 'How can we help?')}
          </p>
          <p className="text-body-sm text-fg-muted">
            {t('kb.hero.subtitle', 'Search guides, API docs and troubleshooting.')}
          </p>
        </div>
        <SearchInput
          className="w-full max-w-[520px]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearLabel={t('kb.hero.clear', 'Clear search')}
          placeholder={t('kb.hero.placeholder', 'Search the knowledge base…')}
          aria-label={t('kb.hero.label', 'Search the knowledge base')}
          data-testid="kb-search"
        />
      </Card>

      {/* Categories — the cards ARE the filter (§4 keeper) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-section text-fg">{t('kb.browse', 'Browse by topic')}</h2>
        {/*
          `thumbnail="monogram"`, not `"icon"`: card-gallery's icon mode paints
          the SAME glyph on every card (it is a record gallery — files, docs —
          where one glyph is the point), so six topics would arrive as six
          identical tiles reading as unfinished. Monogram gives each topic a
          distinct, deterministic initials tile — the design system's own
          convention. Per-category glyphs (the comp's rocket/shield/wrench) need
          an optional per-card `icon` on `card-gallery`; filed as a follow-up
          rather than hand-rolled here.
        */}
        <CardGallery
          testId="kb-categories"
          cards={cards}
          columns={3}
          thumbnail="monogram"
          onOpen={(card) => setCategory((current) => (current === card.id ? null : (card.id as KbCategoryId)))}
        />
      </section>

      <Card padded={false}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <h2 className="text-section flex-1 text-fg">
            {category === null ? t('kb.list.all', 'All guides') : categoryLabel(category)}
          </h2>
          {filtered ? (
            <Button
              variant="soft"
              size="sm"
              onClick={() => {
                setCategory(null);
                setQuery('');
              }}
              data-testid="kb-clear-filter"
            >
              {t('kb.list.clear', 'Clear filter')}
            </Button>
          ) : null}
        </div>

        {articles.length === 0 ? (
          <EmptyState
            compact
            preset="no-matches"
            title={t('kb.empty.title', 'No guides match your search')}
            body={t(
              'kb.empty.body',
              'Try a different word, or search the full documentation at docs.adminium.dev.',
            )}
            actions={
              // The docs HOME, not a search deep-link: Starlight's search is a
              // pagefind modal, so no search route exists to link into and a
              // link there 404s — the last thing to hand someone whose search
              // has already come up empty. See `DOCS_SEARCH_URL`.
              <Button asChild variant="outline" size="sm">
                <a href={DOCS_SEARCH_URL} target="_blank" rel="noreferrer noopener">
                  {t('kb.empty.openDocs', 'Open the docs')}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </Button>
            }
            data-testid="kb-empty"
          />
        ) : (
          <ul data-testid="kb-articles">
            {articles.map((article) => (
              <ArticleRow key={article.id} article={article} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
