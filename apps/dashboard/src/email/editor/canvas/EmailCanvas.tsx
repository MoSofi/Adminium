// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The canvas (comp 498-586, Appendix A §E2): the live-preview row with the
 * device segment, the paper, and the mail shell — client chrome, subject and
 * preheader inputs, the body card with the brand banner, the block slots,
 * *Add section*, the footer — then the attachments card and the variables
 * row. Everything visible is a section the inspector edits; only the
 * subject, the preheader and headings are typed here (comp 518-521, 534).
 *
 * The shell is `dir`ed by the variation's locale while the page stays as it
 * is, sits in the always-light scope (a mailbox is light), and carries the
 * accent as `--adm-email-accent` for every block below it (D15).
 *
 * READ-ONLY renders the same sheet with nothing on it to operate: no device
 * segment, no selection rings, no inline inputs, no insert pills and no *Add
 * section*. It exists so a preview somewhere else in the product is drawn by
 * THIS component rather than by a second renderer that would be wrong the
 * first time either one changed — which is also why every editing prop
 * becomes optional rather than being faked by the caller.
 */
import { Monitor, Plus, Smartphone } from 'lucide-react';
import { SegmentedControl, cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { FileDto } from '../../../files/api.js';
import type { EmailAttachmentResolved, EmailBlockRecord, EmailDocument } from '../../api.js';
import { blockLabel } from '../blockText.js';
import { blockDef } from './blocks/index.js';
import { AttachmentsCard, BrandBanner, ClientChrome, FixedSection, FooterText, VariablesRow, effectiveBrand } from './MailShell.js';
import { SectionSlot } from './SectionSlot.js';

export type CanvasDevice = 'desktop' | 'mobile';

export type CanvasSelection = { kind: 'branding' } | { kind: 'subject' } | { kind: 'footer' } | { kind: 'attach' } | { kind: 'block'; id: string };

export interface EmailCanvasProps {
  document: EmailDocument;
  dir: 'ltr' | 'rtl';
  vars: readonly string[];
  attachmentsResolved: readonly EmailAttachmentResolved[];
  appName: string;
  /** The workspace accent, used when the document has no brand of its own. */
  accent: string;
  logoUrl: string | null;
  files: ReadonlyMap<string, FileDto | null>;
  /** Draw the sheet and nothing to operate it with. Every prop below is then unused. */
  readOnly?: boolean | undefined;
  selection?: CanvasSelection | undefined;
  device?: CanvasDevice | undefined;
  onSelect?: ((selection: CanvasSelection) => void) | undefined;
  onDeviceChange?: ((device: CanvasDevice) => void) | undefined;
  onSubjectFocus?: (() => void) | undefined;
  onSubjectChange?: ((value: string) => void) | undefined;
  onPreheaderFocus?: (() => void) | undefined;
  onPreheaderChange?: ((value: string) => void) | undefined;
  onHeadingFocus?: ((id: string) => void) | undefined;
  onHeadingChange?: ((id: string, text: string) => void) | undefined;
  /** Opens the picker for an insert at `index` (`blocks.length` = the end). */
  onInsertAt?: ((index: number) => void) | undefined;
}

const INLINE_INPUT = 'w-full bg-transparent px-0.5 py-0.5 outline-none focus:rounded-[5px] focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--adm-email-accent)_14%,transparent)]';

/** The same box read-only: a div, not a disabled input, so nothing is focusable. */
const INLINE_TEXT = 'w-full px-0.5 py-0.5 empty:min-h-[1em]';

export function EmailCanvas({
  document,
  dir,
  vars,
  attachmentsResolved,
  appName,
  accent,
  logoUrl,
  files,
  readOnly,
  selection,
  device,
  onSelect,
  onDeviceChange,
  onSubjectFocus,
  onSubjectChange,
  onPreheaderFocus,
  onPreheaderChange,
  onHeadingFocus,
  onHeadingChange,
  onInsertAt,
}: EmailCanvasProps) {
  const brand = effectiveBrand(document.brand, appName, accent);
  // Nothing is selected in a preview, and nothing can be: the ring is the
  // affordance for an inspector that is not on screen.
  const isSelected = (kind: CanvasSelection['kind']) => readOnly !== true && selection?.kind === kind;
  const width = device ?? 'desktop';
  const blocks: readonly EmailBlockRecord[] = document.blocks;

  return (
    <div className="mx-auto max-w-email">
      {readOnly === true ? null : (
        <div className="mb-4 flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[12px] text-fg-subtle">
            {t('email:canvas.livePreview', 'Live preview · click any part of the email to edit it')}
          </div>
          <SegmentedControl
            aria-label={t('email:canvas.device', 'Preview width')}
            data-testid="email-device"
            value={width}
            onValueChange={(value) => onDeviceChange?.(value === 'mobile' ? 'mobile' : 'desktop')}
            options={[
              { value: 'desktop', ariaLabel: t('email:canvas.desktop', 'Desktop'), icon: <Monitor aria-hidden="true" /> },
              { value: 'mobile', ariaLabel: t('email:canvas.mobile', 'Mobile'), icon: <Smartphone aria-hidden="true" /> },
            ]}
          />
        </div>
      )}

      <div className="adm-always-light flex justify-center rounded-2xl border border-border bg-surface-2 p-[26px] shadow-card">
        <div
          dir={dir}
          data-testid="email-mail-shell"
          data-device={width}
          className={cn('adm-always-light w-full transition-[max-width] duration-300', width === 'mobile' ? 'max-w-[380px]' : 'max-w-[600px]')}
          style={{ '--adm-email-accent': brand.accent }}
        >
          <FixedSection
            label={t('email:canvas.sections.branding', 'Brand & sender')}
            selected={isSelected('branding')}
            readOnly={readOnly}
            onSelect={() => onSelect?.({ kind: 'branding' })}
            testId="email-section-chrome"
          >
            <ClientChrome brand={brand} logoUrl={logoUrl} />
          </FixedSection>
          <FixedSection
            label={t('email:canvas.sections.subject', 'Subject & preheader')}
            selected={isSelected('subject')}
            readOnly={readOnly}
            onSelect={() => onSelect?.({ kind: 'subject' })}
            testId="email-section-subject"
          >
            {readOnly === true ? (
              <>
                <div className={cn(INLINE_TEXT, 'mb-1 text-[14px] font-extrabold text-fg')}>{document.subject}</div>
                <div className={cn(INLINE_TEXT, 'mb-3 text-[11.5px] text-fg-subtle')}>{document.preheader}</div>
              </>
            ) : (
              <>
                <input
                  data-testid="email-subject-input"
                  aria-label={t('email:canvas.subject', 'Subject')}
                  value={document.subject}
                  onFocus={onSubjectFocus}
                  onChange={(event) => onSubjectChange?.(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  className={cn(INLINE_INPUT, 'mb-1 text-[14px] font-extrabold text-fg')}
                />
                <input
                  data-testid="email-preheader-input"
                  aria-label={t('email:canvas.preheader', 'Preview text')}
                  placeholder={t('email:canvas.preheaderPlaceholder', 'Preview text…')}
                  value={document.preheader}
                  onFocus={onPreheaderFocus}
                  onChange={(event) => onPreheaderChange?.(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  className={cn(INLINE_INPUT, 'mb-3 text-[11.5px] text-fg-subtle placeholder:text-fg-subtle')}
                />
              </>
            )}
          </FixedSection>

          <div className="overflow-hidden rounded-xl border border-[#ececef] bg-white">
            <FixedSection
              label={t('email:canvas.sections.branding', 'Brand & sender')}
              selected={isSelected('branding')}
              readOnly={readOnly}
              onSelect={() => onSelect?.({ kind: 'branding' })}
              testId="email-section-banner"
            >
              <BrandBanner brand={brand} logoUrl={logoUrl} />
            </FixedSection>
            <div className="px-7 py-[26px]">
              {blocks.map((block, index) => {
                const def = blockDef(block.block);
                const label = blockLabel(block.block);
                return (
                  <SectionSlot
                    key={block.id}
                    block={block}
                    def={def}
                    label={label}
                    index={index}
                    selected={readOnly !== true && selection?.kind === 'block' && selection.id === block.id}
                    files={files}
                    readOnly={readOnly}
                    onSelect={() => onSelect?.({ kind: 'block', id: block.id })}
                    onInsertAbove={() => onInsertAt?.(index)}
                    onHeadingChange={(text) => onHeadingChange?.(block.id, text)}
                    onHeadingFocus={() => onHeadingFocus?.(block.id)}
                  />
                );
              })}
              {readOnly === true ? null : (
                <div className="mt-[26px] flex justify-center">
                  <button
                    type="button"
                    data-testid="email-add-section"
                    onClick={() => onInsertAt?.(blocks.length)}
                    className="inline-flex items-center gap-[7px] rounded-[22px] border border-border bg-surface py-[9px] pe-[17px] ps-3.5 text-[12px] font-bold text-fg-muted shadow-card transition-colors hover:border-border-strong hover:text-fg"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t('email:canvas.addSection', 'Add section')}
                  </button>
                </div>
              )}
              <FixedSection
                label={t('email:canvas.sections.footer', 'Footer')}
                selected={isSelected('footer')}
                readOnly={readOnly}
                onSelect={() => onSelect?.({ kind: 'footer' })}
                testId="email-section-footer"
              >
                <FooterText text={document.footer} />
              </FixedSection>
            </div>
          </div>

          {document.attachments.length === 0 ? null : (
            <FixedSection
              label={t('email:canvas.sections.attachments', 'Attachments')}
              selected={isSelected('attach')}
              readOnly={readOnly}
              onSelect={() => onSelect?.({ kind: 'attach' })}
              testId="email-section-attachments"
            >
              <AttachmentsCard attachments={document.attachments} resolved={attachmentsResolved} />
            </FixedSection>
          )}
          <VariablesRow vars={vars} />
        </div>
      </div>
    </div>
  );
}
