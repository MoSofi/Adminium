// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An update's "Shows visitors more" card: the public endpoints the new
 * version would widen for the visitors who already use them — a column a
 * shop page now reads, a method, a filter loosened — one row each, and the
 * operator's say on it.
 *
 * Unticked by default: the server refuses such an update unless it is
 * allowed (`publicWider: true`), so Update waits for the tick, and the hint
 * under it says why. Someone who may not manage API keys is told it is not
 * theirs to allow.
 */
import { Checkbox, MonoText } from '@adminium/ui';
import { Eye } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { PublicWideningRow } from './appsApi.js';

const CARD = 'rounded-[14px] border border-warn/30 bg-warn-soft p-[18px]';

/** What one endpoint would newly give, in words. */
function gainOf(row: PublicWideningRow): string {
  const parts = [
    ...(row.columns.length === 0 ? [] : [t('studio:publicWider.columns', 'shows {columns}', { columns: row.columns.join(', ') })]),
    ...(row.methods.length === 0 ? [] : [t('studio:publicWider.methods', 'takes {methods}', { methods: row.methods.join(', ') })]),
    ...(row.rows ? [t('studio:publicWider.rows', 'lets more rows through')] : []),
  ];
  return parts.length === 0 ? t('studio:publicWider.more', 'reaches more') : parts.join(' · ');
}

/** The words under Update while the card holds it; null when nothing does. */
export function publicWiderHold(rows: readonly PublicWideningRow[], allowed: boolean): string | null {
  if (rows.length === 0 || allowed) return null;
  return t('studio:publicWider.hold', 'Tick “Allow it” to let visitors see more, or keep the running version.');
}

export function PublicWiderCard({
  rows,
  checked,
  onChange,
  disabled = false,
}: {
  rows: readonly PublicWideningRow[];
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={CARD} data-testid="update-public-wider">
      <h3 className="mb-[11px] flex items-center gap-[9px]">
        <Eye aria-hidden className="size-4 text-warn" />
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{t('studio:publicWider.title', 'Shows visitors more')}</span>
      </h3>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
        {t(
          'studio:publicWider.intro',
          'This version changes {count, plural, one {a public endpoint} other {public endpoints}} that visitors already use, so they would see or do more:',
          { count: rows.length },
        )}
      </p>
      <ul className="mb-[13px] flex flex-col gap-[7px]">
        {rows.map((row) => (
          <li key={row.ref} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[1.45]" data-endpoint={row.ref}>
            <MonoText className="font-bold">{row.ref}</MonoText>
            <span className="text-fg-muted">{gainOf(row)}</span>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-start gap-[9px]">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} />
        <span className="text-[12.5px] font-bold">{t('studio:publicWider.allow', 'Allow it')}</span>
      </label>
      {disabled ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-subtle">
          {t('studio:publicWider.notYours', 'Only someone who may manage API keys can allow this.')}
        </p>
      ) : null}
    </section>
  );
}
