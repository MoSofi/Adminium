// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The modal's header: who this is, which page it was opened on, what it can
 * read, and what it has cost so far.
 *
 * The two chips are the honesty of the whole surface. The scope chip says
 * what this session may read — not what the product could read, what THIS
 * session may — and the token chip says what it has spent. Both are titled,
 * because a number with no unit beside it is a number nobody can check.
 *
 * DEP: the comp puts the chips on the header's right edge, level with the
 * name. `ModalHeader` has no slot between its title column and the close
 * button, and the dashboard may not reach Radix to compose its own dialog
 * title — so they sit at the end of the title column instead, right-aligned.
 * Everything else in this row is the comp's.
 */
import { ModalHeader, Tag, cn } from '@adminium/ui';
import { Database, Gauge, Sparkles } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { assistantIcon } from '../icons.js';

export interface HeaderProps {
  name: string;
  /** The page pill: what this page is called and its glyph. */
  page: string;
  pageIcon: string;
  /** One line on what it knows about this page. */
  blurb: string;
  /** What it may read, already worded by the caller. */
  scope: string;
  tokens: number;
}

export function Header({ name, page, pageIcon, blurb, scope, tokens }: HeaderProps) {
  const PageIcon = assistantIcon(pageIcon);
  return (
    <ModalHeader
      className="items-center gap-3 border-b border-border px-[18px] py-[15px]"
      // The comp's tile is a SOLID accent square with a white glyph; the
      // primitive builds its own tile from the `accent` tone, which is the
      // soft wash this app uses in every other modal header. Same glyph, same
      // slot, the house treatment — part of the header departure below.
      icon={<Sparkles aria-hidden="true" />}
      closeLabel={t('assistant:close', 'Close')}
      title={
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-extrabold tracking-[-0.015em]">{name}</span>
          <Tag className="gap-[5px] rounded-[20px] px-2 py-[2px] text-[10.5px]">
            {PageIcon === null ? null : <PageIcon className="size-[11px]" aria-hidden="true" />}
            {page}
          </Tag>
        </span>
      }
      subtitle={<span className="block truncate text-caption text-fg-muted">{blurb}</span>}
    >
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        <span
          title={t('assistant:scope.title', 'Data this session can read')}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[20px] border border-border bg-surface-2',
            'px-2.5 py-1.5 text-[11px] font-bold text-fg-muted',
          )}
        >
          <Database className="size-3" aria-hidden="true" />
          {scope}
        </span>
        <span
          title={t('assistant:tokens.title', 'Tokens used this session')}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[20px] bg-accent-soft px-2.5 py-1.5',
            'font-mono text-[11px] font-bold text-accent',
          )}
        >
          <Gauge className="size-3" aria-hidden="true" />
          {t('assistant:tokens.value', '{n} tokens', { n: tokens })}
        </span>
      </div>
    </ModalHeader>
  );
}
