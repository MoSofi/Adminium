// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app shelf, ported from `Marketplace.dc.html`'s browse screen
 * (47-app-installation.md step 4b).
 *
 * The comp's toolbar (search), category chips with counts, and card grid, over
 * `GET /api/v1/apps/catalog` — which is a DISK read of the bundled set plus
 * anything uploaded, never a fetch. That property is load-bearing: it is what
 * makes this page work identically on an air-gapped install, and what stops a
 * page load becoming an outbound call nobody asked for (40 §4.3).
 *
 * ─── What the comp draws that nothing here can feed ─────────────────────────
 *
 * The card is thinner than the comp's, and every missing row is a field no
 * manifest carries rather than a decision:
 *
 *  **D7 — no rating, no review count.** Nothing produces either. Five grey
 *  stars would be furniture that looks like data.
 *  **D8 — no screenshot banner and no per-app glyph/colour.** A bundle carries
 *  `manifest.json` and built surfaces; the identity block has no icon field.
 *  Every card takes the same tile rather than inventing one per app.
 *  **D9 — no "Live demo".** The manifest has no demo URL. A button that had to
 *  guess `adminium.dev/demo/<key>` would break the moment an operator bundled
 *  an app of their own.
 *  **D10 — no POPULAR / STAFF PICK / NEW flags, and no sort control.** All four
 *  need a signal nothing measures. The comp's sort menu would have exactly one
 *  honest option, and a control with one reachable option is a control that
 *  lies — the same reason the plan step's segmented control became a badge.
 *
 * What IS real is kept: the byline comes from `publisher.name`, and the feature
 * chips are the manifest's own `capabilities` — a shipped app really does
 * declare `payments`, `email-delivery`, `realtime`.
 */
import { useMemo, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  IconTile,
  MonoText,
  SearchInput,
} from '@adminium/ui';
import { Download, Package, SearchX } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { appCatalogQuery, type CatalogApp } from './appsApi.js';

export interface AppBrowserProps {
  /** Opens the install wizard with this app already chosen. */
  onInstall: (app: CatalogApp) => void;
}

const ALL = '*';

export function AppBrowser({ onInstall }: AppBrowserProps) {
  const { data } = useSuspenseQuery(appCatalogQuery());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);

  /** The comp's chips, with their counts — derived, never hard-coded. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of data.apps) {
      for (const slug of app.categories) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.apps]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.apps
      .filter((app) => category === ALL || app.categories.includes(category))
      .filter(
        (app) =>
          needle === '' ||
          app.name.toLowerCase().includes(needle) ||
          app.key.includes(needle) ||
          app.description.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.apps, query, category]);

  if (data.apps.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title={t('studio:hostedApps.browse.emptyTitle', 'No apps are available to install')}
            body={t(
              'studio:hostedApps.browse.emptyBody',
              'Apps shipped with this build appear here. Point ADMINIUM_BUNDLED_APPS at a directory of app bundles, or upload one yourself.',
            )}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-section text-fg">
            {t('studio:hostedApps.browse.title', 'Apps you can install')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.browse.subtitle',
              'Ready-made apps that came with this build. Installing one creates the tables it needs and serves its screens — nothing happens until you confirm the plan.',
            )}
          </p>
        </div>

        {/* The comp's search pill, clear button included. */}
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('studio:hostedApps.browse.search', 'Search apps…')}
          aria-label={t('studio:hostedApps.browse.search', 'Search apps…')}
          onClear={() => setQuery('')}
          clearLabel={t('studio:hostedApps.browse.clear', 'Clear the search')}
        />

        {categories.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {[[ALL, data.apps.length] as const, ...categories].map(([slug, count]) => (
              <Button
                key={slug}
                size="sm"
                variant={category === slug ? 'primary' : 'secondary'}
                onClick={() => setCategory(slug)}
              >
                {slug === ALL ? t('studio:hostedApps.browse.all', 'All') : slug}
                <MonoText className="ms-1.5 text-[10px]">{count}</MonoText>
              </Button>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState
            icon={<SearchX aria-hidden />}
            title={t('studio:hostedApps.browse.noMatch', 'No apps match that search')}
            body={t(
              'studio:hostedApps.browse.noMatchBody',
              'Try a different term, or another category.',
            )}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((app) => (
              <li key={app.key}>
                <AppCard app={app} onInstall={() => onInstall(app)} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AppCard({ app, onInstall }: { app: CatalogApp; onInstall: () => void }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <IconTile>
          <Package aria-hidden className="size-5" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold tracking-tight">{app.name}</span>
            {app.categories[0] === undefined ? null : (
              <Badge tone="accent">{app.categories[0]}</Badge>
            )}
          </div>
          {app.publisher === '' ? null : (
            <p className="mt-0.5 text-xs text-fg-subtle">
              {t('studio:hostedApps.browse.by', 'by {publisher}', { publisher: app.publisher })}
            </p>
          )}
        </div>
      </div>

      <p className="flex-1 text-sm leading-relaxed text-fg-muted">
        {app.readable
          ? app.description
          : t(
              'studio:hostedApps.browse.unreadable',
              'This package’s manifest could not be read. It cannot be installed — discard it below.',
            )}
      </p>

      {app.capabilities.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {app.capabilities.map((capability) => (
            <span
              key={capability}
              className="rounded-md bg-surface-3 px-2 py-0.5 text-[10.5px] font-semibold text-fg-muted"
            >
              {capability}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <MonoText className="text-xs text-fg-subtle">{app.version}</MonoText>
        {app.installed ? (
          <Badge tone="pos" className="ms-auto">
            {t('studio:hostedApps.browse.installed', 'Installed')}
          </Badge>
        ) : (
          <Button className="ms-auto" size="sm" disabled={!app.readable} onClick={onInstall}>
            <Download aria-hidden className="size-4" />
            {t('studio:hostedApps.browse.install', 'Install')}
          </Button>
        )}
      </div>
    </article>
  );
}
