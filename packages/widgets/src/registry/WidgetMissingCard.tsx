// SPDX-License-Identifier: AGPL-3.0-only
import { EmptyState, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { PackageX } from 'lucide-react';

import type { WidgetProps } from './types.js';

export interface WidgetMissingConfig {
  /** The registry id that could not be resolved. */
  missingId?: string | undefined;
  /**
   * Edit-mode action slot — the dashboard builder passes a "Remove from
   * layout" button here (M7); view mode leaves it empty.
   */
  [key: string]: unknown;
}

/**
 * Fallback card for unknown registry ids in stored page configs (04 §2.2).
 * Page configs written by older/newer versions or uninstalled manifests must
 * never crash a dashboard — this system-family card names the missing id.
 */
export function WidgetMissingCard({ config }: WidgetProps<WidgetMissingConfig>) {
  const t = useMaybeT();
  const missingId = typeof config.missingId === 'string' ? config.missingId : 'unknown';
  return (
    <EmptyState
      compact
      preset="no-data"
      icon={<PackageX />}
      tone="warn"
      title={t('ui:widgets.system.widgetMissing.title', 'Widget unavailable')}
      body={
        // Lead/tail pair around the mono-styled id — the two keys read as one
        // sentence and must be translated together.
        <>
          {t('ui:widgets.system.widgetMissing.bodyLead', 'No widget is registered as')}{' '}
          <MonoText>{missingId}</MonoText>
          {'. '}
          {t('ui:widgets.system.widgetMissing.bodyTail', 'It may belong to a newer version or an uninstalled extension.')}
        </>
      }
      data-widget-missing={missingId}
    />
  );
}

export default WidgetMissingCard;
