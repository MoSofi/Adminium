/**
 * `/settings/desktop` — the desktop settings panel (11-electron.md §2.3: "Everything
 * user-facing in [config.json] is also editable from the dashboard's desktop
 * settings panel (§8)").
 *
 * Two cards so far: §5's "Require login on this device" (11-T06) and §8.3's
 * "Share on local network" (11-T11). The panel is the shape the rest of §8 grows
 * into (updates, auto-backup, data dir), which is why it is a page with sections
 * rather than a lone switch.
 *
 * The order is deliberate and it is not alphabetical: sign-in first, sharing
 * second. §8.3's toggle is the one that changes who can reach this machine, and
 * the question it raises — "wait, does it ask them for a password?" — is
 * answered by the card directly above it.
 *
 * DESKTOP ONLY. Without the preload bridge there is no `config.json` to write, so
 * the route renders the 404 state rather than a toggle that cannot do anything —
 * `designs/Empty States.dc.html`'s "never hide, always explain" is about features
 * a user could have; a browser tab cannot have this one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader, IconTile, Label, Switch } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { StatePage } from '../states/StatePage.js';
import { CapabilitiesCard } from './capabilities/CapabilitiesCard.js';
import { LanShareCard } from './LanShareCard.js';
import { isDesktopRuntime, readSingleUser, setRequireLogin } from './singleUser.js';

export const DESKTOP_RUNTIME_QUERY_KEY = ['desktop', 'runtime-info'] as const;

function RequireLoginCard(): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  const info = useQuery({
    queryKey: DESKTOP_RUNTIME_QUERY_KEY,
    queryFn: readSingleUser,
    // `config.json` only changes through this panel or a relaunch — no polling.
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: setRequireLogin,
    onSuccess: (_result, requireLogin) => {
      // Optimism has no place here: this is a security setting, and the honest
      // source is the file we just wrote. Refetch rather than assume.
      void queryClient.invalidateQueries({ queryKey: DESKTOP_RUNTIME_QUERY_KEY });
      toasts.push({
        variant: 'success',
        title: requireLogin
          ? t('desktop.requireLogin.savedOn', 'Login required on the next launch')
          : t('desktop.requireLogin.savedOff', 'Adminium will skip the login on this computer'),
      });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('desktop.requireLogin.saveFailed', 'Could not save that setting. Try again.'),
      });
    },
  });

  // `singleUser` ("skip login") and this toggle ("require login") are opposites;
  // `setRequireLogin` owns the flip. Until the answer loads, assume the SAFER
  // reading — a switch that renders "off" and then snaps on would misreport the
  // state of a login requirement, which is the one thing it must never do.
  const requireLogin = info.data === null || info.data === undefined ? true : !info.data;
  const descriptionId = 'desktop-require-login-description';

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<KeyRound />} />
        <h3 className="text-section text-fg">{t('desktop.security.heading', 'Sign-in')}</h3>
      </CardHeader>
      <CardBody>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="desktop-require-login" className="text-body font-semibold text-fg">
              {t('desktop.requireLogin.label', 'Require login on this device')}
            </Label>
            <p id={descriptionId} className="text-body-sm text-fg-muted">
              {t(
                'desktop.requireLogin.description',
                'Adminium normally signs you in automatically on this computer. Turn this on to ask for your password at every launch — worth it if other people can use this machine. It takes effect the next time you open Adminium.',
              )}
            </p>
          </div>
          <Switch
            id="desktop-require-login"
            checked={requireLogin}
            disabled={info.isPending || save.isPending}
            onCheckedChange={(next) => {
              save.mutate(next);
            }}
            aria-describedby={descriptionId}
            className="mt-0.5 shrink-0"
          />
        </div>
      </CardBody>
    </Card>
  );
}

export function DesktopSettingsPage(): ReactNode {
  if (!isDesktopRuntime()) {
    // Not a system state with an explanation: these settings do not exist for a
    // browser at all, so the address is simply wrong here (§4 detection contract).
    return <StatePage stateId="not-found" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-body-sm text-fg">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <p>
          {t(
            'desktop.settings.explainer',
            'These settings apply to the Adminium app on this computer only. They are stored on this machine, not in your workspace.',
          )}
        </p>
      </div>
      <RequireLoginCard />
      <LanShareCard />
      <CapabilitiesCard />
    </div>
  );
}
