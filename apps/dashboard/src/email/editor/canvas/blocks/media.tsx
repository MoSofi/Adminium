// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cta, Divider (+ the legacy spacer), Image, Social and Html previews (comp
 * 536-550). An image with a real URL, or a library file the resolver found
 * and can show, renders as the picture; otherwise the comp's dashed
 * placeholder — with the file's chip when a `fileId` is set but has no
 * preview (a non-image file, or a file the library no longer has, D8/D9).
 */
import { Image as ImageIcon, Paperclip } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { emailIcon } from '../../../icons.js';
import { num, rows, str } from '../styles.js';
import type { BlockPreviewProps } from './types.js';

export function CtaPreview({ block }: BlockPreviewProps) {
  return (
    <span className="inline-block rounded-[10px] bg-[var(--adm-email-accent)] px-6 py-3 text-[13.5px] font-bold text-white">
      {str(block.data['label'])}
    </span>
  );
}

export function DividerPreview({ block }: BlockPreviewProps) {
  const line = block.data['line'] !== false;
  return (
    <div
      aria-hidden="true"
      className={cn('h-[var(--adm-email-gap)]', line && 'border-t border-[#ececef]')}
      style={{ '--adm-email-gap': `${String(num(block.data['height'], 24))}px` }}
    />
  );
}

export function SpacerPreview({ block }: BlockPreviewProps) {
  return <div aria-hidden="true" className="h-[var(--adm-email-gap)]" style={{ '--adm-email-gap': `${String(num(block.data['size'], 16))}px` }} />;
}

const REAL_URL = /^(https?:|blob:|data:)/i;

export function ImagePreview({ block, files }: BlockPreviewProps) {
  const url = str(block.data['url']).trim();
  const fileId = str(block.data['fileId']);
  const height = num(block.data['height'], 160);
  const alt = str(block.data['alt']);
  const label = alt === '' ? t('email:canvas.imagePlaceholder', 'Image placeholder') : alt;
  const file = fileId === '' ? undefined : files.get(fileId);
  const src = REAL_URL.test(url) ? url : file !== undefined && file !== null && file.mime.startsWith('image/') ? file.contentPath : null;

  if (src !== null) {
    return (
      <img
        src={src}
        alt={alt}
        className="block h-[var(--adm-email-gap)] w-full rounded-[10px] object-cover"
        style={{ '--adm-email-gap': `${String(height)}px` }}
      />
    );
  }
  const chip =
    fileId === ''
      ? null
      : file === null
        ? t('email:canvas.fileMissing', 'File missing')
        : file === undefined
          ? fileId
          : file.filename;
  return (
    <div
      data-testid="email-image-placeholder"
      className="flex h-[var(--adm-email-gap)] flex-col items-center justify-center gap-[7px] rounded-[10px] border-[1.5px] border-dashed border-[#e2e2e8] bg-[#fafafa] text-[#6b6b76]"
      style={{ '--adm-email-gap': `${String(height)}px` }}
    >
      <ImageIcon className="size-[22px] opacity-50" aria-hidden="true" />
      <span className="text-[11px] font-bold">{label}</span>
      {chip === null ? null : (
        <span
          data-testid="email-image-file-chip"
          className={cn(
            'mt-0.5 inline-flex items-center gap-[5px] rounded-[20px] px-[9px] py-[3px] text-[10px] font-bold',
            file === null ? 'bg-[#fde8ea] text-[#b3261e]' : 'bg-[#f1f1f4] text-[#6b6b76]',
          )}
        >
          <Paperclip className="size-[11px]" aria-hidden="true" />
          {chip}
        </span>
      )}
    </div>
  );
}

export function SocialPreview({ block }: BlockPreviewProps) {
  const links = rows<{ label?: unknown; icon?: unknown; url?: unknown }>(block.data['links']);
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link, index) => {
        const Icon = emailIcon(str(link.icon) === '' ? 'globe' : str(link.icon));
        return (
          <span key={index} className="inline-flex items-center gap-1.5 rounded-[20px] border border-[#ececef] px-[11px] py-1.5 text-[11.5px] font-bold text-[#55555f]">
            <Icon className="size-3.5" aria-hidden="true" />
            {str(link.label)}
          </span>
        );
      })}
    </div>
  );
}

export function HtmlPreview({ block }: BlockPreviewProps) {
  return (
    <>
      <div className="whitespace-pre-wrap rounded-[9px] border border-[#ececef] bg-[#f6f6f8] px-3 py-[11px] text-start font-mono text-[11px] text-[#55555f] [overflow-wrap:anywhere]">
        {str(block.data['code'])}
      </div>
      <div className="mt-1.5 text-[10px] text-[#6b6b76]">{t('email:canvas.htmlNote', 'Rendered as raw HTML when the email is sent.')}</div>
    </>
  );
}
