// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The capability consent surface (11-electron.md §12) — the OAuth-scope pattern
 * from `Integrations.dc.html`, as a modal.
 *
 * §12: installing a manifest that declares capabilities shows a consent step
 * ("THIS WILL ALLOW <app> TO… Print to receipt printers"). This is that step,
 * built as a reusable component so the v1 home for it (Settings → Desktop →
 * {@link CapabilitiesCard}) and the M14 manifest-install flow that follows render
 * the exact same card. It decides nothing — it presents the scopes and reports
 * the user's choice; the caller writes the grant.
 */
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';

/** One line of "…TO:" — a capability the app is asking to use. */
export interface ConsentScope {
  /** Stable key for React + tests (the capability id). */
  id: string;
  /** A small leading icon (e.g. a printer). */
  icon: ReactNode;
  /** The scope sentence, already localized (§12: "Print to receipt printers"). */
  text: string;
}

export interface CapabilityConsentCardProps {
  open: boolean;
  /** The app requesting access — `<app>` in §12's copy. */
  appName: string;
  scopes: readonly ConsentScope[];
  /** True while the grant write is in flight — the Allow button shows a spinner. */
  busy?: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

export function CapabilityConsentCard({
  open,
  appName,
  scopes,
  busy = false,
  onApprove,
  onCancel,
}: CapabilityConsentCardProps): ReactNode {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Radix reports a close (Escape, overlay click, the X) as `false`. A
        // consent that closes any other way than an explicit Allow is a decline,
        // which is the safe default — access is never granted by dismissal.
        if (!next && !busy) onCancel();
      }}
      size="sm"
    >
      <ModalHeader
        icon={<ShieldCheck aria-hidden />}
        tone="accent"
        title={t('capabilities.consent.title', 'Allow {app}?', { app: appName })}
        subtitle={t(
          'capabilities.consent.subtitle',
          '{app} is asking to use this computer’s hardware.',
          { app: appName },
        )}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p className="text-caption font-semibold uppercase tracking-wide text-fg-muted">
          {t('capabilities.consent.willAllow', 'This will allow {app} to:', { app: appName })}
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {scopes.map((scope) => (
            <li key={scope.id} className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5 text-accent">
                {scope.icon}
              </span>
              <span className="text-body text-fg">{scope.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-body-sm text-fg-muted">
          {t(
            'capabilities.consent.revokeNote',
            'You can revoke this at any time in Settings → Desktop. Only allow apps you trust.',
          )}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('capabilities.consent.deny', 'Not now')}
        </Button>
        <Button variant="primary" onClick={onApprove} loading={busy}>
          {t('capabilities.consent.approve', 'Allow')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
