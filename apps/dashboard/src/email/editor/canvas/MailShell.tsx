// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mail shell's fixed parts (comp 509-527, 562-581): the client chrome
 * (avatar, from name, from email, *now*), the brand banner, the footer, the
 * attachments card and the variables row. The shell itself sets `dir` to the
 * variation's locale and the `--adm-email-accent` property every block reads
 * (D15); it sits in the always-light scope because a mailbox is light.
 */
import { FileCog, FileText, Hexagon, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { emailIcon } from '../../icons.js';
import type { EmailAttachment, EmailAttachmentResolved, EmailBrand } from '../../api.js';
import { SECTION_RING, SelectButton } from './SectionSlot.js';

export interface EffectiveBrand {
  name: string;
  mark: string;
  accent: string;
  fromName: string;
  fromEmail: string;
}

/** The brand the canvas draws: the document's own, else the workspace's (the renderer's `effectiveBrand`). */
export function effectiveBrand(brand: EmailBrand | null, appName: string, accent: string): EffectiveBrand {
  return {
    name: brand?.name.trim() === '' || brand === null ? appName : brand.name,
    mark: brand?.mark ?? 'hexagon',
    accent: brand !== null && /^#[0-9a-fA-F]{6}$/.test(brand.accent) ? brand.accent : accent,
    fromName: brand?.fromName.trim() === '' || brand === null ? appName : brand.fromName,
    fromEmail: brand?.fromEmail ?? '',
  };
}

export function MarkIcon({ mark, logoUrl, className }: { mark: string; logoUrl: string | null; className?: string | undefined }) {
  if (mark === 'logo' && logoUrl !== null) return <img src={logoUrl} alt="" className={cn('object-contain', className)} />;
  const Icon = mark === 'logo' || mark === '' ? Hexagon : emailIcon(mark);
  return <Icon className={className} aria-hidden="true" />;
}

/** A selectable fixed section (branding, subject, footer, attachments). */
export function FixedSection({
  label,
  selected,
  onSelect,
  testId,
  className,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} data-selected={selected ? '' : undefined} onClick={onSelect} className={cn(SECTION_RING, 'block', className)}>
      <SelectButton label={label} onSelect={onSelect} />
      {children}
    </div>
  );
}

export function ClientChrome({ brand, logoUrl }: { brand: EffectiveBrand; logoUrl: string | null }) {
  return (
    <div className="mb-3.5 flex items-center gap-[9px] rounded-lg border border-border bg-surface px-3.5 py-[9px]">
      <div className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--adm-email-accent),color-mix(in_srgb,var(--adm-email-accent)_70%,transparent))] text-white">
        <MarkIcon mark={brand.mark} logoUrl={logoUrl} className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-bold text-fg">{brand.fromName}</div>
        <div className="truncate text-[10px] text-fg-subtle">
          {brand.fromEmail === '' ? t('email:canvas.defaultSender', 'Default sender') : brand.fromEmail}
        </div>
      </div>
      <span className="text-[10px] text-fg-subtle">{t('email:canvas.now', 'now')}</span>
    </div>
  );
}

export function BrandBanner({ brand, logoUrl }: { brand: EffectiveBrand; logoUrl: string | null }) {
  return (
    <div className="flex items-center gap-2.5 bg-[linear-gradient(120deg,var(--adm-email-accent),color-mix(in_srgb,var(--adm-email-accent)_72%,transparent))] px-6 py-[18px]">
      <div className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.22] text-white">
        <MarkIcon mark={brand.mark} logoUrl={logoUrl} className="size-[17px]" />
      </div>
      <span className="text-[15px] font-extrabold tracking-[-.01em] text-white">{brand.name}</span>
    </div>
  );
}

export function FooterText({ text }: { text: string }) {
  return (
    <div data-testid="email-footer-text" className="mt-6 whitespace-pre-wrap border-t border-[#ececef] pt-[18px] text-[11px] leading-[1.6] text-[#6b6b76]">
      {text}
    </div>
  );
}

export interface AttachmentsCardProps {
  attachments: readonly EmailAttachment[];
  resolved: readonly EmailAttachmentResolved[];
}

export function AttachmentsCard({ attachments, resolved }: AttachmentsCardProps) {
  const byId = new Map(resolved.map((entry) => [entry.id, entry]));
  return (
    <div className="mt-3.5 rounded-xl border border-[#ececef] bg-white px-3.5 py-3">
      <div className="mb-[9px] flex items-center gap-[7px]">
        <Paperclip className="size-[13px] text-[#6b6b76]" aria-hidden="true" />
        <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#6b6b76]">
          {t('email:canvas.attachments', '{count, plural, one {# attachment} other {# attachments}}', { count: attachments.length })}
        </span>
      </div>
      <div className="flex flex-wrap gap-[7px]">
        {attachments.map((attachment) => {
          const file = attachment.kind === 'file' ? byId.get(attachment.id) : undefined;
          const missing = attachment.kind === 'file' && (file === undefined || file.missing);
          const name =
            attachment.kind === 'generated'
              ? `${attachment.label} · ${attachment.token}`
              : missing
                ? t('email:canvas.fileMissing', 'File missing')
                : (file?.filename ?? attachment.fileId);
          return (
            <span
              key={attachment.id}
              data-testid="email-attachment-chip"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-bold',
                missing ? 'border-[#f5c2c7] bg-[#fde8ea] text-[#b3261e]' : 'border-[#ececef] bg-white text-[#55555f]',
              )}
            >
              {attachment.kind === 'generated' ? <FileCog className="size-[13px]" aria-hidden="true" /> : <FileText className="size-[13px]" aria-hidden="true" />}
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function VariablesRow({ vars }: { vars: readonly string[] }) {
  if (vars.length === 0) return null;
  return (
    <div data-testid="email-variables" className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('email:canvas.variables', 'Variables')}</span>
      {vars.map((name) => (
        <span key={name} className="rounded-[7px] bg-accent-soft px-[9px] py-[3px] font-mono text-[11px] font-bold text-accent">
          {`{{${name}}}`}
        </span>
      ))}
    </div>
  );
}
