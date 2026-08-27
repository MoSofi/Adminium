// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/changelog` — product updates & releases (M10-T06; ports
 * `Changelog.dc.html`).
 *
 * PORT NOTES (16-milestones §5 checklist).
 *
 * §5.1 keepers kept: the version-gutter timeline, the New/Improved/Fixed/
 * Security tag taxonomy with its tone mapping, the filter chip row, and —
 * the load-bearing one — **empty-release hiding**: filtering to `Security`
 * shows only the releases that actually carried a security change, never an
 * empty card implying one.
 *
 * §5.2 dates: the comp hardcodes "Jul 10". We store ISO-8601 in the feed and
 * render it through the @adminium/i18n `Intl` layer, so the one `2026-07-16` in
 * the data reaches an en-US reader as "Jul 16, 2026", a de-DE reader as
 * "16.07.2026", and an ar-EG reader in Arabic-Indic digits.
 *
 * §5.5 known defects NOT copied: the comp's `Subscribe` (RSS) button goes
 * nowhere and there is no feed to subscribe to; a button that lies about a
 * capability is worse than no button. The docs-site link takes its place.
 *
 * WHY NOT `timeline-vertical`. The registered widget has a `changelog` variant
 * and it is the natural home for this page — but its current implementation
 * renders `tags` as bare pills and has no slot for the per-change TEXT, while
 * the annex promises "version gutter + tag-pill entry CARDS". The tagged change
 * line is exactly what the filter operates on here, so this page composes the
 * spine from @adminium/ui Tier-1 primitives (16-milestones §5.4 explicitly
 * sanctions "existing Tier 1–3 components AND registered widgets"). Teaching
 * `timeline-vertical` a `changes: {tag, text}[]` field would let this page
 * collapse into it — filed as a follow-up for the widgets owner.
 */
import { Rss } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Card, ChoiceChips, EmptyState, Tag, type Tone } from '@adminium/ui';
import { getFormatters, tagForLocale, type LocaleId } from '@adminium/i18n';
import { useSuspenseQuery } from '@tanstack/react-query';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { RELEASES_URL } from '../kb/docsLinks.js';
import {
  RELEASES,
  availableTags,
  filterReleases,
  type ChangeTag,
  type FilteredRelease,
} from './releases.js';

/** The comp's `tagMeta` tone mapping, preserved (`Changelog.dc.html`). */
const TAG_TONE: Record<ChangeTag, Tone> = {
  New: 'pos',
  Improved: 'accent',
  Fixed: 'warn',
  Security: 'danger',
};

/** Tag labels are UI chrome (they name a category), so they localize. */
function tagLabel(tag: ChangeTag): string {
  switch (tag) {
    case 'New':
      return t('changelog.tag.new', 'New');
    case 'Improved':
      return t('changelog.tag.improved', 'Improved');
    case 'Fixed':
      return t('changelog.tag.fixed', 'Fixed');
    case 'Security':
      return t('changelog.tag.security', 'Security');
  }
}

function ReleaseNode({
  release,
  isLast,
  dateLabel,
}: {
  release: FilteredRelease;
  isLast: boolean;
  dateLabel: string;
}): ReactNode {
  return (
    <li className="flex gap-4" data-testid="changelog-release" data-version={release.version}>
      {/* Version gutter. `text-end` (not text-right) so it mirrors in RTL. */}
      <div className="hidden w-24 shrink-0 flex-col items-end pt-0.5 text-end sm:flex">
        <Badge tone="accent" className="font-mono">
          {release.version}
        </Badge>
        <span className="mt-1 text-caption text-fg-subtle">{dateLabel}</span>
      </div>

      {/* Spine: node dot + connector. Decorative — the list gives the semantics. */}
      <div aria-hidden="true" className="flex shrink-0 flex-col items-center pt-1">
        <span className="size-3 shrink-0 rounded-full bg-accent ring-4 ring-surface" />
        {isLast ? null : <span className="my-1 w-px flex-1 bg-border" />}
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? 'pb-2' : 'pb-8'}`}>
        {/* The gutter is hidden on narrow screens — restate version + date inline. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2 sm:hidden">
          <Badge tone="accent" className="font-mono">
            {release.version}
          </Badge>
          <span className="text-caption text-fg-subtle">{dateLabel}</span>
        </div>

        <h2 className="text-modal text-fg">{release.title}</h2>
        <p className="mt-1 text-body-sm leading-relaxed text-fg-muted">{release.summary}</p>

        <Card padded={false} className="mt-3.5 overflow-hidden">
          <ul>
            {release.changes.map((change, index) => (
              <li
                key={`${release.version}-${index}`}
                data-testid="changelog-change"
                data-tag={change.tag}
                className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="pt-px">
                  <Tag tone={TAG_TONE[change.tag]}>{tagLabel(change.tag)}</Tag>
                </span>
                <span className="flex-1 text-body-sm leading-relaxed text-fg">{change.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </li>
  );
}

export function ChangelogPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const [filter, setFilter] = useState<ChangeTag | null>(null);

  const fmt = useMemo(
    () => getFormatters(tagForLocale(bootstrap.prefs.locale as LocaleId)),
    [bootstrap.prefs.locale],
  );

  const tags = useMemo(() => availableTags(RELEASES), []);
  const releases = useMemo(() => filterReleases(RELEASES, filter), [filter]);

  const options = useMemo(
    () => [
      { value: '__all__', label: t('changelog.filter.all', 'All') },
      ...tags.map((tag) => ({ value: tag, label: tagLabel(tag) })),
    ],
    [tags],
  );

  return (
    <PageSurface width="page" className="flex flex-col gap-6">
      <PageActions
        title={t('changelog.title', 'Changelog')}
        subtitle={t('changelog.subtitle', 'Product updates & releases.')}
      >
        {/* GitHub Releases, not a docs route: the docs site has no
            `/releases` page, so the old link 404'd — the same defect as the
            comp's non-functional RSS button this replaced, which is a poor
            joke to repeat. This URL is the one the update-available notice
            already sends people to (`telemetry/update-check.ts`
            RELEASES_PAGE_URL), so "all releases" means the same place in both
            surfaces. */}
        <Button asChild variant="outline" size="md">
          <a href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
            <Rss className="size-4" aria-hidden="true" />
            {t('changelog.allReleases', 'All releases')}
          </a>
        </Button>
      </PageActions>

      <ChoiceChips
        options={options}
        value={filter ?? '__all__'}
        onValueChange={(value) => setFilter(value === '__all__' || value === null ? null : (value as ChangeTag))}
        aria-label={t('changelog.filter.label', 'Filter changes by type')}
        data-testid="changelog-filters"
      />

      {releases.length === 0 ? (
        <EmptyState
          preset="no-matches"
          title={t('changelog.empty.title', 'Nothing under this filter')}
          body={t('changelog.empty.body', 'No release has carried a change of this kind yet.')}
          actions={
            <Button variant="outline" onClick={() => setFilter(null)}>
              {t('changelog.empty.clear', 'Show all changes')}
            </Button>
          }
          data-testid="changelog-empty"
        />
      ) : (
        <ol className="flex flex-col" data-testid="changelog-timeline">
          {releases.map((release, index) => (
            <ReleaseNode
              key={release.version}
              release={release}
              isLast={index === releases.length - 1}
              dateLabel={fmt.date(`${release.date}T00:00:00Z`, 'medium')}
            />
          ))}
        </ol>
      )}
    </PageSurface>
  );
}
