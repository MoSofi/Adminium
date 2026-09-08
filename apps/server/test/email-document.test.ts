// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email document envelope and the starters (39-email-templates-and-
 * campaigns.md 39-T02, 39-T07).
 *
 * The starter assertions are the ones with teeth: every starter must
 * validate (a starter that the editor would refuse to save is a New button
 * that creates a broken document), must contain none of the 17 §2 sweep's
 * words in its English (seeded copy is user-visible and swept over built
 * bytes), and must use only vars the test-send samples fill.
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';

import { BUILTIN_EMAIL_TEMPLATE_VARS } from '../src/email/builtins.js';
import {
  EMAIL_BLOCK_DATA_SCHEMAS,
  bareAddress,
  documentVars,
  isBuiltinEmailKey,
  mintKey,
  normalizeDocument,
  slugKey,
  validateDocument,
  varTokens,
  type EmailDocument,
  type EmailDocumentInput,
} from '../src/email/document.js';
import { EMAIL_BLOCK_KINDS, renderEmail } from '../src/email/render.js';
import {
  EMAIL_STARTER_KEYS,
  STARTER_VARS,
  renderStarter,
  starterCards,
  starterSampleVars,
} from '../src/email/starters.js';
import { EMAIL_BLOCK_SAMPLES } from './email-samples.js';

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** 17 §2's grep, verbatim: substrings, case-insensitive. */
const TRAP_RE = /pricing|plan|tier|billing|upgrade|\/mo|free/i;

function ctx(over: Partial<Parameters<typeof validateDocument>[1]> = {}): Parameters<typeof validateDocument>[1] {
  return {
    senders: ['Acme <hi@acme.test>', 'news@acme.test'],
    maxAttachmentBytes: 10 * 1024 * 1024,
    attachmentSizes: new Map(),
    ...over,
  };
}

function doc(over: Partial<EmailDocumentInput> = {}): EmailDocument {
  return normalizeDocument({ subject: 'Hello {{name}}', blocks: [], ...over });
}

/** ICU-lite over `defaultValue`, the same stub `email-render.test.ts` uses. */
function stubT(key: string, opts?: Record<string, unknown>): string {
  const source = typeof opts?.['defaultValue'] === 'string' ? (opts['defaultValue'] as string) : key;
  return source.replaceAll(/\{(\w+)\}/g, (whole, name: string) => {
    const value = opts?.[name];
    return typeof value === 'string' ? value : whole;
  });
}

describe('normalizeDocument / validateDocument (39-T02)', () => {
  it('every kind’s sample data validates, and so does an empty record (the picker’s fresh block)', () => {
    for (const kind of EMAIL_BLOCK_KINDS) {
      const data = EMAIL_BLOCK_SAMPLES[kind];
      expect(data, `no sample for ${kind}`).toBeDefined();
      expect(EMAIL_BLOCK_DATA_SCHEMAS[kind].safeParse(data).success, `${kind} sample data`).toBe(true);
      validateDocument(doc({ blocks: [{ id: 'b', block: kind, data, style: {} }] }), ctx());
      validateDocument(doc({ blocks: [{ id: 'e', block: kind, data: {}, style: {} }] }), ctx());
    }
  });

  it('a {{var}}-only subject validates, and an unknown kind passes through byte-identical', () => {
    const odd = { id: 'x', block: 'email.future-kind', data: { anything: [1, { deep: true }] }, style: {} };
    const normalized = normalizeDocument({ subject: '{{title}}', blocks: [odd] });
    validateDocument(normalized, ctx());
    expect(normalized.blocks[0]).toEqual(odd);
  });

  it('lifts a trailing legacy footer block, mints missing ids, and drops an unknown style axis', () => {
    const normalized = normalizeDocument({
      subject: 'S',
      blocks: [
        { block: 'email.heading', data: { text: 'Hi' }, style: { pad: 'l', bogus: 1, bg: 'neon' } },
        { block: 'email.footer', id: 'f', data: { text: 'Bye' } },
      ],
    });
    expect(normalized.footer).toBe('Bye');
    expect(normalized.blocks).toHaveLength(1);
    expect(normalized.blocks[0]?.id).toMatch(/^b_/);
    // The whole style is dropped when an axis is invalid — cosmetic, never a refused save.
    expect(normalized.blocks[0]?.style).toEqual({});
  });

  it('refuses an unconfigured From, naming the address (39 D7)', () => {
    const bad = doc({ brand: { name: 'Acme', mark: 'zap', accent: '#0d9488', fromName: 'Acme', fromEmail: 'nope@acme.test' } });
    expect(() => validateDocument(bad, ctx())).toThrowError(
      expect.objectContaining({ statusCode: 422, details: { code: 'SENDER_NOT_CONFIGURED', address: 'nope@acme.test' } }),
    );
    // Angle-bracketed and differently-cased senders still match.
    validateDocument(doc({ brand: { name: '', mark: 'hexagon', accent: '#4f46e5', fromName: '', fromEmail: 'HI@acme.test' } }), ctx());
    // An empty From means "the workspace default" and is never checked.
    validateDocument(doc({ brand: { name: '', mark: 'hexagon', accent: '#4f46e5', fromName: '', fromEmail: '' } }), ctx());
    expect(bareAddress('Acme <hi@acme.test>')).toBe('hi@acme.test');
  });

  it('refuses attachments over the cap, naming the total and the cap (39 D8)', () => {
    const over = doc({
      attachments: [
        { id: 'a', kind: 'file', fileId: 'file_A' },
        { id: 'b', kind: 'file', fileId: 'file_B' },
        { id: 'c', kind: 'file', fileId: 'file_missing' },
        { id: 'd', kind: 'generated', label: 'Receipt', token: '{{receipt_pdf}}' },
      ],
    });
    const sizes = new Map<string, number | null>([
      ['file_A', 6_000_000],
      ['file_B', 5_000_000],
      ['file_missing', null],
    ]);
    expect(() => validateDocument(over, ctx({ attachmentSizes: sizes }))).toThrowError(
      expect.objectContaining({ details: { code: 'ATTACHMENTS_OVER_CAP', total: 11_000_000, cap: 10 * 1024 * 1024 } }),
    );
    // Under the cap, a missing file is NOT refused — the editor shows "File missing" instead.
    validateDocument(over, ctx({ attachmentSizes: sizes, maxAttachmentBytes: 20_000_000 }));
  });

  it('refuses an http image URL and malformed block data', () => {
    expect(() =>
      validateDocument(doc({ blocks: [{ id: 'i', block: 'email.image', data: { url: 'http://x.test/a.png' }, style: {} }] }), ctx()),
    ).toThrowError(expect.objectContaining({ details: expect.objectContaining({ code: 'IMAGE_URL_NOT_HTTPS' }) }));
    expect(() =>
      validateDocument(doc({ blocks: [{ id: 'l', block: 'email.list', data: { items: 'not a list' }, style: {} }] }), ctx()),
    ).toThrowError(expect.objectContaining({ details: expect.objectContaining({ code: 'BLOCK_DATA_INVALID', index: 0 }) }));
  });
});

describe('keys and vars', () => {
  it('mints Weekly digest twice as weekly-digest, weekly-digest-2, and never a built-in key', () => {
    expect(slugKey('Weekly digest — Week 28')).toBe('weekly-digest-week-28');
    expect(slugKey('Ünïcödé  name!')).toBe('unicode-name');
    expect(slugKey('---')).toBe('email');
    expect(mintKey('Weekly digest', [])).toBe('weekly-digest');
    expect(mintKey('Weekly digest', ['weekly-digest'])).toBe('weekly-digest-2');
    expect(mintKey('Weekly digest', ['weekly-digest', 'weekly-digest-2', 'weekly-digestive'])).toBe('weekly-digest-3');
    expect(isBuiltinEmailKey('password-reset')).toBe(true);
    expect(mintKey('Password reset', [])).toBe('password-reset-2');
    expect(mintKey('x'.repeat(200), ['x'.repeat(80)]).length).toBeLessThanOrEqual(80);
  });

  it('derives vars from what the document is (39 D18)', () => {
    expect(documentVars('password-reset')).toEqual(BUILTIN_EMAIL_TEMPLATE_VARS['password-reset']);
    expect(documentVars('weekly-digest')).toEqual(['appName', 'name', 'first_name', 'email']);
    expect(documentVars('order-receipt', 'receipt')).toEqual([
      'appName',
      'name',
      'first_name',
      'email',
      'order_number',
      'amount',
      'order_url',
      'receipt_pdf',
    ]);
    expect(varTokens(['name'])).toEqual(['{{name}}']);
  });
});

describe('starters (39-T07, D10)', () => {
  it('renders twelve cards in the comp’s order, four re-themed', () => {
    const cards = starterCards(stubT as never);
    expect(cards.map((c) => c.key)).toEqual([...EMAIL_STARTER_KEYS]);
    expect(cards.map((c) => c.name)).toEqual([
      'Welcome email',
      'Delivery update',
      'Order receipt',
      'Weekly digest',
      'Appointment reminder',
      'Feature announcement',
      'Feedback request',
      'Account paused',
      'Monthly report',
      'Confirm your email',
      'Payment failed',
      'Re-engagement',
    ]);
    expect(cards.find((c) => c.key === 'feature')?.accent).toBe('#ea580c');
    expect(cards.find((c) => c.key === 'welcome')?.accent).toBe('#4f46e5');
  });

  it('every starter validates, has no sweep word, uses only sampled vars, and renders', () => {
    const samples = starterSampleVars({ appName: 'Acme', origin: 'https://admin.test', to: 'ops@acme.test' });
    for (const key of EMAIL_STARTER_KEYS) {
      const starter = renderStarter(key, stubT as never);
      validateDocument(starter.document, ctx());

      const english = JSON.stringify({ name: starter.name, document: starter.document });
      const hit = TRAP_RE.exec(english);
      expect(hit, `${key} carries the sweep word "${hit?.[0] ?? ''}"`).toBeNull();
      expect(english).not.toContain('Adminium');
      expect(english).not.toContain('{{workspace}}');

      const used = new Set([...english.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? ''));
      for (const v of used) {
        expect(Object.hasOwn(samples, v) || v === 'receipt_pdf', `${key} uses {{${v}}} with no sample`).toBe(true);
        expect(
          documentVars(key, key).includes(v),
          `${key} uses {{${v}}}, which its vars do not declare`,
        ).toBe(true);
      }
      for (const v of STARTER_VARS[key]) {
        expect(used.has(v), `${key} declares ${v} but never uses it`).toBe(true);
      }

      const out = renderEmail({ document: starter.document, locale: 'en_US', vars: samples, dir: 'ltr' });
      // A starter's CTA is the last block, after its extras (the comp's `withExtras`), and it renders.
      const cta = starter.document.blocks.at(-1);
      expect(cta?.block).toBe('email.button');
      expect(out.html).toContain(String(cta?.data['label']).replaceAll('{{appName}}', 'Acme'));
      expect(out.text.length).toBeGreaterThan(40);
    }
  });

  it('the receipt ships a generated attachment whose token is resolved per send (39 D8)', () => {
    const receipt = renderStarter('receipt', stubT as never);
    expect(receipt.document.attachments).toEqual([
      expect.objectContaining({ kind: 'generated', label: 'Receipt PDF', token: '{{receipt_pdf}}' }),
    ]);
    expect(renderStarter('welcome', stubT as never).document.attachments).toEqual([]);
  });

  it('renders through the real translator in every compiled locale with only vocabulary kinds', async () => {
    for (const locale of BUILTIN_LOCALE_IDS) {
      const i18n = await createServerI18n({ locale });
      for (const key of EMAIL_STARTER_KEYS) {
        const starter = renderStarter(key, i18n.t);
        validateDocument(starter.document, ctx());
        expect(starter.document.subject.length, `${key}/${locale} has no subject`).toBeGreaterThan(0);
      }
    }
  });
});
