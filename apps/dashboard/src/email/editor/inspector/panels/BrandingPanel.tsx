// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Branding panel (comp 627-648, Appendix A §E3): brand name, the logo
 * mark grid (twelve marks + *Your logo* when the workspace has one, D6),
 * from name, from email — a Combobox over the configured senders, never
 * free text (D7) — brand colour swatches, category, the status pills (D13:
 * a template's toggle `enabled`; a campaign's are display-only) and the
 * language variations rows (D3).
 */
import { Box, Circle, Command, Flame, Gem, Heart, Hexagon, Leaf, Square, Star, Triangle, Zap, type LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Combobox, FormField, Input, cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { EmailCategory, EmailDocumentKind } from '../../../api.js';
import { categoryLabel, statusLabel, type DocumentStatus } from '../../../manager/model.js';
import type { LanguageRow } from '../../LanguageMenu.js';
import type { EffectiveBrand } from '../../canvas/MailShell.js';
import { Divider, OptionButton, PanelLabel, Swatch } from '../parts.js';

/** The comp's twelve marks (1559) — the server's `EMAIL_MARKS` in the same order. */
export const MARKS: readonly { name: string; Icon: LucideIcon }[] = [
  { name: 'hexagon', Icon: Hexagon },
  { name: 'circle', Icon: Circle },
  { name: 'square', Icon: Square },
  { name: 'triangle', Icon: Triangle },
  { name: 'gem', Icon: Gem },
  { name: 'zap', Icon: Zap },
  { name: 'flame', Icon: Flame },
  { name: 'leaf', Icon: Leaf },
  { name: 'star', Icon: Star },
  { name: 'heart', Icon: Heart },
  { name: 'command', Icon: Command },
  { name: 'box', Icon: Box },
];

/** The comp's swatches (1558). */
export const SWATCHES = ['#4f46e5', '#0d9488', '#e5484d', '#ea580c', '#111111'] as const;

export interface SenderOption {
  name: string;
  address: string;
}

export interface BrandingPanelProps {
  brand: EffectiveBrand;
  /** What the document stores — `null` until the operator touches a brand field. */
  storedAccent: string | null;
  logoUrl: string | null;
  senders: readonly SenderOption[];
  kind: EmailDocumentKind;
  category: EmailCategory;
  enabled: boolean;
  /** A campaign's derived status (display-only pills, D13). */
  campaignStatus: DocumentStatus;
  languages: readonly LanguageRow[];
  topicLabel: string;
  onBrand: (patch: Partial<EffectiveBrand>) => void;
  onFocus: () => void;
  onCategory: (category: EmailCategory) => void;
  onEnabled: (enabled: boolean) => void;
  onOpenLanguage: (id: string) => void;
  onAddLanguage: (locale: string) => void;
}

export function BrandingPanel({
  brand,
  storedAccent,
  logoUrl,
  senders,
  kind,
  category,
  enabled,
  campaignStatus,
  languages,
  topicLabel,
  onBrand,
  onFocus,
  onCategory,
  onEnabled,
  onOpenLanguage,
  onAddLanguage,
}: BrandingPanelProps) {
  const senderOptions = senders.map((sender) => ({ value: sender.address, label: sender.address, description: sender.name }));
  const fromEmail = brand.fromEmail;
  const unknownSender = fromEmail !== '' && !senders.some((sender) => sender.address.toLowerCase() === fromEmail.toLowerCase());
  const accent = storedAccent ?? '';
  const customAccent = accent !== '' && !(SWATCHES as readonly string[]).includes(accent.toLowerCase()) ? accent : null;

  return (
    <div data-testid="email-branding-panel" className="flex flex-col gap-4">
      <FormField label={t('email:branding.brandName', 'Brand name')}>
        <Input data-testid="email-brand-name" value={brand.name} onFocus={onFocus} onChange={(event) => onBrand({ name: event.target.value })} className="font-bold" />
      </FormField>
      <div>
        <PanelLabel className="mb-2" id="email-brand-mark-label">
          {t('email:branding.logoMark', 'Logo mark')}
        </PanelLabel>
        <div className="grid grid-cols-6 gap-1.5" role="group" aria-labelledby="email-brand-mark-label">
          {MARKS.map(({ name, Icon }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={brand.mark === name}
              data-testid="email-brand-mark"
              data-mark={name}
              onClick={() => onBrand({ mark: name })}
              className={cn(
                'flex h-9 items-center justify-center rounded-[9px] border transition-colors',
                brand.mark === name ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
          {logoUrl === null ? null : (
            <button
              type="button"
              aria-label={t('email:branding.yourLogo', 'Your logo')}
              aria-pressed={brand.mark === 'logo'}
              data-testid="email-brand-mark"
              data-mark="logo"
              onClick={() => onBrand({ mark: 'logo' })}
              className={cn(
                'flex h-9 items-center justify-center rounded-[9px] border p-1.5 transition-colors',
                brand.mark === 'logo' ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2 hover:border-border-strong',
              )}
            >
              <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
            </button>
          )}
        </div>
      </div>
      <FormField label={t('email:branding.fromName', 'From name')}>
        <Input data-testid="email-from-name" value={brand.fromName} onFocus={onFocus} onChange={(event) => onBrand({ fromName: event.target.value })} />
      </FormField>
      <FormField
        label={t('email:branding.fromEmail', 'From email')}
        error={
          unknownSender ? (
            <span data-testid="email-from-email-hint">
              {t('email:branding.notConfigured', 'Not a configured sender.')}{' '}
              <Link to="/studio/settings" hash="email" className="underline">
                {t('email:branding.manageSenders', 'Manage senders')}
              </Link>
            </span>
          ) : undefined
        }
        helper={senders.length === 0 ? t('email:branding.noSenders', 'No senders configured yet — the default sender is used.') : undefined}
      >
        <Combobox
          data-testid="email-from-email"
          mono
          options={unknownSender ? [{ value: fromEmail, label: fromEmail, description: t('email:branding.notConfigured', 'Not a configured sender.'), disabled: true }, ...senderOptions] : senderOptions}
          value={fromEmail === '' ? null : fromEmail}
          onValueChange={(value) => onBrand({ fromEmail: value ?? '' })}
          placeholder={t('email:branding.defaultSenderOption', 'Default sender')}
          emptyText={t('email:branding.noMatch', 'No sender matches')}
          disabled={senders.length === 0 && !unknownSender}
        />
      </FormField>
      <Divider />
      <div>
        <PanelLabel className="mb-2" id="email-brand-colour-label">
          {t('email:branding.brandColour', 'Brand colour')}
        </PanelLabel>
        <div className="flex gap-[9px]" role="group" aria-labelledby="email-brand-colour-label">
          {SWATCHES.map((hex) => (
            <Swatch
              key={hex}
              on={accent.toLowerCase() === hex}
              label={hex}
              onClick={() => onBrand({ accent: hex })}
              className="bg-[var(--adm-swatch)]"
              swatch={hex}
              testId="email-brand-swatch"
              value={hex}
            />
          ))}
          {customAccent === null ? null : (
            <Swatch on label={customAccent} onClick={() => {}} className="bg-[var(--adm-swatch)]" swatch={customAccent} testId="email-brand-swatch" value={customAccent} />
          )}
        </div>
      </div>
      <div>
        <PanelLabel className="mb-2" id="email-category-label">
          {t('email:branding.category', 'Category')}
        </PanelLabel>
        <div className="flex gap-1.5" role="group" aria-labelledby="email-category-label">
          {(['transactional', 'lifecycle', 'marketing'] as const).map((value) => (
            <OptionButton key={value} on={category === value} label={categoryLabel(value)} onClick={() => onCategory(value)} testId="email-category" value={value} />
          ))}
        </div>
      </div>
      <div>
        <PanelLabel className="mb-2" id="email-status-label">
          {t('email:branding.status', 'Status')}
        </PanelLabel>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="email-status-label">
          {kind === 'template' ? (
            <>
              <StatusPillButton on={!enabled} status="draft" onClick={() => onEnabled(false)} />
              <StatusPillButton on={enabled} status="live" onClick={() => onEnabled(true)} />
            </>
          ) : (
            (['draft', 'scheduled', 'sent'] as const).map((status) => <StatusPillButton key={status} on={campaignStatus === status} status={status} />)
          )}
        </div>
      </div>
      <Divider />
      <div>
        <PanelLabel className="mb-2">{t('email:branding.languageVariations', 'Language variations')}</PanelLabel>
        <div className="flex flex-col gap-[5px]">
          {languages.map((row) => {
            const isCurrent = row.status === 'current';
            const exists = row.id !== null;
            return (
              <button
                key={row.locale}
                type="button"
                data-testid="email-branding-language"
                data-locale={row.locale}
                onClick={() => {
                  if (isCurrent) return;
                  if (row.id !== null) onOpenLanguage(row.id);
                  else onAddLanguage(row.locale);
                }}
                className={cn(
                  'flex w-full items-center gap-[9px] rounded-[9px] border px-[9px] py-2 text-start text-fg transition-colors',
                  isCurrent ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2 hover:border-border-strong',
                )}
              >
                <span
                  className={cn(
                    'inline-flex min-w-8 shrink-0 items-center justify-center rounded-md border px-1.5 py-[3px] text-[10px] font-extrabold tracking-[.04em]',
                    isCurrent ? 'border-transparent bg-accent text-accent-fg' : exists ? 'border-transparent bg-surface-3 text-fg-muted' : 'border-dashed border-border-strong text-fg-muted',
                  )}
                >
                  {row.code}
                </span>
                <span className="min-w-0 flex-1 text-[12px] font-bold">{row.native}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-[20px] px-2 py-0.5 text-[10px] font-extrabold',
                    isCurrent ? 'bg-accent text-accent-fg' : exists ? 'bg-surface-3 text-fg-muted' : 'bg-pos-soft text-pos',
                  )}
                >
                  {isCurrent ? t('email:branding.tagCurrent', 'Current') : exists ? t('email:branding.tagEdit', 'Edit') : t('email:branding.tagAdd', 'Add')}
                </span>
              </button>
            );
          })}
        </div>
        <span className="mt-2 block text-[10.5px] leading-[1.5] text-fg-subtle">
          {t('email:branding.languageHint', 'Adding a language creates a linked copy. Variations stay grouped under {topic}.', { topic: topicLabel })}
        </span>
      </div>
    </div>
  );
}

const STATUS_PILL: Record<DocumentStatus, string> = {
  draft: 'bg-surface-3 text-fg-muted',
  live: 'bg-pos-soft text-pos',
  scheduled: 'bg-warn-soft text-warn',
  sending: 'bg-accent-soft text-accent',
  sent: 'bg-accent-soft text-accent',
  failed: 'bg-danger-soft text-danger',
};

/** The comp's status pill (1562): `onClick` only for a template's Draft/Live (D13). */
function StatusPillButton({ on, status, onClick }: { on: boolean; status: DocumentStatus; onClick?: (() => void) | undefined }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={onClick === undefined ? true : undefined}
      data-testid="email-status-pill"
      data-status={status}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-[7px] text-[11.5px] font-bold transition-colors',
        on ? cn('border-transparent', STATUS_PILL[status]) : 'border-border bg-surface-2 text-fg-muted',
        onClick === undefined && 'cursor-default',
      )}
    >
      {statusLabel(status)}
    </button>
  );
}
