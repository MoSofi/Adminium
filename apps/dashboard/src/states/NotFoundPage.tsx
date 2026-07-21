/**
 * Branded 404 (designs/404.dc.html + ia-mapping §4 Surface G keepers):
 * gradient mono numeral with the floating database tile, page-search
 * recovery, popular-destination chips from the real nav tree (static
 * fallbacks pre-bootstrap), and the `req_…` request-id footer line.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, BarChart3, Database, FolderKanban, FolderOpen, Hexagon, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, MonoText, SearchInput } from '@adminium/ui';

import { bootstrapQuery, flattenNav, type NavItem } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { lucideByName } from '../lib/lucide.js';

const STATIC_CHIPS = [
  { label: 'Projects', icon: FolderKanban, slug: null },
  { label: 'Analytics', icon: BarChart3, slug: null },
  { label: 'Files', icon: FolderOpen, slug: null },
  { label: 'Settings', icon: Settings, slug: null },
] as const;

/** Client-generated `req_…` id for route-level 404s that never hit the API. */
function clientRequestId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 7)}`;
}

export interface NotFoundPageProps {
  requestId?: string | null | undefined;
}

export function NotFoundPage({ requestId }: NotFoundPageProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const reqId = useMemo(() => requestId ?? clientRequestId(), [requestId]);

  // Cache-only read: the 404 also renders pre-auth, where there is no nav.
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const navItems: NavItem[] = boot.data === undefined ? [] : flattenNav(boot.data.nav);

  const q = query.trim().toLowerCase();
  const matches = q === '' ? [] : navItems.filter((item) => item.fallback.toLowerCase().includes(q)).slice(0, 5);

  const goTo = (slug: string) => void navigate({ to: '/p/$slug', params: { slug } });

  return (
    <div
      data-part="not-found-page"
      className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-bg p-10 text-fg"
    >
      <div className="absolute start-[26px] top-6 flex items-center gap-2.5">
        <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-accent-fg">
          <Hexagon className="size-[17px]" aria-hidden="true" />
        </span>
        <span className="text-[16px] font-extrabold tracking-[-0.02em]">Adminium</span>
      </div>

      <div className="max-w-[520px] text-center">
        <div className="relative mb-2 inline-flex items-center justify-center">
          <MonoText
            aria-hidden="true"
            className="bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--accent)_55%,#a855f7))] bg-clip-text text-[120px] font-extrabold leading-none tracking-[-0.05em] text-transparent"
          >
            404
          </MonoText>
          <span className="absolute flex size-[58px] translate-x-[96px] translate-y-[-30px] animate-[nb-float_3.5s_ease-in-out_infinite] items-center justify-center rounded-xl border border-border bg-surface text-accent shadow-card motion-reduce:animate-none">
            <Database className="size-[26px]" aria-hidden="true" />
          </span>
        </div>

        <h1 className="mt-2.5 text-[24px] font-extrabold tracking-[-0.02em]">
          {t('notFound.title', 'This page went missing')}
        </h1>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-fg-muted">
          {t(
            'notFound.body',
            "The page you're looking for doesn't exist or was moved. Check the URL, or head back to your dashboard.",
          )}
        </p>

        <SearchInput
          className="mx-auto mt-[22px] max-w-[380px]"
          placeholder={t('notFound.searchPlaceholder', 'Search for a page…')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = matches[0];
            if (event.key === 'Enter' && first !== undefined) goTo(first.slug);
          }}
        />

        <div className="mt-5 flex items-center justify-center gap-2.5">
          <Button asChild>
            <Link to="/">
              <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
              {t('notFound.backToDashboard', 'Back to dashboard')}
            </Link>
          </Button>
          <Button variant="outline" onClick={() => window.history.back()}>
            {t('notFound.goBack', 'Go back')}
          </Button>
        </div>

        <div className="mt-[34px] border-t border-border pt-[22px]">
          <div className="mb-3 text-micro uppercase text-fg-subtle">
            {q === ''
              ? t('notFound.popular', 'Popular destinations')
              : t('notFound.matches', 'Matching pages')}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {q !== '' && matches.length === 0 ? (
              <span className="text-body-sm text-fg-subtle">
                {t('notFound.noMatches', `No pages match "${query.trim()}"`)}
              </span>
            ) : q !== '' ? (
              matches.map((item) => <NavChip key={item.pageId} item={item} onSelect={goTo} />)
            ) : navItems.length > 0 ? (
              navItems.slice(0, 4).map((item) => <NavChip key={item.pageId} item={item} onSelect={goTo} />)
            ) : (
              STATIC_CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <span
                    key={chip.label}
                    className="inline-flex items-center gap-[7px] rounded-[20px] border border-border bg-surface px-[13px] py-2 text-[12.5px] font-semibold text-fg-muted"
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {chip.label}
                  </span>
                );
              })
            )}
          </div>
        </div>

        <MonoText className="mt-[26px] block text-[11px] text-fg-subtle">
          {t('notFound.errorLine', 'Error 404')} · {reqId}
        </MonoText>
      </div>
    </div>
  );
}

function NavChip({ item, onSelect }: { item: NavItem; onSelect: (slug: string) => void }) {
  const Icon = lucideByName(item.icon);
  return (
    <button
      type="button"
      onClick={() => onSelect(item.slug)}
      className="inline-flex cursor-pointer items-center gap-[7px] rounded-[20px] border border-border bg-surface px-[13px] py-2 text-[12.5px] font-semibold text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {item.fallback}
    </button>
  );
}
