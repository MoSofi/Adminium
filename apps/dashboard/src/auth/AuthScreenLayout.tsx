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
import { BrandMark } from '../shell/BrandMark.js';
import { useDocumentPageTitle } from '../shell/documentTitle.js';

export function ThemeToggleButton() {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  return (
    <IconButton
      variant="bordered"
      size="lg"
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

export function AuthScreenLayout({ documentTitle, children }: AuthScreenLayoutProps) {
  useDocumentPageTitle(documentTitle);
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
