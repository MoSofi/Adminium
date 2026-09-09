// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The twelve starters, the blank document and the envelope
 * (43-report-builder.md Appendix B, Appendix C, Appendix D, §3.3; 43-T03).
 *
 * The assertions with teeth: every seeded string is swept for the 17 §2
 * substrings and for the company's name (seeded copy ships in a real row on
 * first use — 24 D12, and 43 Appendix D names each replacement); every one of
 * the 25 kinds round-trips encode → decode with its own fields; a block of an
 * unknown kind becomes a LABELLED placeholder rather than an empty card; and
 * the two 34 O18 caps refuse with a code that names the field.
 */
import { describe, expect, it } from 'vitest';

import {
  BODY_BYTES_MAX,
  IMAGE_DATA_URL_MAX,
  REPORT_BLOCK_KINDS,
  acceptReportBody,
  assertBodyWithinCaps,
  emptyBody,
  inlineImages,
  isReportBlockKind,
  isReportStatus,
  normalizeReportBody,
  reportBodyInputSchema,
  reportBodySchema,
  unknownBlockText,
  type ReportBlock,
} from '../src/report-documents/document.js';
import {
  BLANK_ICON,
  STARTER_KEYS,
  blankBody,
  isReportStarterKey,
  renderStarter,
  starterCards,
  thumbSeries,
} from '../src/report-documents/starters.js';
import { summaryOf } from '../src/report-documents/summary.js';

/** 17 §2's grep, verbatim: substrings, case-insensitive. */
const TRAP_RE = /pricing|plan|tier|billing|upgrade|\/mo|free/i;

const CATEGORIES = ['leadership', 'operations', 'revenue', 'growth', 'finance', 'product', 'success', 'engineering'];

describe('the twelve starters (Appendix C, Appendix D)', () => {
  it('has the comp’s twelve keys in its order, and eight clean category keys', () => {
    expect([...STARTER_KEYS]).toEqual([
      'exec',
      'weekly',
      'mbr',
      'sales',
      'marketing',
      'finance',
      'product',
      'health',
      'campaign',
      'board',
      'incident',
      'scorecard',
    ]);
    const cards = starterCards();
    expect(cards.map((c) => c.key)).toEqual([...STARTER_KEYS]);
    for (const card of cards) {
      expect(CATEGORIES, card.key).toContain(card.category);
      expect(card.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(card.icon.length).toBeGreaterThan(0);
      expect(card.blockCount).toBeGreaterThan(0);
      expect(card.series.length).toBeGreaterThan(0);
      expect(card.series.length).toBeLessThanOrEqual(6);
    }
    expect(cards.find((c) => c.key === 'health')).toMatchObject({
      name: 'Customer health',
      category: 'success',
      icon: 'heart-pulse',
      reportTitle: 'Account Health',
      // Not one of the five swatches (633) — the comp's own, kept.
      accent: '#12805c',
    });
    expect(cards.find((c) => c.key === 'exec')?.accent).toBe('#4f46e5');
    expect(isReportStarterKey('scorecard')).toBe(true);
    expect(isReportStarterKey('quarterly')).toBe(false);
  });

  it('no seeded string trips the 17 §2 sweep or names the company (Appendix D)', () => {
    const documents = [blankBody(), ...STARTER_KEYS.map((key) => renderStarter(key).body)];
    for (const [index, body] of documents.entries()) {
      const text = JSON.stringify(body);
      expect(TRAP_RE.exec(text)?.[0], `document ${String(index)}`).toBeUndefined();
      expect(/adminium/i.test(text), `document ${String(index)} names the company`).toBe(false);
    }
    const cards = JSON.stringify(starterCards());
    expect(TRAP_RE.exec(cards)?.[0]).toBeUndefined();
    expect(/adminium/i.test(cards)).toBe(false);
  });

  it('applies Appendix D’s three copy replacements at the source', () => {
    const exec = JSON.stringify(renderStarter('exec').body);
    expect(exec).toContain('driven by expansion in larger accounts');
    expect(exec).not.toContain('Team tier');
    const mbr = JSON.stringify(renderStarter('mbr').body);
    expect(mbr).toContain('Mitigation work in progress');
    const board = JSON.stringify(renderStarter('board').body);
    expect(board).toContain('the expanded hiring roadmap');
  });

  it('each starter is the comp’s body: header, blocks in order, seeded values', () => {
    const exec = renderStarter('exec').body;
    expect(exec).toMatchObject({
      accent: '#4f46e5',
      kicker: 'Quarterly report',
      reportTitle: 'Q3 2026 Executive Summary',
      subtitle: 'For the leadership team · Jul 1 – Sep 30',
      bgImage: '',
      bgTint: 0.82,
    });
    expect(exec.blocks.map((b) => [b.kind, b.title])).toEqual([
      ['text', 'Overview'],
      ['kpi', 'Key metrics'],
      ['bar', 'Revenue by month'],
      ['table', 'Top accounts'],
    ]);
    const kpi = exec.blocks[1];
    expect(kpi?.kind === 'kpi' && kpi.kpis).toEqual([
      { label: 'MRR', value: '$482k', delta: '+12%' },
      { label: 'Customers', value: '8,420', delta: '+340' },
      { label: 'Churn', value: '1.9%', delta: '−0.2%' },
    ]);
    const bar = exec.blocks[2];
    expect(bar?.kind === 'bar' && bar.series.map((p) => p.value)).toEqual([52, 68, 60, 82, 74, 96]);
    const table = exec.blocks[3];
    expect(table?.kind === 'table' && table.rows[0]).toEqual(['Account', 'Revenue']);
    // Every block is full width and shown; every id is unique within the body.
    for (const block of exec.blocks) expect([block.w, block.show]).toEqual(['full', true]);
    expect(new Set(exec.blocks.map((b) => b.id)).size).toBe(exec.blocks.length);
    // A kind REPEATS — the scorecard has two KPI blocks (comp 491).
    expect(renderStarter('scorecard').body.blocks.map((b) => b.kind)).toEqual(['kpi', 'kpi']);
    // A divider carries the palette label as its title (`blk`, 474).
    expect(renderStarter('mbr').body.blocks.map((b) => b.kind)).toEqual(['heading', 'kpi', 'bar', 'divider', 'text']);
    expect(renderStarter('mbr').body.blocks[3]?.title).toBe('Divider');
    // Two starters never share block ids.
    const a = renderStarter('exec').body.blocks.map((b) => b.id);
    const b = renderStarter('exec').body.blocks.map((x) => x.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it('the blank document is the comp’s `createBlank` (554)', () => {
    const body = blankBody();
    expect(body).toMatchObject({ kicker: 'Report', reportTitle: 'Untitled report', subtitle: 'Add a subtitle', accent: '#4f46e5' });
    expect(body.blocks).toHaveLength(1);
    const only = body.blocks[0];
    expect(only?.kind === 'text' && only.text).toBe('Start writing your report, or add a block from the left.');
    expect(BLANK_ICON).toBe('file-text');
  });

  it('the thumbnail series is the first bar/line block’s, capped at six, with the comp’s fallback', () => {
    // exec's bar has six values.
    expect(thumbSeries(renderStarter('exec').body.blocks)).toEqual([52, 68, 60, 82, 74, 96]);
    // weekly's LINE comes after a kpi — the first chart of either kind wins (570).
    expect(thumbSeries(renderStarter('weekly').body.blocks)).toEqual([40, 55, 62, 58, 78, 44]);
    // finance draws no chart at all.
    expect(thumbSeries(renderStarter('finance').body.blocks)).toEqual([40, 66, 52, 78, 60]);
    // Seven points, six bars.
    expect(
      thumbSeries([{ kind: 'bar', series: [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value })) }]),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the summary (D15/D16)', () => {
  it('carries exactly what the comp’s card thumbnail draws', () => {
    const starter = renderStarter('exec');
    expect(summaryOf(starter.body, { starterIcon: starter.card.icon })).toEqual({
      reportTitle: 'Q3 2026 Executive Summary',
      kicker: 'Quarterly report',
      accent: '#4f46e5',
      blockCount: 4,
      kpiCount: 3,
      series: [52, 68, 60, 82, 74, 96],
      starterIcon: 'briefcase',
    });
  });

  it('kpiCount is min(3, kpis) of the FIRST kpi block, and three when there is none (584)', () => {
    // scorecard's first kpi block has four metrics; the comp draws three boxes.
    expect(summaryOf(renderStarter('scorecard').body).kpiCount).toBe(3);
    // incident draws no kpi block at all — the comp still draws three boxes.
    expect(summaryOf(renderStarter('incident').body).kpiCount).toBe(3);
    const one = normalizeReportBody({ blocks: [{ id: 'b1', kind: 'kpi', kpis: [{ label: 'A', value: '1' }] }] });
    expect(summaryOf(one).kpiCount).toBe(1);
    // A blank document's icon is the fallback.
    expect(summaryOf(blankBody()).starterIcon).toBe('file-text');
  });
});

describe('the envelope (§3.3)', () => {
  it('the palette order IS the kind list, and every kind is recognised', () => {
    expect(REPORT_BLOCK_KINDS).toHaveLength(25);
    expect([...REPORT_BLOCK_KINDS].slice(0, 6)).toEqual(['heading', 'text', 'kpi', 'bar', 'line', 'table']);
    expect([...REPORT_BLOCK_KINDS].slice(-2)).toEqual(['image', 'divider']);
    for (const kind of REPORT_BLOCK_KINDS) expect(isReportBlockKind(kind)).toBe(true);
    expect(isReportBlockKind('totals')).toBe(false);
    expect(isReportStatus('sent')).toBe(true);
    // The INVOICE vocabulary, not this one.
    expect(isReportStatus('paid')).toBe(false);
  });

  it('every one of the 25 kinds round-trips encode → decode with its own fields', () => {
    const seeds: Record<string, Record<string, unknown>> = {
      heading: { text: 'New heading' },
      text: { text: 'A paragraph.' },
      kpi: { kpis: [{ label: 'Metric', value: '0', delta: '' }] },
      bar: { series: [{ label: 'A', value: 40 }] },
      line: { series: [{ label: 'A', value: 30.5 }] },
      table: { rows: [['Column', 'Value']] },
      signature: { sigName: 'Ava Reyes', sigTitle: 'Prepared by' },
      terms: { termsLabel: 'I approve.', termsChecked: true },
      attachments: { attachments: [{ name: 'Appendix.xlsx', size: '128 KB' }] },
      approval: { apprName: 'Ava', apprTitle: 'Owner', apprStatus: 'approved' },
      qr: { qrCaption: 'Scan to open' },
      latefees: { lateRate: '1.5', lateDays: 7 },
      poterms: { poTerms: 'Standard terms.' },
      multicurrency: { mcAmount: '48200', fx: [{ code: 'EUR', sym: '€', rate: '0.92' }] },
      recurring: { recurFreq: 'Quarterly', recurNext: 'Aug 12, 2026', recurCount: '12 cycles' },
      discount: { discCodes: [{ code: 'WELCOME10', label: '10% credit', amount: '-$29.00' }] },
      taxbreak: { taxLines: [{ label: 'State tax (6%)', amount: '$28.90' }] },
      payhistory: { payHist: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$500.00', status: 'failed' }] },
      legal: { legalText: 'Unaudited.' },
      refund: { refText: 'Within 30 days.' },
      contact: { conName: 'Orchard Lane Studio', conEmail: 'hello@orchardlane.example', conPhone: '+1 (555) 010-0100' },
      loyalty: { loyBalance: 1240, loyEarned: 290, loyLevel: 'Gold' },
      delivery: { delSteps: [{ label: 'Shipped', status: 'current' }] },
      image: { text: 'image placeholder', url: '' },
      divider: {},
    };
    const raw = REPORT_BLOCK_KINDS.map((kind, i) => ({ id: `b${String(i)}`, kind, title: kind, w: 'full', show: true, ...seeds[kind] }));
    const body = normalizeReportBody({ accent: '#0d9488', kicker: 'K', reportTitle: 'T', subtitle: 'S', blocks: raw });
    expect(body.blocks.map((b) => b.kind)).toEqual([...REPORT_BLOCK_KINDS]);
    // The reply schema accepts the normalizer's output for every kind…
    expect(reportBodySchema.safeParse(body).success).toBe(true);
    // …and the wire schema accepts it back, so a save of what was loaded is legal.
    expect(reportBodyInputSchema.safeParse(body).success).toBe(true);
    // …and a second pass is a fixed point.
    expect(normalizeReportBody(body)).toEqual(body);
    const by = (kind: string): ReportBlock => body.blocks.find((b) => b.kind === kind) as ReportBlock;
    expect(by('latefees')).toMatchObject({ lateRate: '1.5', lateDays: 7 });
    expect(by('multicurrency')).toMatchObject({ mcAmount: '48200' });
    expect(by('loyalty')).toMatchObject({ loyBalance: 1240, loyEarned: 290, loyLevel: 'Gold' });
    expect(by('payhistory')).toMatchObject({ payHist: [expect.objectContaining({ status: 'failed' })] });
    expect(by('line')).toMatchObject({ series: [{ label: 'A', value: 30.5 }] });
  });

  it('a block of an unknown kind becomes a labelled placeholder, never an empty card (34-T47)', () => {
    const body = normalizeReportBody({ blocks: [{ id: 'b1', kind: 'gantt', title: 'Timeline', w: 'half', show: false }] });
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toEqual({
      id: 'b1',
      kind: 'text',
      title: 'Timeline',
      w: 'half',
      show: false,
      text: unknownBlockText('gantt'),
    });
  });

  it('decodes leniently: absent fields default, a bad shape never throws, ids never collide', () => {
    expect(normalizeReportBody(null)).toEqual(emptyBody());
    expect(normalizeReportBody('nope')).toEqual(emptyBody());
    const body = normalizeReportBody({
      accent: 'not-a-hex',
      bgTint: 4,
      blocks: [
        { kind: 'kpi', kpis: 'nope' },
        { id: 'same', kind: 'bar', series: [{ label: 1, value: '52' }] },
        { id: 'same', kind: 'divider' },
        'not an object',
      ],
    });
    expect(body.accent).toBe('#4f46e5');
    // The tint is clamped to the range the comp's slider offers (0-95%).
    expect(body.bgTint).toBe(0.95);
    expect(body.blocks).toHaveLength(4);
    expect(body.blocks[0]).toMatchObject({ kind: 'kpi', kpis: [], id: 'blk_0', title: '', w: 'full', show: true });
    expect(body.blocks[1]).toMatchObject({ kind: 'bar', series: [{ label: '1', value: 52 }] });
    // A duplicate id is re-minted — two cards must never move as one.
    expect(body.blocks[2]?.id).not.toBe('same');
    expect(new Set(body.blocks.map((b) => b.id)).size).toBe(4);
    // An unparseable entry still becomes a block rather than shifting the stack.
    expect(body.blocks[3]?.kind).toBe('text');
    // A `w` that is not `half` is `full`; a `recurFreq` that is not one of four is Monthly.
    const odd = normalizeReportBody({ blocks: [{ id: 'x', kind: 'recurring', w: 'wide', recurFreq: 'Daily' }] });
    expect(odd.blocks[0]).toMatchObject({ w: 'full', recurFreq: 'Monthly' });
  });

  it('the caps refuse with a code that names the field (34 O18)', () => {
    const big = `data:image/png;base64,${'A'.repeat(IMAGE_DATA_URL_MAX)}`;
    const withBg = normalizeReportBody({ bgImage: big });
    expect(() => {
      assertBodyWithinCaps(withBg);
    }).toThrowError(/over the cap/);
    try {
      assertBodyWithinCaps(withBg);
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details).toMatchObject({ code: 'IMAGE_TOO_LARGE', field: 'bgImage' });
    }
    // An image BLOCK's picture is the second slot, and the refusal names it.
    const withBlock = normalizeReportBody({ blocks: [{ id: 'pic', kind: 'image', text: 'c', url: big }] });
    expect(inlineImages(withBlock).map((i) => i.field)).toEqual(['bgImage', 'blocks.pic.url']);
    try {
      assertBodyWithinCaps(withBlock);
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details).toMatchObject({ code: 'IMAGE_TOO_LARGE', field: 'blocks.pic.url' });
    }
    // A plain URL is never that long and is never refused.
    expect(() => {
      assertBodyWithinCaps(normalizeReportBody({ bgImage: 'https://example.test/letterhead.png' }));
    }).not.toThrow();
    // The whole-body cap.
    const fat = normalizeReportBody({ blocks: [{ id: 'b', kind: 'text', text: 'x' }], subtitle: 'y' });
    fat.bgImage = `https://example.test/${'a'.repeat(BODY_BYTES_MAX)}`;
    try {
      assertBodyWithinCaps(fat);
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details).toMatchObject({ code: 'BODY_TOO_LARGE' });
    }
    // `acceptReportBody` is the one door: normalize, then the caps.
    expect(acceptReportBody({ reportTitle: 'ok' }).reportTitle).toBe('ok');
  });
});
