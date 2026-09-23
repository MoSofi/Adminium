// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared AuthLayout composition for every `/login`-group screen: brand panel
 * copy per Login.dc.html, theme-toggle corner, and the ui screen as
 * the 380px form column.
 */
import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { AuthLayout, IconButton, useTheme, useThemePrefs } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { BrandMark, useBranding } from '../shell/BrandMark.js';
import { useDocumentPageTitle } from '../shell/documentTitle.js';

/** `className` lets a screen give the corner control the geometry its comp draws. */
export function ThemeToggleButton({ className }: { className?: string | undefined } = {}) {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  return (
    <IconButton
      variant="bordered"
      size="lg"
      {...(className === undefined ? {} : { className })}
      label={
          dark
            ? t('theme.toLight', 'Light mode')
            : t('theme.toDark', 'Dark mode')
        }
      onClick={() => setPref('theme', dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

export interface AuthScreenLayoutProps {
  /**
   * What the browser tab calls this screen, ahead of the workspace name. These
   * screens render with no shell, so there is no topbar to derive it from and
   * each one has to say who it is — otherwise every tab in the group reads
   * "Adminium" and they are indistinguishable side by side.
   *
   * Required, and nullable rather than optional, so the two first-run wizards
   * have to say out loud that they mean it: at first run this layout is the
   * only screen the instance can show, so there is nothing to tell apart and
   * the tab is better off reading the product name alone.
   */
  documentTitle: string | null;
  children: ReactNode;
}

/**
 * The venue's own header on an app's staff address (`App Address Pages.dc.html`):
 * its first letter on a tile, its name, and "{app} · Staff sign-in". The tile
 * uses the fill the brand panel uses behind white text, which holds its
 * contrast in dark mode (the comp's own colour does not).
 */
function StaffHeader({ surface }: { surface: NonNullable<ReturnType<typeof useBranding>['surface']> }) {
  const venue = surface.name ?? surface.appName;
  return (
    <div className="mb-5 flex items-center gap-[13px]" data-part="staff-header">
      <span
        aria-hidden="true"
        className="flex size-[50px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--accent-light)] text-[23px] font-extrabold text-white"
      >
        {[...venue][0]?.toLocaleUpperCase() ?? ''}
      </span>
      <span className="min-w-0">
        {/* `normal` line height, as the comp's (this system's `leading-normal` is 1.5). */}
        <span className="block truncate text-[19.5px] font-extrabold leading-[normal] tracking-[-0.025em]">{venue}</span>
        <span className="mt-0.5 block text-[13.5px] leading-[normal] text-fg-muted">
          {t('auth.staff.subtitle', '{app} · Staff sign-in', { app: surface.appName })}
        </span>
      </span>
    </div>
  );
}

export function AuthScreenLayout({ documentTitle, children }: AuthScreenLayoutProps) {
  useDocumentPageTitle(documentTitle);
  const { surface } = useBranding();
  /*
   * On an app's staff address the page is the venue's: no Adminium marketing
   * panel, no theme corner — the venue's name and the app's, over the form.
   */
  if (surface !== undefined) {
    return (
      <AuthLayout
        variant="single"
        footer={
          // The venue's own line, at the comp's size — not the Adminium footer's caption.
          <span className="text-[12.5px] leading-[1.55]">
            {t('auth.staff.shared', 'Shared tablet? Everyone signs in with their own account.')}
          </span>
        }
      >
        <StaffHeader surface={surface} />
        {children}
      </AuthLayout>
    );
  }
  return (
    // `logo`: the workspace's own mark, from the PUBLIC branding route — a
    // white label that only applies after you sign in is not a white label.
    <AuthLayout
      logo={<BrandMark tone="onAccent" />}
      headline={t('auth.headline', 'Turn any database into a dashboard.')}
      description={t(
        'auth.description',
        'Connect PostgreSQL and Adminium generates a themeable, permission-aware admin app — no code required.',
      )}
      trustBadges={<span>{t('auth.trust', 'AGPL core · Self-hosted · Your data stays yours')}</span>}
      corner={<ThemeToggleButton />}
    >
      {children}
    </AuthLayout>
  );
}
