// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page error card (`pages/PageRenderer.tsx` has the same one), for use
 * inside a project page, which already sits in the page gutter. Kept here so
 * the renderer every page loads stays as small as it was.
 */

import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader, IconTile, MonoText } from '@adminium/ui';

import { t } from '../i18n/t.js';

export function ProjectMessageCard({
  icon,
  title,
  body,
  detail,
  onRetry,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  detail?: string | undefined;
  onRetry?: (() => void) | undefined;
}): ReactNode {
  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="warn" size="md" icon={icon} />
        <h2 className="min-w-0 truncate text-section text-fg">{title}</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="whitespace-pre-line text-body-sm text-fg-muted">{body}</p>
        {detail === undefined ? null : <MonoText className="text-caption text-fg-subtle">{detail}</MonoText>}
        {onRetry === undefined ? null : (
          <button type="button" className="text-body-sm font-bold text-accent hover:underline" onClick={onRetry}>
            {t('common.retry', 'Retry')}
          </button>
        )}
      </CardBody>
    </Card>
  );
}
