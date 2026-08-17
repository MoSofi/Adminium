// SPDX-License-Identifier: AGPL-3.0-only
import { MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Mail, Phone, User } from 'lucide-react';

import { BlockEmpty } from './BlockShell.js';
import { rowOf } from './block-lib.js';
import {
  blockContactConfigSchema,
  blockContactDemoData,
  blockHighlightBoxConfigSchema,
  blockHighlightBoxDemoData,
} from './blocks-config.js';
import type { BlockContactConfig, BlockHighlightBoxConfig } from './blocks-config.js';
import type { BlockContact, BlockHighlight } from './block-types.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  blockContactConfigSchema,
  blockContactDemoData,
  blockHighlightBoxConfigSchema,
  blockHighlightBoxDemoData,
};

/**
 * TRACK BUILDER — the CONTENT tail of the annex §13 document-block vocabulary:
 * `block-contact` and `block-highlight-box`.
 */

// ── block-contact ───────────────────────────────────────────────────────────

export function BlockContactWidget({ config, data }: WidgetProps<BlockContactConfig>) {
  const t = useMaybeT();
  const payload = rowOf<BlockContact>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? t('ui:widgets.domain.blockContact.emptyTitle', 'No contact')} body={config.emptyBody ?? t('ui:widgets.domain.blockContact.emptyBody', 'Contact details appear once this document names a recipient.')} />;
  }

  const rows: readonly { key: string; icon: typeof User; value: string | undefined; mono: boolean }[] = [
    { key: 'name', icon: User, value: payload.name, mono: false },
    { key: 'email', icon: Mail, value: payload.email, mono: true },
    { key: 'phone', icon: Phone, value: payload.phone, mono: true },
  ];

  return (
    <ul data-widget="block-contact" data-testid={config.testId} className="w-full space-y-1.5">
      {rows
        .filter((row) => row.value !== undefined && row.value !== '')
        .map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.key} data-part={`contact-${row.key}`} className="flex items-center gap-2.5 text-body-sm">
              <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              {row.mono ? (
                <MonoText className="min-w-0 truncate text-fg">{row.value}</MonoText>
              ) : (
                <span className="min-w-0 truncate font-bold text-fg">{row.value}</span>
              )}
            </li>
          );
        })}
    </ul>
  );
}

// ── block-highlight-box ─────────────────────────────────────────────────────

export function BlockHighlightBoxWidget({ config, data }: WidgetProps<BlockHighlightBoxConfig>) {
  const t = useMaybeT();
  const payload = rowOf<BlockHighlight>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? t('ui:widgets.domain.blockHighlightBox.emptyTitle', 'Nothing highlighted')} body={config.emptyBody ?? t('ui:widgets.domain.blockHighlightBox.emptyBody', 'A highlighted figure appears once this block is bound.')} />;
  }

  return (
    // The annex's "gray callout, label + large mono value ("Amount charged /
    // $290.00")" — centered, because it is the one figure an email surface wants
    // the reader to land on.
    <div
      data-widget="block-highlight-box"
      data-testid={config.testId}
      className="w-full rounded-md bg-surface-2 px-4 py-3 text-center"
    >
      <p className="text-caption text-fg-subtle">{payload.label}</p>
      <MonoText className="mt-0.5 block text-title font-bold text-fg">{payload.value}</MonoText>
    </div>
  );
}
