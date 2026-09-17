// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browse half of `/studio/add-ons`.
 *
 * Split out of `AddOnsPage.tsx` because that file had reached the point where
 * adding a stateful filter to it made the CONSENT code harder to read, and the
 * consent dialog is the security surface — the one part of this screen that
 * must stay easy to audit. The page keeps consent, the installed list, the
 * sideload card and the catalogue switch's owner; this component owns only what
 * an operator looks at while choosing.
 *
 * ── WHAT THIS COMPONENT MAY NOT DO ─────────────────────────────────────────
 * It never fetches. `GET /add-ons/catalog` is a disk read on the server and
 * that is what makes this screen work identically on an air-gapped install; a
 * filter that "completed" the list by refreshing would turn every category
 * click into an outbound call. Refresh stays the separate, visible action it
 * already was, in the header, next to the switch that enables it.
 *
 * Design input: the comp’s category rail with counts,
 * the search box, and the card grid are its `cats`/`catLabels`/`catList`,
 * `state.query` and card render respectively. Departures are numbered.
 */
import { useState } from 'react';
import { Blocks, CloudDownload, KeyRound, Search, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconTile,
  Input,
  Switch,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { CatalogBrowse, CatalogEntry } from './addOnsApi.js';

/**
 * The vocabulary, which is also `ADD_ON_CATEGORIES` in
 * `@adminium/add-on-contracts`. Kept as a local list rather than imported
 * because this is a LABEL ORDER, not a validation: the rail renders these five
 * first, in this order, and anything else an add-on declares follows in the
 * order the server sent it. Importing the enum would tie the rail's layout to
 * a package whose job is to police manifests.
 */
const KNOWN_CATEGORIES = ['artwork', 'delivery', 'payments', 'email', 'data'] as const;

/**
 * A category's label, or the slug itself.
 *
 * The fallback is not defensive coding — it is. The feed types categories
 * `z.array(z.string())`, so a future add-on may carry a slug this build has
 * never heard of, and the honest thing is to show the operator what it says
 * rather than drop the row out of the rail and the grid with it.
 */
function categoryLabel(slug: string): string {
  switch (slug) {
    case 'artwork':
      return t('studio:addOns.category.artwork', 'Artwork');
    case 'delivery':
      return t('studio:addOns.category.delivery', 'Delivery');
    case 'payments':
      return t('studio:addOns.category.payments', 'Payments');
    case 'email':
      return t('studio:addOns.category.email', 'Email');
    case 'data':
      return t('studio:addOns.category.data', 'Data');
    default:
      return slug;
  }
}

/** What installing will ask for, said before a download starts. */
function ConnectLine({ kind }: { kind: CatalogEntry['connectKind'] }) {
  if (kind === 'none') return null;
  return (
    <span className="flex items-center gap-1.5 text-caption text-fg-subtle">
      {kind === 'api-key' ? (
        <KeyRound aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
      )}
      {kind === 'api-key'
        ? t('studio:addOns.card.needsApiKey', 'Needs an API key')
        : t('studio:addOns.card.needsOauth', 'Connects with OAuth')}
    </span>
  );
}

/**
 * One add-on card.
 *
 * The comp draws a brand monogram on a per-add-on hex (`mark`, `c`). Departure
 * 1: 02-design-system forbids raw hex, and the feed carries no icon or colour
 * field to replace one with, so the card uses the token `IconTile` the rest of
 * Studio uses. Everything else on it is the comp's: name, category, one line of
 * what it does, and a full-width action.
 */
function AddOnCard({
  entry,
  busy,
  onDownload,
  onInstall,
  onDiscard,
  onUpgrade,
}: {
  entry: CatalogEntry;
  busy: boolean;
  onDownload: (entry: CatalogEntry) => void;
  onInstall: (entry: CatalogEntry) => void;
  onDiscard: (entry: CatalogEntry) => void;
  onUpgrade: (entry: CatalogEntry) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <IconTile tone="accent" size="md" icon={<Blocks />} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-section text-fg">{entry.name}</strong>
            <Badge tone="neutral">{entry.version}</Badge>
            {entry.source === 'bundled' && (
              <Badge tone="neutral">{t('studio:addOns.browse.bundled', 'Included')}</Badge>
            )}
            {entry.upgradeTo !== null && (
              <Badge tone="accent">
                {t('studio:addOns.browse.upgrade', 'v{version} available', {
                  version: entry.upgradeTo,
                })}
              </Badge>
            )}
          </div>
          {/* `line-clamp-2`: a staged row's line comes from the manifest's
              `description.fallback`, which is a paragraph, while the feed's
              `tagline` is one sentence. The card holds its shape either way. */}
          {entry.tagline !== null && (
            <p className="mt-0.5 line-clamp-2 text-caption text-fg-muted">{entry.tagline}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {entry.categories.map((slug) => (
              <span key={slug} className="text-caption text-fg-subtle">
                {categoryLabel(slug)}
              </span>
            ))}
            <ConnectLine kind={entry.connectKind} />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {entry.state === 'available' && (
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => onDownload(entry)}
          >
            {t('studio:addOns.browse.download', 'Download')}
          </Button>
        )}
        {entry.state === 'staged' && (
          <>
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => onInstall(entry)}>
              {t('studio:addOns.browse.install', 'Install')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDiscard(entry)}>
              {t('studio:addOns.browse.discard', 'Discard')}
            </Button>
          </>
        )}
        {entry.state === 'installed' && entry.upgradeTo !== null && (
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => onUpgrade(entry)}>
            {t('studio:addOns.browse.upgradeAction', 'Upgrade')}
          </Button>
        )}
      </div>
    </li>
  );
}

export interface AddOnBrowserProps {
  catalog: CatalogBrowse;
  busy: boolean;
  onRefreshCatalog: () => void;
  onToggleOnline: (next: boolean) => void;
  onDownload: (entry: CatalogEntry) => void;
  onInstall: (entry: CatalogEntry) => void;
  onDiscard: (entry: CatalogEntry) => void;
  onUpgrade: (entry: CatalogEntry) => void;
}

export function AddOnBrowser({
  catalog,
  busy,
  onRefreshCatalog,
  onToggleOnline,
  onDownload,
  onInstall,
  onDiscard,
  onUpgrade,
}: AddOnBrowserProps) {
  /* Component state, not route state: nothing links to a pre-filtered
     add-ons view, and a URL encoding a filter would be a shareable link into a
     screen whose contents differ per deployment. */
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');

  /* Rail order: the five known slugs first (order), then anything
     else an add-on declared, so an unfamiliar category is reachable rather
     than merely visible on a card. */
  const present = new Set(catalog.addOns.flatMap((entry) => entry.categories));
  const ordered = [
    ...KNOWN_CATEGORIES.filter((slug) => present.has(slug)),
    ...[...present].filter((slug) => !KNOWN_CATEGORIES.includes(slug as never)).sort(),
  ];

  const needle = query.trim().toLowerCase();
  /* The comp filters on name alone. Including the tagline is — additive,
     costs nothing, and matches what an operator actually types. */
  const matches = (entry: CatalogEntry): boolean =>
    (category === 'all' || entry.categories.includes(category)) &&
    (needle === '' ||
      entry.name.toLowerCase().includes(needle) ||
      (entry.tagline ?? '').toLowerCase().includes(needle));

  const shown = catalog.addOns.filter(matches);
  /* Counts come from the rows the server sent, so the number beside a label can
     never disagree with what clicking it shows. */
  const countFor = (slug: string): number =>
    slug === 'all'
      ? catalog.addOns.length
      : catalog.addOns.filter((entry) => entry.categories.includes(slug)).length;

  const railEntries = ['all', ...ordered];

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-3">
          <IconTile>
            <CloudDownload />
          </IconTile>
          <span className="flex flex-col">
            <strong>{t('studio:addOns.browse.title', 'Available')}</strong>
            <span className="text-sm text-fg-muted">
              {catalog.onlineEnabled
                ? t(
                    'studio:addOns.browse.online',
                    'Includes add-ons from the online catalogue. Checking for newer versions is a separate action.',
                  )
                : t(
                    'studio:addOns.browse.offline',
                    'Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.',
                  )}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3">
          {catalog.onlineEnabled && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onRefreshCatalog}>
              {t('studio:addOns.browse.refresh', 'Check for newer')}
            </Button>
          )}
          {/*
            THE SWITCH IS HERE, beside what it changes, rather than in
            Settings. These routes are gated on `manifests.manage` and
            the /settings/* routes are not, so a switch deciding whether this
            deployment talks to a package registry belongs with the add-ons.
          */}
          <Switch
            checked={catalog.onlineEnabled}
            disabled={busy}
            onCheckedChange={onToggleOnline}
            aria-label={t('studio:addOns.browse.toggle', 'Browse the online catalogue')}
          />
        </span>
      </CardHeader>
      <CardBody>
        {catalog.addOns.length === 0 ? (
          /* D8's first nothing: a CONFIGURATION answer. Nothing is wrong; this
             build shipped no bundled set and online browsing is off. */
          <EmptyState
            icon={<Blocks />}
            title={t('studio:addOns.browse.emptyTitle', 'No add-ons available')}
            body={
              catalog.onlineEnabled
                ? t(
                    'studio:addOns.browse.emptyOnlineBody',
                    'The online catalogue is on, but the last check found nothing. Try checking for newer.',
                  )
                : t(
                    'studio:addOns.browse.emptyBody',
                    'This build shipped none, and the online catalogue is off.',
                  )
            }
          />
        ) : (
          <div className="flex flex-col gap-4 md:flex-row">
            {/* The rail. `md:` only — below that it wraps to a chip row, because
                a 160px column beside a card grid on a phone leaves neither
                enough width to read. */}
            <nav
              aria-label={t('studio:addOns.browse.categories', 'Categories')}
              className="flex shrink-0 flex-row flex-wrap gap-1 md:w-40 md:flex-col md:flex-nowrap"
            >
              {railEntries.map((slug) => {
                const active = category === slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCategory(slug)}
                    className={
                      'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-start text-[13px] font-semibold transition-colors ' +
                      (active
                        ? 'bg-accent-soft text-accent'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg')
                    }
                  >
                    <span className="min-w-0 truncate">
                      {slug === 'all' ? t('studio:addOns.browse.all', 'All') : categoryLabel(slug)}
                    </span>
                    <span className="shrink-0 text-caption font-normal text-fg-subtle">
                      {countFor(slug)}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 flex-1">
              <div className="relative mb-3">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-fg-subtle"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="ps-8"
                  aria-label={t('studio:addOns.browse.search', 'Search add-ons')}
                  placeholder={t('studio:addOns.browse.search', 'Search add-ons')}
                />
              </div>

              {shown.length === 0 ? (
                /* D8's second nothing: a UI answer, and the only one the
                   operator can fix from where they are standing. */
                <EmptyState
                  icon={<Search />}
                  title={t('studio:addOns.browse.noMatchTitle', 'Nothing matches')}
                  body={t(
                    'studio:addOns.browse.noMatchBody',
                    'No add-on here matches that search and category.',
                  )}
                />
              ) : (
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {shown.map((entry) => (
                    <AddOnCard
                      key={entry.key}
                      entry={entry}
                      busy={busy}
                      onDownload={onDownload}
                      onInstall={onInstall}
                      onDiscard={onDiscard}
                      onUpgrade={onUpgrade}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
