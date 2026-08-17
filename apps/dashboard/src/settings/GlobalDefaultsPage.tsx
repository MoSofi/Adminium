/**
 * /settings/defaults — the Global Defaults admin page (10-i18n-theming.md
 * §7.3, a comp gap: no design file exists). Four axis pickers for the
 * workspace defaults, per-axis adoption meters ("N of M users follow this
 * default"), an explicit Save (this page is consequential — no autosave),
 * and live propagation: the PUT broadcasts `settings.defaults.updated`,
 * which the realtime mapping turns into a bootstrap invalidation so users
 * following a default re-resolve without a reload.
 *
 * Client-side gate: super-admin only (roles from bootstrap); direct access
 * by anyone else renders the 403 system state. The server enforces
 * `system:settings:manage` regardless.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Globe2, Info, Palette } from 'lucide-react';
import type { LocaleId } from '@adminium/i18n/registry';
import { Button, Card, CardBody, CardHeader, IconTile } from '@adminium/ui';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { StatePage } from '../states/StatePage.js';
import {
  AccentControl,
  DensityControl,
  LocaleControl,
  ThemeControl,
} from '../account/prefControls.js';
import {
  SETTINGS_DEFAULTS_QUERY_KEY,
  putSettingsDefaults,
  settingsDefaultsQuery,
  type SettingsDefaultsData,
  type SettingsDefaultsValues,
} from './defaultsApi.js';

const SUPER_ADMIN_ROLE = 'super-admin';

function AdoptionLine(props: { following: number; total: number }): ReactNode {
  return (
    <p className="text-body-sm text-fg-muted">
      {t('settings.defaults.adoption', '{following, number} of {total, plural, one {# user} other {# users}} follow this default.', {
        following: props.following,
        total: props.total,
      })}
    </p>
  );
}

function AxisField(props: {
  label: string;
  following: number;
  total: number;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 py-3">
      <span className="text-body font-semibold text-fg">{props.label}</span>
      {props.children}
      <AdoptionLine following={props.following} total={props.total} />
    </div>
  );
}

function DefaultsForm({ initial }: { initial: SettingsDefaultsData }): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [values, setValues] = useState<SettingsDefaultsValues>({
    theme: initial.theme,
    accent: initial.accent,
    density: initial.density,
    locale: initial.locale,
  });
  const [saving, setSaving] = useState(false);

  const { adoption } = initial;
  const dirty =
    values.theme !== initial.theme ||
    values.accent !== initial.accent ||
    values.density !== initial.density ||
    values.locale !== initial.locale;

  function set<K extends keyof SettingsDefaultsValues>(axis: K, value: SettingsDefaultsValues[K]): void {
    setValues((prev) => ({ ...prev, [axis]: value }));
  }

  function save(): void {
    setSaving(true);
    putSettingsDefaults(values)
      .then((data) => {
        queryClient.setQueryData(SETTINGS_DEFAULTS_QUERY_KEY, data);
        // Sessions following a default re-resolve (§7.2); ours included.
        void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
        toasts.push({ variant: 'success', title: t('settings.defaults.saved', 'Workspace defaults updated') });
      })
      .catch(() => {
        toasts.push({
          variant: 'error',
          title: t('settings.defaults.saveFailed', 'Could not save workspace defaults. Try again.'),
        });
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-body-sm text-fg">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <p>
          {t(
            'settings.defaults.explainer',
            'These defaults apply to all users unless they override them. Anyone can set their own preference under Profile → Preferences — personal preferences always win for that user.',
          )}
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<Palette />} />
          <h3 className="text-section text-fg">
            {t('settings.defaults.appearanceHeading', 'Appearance defaults')}
          </h3>
        </CardHeader>
        <CardBody>
          <AxisField label={t('prefs.theme.label', 'Theme')} following={adoption.following.theme} total={adoption.totalUsers}>
            <ThemeControl label={t('prefs.theme.label', 'Theme')} value={values.theme} onChange={(v) => set('theme', v)} />
          </AxisField>
          <AxisField label={t('prefs.accent.label', 'Accent color')} following={adoption.following.accent} total={adoption.totalUsers}>
            <AccentControl label={t('prefs.accent.label', 'Accent color')} value={values.accent} onChange={(v) => set('accent', v)} />
          </AxisField>
          <AxisField label={t('prefs.density.label', 'Density')} following={adoption.following.density} total={adoption.totalUsers}>
            <DensityControl label={t('prefs.density.label', 'Density')} value={values.density} onChange={(v) => set('density', v)} />
          </AxisField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<Globe2 />} />
          <h3 className="text-section text-fg">
            {t('settings.defaults.languageHeading', 'Language & region defaults')}
          </h3>
        </CardHeader>
        <CardBody>
          <AxisField label={t('prefs.locale.label', 'Language')} following={adoption.following.locale} total={adoption.totalUsers}>
            <LocaleControl
              label={t('prefs.locale.label', 'Language')}
              value={values.locale}
              onChange={(v: LocaleId) => set('locale', v)}
            />
          </AxisField>
          <p className="text-body-sm text-fg-subtle">
            {t('settings.defaults.weekStartNote', 'Week start and number formats follow the language.')}
          </p>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-body-sm text-fg-subtle">
          {t(
            'settings.defaults.liveNote',
            'Saving broadcasts the change live — signed-in users who follow a default see it apply without a reload.',
          )}
        </p>
        <Button onClick={save} loading={saving} disabled={!dirty || saving}>
          {t('settings.defaults.save', 'Save defaults')}
        </Button>
      </div>
    </div>
  );
}

export function GlobalDefaultsPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const isSuperAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);

  // Hooks order: the defaults query only mounts for super admins (the server
  // would 403 anyone else anyway) via the split component below.
  if (!isSuperAdmin) {
    return <StatePage stateId="forbidden" fullPage={false} />;
  }
  return <GlobalDefaultsBody />;
}

function GlobalDefaultsBody(): ReactNode {
  const { data } = useSuspenseQuery(settingsDefaultsQuery());
  return (
    <PageSurface width="narrow">
      <PageActions
        title={t('settings.defaults.title', 'Global defaults')}
        subtitle={t('settings.defaults.subtitle', 'Workspace-wide appearance and language defaults.')}
      />
      {/* Remount the form when the server state changes (realtime refetch). */}
      <DefaultsForm key={`${data.theme}|${data.accent}|${data.density}|${data.locale}`} initial={data} />
    </PageSurface>
  );
}
