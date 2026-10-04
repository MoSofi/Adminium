// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start with an app" on Designer Home: the apps of the adminium.dev list as
 * cards, each to copy into the project and make one's own.
 *
 * Filter chips show once the list has nine apps or more; with fewer, every
 * chip would hold one card. While the list loads, six skeleton cards; when it
 * could not be loaded, one quiet card with "Try again"; when this install has
 * the online list switched off, the same card with neither.
 *
 * The cover is a tinted placeholder with the app's icon, in the accent: the
 * list gives each app a tint, but a raw colour is not a token.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, CloudOff, IdCard, LayoutGrid, RotateCw, UserRound } from 'lucide-react';
import { Skeleton } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { catalogQuery, type CatalogApp } from '../api.js';

/** Fewer apps than this and the filter chips are not shown. */
export const FILTERS_FROM = 9;

const COVER =
  'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--accent)_10%,var(--surface))_0_10px,color-mix(in_srgb,var(--accent)_6%,var(--surface))_10px_20px)]';

function AppIcon({ app }: { app: CatalogApp }): ReactNode {
  if (app.iconPaths.length > 0) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[26px]" aria-hidden="true">
        {app.iconPaths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  if (app.monogram !== null && app.monogram !== '') {
    return (
      <span aria-hidden="true" className="text-lg font-extrabold">
        {app.monogram}
      </span>
    );
  }
  return <LayoutGrid aria-hidden="true" className="size-[26px]" />;
}

export function AppCard({ app, onStart }: { app: CatalogApp; onStart: (app: CatalogApp) => void }): ReactNode {
  return (
    <article aria-label={app.name} className="group relative flex flex-col overflow-hidden rounded-[14px] border border-border bg-surface transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-within:-translate-y-0.5 focus-within:shadow-md motion-reduce:transform-none">
      <div className={`${COVER} relative flex aspect-[16/10] items-center justify-center border-b border-border`}>
        <span aria-hidden="true" className="flex size-[58px] items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-md">
          <AppIcon app={app} />
        </span>
        <button
          type="button"
          onClick={() => onStart(app)}
          aria-label={t('designer:start.startApp', 'Start with this: {name}', { name: app.name })}
          className="absolute bottom-3 end-3 inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-[13px] py-2 text-[12.5px] font-bold text-accent-fg opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100"
        >
          {t('designer:start.startThis', 'Start with this')}
          <ArrowRight aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-[18px] pb-[18px] pt-4 max-sm:px-[15px] max-sm:pb-[15px] max-sm:pt-[13px]">
        <h3 className="m-0 text-[15px] font-extrabold tracking-tight">{app.name}</h3>
        <p className="m-0 text-pretty text-[13px] leading-normal text-fg-muted">{app.tagline}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
          <span className="me-auto text-xs font-semibold text-fg-subtle">{app.category ?? ''}</span>
          {app.sides.includes('staff') ? (
            <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-surface-3 px-[9px] py-[3px] text-[10.5px] font-bold text-fg-muted">
              <IdCard aria-hidden="true" className="size-3" />
              {t('designer:start.staffSide', 'Staff side')}
            </span>
          ) : null}
          {app.sides.includes('customer') ? (
            <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-surface-3 px-[9px] py-[3px] text-[10.5px] font-bold text-fg-muted">
              <UserRound aria-hidden="true" className="size-3" />
              {t('designer:start.customerSide', 'Customer side')}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-5 max-sm:gap-3.5';

export function StartWithAnApp({ onStart = () => undefined }: { onStart?: (app: CatalogApp) => void }): ReactNode {
  const catalog = useQuery(catalogQuery());
  const [filter, setFilter] = useState<string | null>(null);
  const apps = catalog.data?.state === 'ok' ? catalog.data.apps : [];
  const categories = [...new Set(apps.map((app) => app.category).filter((category): category is string => category !== null))];
  const showFilters = apps.length >= FILTERS_FROM && categories.length > 1;
  const shown = filter === null || !showFilters ? apps : apps.filter((app) => app.category === filter);
  const failed = catalog.isError || catalog.data?.state === 'unreachable';
  const off = catalog.data?.state === 'off';

  return (
    <section aria-labelledby="designer-start" className="mt-[clamp(56px,6.5vw,96px)] w-full">
      <div className="mb-[18px] flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 id="designer-start" className="m-0 flex-[1_0_auto] text-lg font-extrabold tracking-tight">
          {t('designer:start.title', 'Start with an app')}
        </h2>
        {showFilters ? (
          <>
            <div role="group" aria-label={t('designer:start.filters', 'Filter apps')} className="flex gap-2 max-sm:order-3 max-sm:w-full max-sm:overflow-x-auto">
              {[null, ...categories].map((category) => (
                <button
                  key={category ?? '*'}
                  type="button"
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                  className="whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-bold text-fg-muted hover:text-fg aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
                >
                  {category ?? t('designer:start.all', 'All')}
                </button>
              ))}
            </div>
            <a href="/studio/apps" className="inline-flex items-center gap-1 text-[13px] font-bold text-accent hover:underline">
              {t('designer:start.browse', 'Browse all')}
              <ChevronRight aria-hidden="true" className="size-[15px] rtl:-scale-x-100" />
            </a>
          </>
        ) : null}
      </div>

      {catalog.isPending ? (
        // A status, so its name is allowed: a bare div may not carry one (seen by axe once a new install showed this list at first paint).
        <div role="status" aria-busy="true" aria-label={t('designer:start.loading', 'Loading the app list')} className={GRID}>
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <div key={key} className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-surface">
              <Skeleton className="aspect-[16/10] rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <Skeleton height={16} width="55%" />
                <Skeleton height={12} width="90%" />
                <Skeleton height={12} width="35%" />
              </div>
            </div>
          ))}
        </div>
      ) : failed || off ? (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-surface-2 px-6 py-9 text-center">
          <span aria-hidden="true" className="mb-3.5 flex size-[46px] items-center justify-center rounded-[13px] bg-surface-3 text-fg-muted">
            <CloudOff className="size-[22px]" />
          </span>
          <p className="m-0 text-[15px] font-extrabold tracking-tight">
            {off ? t('designer:start.off', 'The online app list is switched off for this install.') : t('designer:start.failed', 'The app list could not be loaded.')}
          </p>
          {off ? null : (
            <>
              <p className="m-0 mt-1.5 text-[13px] leading-normal text-fg-muted">{t('designer:start.stillDescribe', 'You can still describe an app above.')}</p>
              <button
                type="button"
                onClick={() => void catalog.refetch()}
                className="mt-[18px] inline-flex items-center gap-[7px] rounded-[10px] border border-border-strong bg-surface px-[15px] py-[9px] text-[13px] font-bold text-fg hover:bg-surface-2"
              >
                <RotateCw aria-hidden="true" className="size-[15px]" />
                {t('designer:start.retry', 'Try again')}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={GRID}>
          {shown.map((app) => (
            <AppCard key={app.key} app={app} onStart={onStart} />
          ))}
        </div>
      )}
    </section>
  );
}
