// SPDX-License-Identifier: AGPL-3.0-only
/**
 * /account/preferences — the per-user Preferences page
 * (Profile Settings.dc.html Preferences tab, upgraded per
 * 10-i18n-theming.md §7.4): the four axes with inheritance affordances.
 *
 * - An axis with a `NULL` override shows the *effective* (workspace default)
 *   value plus a neutral "Workspace default" badge and a
 *   "Using workspace default (X)" caption.
 * - First interaction writes an override through ThemeProvider's `setPref`
 *   (optimistic, applies instantly; the app-root `onPrefChange` persists it
 *   via PATCH /api/v1/me/prefs) and swaps the badge to accent-tone
 *   "Personal".
 * - "Reset to workspace default" sends the explicit `null` per the route
 *   contract, drops any optimistic session override via `clearSessionPref` (so
 *   the workspace default shows immediately, not after a reload), and returns
 *   the axis to live inheritance.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { LocaleId } from '@adminium/i18n/registry';
import type { Accent, Density, ThemePref } from '@adminium/tokens';
import { Badge, Button, Card, CardBody, Divider, useThemePrefs } from '@adminium/ui';

import { t } from '../i18n/t.js';
import {
  AccentControl,
  DensityControl,
  LocaleControl,
  ThemeControl,
  accentLabel,
  densityLabel,
  localeLabel,
  themeLabel,
} from './prefControls.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { ME_PREFS_QUERY_KEY, mePrefsQuery, patchMePrefs, type MePrefsData, type RawUserPrefs } from './prefsApi.js';

type Axis = 'theme' | 'accent' | 'density' | 'locale';

function PrefRow(props: {
  label: string;
  inherited: boolean;
  effectiveLabel: string;
  onReset: () => void;
  resetting: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex items-center gap-2">
        <span className="text-body font-semibold text-fg">{props.label}</span>
        {props.inherited ? (
          <Badge tone="neutral">{t('account.preferences.workspaceDefault', 'Workspace default')}</Badge>
        ) : (
          <Badge tone="accent">{t('account.preferences.personal', 'Personal')}</Badge>
        )}
      </div>
      {props.children}
      {props.inherited ? (
        <p className="text-body-sm text-fg-muted">
          {t('account.preferences.usingDefault', 'Using workspace default ({value})', {
            value: props.effectiveLabel,
          })}
        </p>
      ) : (
        <div>
          <Button variant="link" onClick={props.onReset} loading={props.resetting}>
            {t('account.preferences.reset', 'Reset to workspace default')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PreferencesPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(mePrefsQuery());
  const { prefs: effective, setPref, clearSessionPref } = useThemePrefs();
  const [resetting, setResetting] = useState<Axis | null>(null);
  // Optimistic overlay for overrides made this session (the server round trip
  // rides the app-root onPrefChange PATCH; badges must not wait for it).
  const [localOverrides, setLocalOverrides] = useState<Partial<RawUserPrefs>>({});

  const raw: RawUserPrefs = { ...data.prefs, ...localOverrides };

  const applyServerReply = useCallback(
    (reply: MePrefsData): void => {
      queryClient.setQueryData(ME_PREFS_QUERY_KEY, reply);
      // Re-resolve prefs everywhere the resolved axes ride (§7.2).
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    [queryClient],
  );

  function override<K extends Axis>(axis: K, value: NonNullable<RawUserPrefs[K]>): void {
    // Optimistic + instant (ThemeProvider applies, root onPrefChange persists).
    setPref(axis, value as never);
    setLocalOverrides((prev) => ({ ...prev, [axis]: value }));
  }

  function reset(axis: Axis): void {
    setResetting(axis);
    patchMePrefs({ [axis]: null })
      .then((reply) => {
        // Drop any override made this session via `setPref`. Without this the
        // stale optimistic value would keep masking the refetched workspace
        // default (ThemeProvider §4.2) until a reload — the axis would reset
        // server-side but not visually.
        clearSessionPref(axis);
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[axis];
          return next;
        });
        applyServerReply(reply);
      })
      .catch(() => {
        // Non-fatal; the badge keeps its current state and the user can retry.
      })
      .finally(() => {
        setResetting((current) => (current === axis ? null : current));
      });
  }

  return (
    <PageSurface width="page">
      <PageActions
        title={t('account.preferences.title', 'Preferences')}
        subtitle={t(
          'account.preferences.subtitle',
          'How Adminium looks and reads for you — on this and every device you sign in from.',
        )}
      />
      <Card>
        <CardBody>
          <PrefRow
            label={t('prefs.theme.label', 'Theme')}
            inherited={raw.theme === null}
            effectiveLabel={themeLabel(effective.theme)}
            onReset={() => reset('theme')}
            resetting={resetting === 'theme'}
          >
            <ThemeControl
              label={t('prefs.theme.label', 'Theme')}
              value={effective.theme}
              onChange={(value: ThemePref) => override('theme', value)}
            />
          </PrefRow>
          <Divider />
          <PrefRow
            label={t('prefs.accent.label', 'Accent color')}
            inherited={raw.accent === null}
            effectiveLabel={accentLabel(effective.accent)}
            onReset={() => reset('accent')}
            resetting={resetting === 'accent'}
          >
            <AccentControl
              label={t('prefs.accent.label', 'Accent color')}
              value={effective.accent}
              onChange={(value: Accent) => override('accent', value)}
            />
          </PrefRow>
          <Divider />
          <PrefRow
            label={t('prefs.density.label', 'Density')}
            inherited={raw.density === null}
            effectiveLabel={densityLabel(effective.density)}
            onReset={() => reset('density')}
            resetting={resetting === 'density'}
          >
            <DensityControl
              label={t('prefs.density.label', 'Density')}
              value={effective.density}
              onChange={(value: Density) => override('density', value)}
            />
          </PrefRow>
          <Divider />
          <PrefRow
            label={t('prefs.locale.label', 'Language')}
            inherited={raw.locale === null}
            effectiveLabel={localeLabel(effective.locale as LocaleId)}
            onReset={() => reset('locale')}
            resetting={resetting === 'locale'}
          >
            <LocaleControl
              label={t('prefs.locale.label', 'Language')}
              value={effective.locale as LocaleId}
              onChange={(value: LocaleId) => override('locale', value)}
            />
          </PrefRow>
          <p className="pt-4 text-body-sm text-fg-subtle">
            {t('account.preferences.appliesInstantly', 'Changes apply instantly and are saved to your profile.')}
          </p>
        </CardBody>
      </Card>
    </PageSurface>
  );
}
