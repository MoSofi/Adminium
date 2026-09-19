// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text families (comp 534-545): Heading — the one block edited on the
 * canvas, an auto-growing textarea; Body — paragraphs; Twocol; List; Quote;
 * TitledText (PO terms, refund policy, legal fine print); the legacy Footer
 * block. Colours are the comp's always-light literals.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@adminium/ui';

import { KICKER, str, strings } from '../styles.js';
import type { BlockPreviewProps } from './types.js';

function grow(el: HTMLTextAreaElement | null): void {
  if (el === null) return;
  el.style.height = 'auto';
  el.style.height = `${String(el.scrollHeight)}px`;
}

export function HeadingPreview({ block, label, onHeadingChange, onHeadingFocus }: BlockPreviewProps) {
  const text = str(block.data['text']);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    grow(ref.current);
  }, [text]);
  // With no way to change it there is nothing for a text box to do, and a
  // read-only one is still a focus stop a preview has no use for.
  if (onHeadingChange === undefined) {
    return (
      <div aria-label={label} className="block w-full text-[1.42em] font-extrabold leading-[1.3] tracking-[-.01em] text-inherit">
        {text}
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      aria-label={label}
      data-testid="email-heading-input"
      rows={Math.max(1, Math.ceil((text.length + 1) / 26))}
      value={text}
      onFocus={onHeadingFocus}
      onChange={(event) => {
        grow(event.target);
        onHeadingChange(event.target.value);
      }}
      onClick={(event) => event.stopPropagation()}
      className="block w-full resize-none overflow-hidden bg-transparent text-[1.42em] font-extrabold leading-[1.3] tracking-[-.01em] text-inherit outline-none focus:rounded-[5px] focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--adm-email-accent)_14%,transparent)]"
    />
  );
}

export function BodyPreview({ block }: BlockPreviewProps) {
  const paras = Array.isArray(block.data['paras']) ? strings(block.data['paras']) : [str(block.data['text'])];
  return (
    <>
      {paras.map((para, index) => (
        <div key={index} className={cn('whitespace-pre-wrap leading-[1.65]', index > 0 && 'mt-3')}>
          {para}
        </div>
      ))}
    </>
  );
}

export function TwoColPreview({ block }: BlockPreviewProps) {
  return (
    <div className="grid grid-cols-2 gap-[18px]">
      <div className="whitespace-pre-wrap text-[1em] leading-[1.65]">{str(block.data['a'])}</div>
      <div className="whitespace-pre-wrap text-[1em] leading-[1.65]">{str(block.data['b'])}</div>
    </div>
  );
}

export function ListPreview({ block }: BlockPreviewProps) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
      {strings(block.data['items']).map((item, index) => (
        <li key={index} className="flex items-start gap-[9px]">
          <span className="mt-[.6em] size-[5px] shrink-0 rounded-full bg-[var(--adm-email-accent)]" aria-hidden="true" />
          <span className="text-[1em] leading-[1.6]">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function QuotePreview({ block }: BlockPreviewProps) {
  return (
    <>
      <div className="border-s-[3px] border-[var(--adm-email-accent)] ps-3.5 text-[1.05em] italic leading-[1.6]">{str(block.data['text'])}</div>
      <div className="mt-2 ps-[17px] text-[.82em] font-bold text-[#6b6b76]">{str(block.data['author'])}</div>
    </>
  );
}

export function TitledTextPreview({ block, def }: BlockPreviewProps) {
  const kicker = str(block.data['kicker']);
  return (
    <>
      {kicker === '' ? null : <div className={cn(KICKER, 'mb-2')}>{kicker}</div>}
      <div className={cn('whitespace-pre-wrap leading-[1.65]', def.fine ? 'text-[.76em] text-[#6b6b76]' : 'text-[.9em]')}>
        {str(block.data['text'])}
      </div>
    </>
  );
}

export function FooterBlockPreview({ block }: BlockPreviewProps) {
  return <div className="whitespace-pre-wrap text-[11px] leading-[1.6] text-[#6b6b76]">{str(block.data['text'])}</div>;
}
