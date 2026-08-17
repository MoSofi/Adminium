/**
 * Shared AuthLayout composition for every `/login`-group screen: brand panel
 * copy per Login.dc.html, theme-toggle corner, and the ui screen as
 * the 380px form column.
 */
import { Hexagon, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { AuthLayout, IconButton, useTheme, useThemePrefs } from '@adminium/ui';

import { t } from '../i18n/t.js';

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

export function AuthScreenLayout({ children }: { children: ReactNode }) {
  return (
    <AuthLayout
      logo={
        <span className="flex items-center gap-2.5">
          <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-white/15">
            <Hexagon className="size-[17px]" aria-hidden="true" />
          </span>
          <span className="text-[16px] font-extrabold tracking-[-0.02em]">Adminium</span>
        </span>
      }
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
