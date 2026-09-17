// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector, rendered on its own over a full draft and a mocked
 * `DocumentEdits`: every one of the twenty-nine panels shows its header and
 * its key controls under their accessible names; every textbox, slider,
 * switch and button is named; the *Remove section* footer flips the flag and
 * falls back to the items panel (comp `hideSec`, 1361); each discrete choice
 * reaches its `hist…` setter with the right value; the Images panel's dashed
 * row opens the Add-section modal; the delivery status button walks Pending →
 * In progress → Done; and the custom panel's Remove drops the section.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { FIXED_SECTION_KEYS, type FixedSectionKey, type OptionalFlag, type SectionKey } from '../../model/blocks.js';
import type { EditorDraft } from '../../model/doc.js';
import type { DocumentEdits } from '../../model/edits.js';
import { emptyBody, type CustomSection, type InvoiceBody } from '../../model/envelope.js';
import { totalsOf } from '../../model/money.js';
import { fixedSectionHeader } from '../sectionText.js';
import { Inspector } from './Inspector.js';
import { nextStepStatus } from './panels/DeliveryPanel.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** One custom section of each type (comp `customDefs()`, 1266-1272). */
const CUSTOM: readonly CustomSection[] = [
  { id: 'c_text', type: 'text', title: 'Scope of work', body: 'Two sprints.' },
  { id: 'c_image', type: 'image', title: 'Site photo', url: '', caption: 'Before', height: 200 },
  { id: 'c_kv', type: 'kv', title: 'Reference details', rows: [{ k: 'Cost centre', v: 'CC-4410' }] },
  { id: 'c_gallery', type: 'gallery', title: 'Deliverables', images: [{ id: 'g1', url: '' }] },
];

/** Every flag on, one row in every repeater, a logo and a background uploaded. */
function fullBody(): InvoiceBody {
  return {
    ...emptyBody(),
    logoText: 'Northwind',
    from: ['Northwind Ltd', '1 Harbour Row'],
    customerName: 'Globex',
    customer: ['ap@globex.test'],
    number: 'INV-0001',
    issued: '2026-09-01',
    due: '2026-10-01',
    terms: 'Net 30',
    poNumber: 'PO-7',
    items: [{ id: 'i1', desc: 'Design retainer — Q3', qty: '2', rate: '100' }],
    taxRate: '10',
    discountRate: '5',
    payment: ['Bank transfer'],
    notes: 'Thank you.',
    shipShow: true,
    shipName: 'Warehouse',
    ship: ['Dock 4'],
    sigShow: true,
    sigName: 'Ada',
    sigTitle: 'Director',
    termsShow: true,
    termsLabel: 'I accept these terms',
    termsChecked: false,
    attachShow: true,
    attachments: [{ name: 'spec.pdf', size: '214 KB' }],
    approvalShow: true,
    apprName: 'Bob',
    apprTitle: 'CFO',
    apprStatus: 'pending',
    qrShow: true,
    qrCaption: 'Scan to pay',
    lateShow: true,
    lateRate: '1.5',
    lateDays: 7,
    poShow: true,
    poTerms: 'Goods per PO-7.',
    mcShow: true,
    fx: [{ code: 'EUR', sym: '€', rate: '0.9' }],
    recurShow: true,
    recurFreq: 'Monthly',
    recurNext: '2026-10-01',
    recurCount: '12 of 24',
    discShow: true,
    discCodes: [{ code: 'WELCOME', label: 'Welcome offer', amount: '10' }],
    taxbShow: true,
    taxLines: [{ label: 'VAT', rate: '20' }],
    payhShow: true,
    payHist: [{ date: '2026-09-02', method: 'Card', amount: '$50.00', status: 'paid' }],
    legalShow: true,
    legalText: 'Registered in Delaware.',
    refShow: true,
    refText: 'Refunds within 14 days.',
    conShow: true,
    conName: 'Support desk',
    conEmail: 'help@northwind.test',
    conPhone: '+1 555 0100',
    loyShow: true,
    loyBalance: 1200,
    loyEarned: 40,
    loyLevel: 'Silver',
    delShow: true,
    delSteps: [{ label: 'Packed', status: 'todo' }],
    bgImage: PNG,
    bgTint: 0.82,
    logoImage: PNG,
    custom: [...CUSTOM],
  };
}

function mockEdits(): DocumentEdits {
  return {
    beginEdit: vi.fn(),
    set: vi.fn(),
    histSet: vi.fn(),
    setName: vi.fn(),
    histSetStatus: vi.fn(),
    histSetTopic: vi.fn(),
    histSetLang: vi.fn(),
    updateLine: vi.fn(),
    addLine: vi.fn(),
    removeLine: vi.fn(),
    updateRow: vi.fn(),
    addRow: vi.fn(),
    removeRow: vi.fn(),
    updateItem: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    reorderItems: vi.fn(),
    enableSection: vi.fn(),
    hideSection: vi.fn(),
    addBuiltin: vi.fn(),
    addCustom: vi.fn(),
    removeCustom: vi.fn(),
    reorderBlocks: vi.fn(),
    updateCustom: vi.fn(),
    histUpdateCustom: vi.fn(),
    updateCustomImage: vi.fn(),
    updateCustomRow: vi.fn(),
    addCustomRow: vi.fn(),
    removeCustomRow: vi.fn(),
    setImage: vi.fn(),
  };
}

function makeDraft(over: Partial<EditorDraft> = {}): EditorDraft {
  return { name: 'Q3 retainer', status: 'sent', topic: 'services', lang: 'en', body: fullBody(), ...over };
}

interface Harness {
  edits: DocumentEdits;
  onSelect: ReturnType<typeof vi.fn>;
  onOpenAdd: ReturnType<typeof vi.fn>;
  onImageRejected: ReturnType<typeof vi.fn>;
}

function element(section: SectionKey, draft: EditorDraft, harness: Harness, variant?: 'aside' | 'drawer') {
  return (
    <Inspector
      section={section}
      draft={draft}
      edits={harness.edits}
      totals={totalsOf(draft.body)}
      onSelect={harness.onSelect}
      onOpenAdd={harness.onOpenAdd}
      onImageRejected={harness.onImageRejected}
      variant={variant}
    />
  );
}

function renderInspector(section: SectionKey, over: Partial<EditorDraft> = {}, variant?: 'aside' | 'drawer') {
  const draft = makeDraft(over);
  const harness: Harness = { edits: mockEdits(), onSelect: vi.fn(), onOpenAdd: vi.fn(), onImageRejected: vi.fn() };
  const view = render(element(section, draft, harness, variant));
  return {
    ...harness,
    draft,
    view,
    user: userEvent.setup(),
    header: screen.getByTestId('invoices-inspector-header'),
    panel: screen.getByTestId('invoices-inspector-panel'),
    rerender: (next: EditorDraft) => view.rerender(element(section, next, harness)),
  };
}

/** Every control with one of these roles must carry a non-empty accessible name. */
function expectEveryControlNamed(panel: HTMLElement): void {
  for (const role of ['textbox', 'slider', 'switch', 'button']) {
    const all = within(panel).queryAllByRole(role);
    const named = within(panel).queryAllByRole(role, { name: /\S/ });
    expect(named.length, `${role}s without an accessible name`).toBe(all.length);
  }
}

interface Expectation {
  /** Labelled controls — `getByLabelText` (a `<label htmlFor>`, an `aria-label`, or a file input inside its label). */
  fields: string[];
  /** Buttons by accessible name. */
  buttons: string[];
  /** The `*Show` flag the *Remove section* footer flips, or `null` for a permanent panel. */
  flag: OptionalFlag | null;
}

/** The comp's key controls per panel (732-1033), by the name a screen reader gives them. */
const EXPECTED: Readonly<Record<FixedSectionKey, Expectation>> = {
  images: { fields: ['Upload QR code', 'Upload Signature', 'Upload Stamp / seal', 'Replace', 'Upload'], buttons: ['Remove', 'Add an image section'], flag: null },
  branding: { fields: ['Brand name', 'Upload logo'], buttons: ['hexagon', 'gem', 'box', 'Remove'], flag: null },
  theme: { fields: ['Document title', 'Overlay', 'Replace'], buttons: ['USD $', 'EUR €', 'GBP £', 'JPY ¥', 'Draft', 'Sent', 'Paid', 'Live', 'Overdue', 'Recurring', 'Professional services', 'Receipts & refunds', 'Sales & quotes', 'Shipping & logistics', 'English', 'Deutsch', 'Français', 'Español', 'Português', '日本語', 'Remove'], flag: null },
  from: { fields: ['Company details 1', 'Company details 2'], buttons: ['Add line', 'Remove Company details 1'], flag: null },
  customer: { fields: ['Client name', 'Address & contact 1'], buttons: ['Add line', 'Remove Address & contact 1'], flag: null },
  meta: { fields: ['Invoice number', 'Issue date', 'Due date', 'Payment terms', 'PO number'], buttons: [], flag: null },
  items: { fields: [], buttons: ['Add line item'], flag: null },
  tax: { fields: ['Tax rate', 'Discount'], buttons: [], flag: null },
  payment: { fields: ['Payment instructions 1'], buttons: ['Add line', 'Remove Payment instructions 1'], flag: null },
  notes: { fields: ['Footer notes'], buttons: [], flag: null },
  shipto: { fields: ['Ship-to name', 'Address lines 1'], buttons: ['Add line', 'Remove Address lines 1'], flag: 'shipShow' },
  signature: { fields: ['Signatory name', 'Title / role'], buttons: [], flag: 'sigShow' },
  terms: { fields: ['Checkbox label'], buttons: [], flag: 'termsShow' },
  attachments: { fields: ['File 1 name', 'File 1 size'], buttons: ['Add file', 'Remove file 1'], flag: 'attachShow' },
  approval: { fields: ['Approver name', 'Role / title'], buttons: ['Pending', 'Approved', 'Rejected'], flag: 'approvalShow' },
  qr: { fields: ['Caption'], buttons: [], flag: 'qrShow' },
  latefees: { fields: ['Late fee rate', 'Grace period'], buttons: [], flag: 'lateShow' },
  poterms: { fields: ['Purchase order terms'], buttons: [], flag: 'poShow' },
  multicurrency: { fields: ['Currency 1 code', 'Currency 1 symbol', 'Currency 1 rate'], buttons: ['Add currency', 'Remove currency 1'], flag: 'mcShow' },
  recurring: { fields: ['Next issue date', 'Schedule note'], buttons: ['Weekly', 'Monthly', 'Quarterly', 'Annually'], flag: 'recurShow' },
  discount: { fields: ['Code 1', 'Code 1 amount', 'Code 1 description'], buttons: ['Add code', 'Remove code 1'], flag: 'discShow' },
  taxbreak: { fields: ['Tax line 1 label', 'Tax line 1 rate'], buttons: ['Add tax line', 'Remove tax line 1'], flag: 'taxbShow' },
  payhistory: { fields: ['Payment 1 date', 'Payment 1 amount', 'Payment 1 method'], buttons: ['Add payment', 'Remove payment 1'], flag: 'payhShow' },
  legal: { fields: ['Legal footer'], buttons: [], flag: 'legalShow' },
  refund: { fields: ['Refund policy'], buttons: [], flag: 'refShow' },
  contact: { fields: ['Contact name', 'Email', 'Phone'], buttons: [], flag: 'conShow' },
  loyalty: { fields: ['Points balance', 'Points earned', 'Level'], buttons: [], flag: 'loyShow' },
  delivery: { fields: ['Step 1'], buttons: ['Add step', 'Step 1 status: Pending', 'Remove step 1'], flag: 'delShow' },
};

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('Inspector — every fixed section', () => {
  it.each(FIXED_SECTION_KEYS)('%s: header, key controls, accessible names, Remove section', async (section) => {
    const { header, panel, edits, onSelect, user } = renderInspector(section);
    const expected = EXPECTED[section];
    const meta = fixedSectionHeader(section);

    expect(screen.getByTestId('invoices-inspector').getAttribute('data-variant')).toBe('aside');
    expect(header.getAttribute('data-section')).toBe(section);
    expect(header.getAttribute('data-icon')).toBe(meta.icon);
    expect(within(header).getByText(meta.title)).toBeDefined();
    expect(within(header).getByText(meta.hint)).toBeDefined();
    expect(panel.getAttribute('data-section')).toBe(section);

    for (const field of expected.fields) expect(within(panel).getAllByLabelText(field).length, `${section} field ${field}`).toBeGreaterThan(0);
    for (const button of expected.buttons) expect(within(panel).getAllByRole('button', { name: button }).length, `${section} button ${button}`).toBeGreaterThan(0);
    expectEveryControlNamed(panel);

    if (expected.flag === null) {
      expect(within(panel).queryByTestId('invoices-remove-section')).toBeNull();
      return;
    }
    const remove = within(panel).getByTestId('invoices-remove-section');
    expect(remove.getAttribute('data-flag')).toBe(expected.flag);
    expect(remove.textContent).toBe('Remove section');
    await user.click(remove);
    expect(edits.hideSection).toHaveBeenCalledWith(expected.flag);
    expect(onSelect).toHaveBeenCalledWith('items');
  });

  it('the drawer variant renders the same header and panel without the aside chrome', () => {
    const { header, panel } = renderInspector('meta', {}, 'drawer');
    const root = screen.getByTestId('invoices-inspector');
    expect(root.tagName).toBe('DIV');
    expect(root.getAttribute('data-variant')).toBe('drawer');
    expect(within(header).getByText('Invoice details')).toBeDefined();
    expect(within(panel).getByLabelText('Invoice number')).toBeDefined();
  });
});

describe('Inspector — the custom sections', () => {
  it.each(CUSTOM)('$type: the section title heads the panel and Remove drops it', async (custom) => {
    const section: SectionKey = `cus:${custom.id}`;
    const { header, panel, edits, onSelect, user } = renderInspector(section);
    expect(header.getAttribute('data-icon')).toBe('shapes');
    expect(within(header).getByText(custom.title)).toBeDefined();
    expect(within(header).getByText('Your own section')).toBeDefined();
    expect(within(panel).getByLabelText('Section title')).toBeDefined();
    expectEveryControlNamed(panel);

    await user.type(within(panel).getByLabelText('Section title'), '!');
    expect(edits.beginEdit).toHaveBeenCalled();
    expect(edits.updateCustom).toHaveBeenCalledWith(custom.id, { title: `${custom.title}!` });

    switch (custom.type) {
      case 'text':
        expect(within(panel).getByLabelText('Body copy').tagName).toBe('TEXTAREA');
        await user.type(within(panel).getByLabelText('Body copy'), '.');
        expect(edits.updateCustom).toHaveBeenCalledWith(custom.id, { body: `${custom.body}.` });
        break;
      case 'image': {
        expect(within(panel).getByLabelText('Upload / replace')).toBeDefined();
        expect(within(panel).getByLabelText('Caption')).toBeDefined();
        const height = within(panel).getByRole('slider', { name: 'Height' });
        expect(height.getAttribute('min')).toBe('110');
        expect(height.getAttribute('max')).toBe('380');
        fireEvent.change(height, { target: { value: '300' } });
        expect(edits.updateCustom).toHaveBeenCalledWith(custom.id, { height: 300 });
        break;
      }
      case 'kv':
        await user.click(within(panel).getByRole('button', { name: 'Add row' }));
        expect(edits.addCustomRow).toHaveBeenCalledWith(custom.id);
        break;
      case 'gallery':
        expect(within(panel).getByText('Click each slot on the invoice to upload an image.')).toBeDefined();
        break;
    }

    await user.click(within(panel).getByRole('button', { name: 'Remove section' }));
    expect(edits.removeCustom).toHaveBeenCalledWith(custom.id);
    expect(onSelect).toHaveBeenCalledWith('items');
  });

  it('a custom title that is empty falls back to "Custom section"', () => {
    const body = fullBody();
    body.custom = [{ id: 'c_blank', type: 'text', title: '', body: '' }];
    const { header } = renderInspector('cus:c_blank', { body });
    expect(within(header).getByText('Custom section')).toBeDefined();
  });

  it('a `cus:` key no section answers to shows the "Edit" fallback over an empty panel', () => {
    const { header, panel } = renderInspector('cus:ghost');
    expect(header.getAttribute('data-icon')).toBe('mouse-pointer-click');
    expect(within(header).getByText('Edit')).toBeDefined();
    expect(panel.childElementCount).toBe(0);
  });
});

describe('Inspector — the discrete choices reach their hist… setter', () => {
  it('Title & theme: swatch, currency, decimals, status, topic, language, background', async () => {
    const { panel, edits, user } = renderInspector('theme');
    const swatches = within(panel).getAllByTestId('invoices-swatch');
    expect(swatches).toHaveLength(5);
    expect(swatches[0]?.getAttribute('aria-pressed')).toBe('true');
    await user.click(swatches.find((el) => el.getAttribute('data-value') === '#0d9488') as HTMLElement);
    expect(edits.histSet).toHaveBeenCalledWith('accent', '#0d9488');

    expect(within(panel).getByRole('button', { name: 'USD $' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'EUR €' }));
    expect(edits.histSet).toHaveBeenCalledWith('currency', '€');

    const decimals = within(panel).getByRole('switch', { name: 'Show decimals' });
    expect(decimals.getAttribute('aria-checked')).toBe('true');
    await user.click(decimals);
    expect(edits.histSet).toHaveBeenCalledWith('cents', false);
    expect(within(panel).getByText('e.g. $290.00 vs $290')).toBeDefined();

    expect(within(panel).getByRole('button', { name: 'Sent' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'Paid' }));
    expect(edits.histSetStatus).toHaveBeenCalledWith('paid');

    expect(within(panel).getByRole('button', { name: 'Professional services' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'Shipping & logistics' }));
    expect(edits.histSetTopic).toHaveBeenCalledWith('logistics');

    expect(within(panel).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'Deutsch' }));
    expect(edits.histSetLang).toHaveBeenCalledWith('de');
    expect(within(panel).getByText('Use the language button in the toolbar to create a linked variation instead of re-tagging this one.')).toBeDefined();

    // The background is set: thumb + Replace + Remove + the overlay slider capped at 95.
    expect(within(panel).getByText('Overlay 82%')).toBeDefined();
    const overlay = within(panel).getByRole('slider', { name: 'Overlay' });
    expect(overlay.getAttribute('max')).toBe('95');
    fireEvent.change(overlay, { target: { value: '40' } });
    expect(edits.set).toHaveBeenCalledWith('bgTint', 0.4);
    await user.click(within(panel).getByRole('button', { name: 'Remove' }));
    expect(edits.setImage).toHaveBeenCalledWith('bgImage', '');

    await user.type(within(panel).getByLabelText('Document title'), 'S');
    expect(edits.set).toHaveBeenCalledWith('title', 'INVOICES');
  });

  it('Title & theme without a background shows the dashed upload and its hint', () => {
    const body = fullBody();
    body.bgImage = '';
    const { panel } = renderInspector('theme', { body });
    expect(within(panel).getByLabelText('Upload background')).toBeDefined();
    expect(within(panel).getByText('Adds a full-bleed background behind the whole invoice — great for letterhead or a watermark.')).toBeDefined();
    expect(within(panel).queryByRole('slider')).toBeNull();
  });

  it('Branding: a logo mark, the logo image, the two notes', async () => {
    const { panel, edits, user } = renderInspector('branding');
    const marks = within(panel).getAllByTestId('invoices-option');
    expect(marks).toHaveLength(12);
    expect(within(panel).getByRole('button', { name: 'hexagon' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'gem' }));
    expect(edits.histSet).toHaveBeenCalledWith('logoIcon', 'gem');
    await user.click(within(panel).getByRole('button', { name: 'Remove' }));
    expect(edits.setImage).toHaveBeenCalledWith('logoImage', '');
    expect(within(panel).getByText('Images', { selector: 'b' })).toBeDefined();
    expect(within(panel).getByText('title', { selector: 'b' })).toBeDefined();
    await user.type(within(panel).getByLabelText('Brand name'), 'x');
    expect(edits.set).toHaveBeenCalledWith('logoText', 'Northwindx');
  });

  it('Branding without a logo image has no Remove', () => {
    const body = fullBody();
    body.logoImage = '';
    const { panel } = renderInspector('branding', { body });
    expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('Recurring: a frequency; Approval: a status; Terms: the pre-checked switch', async () => {
    const recurring = renderInspector('recurring');
    expect(within(recurring.panel).getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
    await recurring.user.click(within(recurring.panel).getByRole('button', { name: 'Quarterly' }));
    expect(recurring.edits.histSet).toHaveBeenCalledWith('recurFreq', 'Quarterly');
    recurring.view.unmount();

    const approval = renderInspector('approval');
    expect(within(approval.panel).getByRole('button', { name: 'Pending' }).getAttribute('aria-pressed')).toBe('true');
    await approval.user.click(within(approval.panel).getByRole('button', { name: 'Approved' }));
    expect(approval.edits.histSet).toHaveBeenCalledWith('apprStatus', 'approved');
    approval.view.unmount();

    const terms = renderInspector('terms');
    const pre = within(terms.panel).getByRole('switch', { name: 'Pre-checked' });
    expect(pre.getAttribute('aria-checked')).toBe('false');
    await terms.user.click(pre);
    expect(terms.edits.histSet).toHaveBeenCalledWith('termsChecked', true);
    expect(within(terms.panel).getByText('Show the box already ticked')).toBeDefined();
  });
});

describe('Inspector — the Images panel', () => {
  it('draws the five slots, Replace/Remove on a filled one, Upload on an empty one, and opens the Add-section modal', async () => {
    const { panel, edits, onOpenAdd, user } = renderInspector('images');
    expect(within(panel).getByText('Fixed images that travel with the invoice. Upload once and every document built from this template keeps them.')).toBeDefined();
    const slots = within(panel).getAllByTestId('invoices-image-slot');
    expect(slots.map((slot) => slot.getAttribute('data-field'))).toEqual(['logoImage', 'bgImage', 'qrImage', 'sigImage', 'stampImage']);
    expect(slots.map((slot) => slot.getAttribute('data-filled'))).toEqual(['true', 'true', 'false', 'false', 'false']);
    for (const [label, hint] of [
      ['Logo', 'Replaces the logo mark'],
      ['Background', 'Watermark behind the invoice'],
      ['QR code', 'Shown in the payment QR block'],
      ['Signature', 'Scanned signature image'],
      ['Stamp / seal', 'Paid or approval stamp'],
    ]) {
      expect(within(panel).getByText(label as string)).toBeDefined();
      expect(within(panel).getByText(hint as string)).toBeDefined();
    }
    const logo = slots[0] as HTMLElement;
    // A decorative thumb: `alt=""` keeps it out of the accessibility tree, so it is not an `img` role.
    expect(logo.querySelector('img')?.getAttribute('src')).toBe(PNG);
    expect(within(logo).getByLabelText('Replace')).toBeDefined();
    await user.click(within(logo).getByRole('button', { name: 'Remove' }));
    expect(edits.setImage).toHaveBeenCalledWith('logoImage', '');

    const qr = slots[2] as HTMLElement;
    expect(within(qr).getByLabelText('Upload QR code')).toBeDefined();
    expect(within(qr).getByLabelText('Upload')).toBeDefined();
    expect(within(qr).queryByRole('button', { name: 'Remove' })).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'Add an image section' }));
    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('an image file reaches setImage as a data URL; a non-image is refused to onImageRejected', async () => {
    const { panel, edits, onImageRejected } = renderInspector('images');
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(within(panel).getByLabelText('Upload QR code'), new File([new Uint8Array([137, 80, 78, 71])], 'code.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(edits.setImage).toHaveBeenCalledWith('qrImage', expect.stringMatching(/^data:image\/png;base64,/));
    });
    expect(onImageRejected).not.toHaveBeenCalled();

    await user.upload(within(panel).getByLabelText('Upload Signature'), new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => {
      expect(onImageRejected).toHaveBeenCalledWith({ ok: false, reason: 'notImage' });
    });
    expect(edits.setImage).toHaveBeenCalledTimes(1);
  });
});

describe('Inspector — fields, lines, rows and totals', () => {
  it('a keystroke begins an edit on focus and sets the field without a step', async () => {
    const { panel, edits, user } = renderInspector('meta');
    const number = within(panel).getByLabelText('Invoice number') as HTMLInputElement;
    expect(number.value).toBe('INV-0001');
    await user.type(number, 'A');
    expect(edits.beginEdit).toHaveBeenCalled();
    expect(edits.set).toHaveBeenCalledWith('number', 'INV-0001A');
    expect(edits.histSet).not.toHaveBeenCalled();
  });

  it('Late fees and Loyalty parse their integers; the units are the lexicon words', () => {
    const late = renderInspector('latefees');
    expect(within(late.panel).getByText('% per month')).toBeDefined();
    expect(within(late.panel).getByText('days')).toBeDefined();
    fireEvent.change(within(late.panel).getByLabelText('Grace period'), { target: { value: '14' } });
    expect(late.edits.set).toHaveBeenCalledWith('lateDays', 14);
    fireEvent.change(within(late.panel).getByLabelText('Grace period'), { target: { value: 'x' } });
    expect(late.edits.set).toHaveBeenCalledWith('lateDays', 0);
    fireEvent.change(within(late.panel).getByLabelText('Late fee rate'), { target: { value: '2' } });
    expect(late.edits.set).toHaveBeenCalledWith('lateRate', '2');
    late.view.unmount();

    const loyalty = renderInspector('loyalty');
    fireEvent.change(within(loyalty.panel).getByLabelText('Points balance'), { target: { value: '1,250' } });
    expect(loyalty.edits.set).toHaveBeenCalledWith('loyBalance', 1);
    fireEvent.change(within(loyalty.panel).getByLabelText('Points earned'), { target: { value: '55' } });
    expect(loyalty.edits.set).toHaveBeenCalledWith('loyEarned', 55);
    fireEvent.change(within(loyalty.panel).getByLabelText('Level'), { target: { value: 'Gold' } });
    expect(loyalty.edits.set).toHaveBeenCalledWith('loyLevel', 'Gold');
  });

  it('a line editor updates, adds and removes lines', async () => {
    const { panel, edits, user } = renderInspector('from');
    expect(within(panel).getAllByTestId('invoices-line')).toHaveLength(2);
    await user.type(within(panel).getByLabelText('Company details 2'), '.');
    expect(edits.updateLine).toHaveBeenCalledWith('from', 1, '1 Harbour Row.');
    await user.click(within(panel).getByRole('button', { name: 'Remove Company details 1' }));
    expect(edits.removeLine).toHaveBeenCalledWith('from', 0);
    await user.click(within(panel).getByTestId('invoices-rows-add'));
    expect(edits.addLine).toHaveBeenCalledWith('from');
  });

  it('every rows editor seeds the comp’s default row on Add and removes by index', async () => {
    const cases: { section: FixedSectionKey; add: string; row: unknown; field: string }[] = [
      { section: 'attachments', add: 'Add file', row: { name: 'New file.pdf', size: '—' }, field: 'attachments' },
      { section: 'multicurrency', add: 'Add currency', row: { code: 'USD', sym: '$', rate: '1' }, field: 'fx' },
      { section: 'discount', add: 'Add code', row: { code: 'NEWCODE', label: 'New discount', amount: '0' }, field: 'discCodes' },
      { section: 'taxbreak', add: 'Add tax line', row: { label: 'New tax', rate: '0' }, field: 'taxLines' },
      { section: 'payhistory', add: 'Add payment', row: { date: '—', method: '—', amount: '$0.00', status: 'paid' }, field: 'payHist' },
      { section: 'delivery', add: 'Add step', row: { label: 'New step', status: 'todo' }, field: 'delSteps' },
    ];
    for (const { section, add, row, field } of cases) {
      const { panel, edits, user, view } = renderInspector(section);
      await user.click(within(panel).getByRole('button', { name: add }));
      expect(edits.addRow, section).toHaveBeenCalledWith(field, row);
      await user.click(within(panel).getByTestId('invoices-row-remove'));
      expect(edits.removeRow, section).toHaveBeenCalledWith(field, 0);
      view.unmount();
    }
  });

  it('a row cell patches its own key', async () => {
    const attachments = renderInspector('attachments');
    await attachments.user.type(within(attachments.panel).getByLabelText('File 1 size'), '!');
    expect(attachments.edits.updateRow).toHaveBeenCalledWith('attachments', 0, { size: '214 KB!' });
    attachments.view.unmount();

    const fx = renderInspector('multicurrency');
    await fx.user.type(within(fx.panel).getByLabelText('Currency 1 rate'), '1');
    expect(fx.edits.updateRow).toHaveBeenCalledWith('fx', 0, { rate: '0.91' });
    expect(within(fx.panel).getByText('Rate is multiplied by the invoice total. Code, symbol, then rate.')).toBeDefined();
    fx.view.unmount();

    const discount = renderInspector('discount');
    expect(within(discount.panel).getByPlaceholderText('CODE')).toBeDefined();
    expect(within(discount.panel).getByPlaceholderText('0')).toBeDefined();
    expect(within(discount.panel).getByPlaceholderText('Description')).toBeDefined();
    await discount.user.type(within(discount.panel).getByLabelText('Code 1 description'), '!');
    expect(discount.edits.updateRow).toHaveBeenCalledWith('discCodes', 0, { label: 'Welcome offer!' });
    discount.view.unmount();

    const taxbreak = renderInspector('taxbreak');
    await taxbreak.user.type(within(taxbreak.panel).getByLabelText('Tax line 1 rate'), '1');
    expect(taxbreak.edits.updateRow).toHaveBeenCalledWith('taxLines', 0, { rate: '201' });
    expect(within(taxbreak.panel).getByText('Each rate is applied to the subtotal after any discount.')).toBeDefined();
    taxbreak.view.unmount();

    const payhistory = renderInspector('payhistory');
    for (const placeholder of ['Date', 'Amount', 'Method']) expect(within(payhistory.panel).getByPlaceholderText(placeholder)).toBeDefined();
    await payhistory.user.type(within(payhistory.panel).getByLabelText('Payment 1 method'), '!');
    expect(payhistory.edits.updateRow).toHaveBeenCalledWith('payHist', 0, { method: 'Card!' });
  });

  it('the delivery status button cycles Pending → In progress → Done → Pending', async () => {
    const { panel, edits, user, rerender, draft } = renderInspector('delivery');
    expect(within(panel).getByText('Tap the status to cycle Pending → In progress → Done.')).toBeDefined();
    const button = () => within(panel).getByTestId('invoices-cycle');
    expect(button().textContent).toBe('Pending');
    await user.click(button());
    expect(edits.updateRow).toHaveBeenLastCalledWith('delSteps', 0, { status: 'current' });

    rerender({ ...draft, body: { ...draft.body, delSteps: [{ label: 'Packed', status: 'current' }] } });
    expect(button().textContent).toBe('In progress');
    expect(button().getAttribute('data-value')).toBe('current');
    await user.click(button());
    expect(edits.updateRow).toHaveBeenLastCalledWith('delSteps', 0, { status: 'done' });

    rerender({ ...draft, body: { ...draft.body, delSteps: [{ label: 'Packed', status: 'done' }] } });
    expect(button().textContent).toBe('Done');
    await user.click(button());
    expect(edits.updateRow).toHaveBeenLastCalledWith('delSteps', 0, { status: 'todo' });

    expect(nextStepStatus('todo')).toBe('current');
    expect(nextStepStatus('current')).toBe('done');
    expect(nextStepStatus('done')).toBe('todo');
  });

  it('Line items and Tax & totals read the ladder: count, subtotal, discount, tax, total', async () => {
    const items = renderInspector('items');
    expect(within(items.panel).getByTestId('invoices-items-count').textContent).toBe('1');
    expect(within(items.panel).getByTestId('invoices-items-subtotal').textContent).toBe('$200.00');
    await items.user.click(within(items.panel).getByRole('button', { name: 'Add line item' }));
    expect(items.edits.addItem).toHaveBeenCalledTimes(1);
    expect(within(items.panel).getByText('Edit any cell directly on the invoice, or drag the handle to reorder.')).toBeDefined();
    items.view.unmount();

    const tax = renderInspector('tax');
    const ladder = within(tax.panel).getByTestId('invoices-tax-ladder');
    expect(within(ladder).getByText('$200.00')).toBeDefined();
    expect(within(ladder).getByTestId('invoices-tax-discount').textContent).toBe('−$10.00');
    expect(within(ladder).getByText('$19.00')).toBeDefined();
    expect(within(ladder).getByText('Total')).toBeDefined();
    expect(within(ladder).getByTestId('invoices-tax-total').textContent).toBe('$209.00');
    await tax.user.type(within(tax.panel).getByLabelText('Tax rate'), '0');
    expect(tax.edits.set).toHaveBeenCalledWith('taxRate', '100');
    tax.view.unmount();

    const body = fullBody();
    body.discountRate = '0';
    const noDiscount = renderInspector('tax', { body });
    expect(within(noDiscount.panel).queryByTestId('invoices-tax-discount')).toBeNull();
  });

  it('the Payment QR panel draws the tile, the caption and the honest hint', () => {
    const { panel, view } = renderInspector('qr');
    expect(within(panel).getByTestId('invoices-qr-tile').tagName).toBe('DIV');
    expect(within(panel).getByTestId('invoices-qr-hint').textContent).toBe('Encodes Amount due · $209.00. The code shown is the image you upload under Images.');
    view.unmount();

    const body = fullBody();
    body.qrImage = PNG;
    const { panel: withImage } = renderInspector('qr', { body });
    expect(within(withImage).getByTestId('invoices-qr-tile').tagName).toBe('IMG');
  });

  it('the textarea panels carry the comp’s row counts and the Notes hint', () => {
    const notes = renderInspector('notes');
    expect(within(notes.panel).getByLabelText('Footer notes').getAttribute('rows')).toBe('6');
    expect(within(notes.panel).getByText('Shown at the bottom of the invoice — terms, thank-you note, or legal text.')).toBeDefined();
    notes.view.unmount();
    for (const [section, label, rows] of [
      ['terms', 'Checkbox label', '3'],
      ['poterms', 'Purchase order terms', '7'],
      ['legal', 'Legal footer', '7'],
      ['refund', 'Refund policy', '7'],
    ] as const) {
      const { panel, view } = renderInspector(section);
      expect(within(panel).getByLabelText(label).getAttribute('rows'), section).toBe(rows);
      view.unmount();
    }
  });
});
