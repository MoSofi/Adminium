// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The draft, with the three ways of looking at it.
 *
 * PREVIEW IS THE HOST'S OWN RENDERER. Not a second one built here — the same
 * component the page's editor draws the document with, read-only. A preview
 * written in this file would be a second renderer to keep in step, and it
 * would be wrong the first time either one changed. The record preview is the
 * exception: a draft invoice has no sheet until it is a document.
 *
 * DIFF IS COMPUTED, DETAILS ARE MEASURED. Neither is the model's account of
 * itself. Between them they answer the two questions worth asking before
 * saving anything: what does this change, and where did it come from?
 *
 * Each tab has a `TabsContent`, including the active one. A tray of triggers
 * with no panel behind them is a switch wearing a tablist's clothes, and axe
 * says so.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@adminium/ui';
import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import type { AssistantResult } from '../api.js';
import { DetailsView } from './DetailsView.js';
import { DiffView } from './DiffView.js';

export interface ResultCardProps {
  result: AssistantResult;
  /** The page's own read-only sheet, or the record preview for a draft invoice. */
  preview: ReactNode;
  /** What the draft would create, for the no-base diff sentence. */
  kind: string;
  tokensIn: number;
  tokensOut: number;
  /** The result card's footer — the fixed actions for this page. */
  footer: ReactNode;
  /**
   * Draw the row "What I left out, and why" even when nothing was left out
   * (it then says "Nothing."): on a page where a draft that quietly does less
   * than was asked would be taken for one that does all of it. Elsewhere the
   * row is there only when the draft names something.
   */
  alwaysLeftOut?: boolean | undefined;
  /** Under that row: what would give the part left out (an add-on's card). */
  under?: ReactNode;
  /** Beside the title: what will become of the draft ("Will be saved switched off"). */
  badge?: ReactNode;
  /** One line above the actions: what pressing one does and does not do ("Nothing is saved until you save the rule."). */
  note?: string | undefined;
}

export function ResultCard({ result, preview, kind, tokensIn, tokensOut, footer, alwaysLeftOut, under, badge, note }: ResultCardProps) {
  return (
    <div data-testid="assistant-result" className="min-w-0 flex-1 overflow-hidden rounded-[16px] border border-border bg-surface shadow-menu">
      <Tabs variant="pill" defaultValue="preview" className="gap-0">
        <div className="flex items-center gap-3 border-b border-border px-4 py-[13px]">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-extrabold tracking-[-0.01em] text-fg">{result.title}</div>
            {result.meta === '' ? null : (
              <div className="mt-0.5 truncate text-caption text-fg-muted">{result.meta}</div>
            )}
            {badge === undefined || badge === null ? null : <div className="mt-1.5">{badge}</div>}
          </div>
          <TabsList className="shrink-0 border border-border">
            <TabsTrigger data-testid="assistant-tab" data-tab="preview" value="preview">{t('assistant:tabs.preview', 'Preview')}</TabsTrigger>
            <TabsTrigger data-testid="assistant-tab" data-tab="diff" value="diff">{t('assistant:tabs.diff', 'Diff')}</TabsTrigger>
            <TabsTrigger data-testid="assistant-tab" data-tab="details" value="details">{t('assistant:tabs.details', 'Details')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="preview" className={cn('outline-none')}>
          {preview}
          {result.warning === null ? null : <Warning text={result.warning} />}
        </TabsContent>
        <TabsContent value="diff" className="outline-none">
          <DiffView diff={result.diff} kind={kind} />
        </TabsContent>
        <TabsContent value="details" className="outline-none">
          <DetailsView result={result} tokensIn={tokensIn} tokensOut={tokensOut} />
        </TabsContent>
      </Tabs>
      {alwaysLeftOut === true || result.leftOut.length > 0 ? <LeftOut items={result.leftOut} /> : null}
      {under === undefined || under === null ? null : <div className="flex flex-col gap-2 px-4 pb-3.5 ps-[42px]">{under}</div>}
      {note === undefined ? null : (
        <p data-testid="assistant-result-note" className="border-t border-border px-4 py-2.5 text-caption leading-[1.5] text-fg-muted">
          {note}
        </p>
      )}
      {footer}
    </div>
  );
}

/**
 * "What I left out, and why" (comp `Milo Automations` 01, 02): the parts of
 * the request the draft does not do, in the assistant's own words. A row of
 * the card, not a line of the answer: it stays under the preview while the
 * answer above scrolls away.
 */
function LeftOut({ items }: { items: readonly { what: string; why: string }[] }) {
  return (
    <div data-testid="assistant-left-out" className="border-t border-border px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12.5px] font-extrabold text-fg">
        <Info className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
        {t('assistant:leftOut.title', 'What I left out, and why')}
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 ps-[22px] text-caption leading-[1.55] text-fg-muted">{t('assistant:leftOut.nothing', 'Nothing.')}</p>
      ) : (
        <ul className="mt-1.5 flex list-none flex-col gap-1 p-0 ps-[22px]">
          {items.map((item, index) => (
            <li key={index} className="text-caption leading-[1.55] text-pretty text-fg-muted">
              <span className="font-bold text-fg">{item.what}</span>
              {item.why === '' ? null : <> {item.why}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The warn strip under a preview — the model's caveat, or a turn that failed. */
export function Warning({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="mx-[18px] mb-4 flex items-start gap-[9px] rounded-[11px] bg-warn-soft px-[13px] py-[11px]">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="text-caption leading-[1.55] text-pretty text-fg-muted">{text}</span>
      {action === undefined ? null : <span className="ms-auto shrink-0">{action}</span>}
    </div>
  );
}
