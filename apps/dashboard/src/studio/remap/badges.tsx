/**
 * SchemaBadges vocabulary (research/ia-mapping.md §4, UI Kit schema
 * explorer): PK accent · FK info · UNIQUE neutral · PII warn (+ Masked warn),
 * with the mono type chip alongside. Tints always derive from tones.
 */
import { Badge, Tag } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EffectiveColumn } from './model.js';

export function TypeChip({ type }: { type: string }) {
  return <Tag mono>{type}</Tag>;
}

export function SchemaBadges({ column }: { column: EffectiveColumn }) {
  const pii = column.semantics?.flags.pii ?? null;
  const masked = column.masked ?? column.semantics?.flags.maskedByDefault === true;
  return (
    <span className="inline-flex items-center gap-1">
      {column.isPrimaryKey ? <Badge tone="accent">{t('studio.remap.badge.pk', 'PK')}</Badge> : null}
      {column.references !== null ? <Badge tone="info">{t('studio.remap.badge.fk', 'FK')}</Badge> : null}
      {column.isUnique && !column.isPrimaryKey ? (
        <Badge tone="neutral">{t('studio.remap.badge.unique', 'UNIQUE')}</Badge>
      ) : null}
      {pii !== null ? <Badge tone="warn">{t('studio.remap.badge.pii', 'PII')}</Badge> : null}
      {masked ? (
        <Badge tone="warn" dot>
          {t('studio.remap.badge.masked', 'Masked')}
        </Badge>
      ) : null}
    </span>
  );
}
