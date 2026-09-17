// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector aside (the comp's 729-1033): a 294 px right aside with
 * the accent-soft header — the selected section's icon, title and hint
 * (`insMeta`, 1565) — over ONE contextual panel keyed off the selection. NOT
 * tabbed: unlike the email inspector there is no Sections/Design tray; the
 * canvas is the outline.
 *
 * PROPS CONTRACT (shared with `editor/Editor.tsx`, which mounts this):
 * everything a panel edits goes through `edits` (model/edits.ts); a panel that
 * changes the selection (a *Remove section* footer falls back to `items`,
 * comp 1361) calls `onSelect`; the Images panel's *Add an image section*
 * opens the Add-section modal in append mode (`addAt: null`, comp 749).
 *
 * The shell scrolls the PAGE under a sticky topbar, so the aside is STICKY
 * under the topbar and the editor header (both heights measured by the
 * editor as custom properties) and scrolls on its own; below `lg` it is
 * hidden and the editor shows the panel in a drawer.
 */
import { MousePointerClick } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import { invoiceIcon } from '../../icons.js';
import type { EditorDraft } from '../../model/doc.js';
import type { DocumentEdits } from '../../model/edits.js';
import { customIdOf, isCustomKey, type FixedSectionKey, type SectionKey } from '../../model/blocks.js';
import type { Totals } from '../../model/money.js';
import type { ImageReadResult } from '../images.js';
import { sectionHeader, type SectionHeader } from '../sectionText.js';
import type { PanelProps } from './panelProps.js';
import { ApprovalPanel } from './panels/ApprovalPanel.js';
import { AttachmentsPanel } from './panels/AttachmentsPanel.js';
import { BrandingPanel } from './panels/BrandingPanel.js';
import { ContactPanel } from './panels/ContactPanel.js';
import { CustomPanel } from './panels/CustomPanel.js';
import { CustomerPanel } from './panels/CustomerPanel.js';
import { DeliveryPanel } from './panels/DeliveryPanel.js';
import { DiscountPanel } from './panels/DiscountPanel.js';
import { FromPanel } from './panels/FromPanel.js';
import { ImagesPanel } from './panels/ImagesPanel.js';
import { ItemsPanel } from './panels/ItemsPanel.js';
import { LateFeesPanel } from './panels/LateFeesPanel.js';
import { LegalPanel } from './panels/LegalPanel.js';
import { LoyaltyPanel } from './panels/LoyaltyPanel.js';
import { MetaPanel } from './panels/MetaPanel.js';
import { MultiCurrencyPanel } from './panels/MultiCurrencyPanel.js';
import { NotesPanel } from './panels/NotesPanel.js';
import { PayHistoryPanel } from './panels/PayHistoryPanel.js';
import { PaymentPanel } from './panels/PaymentPanel.js';
import { PoTermsPanel } from './panels/PoTermsPanel.js';
import { QrPanel } from './panels/QrPanel.js';
import { RecurringPanel } from './panels/RecurringPanel.js';
import { RefundPanel } from './panels/RefundPanel.js';
import { ShipToPanel } from './panels/ShipToPanel.js';
import { SignaturePanel } from './panels/SignaturePanel.js';
import { TaxBreakPanel } from './panels/TaxBreakPanel.js';
import { TaxPanel } from './panels/TaxPanel.js';
import { TermsPanel } from './panels/TermsPanel.js';
import { ThemePanel } from './panels/ThemePanel.js';

export interface InspectorProps {
  section: SectionKey;
  draft: EditorDraft;
  edits: DocumentEdits;
  totals: Totals;
  onSelect: (section: SectionKey) => void;
  /** The Images panel's *Add an image section* — the modal in append mode. */
  onOpenAdd: () => void;
  /** An upload the cap refused; the editor toasts it. */
  onImageRejected: (result: Extract<ImageReadResult, { ok: false }>) => void;
  /** The drawer variant below `lg` renders the same panel without the aside chrome. */
  variant?: 'aside' | 'drawer' | undefined;
}

/** The comp's `insMeta` per fixed section (1565) → its panel (732-1033). */
function fixedPanel(section: FixedSectionKey, props: PanelProps): ReactNode {
  switch (section) {
    case 'images':
      return <ImagesPanel {...props} />;
    case 'branding':
      return <BrandingPanel {...props} />;
    case 'theme':
      return <ThemePanel {...props} />;
    case 'from':
      return <FromPanel {...props} />;
    case 'customer':
      return <CustomerPanel {...props} />;
    case 'meta':
      return <MetaPanel {...props} />;
    case 'items':
      return <ItemsPanel {...props} />;
    case 'tax':
      return <TaxPanel {...props} />;
    case 'payment':
      return <PaymentPanel {...props} />;
    case 'notes':
      return <NotesPanel {...props} />;
    case 'shipto':
      return <ShipToPanel {...props} />;
    case 'signature':
      return <SignaturePanel {...props} />;
    case 'terms':
      return <TermsPanel {...props} />;
    case 'attachments':
      return <AttachmentsPanel {...props} />;
    case 'approval':
      return <ApprovalPanel {...props} />;
    case 'qr':
      return <QrPanel {...props} />;
    case 'latefees':
      return <LateFeesPanel {...props} />;
    case 'poterms':
      return <PoTermsPanel {...props} />;
    case 'multicurrency':
      return <MultiCurrencyPanel {...props} />;
    case 'recurring':
      return <RecurringPanel {...props} />;
    case 'discount':
      return <DiscountPanel {...props} />;
    case 'taxbreak':
      return <TaxBreakPanel {...props} />;
    case 'payhistory':
      return <PayHistoryPanel {...props} />;
    case 'legal':
      return <LegalPanel {...props} />;
    case 'refund':
      return <RefundPanel {...props} />;
    case 'contact':
      return <ContactPanel {...props} />;
    case 'loyalty':
      return <LoyaltyPanel {...props} />;
    case 'delivery':
      return <DeliveryPanel {...props} />;
  }
}

/** The comp's `insMeta` fallback (1565's last branch): a `cus:` key no section answers to. */
function fallbackHeader(): SectionHeader {
  return { icon: 'mouse-pointer-click', title: t('invoices:inspector.fallback.title', 'Edit'), hint: '' };
}

export function Inspector({ section, draft, edits, totals, onSelect, onOpenAdd, onImageRejected, variant = 'aside' }: InspectorProps) {
  const props: PanelProps = { draft, edits, totals, onSelect, onOpenAdd, onImageRejected };

  let header: SectionHeader;
  let panel: ReactNode;
  if (!isCustomKey(section)) {
    header = sectionHeader(section, null);
    panel = fixedPanel(section, props);
  } else {
    const customId = customIdOf(section);
    const custom = draft.body.custom.find((entry) => entry.id === customId) ?? null;
    if (custom === null) {
      header = fallbackHeader();
      panel = null;
    } else {
      header = sectionHeader(section, custom.title);
      panel = <CustomPanel {...props} section={custom} />;
    }
  }
  const HeaderIcon = header.icon === 'mouse-pointer-click' ? MousePointerClick : invoiceIcon(header.icon);

  const content = (
    <>
      <div data-testid="invoices-inspector-header" data-section={section} data-icon={header.icon} className="mb-[18px] flex items-center gap-[10px] rounded-xl bg-accent-soft px-[13px] py-[11px]">
        <HeaderIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold text-accent">{header.title}</div>
          {/* The comp fades the hint to 75 % (731); on `--accent-soft` that is 3.57:1 and
              fails WCAG AA, so the accent runs at full strength and the 10.5 px size
              beside the 13 px extrabold title carries the hierarchy instead (39's
              muted-grey departure, same rule). */}
          {header.hint === '' ? null : <div className="text-[10.5px] text-accent">{header.hint}</div>}
        </div>
      </div>
      <div data-testid="invoices-inspector-panel" data-section={section}>
        {panel}
      </div>
    </>
  );

  if (variant === 'drawer') {
    return (
      <div data-testid="invoices-inspector" data-variant="drawer" className="block rounded-xl border border-border bg-surface px-4 pb-6 pt-[18px] lg:hidden">
        {content}
      </div>
    );
  }
  return (
    <aside
      data-testid="invoices-inspector"
      data-variant="aside"
      className="nb-scroll sticky top-[calc(var(--adm-topbar-h,0px)+var(--adm-editor-header-h,0px))] hidden max-h-[calc(100dvh-var(--adm-topbar-h,0px)-var(--adm-editor-header-h,0px))] w-[294px] shrink-0 self-start overflow-auto border-s border-border bg-surface px-4 pb-10 pt-[18px] lg:block"
    >
      {content}
    </aside>
  );
}
