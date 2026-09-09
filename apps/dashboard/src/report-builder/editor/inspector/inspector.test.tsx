// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector (43-report-builder.md 43-T07; Appendix A I1–I10, Appendix B's
 * *Inspector* column), rendered on its own over a full draft and a mocked
 * `DocumentEdits`: every one of the 25 field groups shows its controls under
 * their accessible names, every discrete choice reaches its `hist…` setter
 * with the right value, and the three parts every kind shares — Width, *Show
 * in export*, *Delete block* — are on every panel.
 *
 * THE ASSERTION WITH TEETH IS THE TABLE-DRIVEN ONE: it walks all 25 kinds and
 * requires each panel to name at least one control of its own, so a kind
 * whose group is missing cannot pass by rendering an empty div.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { DEFAULT_BLOCK_SEED, newBlock } from '../../model/blocks.js';
import type { DocumentEdits } from '../../model/edits.js';
import { emptyBody, REPORT_BLOCK_KINDS, type ReportBlock, type ReportBlockKind, type ReportBody } from '../../model/envelope.js';
import type { Selection } from '../../model/ops.js';
import { Inspector } from './Inspector.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function mockEdits(): DocumentEdits {
  return {
    beginEdit: vi.fn(),
    setHeader: vi.fn(),
    histSetHeader: vi.fn(),
    setName: vi.fn(),
    histSetStatus: vi.fn(),
    patchBlock: vi.fn(),
    histPatchBlock: vi.fn(),
    addBlock: vi.fn(),
    swapBlock: vi.fn(),
    reorderBlock: vi.fn(),
    deleteBlock: vi.fn(),
    updateArrayItem: vi.fn(),
    addArrayItem: vi.fn(),
    removeArrayItem: vi.fn(),
    updateRow: vi.fn(),
    addRow: vi.fn(),
    removeRow: vi.fn(),
    select: vi.fn(),
  };
}

/** One block of every kind, in palette order, ids `k0…k24`. */
function allBlocks(): ReportBlock[] {
  return REPORT_BLOCK_KINDS.map((kind, i) => newBlock(kind, DEFAULT_BLOCK_SEED, `k${String(i)}`));
}

function bodyWith(blocks: ReportBlock[], over: Partial<ReportBody> = {}): ReportBody {
  return { ...emptyBody(), kicker: 'Quarterly report', reportTitle: 'Q3 Summary', subtitle: 'Leadership', blocks, ...over };
}

function idOf(kind: ReportBlockKind): string {
  return `k${String(REPORT_BLOCK_KINDS.indexOf(kind))}`;
}

function renderInspector(selection: Selection, body: ReportBody = bodyWith(allBlocks())) {
  const edits = mockEdits();
  const view = render(<Inspector body={body} status="draft" selection={selection} edits={edits} onImageRejected={vi.fn()} />);
  return { edits, view, user: userEvent.setup() };
}

/** The one `aside` this bare render mounts (the drawer twin only exists inside the Editor). */
function panel(): HTMLElement {
  return screen.getByTestId('report-inspector');
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('the banner (I2) and the three panels (I3–I5)', () => {
  it('the header panel names the document’s fields, swatches and status (353-371)', async () => {
    const { edits, user } = renderInspector('header');
    expect(screen.getByTestId('report-inspector-title').textContent).toBe('Report header');
    expect(panel().textContent).toContain('Title, kicker & theme');
    expect((screen.getByTestId('report-panel-kicker') as HTMLInputElement).value).toBe('Quarterly report');
    expect((screen.getByTestId('report-panel-title') as HTMLInputElement).value).toBe('Q3 Summary');

    const swatches = screen.getAllByTestId('report-swatch');
    expect(swatches.map((el) => el.getAttribute('data-value'))).toEqual(['#4f46e5', '#0d9488', '#e5484d', '#ea580c', '#111111']);
    expect(swatches[0]?.getAttribute('aria-pressed')).toBe('true');
    await user.click(swatches[2] as HTMLElement);
    expect(edits.histSetHeader).toHaveBeenCalledWith('accent', '#e5484d');

    const statuses = screen.getAllByTestId('report-status-option');
    expect(statuses.map((el) => el.textContent)).toEqual(['Draft', 'Published', 'Live']);
    await user.click(statuses[1] as HTMLElement);
    expect(edits.histSetStatus).toHaveBeenCalledWith('sent');
  });

  it('a starter accent outside the five shows NO swatch as active — the comp’s own behaviour', () => {
    renderInspector('header', bodyWith(allBlocks(), { accent: '#12805c' }));
    expect(screen.getAllByTestId('report-swatch').every((el) => el.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('the background is upload → thumb + Replace/Remove + an Overlay range at 0–95 (I3)', async () => {
    renderInspector('header');
    expect(screen.getByTestId('report-background-upload')).toBeDefined();
    expect(panel().textContent).toContain('Adds a full-bleed background behind the whole report');

    const { edits, user } = renderInspector('header', bodyWith(allBlocks(), { bgImage: PNG, bgTint: 0.5 }));
    const withImage = screen.getAllByTestId('report-inspector')[1] as HTMLElement;
    expect(within(withImage).getByTestId('report-background-replace')).toBeDefined();
    const range = within(withImage).getByTestId('report-background-tint') as HTMLInputElement;
    expect([range.min, range.max, range.value]).toEqual(['0', '95', '50']);
    await user.click(within(withImage).getByTestId('report-background-remove'));
    expect(edits.histSetHeader).toHaveBeenCalledWith('bgImage', '');
  });

  it('a selection that is neither the header nor a live block shows *Select a block* (I4)', () => {
    renderInspector('gone');
    expect(screen.getByTestId('report-none-panel').textContent).toContain('Select a block');
    expect(screen.getByTestId('report-inspector-title').textContent).toBe('Nothing selected');
  });
});

describe('every one of the 25 field groups (I6)', () => {
  const NAMED: Readonly<Record<ReportBlockKind, string>> = {
    heading: 'Text',
    text: 'Text',
    kpi: 'Label 1',
    bar: 'Label 1',
    line: 'Label 1',
    table: 'Row 1, first column',
    signature: 'Signatory name',
    terms: 'Checkbox label',
    attachments: 'File name 1',
    approval: 'Approver name',
    qr: 'Caption',
    latefees: 'Late fee rate',
    poterms: 'Purchase order terms',
    multicurrency: 'Base amount',
    recurring: 'Next date',
    discount: 'CODE 1',
    taxbreak: 'Tax label 1',
    payhistory: 'Date 1',
    legal: 'Legal footer',
    refund: 'Refund policy',
    contact: 'Contact name',
    loyalty: 'Points balance',
    delivery: 'Step 1',
    image: 'Placeholder caption',
    // The one kind with no group of its own: title, width, show and delete are
    // its whole panel (B25).
    divider: 'Block title',
  };

  it.each(REPORT_BLOCK_KINDS)('%s names its own control, and carries Width · Show · Delete', (kind) => {
    renderInspector(idOf(kind));
    const aside = panel();
    // The banner reads the kind's LABEL, never its glyph slug (D13).
    expect(within(aside).getByTestId('report-inspector-title').textContent).not.toMatch(/^[a-z][a-z0-9-]*$/);
    expect(within(aside).getByTestId('report-block-panel').getAttribute('data-kind')).toBe(kind);
    expect(within(aside).getByRole('textbox', { name: NAMED[kind] })).toBeDefined();
    // The three every kind shares (I7–I9).
    expect(within(aside).getAllByTestId('report-width-option').map((el) => el.getAttribute('data-value'))).toEqual(['full', 'half']);
    expect(within(aside).getByTestId('report-show-toggle').getAttribute('role')).toBe('switch');
    expect(within(aside).getByTestId('report-delete-block')).toBeDefined();
  });

  it('Width, Show and Delete reach their setters', async () => {
    const { edits, user } = renderInspector(idOf('text'));
    await user.click(screen.getAllByTestId('report-width-option')[1] as HTMLElement);
    expect(edits.histPatchBlock).toHaveBeenCalledWith('k1', { w: 'half' });
    await user.click(screen.getByTestId('report-show-toggle'));
    expect(edits.histPatchBlock).toHaveBeenCalledWith('k1', { show: false });
    await user.click(screen.getByTestId('report-delete-block'));
    expect(edits.deleteBlock).toHaveBeenCalledWith('k1');
  });
});

describe('the eight repeaters (I10) and the fills', () => {
  it('a KPI row carries Label · Value · Delta — the field the comp renders and cannot edit (D27/O8)', async () => {
    const { edits, user } = renderInspector(idOf('kpi'));
    const rows = screen.getAllByTestId('report-kpi-row');
    expect(rows).toHaveLength(2);
    const delta = within(rows[0] as HTMLElement).getByTestId('report-kpi-delta');
    // Every cell of every row has a name of its own — the comp names none (383).
    expect(rows.map((row) => within(row).getByTestId('report-kpi-delta').getAttribute('aria-label'))).toEqual(['Delta 1', 'Delta 2']);
    expect(delta.getAttribute('aria-label')).toBe('Delta 1');
    await user.type(delta, '+');
    expect(edits.updateArrayItem).toHaveBeenCalledWith('k2', 'kpis', 0, { delta: '+' });
    // …and *Add metric* seeds the comp's own `{ Metric, '0', '' }` (646).
    await user.click(screen.getByTestId('report-rows-add'));
    expect(edits.addArrayItem).toHaveBeenCalledWith('k2', 'kpis', { label: 'Metric', value: '0', delta: '' });
  });

  it('a series value is parsed as a number, and an unparseable keystroke reads as 0 (648)', async () => {
    const { edits, user } = renderInspector(idOf('bar'));
    const value = within(screen.getAllByTestId('report-series-row')[0] as HTMLElement).getByRole('textbox', { name: 'Value 1' });
    await user.clear(value);
    // Clearing sends '' — the comp's `parseFloat(…) || 0` makes that a zero-height
    // bar rather than a bar that vanishes.
    expect(edits.updateArrayItem).toHaveBeenCalledWith('k3', 'series', 0, { value: 0 });
    await user.type(value, '9');
    const last = (edits.updateArrayItem as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
    expect(typeof (last?.[3] as { value: unknown }).value).toBe('number');
  });

  it('the table adds the comp’s `[New, —]` row (544) and edits one cell at a time', async () => {
    const { edits, user } = renderInspector(idOf('table'));
    expect(screen.getAllByTestId('report-table-row')).toHaveLength(3);
    await user.click(screen.getByTestId('report-rows-add'));
    expect(edits.addRow).toHaveBeenCalledWith('k5', ['New', '—']);
    await user.type(screen.getByRole('textbox', { name: 'Row 1, second column' }), '!');
    expect(edits.updateRow).toHaveBeenCalledWith('k5', 0, 1, 'Value!');
  });

  it('the delivery status button cycles Pending → In progress → Done (667)', async () => {
    const body = bodyWith(allBlocks());
    const { edits, user } = renderInspector(idOf('delivery'), body);
    const buttons = screen.getAllByTestId('report-step-status');
    expect(buttons.map((el) => el.textContent)).toEqual(['Done', 'Done', 'In progress', 'Pending']);
    // The last seeded step is `todo`; one click makes it `current`.
    await user.click(buttons[3] as HTMLElement);
    expect(edits.updateArrayItem).toHaveBeenCalledWith('k22', 'delSteps', 3, { status: 'current' });
  });

  it('the image block gains Upload / Replace / Remove — the comp’s own background pattern (D26/O4)', async () => {
    renderInspector(idOf('image'));
    expect(screen.getByTestId('report-block-image-upload')).toBeDefined();
    expect(screen.queryByTestId('report-block-image-remove')).toBeNull();

    const withImage = allBlocks().map((b) => (b.kind === 'image' ? { ...b, url: PNG } : b));
    const { edits, user } = renderInspector(idOf('image'), bodyWith(withImage));
    const aside = screen.getAllByTestId('report-inspector')[1] as HTMLElement;
    await user.click(within(aside).getByTestId('report-block-image-remove'));
    expect(edits.histPatchBlock).toHaveBeenCalledWith('k23', { url: '' });
  });

  it('the two Appendix D renames are at the source (34 DEP-3/DEP-4)', () => {
    // The words the comp uses here are the ones 17 §2's sweep catches; they are
    // built from character codes so this file does not carry them as literals
    // and muffle a future grep over the tree.
    const slashMo = `% / ${String.fromCharCode(109, 111)}`;
    const tierWord = String.fromCharCode(84, 105, 101, 114);

    renderInspector(idOf('latefees'));
    expect(panel().textContent).toContain('% per month');
    expect(panel().textContent).not.toContain(slashMo);

    renderInspector(idOf('loyalty'));
    const loyalty = screen.getAllByTestId('report-inspector')[1] as HTMLElement;
    expect(within(loyalty).getByRole('textbox', { name: 'Level' })).toBeDefined();
    expect(loyalty.textContent).not.toContain(tierWord);
  });

  it('the approval and frequency options reach their `hist…` setters', async () => {
    const approval = renderInspector(idOf('approval'));
    const options = screen.getAllByTestId('report-approval-option');
    expect(options.map((el) => el.getAttribute('data-value'))).toEqual(['pending', 'approved', 'rejected']);
    await approval.user.click(options[2] as HTMLElement);
    expect(approval.edits.histPatchBlock).toHaveBeenCalledWith('k9', { apprStatus: 'rejected' });

    const recurring = renderInspector(idOf('recurring'));
    const freqs = screen.getAllByTestId('report-frequency-option');
    expect(freqs.map((el) => el.getAttribute('data-value'))).toEqual(['Weekly', 'Monthly', 'Quarterly', 'Annually']);
    await recurring.user.click(freqs[3] as HTMLElement);
    expect(recurring.edits.histPatchBlock).toHaveBeenCalledWith('k14', { recurFreq: 'Annually' });
  });

  it('the terms toggle is a switch that records a history step', async () => {
    const { edits, user } = renderInspector(idOf('terms'));
    const toggle = screen.getByTestId('report-prechecked');
    expect([toggle.getAttribute('role'), toggle.getAttribute('aria-checked')]).toEqual(['switch', 'false']);
    await user.click(toggle);
    expect(edits.histPatchBlock).toHaveBeenCalledWith('k7', { termsChecked: true });
  });
});
