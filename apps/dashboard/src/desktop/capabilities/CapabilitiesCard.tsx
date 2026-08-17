// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → Desktop → "App permissions" (11-electron.md §12).
 *
 * The v1 home for capability consent + revoke. §12 puts these "on the manifest
 * detail page"; the marketplace that owns that page is M14 (13-marketplace.md),
 * so until it lands this panel is where a super admin sees what this computer's
 * hardware can do and manages which app may reach it — reusing the very
 * components ({@link CapabilityConsentCard}) the future install flow will.
 *
 * The whole §12 pipeline is clickable here: the bridge reports each capability's
 * status (`stub` for v1's printer), "Allow…" opens the consent card, approving
 * writes a grant (`POST`), the grant then shows with a Revoke control (`DELETE`),
 * and the main-process host gates real invokes on exactly that grant.
 *
 * v1 offers consent for one concrete app — the POS micro-SaaS (13-marketplace.md
 * §10), the reason §12 exists — under its reserved manifest id. Grants written by
 * a future marketplace install (any manifest id) still appear and revoke here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Usb } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, IconTile, type Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import {
  CAPABILITY_GRANTS_QUERY_KEY,
  capabilityDescriptorsQuery,
  capabilityGrantsQuery,
  grantCapability,
  revokeCapability,
  type CapabilityGrantRef,
} from './api.js';
import { CapabilityConsentCard } from './CapabilityConsentCard.js';
import { capabilityStatuses, CAPABILITY_CATALOG, type CapabilityStatus } from './model.js';

/**
 * The reserved id + name of the first micro-SaaS this shell is built for
 * (13-marketplace.md §10). Until the M14 storefront supplies real manifest ids,
 * this is the app the consent flow grants to — a real, forward-looking
 * authorization, not a placeholder.
 */
const POS_APP = { manifestId: 'com.adminium.pos', name: 'Adminium POS' } as const;

const STATUS_TONE: Record<CapabilityStatus, Tone> = {
  available: 'pos',
  stub: 'warn',
  unavailable: 'neutral',
};

function statusLabel(status: CapabilityStatus): string {
  switch (status) {
    case 'available':
      return t('capabilities.status.available', 'Available');
    case 'stub':
      return t('capabilities.status.stub', 'Not available yet');
    case 'unavailable':
      return t('capabilities.status.unavailable', 'Unavailable');
  }
}

function iconFor(capabilityId: string): ReactNode {
  return capabilityId === 'printer.escpos' ? <Printer aria-hidden /> : <Usb aria-hidden />;
}

export function CapabilitiesCard(): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [consentFor, setConsentFor] = useState<string | null>(null);

  const grants = useQuery(capabilityGrantsQuery());
  const descriptors = useQuery(capabilityDescriptorsQuery());

  // Desktop-only panel (its parent page 404s off-desktop), so the runtime is
  // 'desktop' here — the helper's cross-runtime `unavailable` branch is the §12
  // contract for a future manifest page and is covered by `model.test.ts`.
  const effective = capabilityStatuses('desktop', descriptors.data ?? null);
  const statusById = new Map(effective.map((d) => [d.id, d.status]));

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: CAPABILITY_GRANTS_QUERY_KEY });
  };

  const grant = useMutation({
    mutationFn: (ref: CapabilityGrantRef) => grantCapability(ref),
    onSuccess: () => {
      setConsentFor(null);
      invalidate();
      toasts.push({
        variant: 'success',
        title: t('capabilities.grant.saved', 'Access allowed'),
      });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('capabilities.grant.failed', 'Could not allow access. Try again.'),
      });
    },
  });

  const revoke = useMutation({
    mutationFn: (ref: CapabilityGrantRef) => revokeCapability(ref),
    onSuccess: () => {
      invalidate();
      toasts.push({
        variant: 'success',
        title: t('capabilities.revoke.saved', 'Access revoked'),
      });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('capabilities.revoke.failed', 'Could not revoke access. Try again.'),
      });
    },
  });

  const grantList = grants.data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Usb />} />
        <div className="flex min-w-0 flex-col">
          <h3 className="text-section text-fg">{t('capabilities.heading', 'App permissions')}</h3>
          <p className="text-body-sm text-fg-muted">
            {t(
              'capabilities.description',
              'Apps you install can ask to use this computer’s hardware. You approve each one, and can revoke access anytime.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {CAPABILITY_CATALOG.map((meta) => {
          const status = statusById.get(meta.id) ?? 'unavailable';
          const capabilityGrants = grantList.filter((g) => g.capabilityId === meta.id);
          const posGranted = capabilityGrants.some((g) => g.manifestId === POS_APP.manifestId);
          const scopeText = t(meta.scopeKey, meta.scopeDefault);

          return (
            <div
              key={meta.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="mt-0.5 text-fg-muted">
                  {iconFor(meta.id)}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-fg">
                      {t(meta.nameKey, meta.nameDefault)}
                    </span>
                    <Badge tone={STATUS_TONE[status]}>{statusLabel(status)}</Badge>
                  </div>
                  <p className="text-body-sm text-fg-muted">{scopeText}</p>
                  {capabilityGrants.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {capabilityGrants.map((g) => (
                        <li
                          key={g.manifestId}
                          className="flex items-center gap-2 text-body-sm text-fg"
                        >
                          <span className="text-pos">✓</span>
                          <span className="min-w-0 truncate">
                            {t('capabilities.grantedTo', 'Allowed for {app}', {
                              app: g.manifestId === POS_APP.manifestId ? POS_APP.name : g.manifestId,
                            })}
                          </span>
                          <Button
                            variant="destructiveSoft"
                            size="sm"
                            loading={
                              revoke.isPending &&
                              revoke.variables?.manifestId === g.manifestId &&
                              revoke.variables.capabilityId === g.capabilityId
                            }
                            onClick={() => {
                              revoke.mutate({ manifestId: g.manifestId, capabilityId: g.capabilityId });
                            }}
                          >
                            {t('capabilities.revoke.action', 'Revoke')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {!posGranted && (
                <div className="shrink-0">
                  <Button variant="soft" size="sm" onClick={() => setConsentFor(meta.id)}>
                    {t('capabilities.allow.action', 'Allow…')}
                  </Button>
                </div>
              )}

              <CapabilityConsentCard
                open={consentFor === meta.id}
                appName={POS_APP.name}
                busy={grant.isPending}
                scopes={[{ id: meta.id, icon: iconFor(meta.id), text: scopeText }]}
                onApprove={() => {
                  grant.mutate({ manifestId: POS_APP.manifestId, capabilityId: meta.id });
                }}
                onCancel={() => {
                  if (!grant.isPending) setConsentFor(null);
                }}
              />
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
