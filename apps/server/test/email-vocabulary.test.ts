// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REGRESSION: the mail renderer must send everything the builder can author.
 *
 * This is the OTHER half of the Email Templates defect. The canvas half — a
 * seeded row loading as an empty page — is asserted in
 * `apps/dashboard/src/pages/builders/emailSeededTemplate.test.tsx`. This file
 * asserts the reverse trip: a block added in the builder has to survive
 * `renderEmail`.
 *
 * It did not. The builder's palette offered only `block-*` document ids
 * (`block-discount-codes`, `block-qr-pay`, …), `renderEmail` skips any kind
 * outside `EMAIL_BLOCK_KINDS` — deliberately, so a stale row can't 500 a
 * password reset — and so every block the surface could add was silently
 * dropped on send. An admin edited a template, saw it save, and the recipient
 * got a message with nothing in it.
 *
 * The two assertions below are what make that unrepresentable:
 *
 *   1. every kind in the vocabulary renders NON-EMPTY html and text, so
 *      "the palette can only offer vocabulary kinds" (held by
 *      `scripts/check-email-block-vocab.mjs`) is worth something;
 *   2. every block the real `builtins.ts` seed writes is a vocabulary kind, so
 *      the fixture the dashboard suite copied out of a live install cannot
 *      drift away from what the seed actually produces.
 *
 * Note what is NOT asserted: that an unknown kind throws. It must not — see the
 * renderer's header. Skipping is correct; skipping a kind we ship in the
 * palette was the bug.
 */
import { describe, expect, it } from 'vitest';

import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';

import { builtinEmailTemplates } from '../src/email/builtins.js';
import { EMAIL_BLOCK_KINDS, isEmailBlockKind, renderEmail } from '../src/email/render.js';

/**
 * A minimal but VALID payload per kind. Deliberately spelled out rather than
 * generated: the renderer drops a block whose required fields are missing
 * (a button with no url renders nothing at all), so a generated stub would
 * quietly assert the empty case and pass while proving nothing.
 */
const SAMPLE: Record<string, Record<string, unknown>> = {
  'email.heading': { text: 'Reset your password', level: 1 },
  'email.text': { text: 'Hi {{name}}, here is the thing you asked for.' },
  'email.button': { label: 'Choose a new password', url: 'https://example.test/reset' },
  'email.divider': {},
  'email.spacer': { size: 24 },
  'email.footer': { text: 'You are receiving this because you have an account.' },
};

describe('email block vocabulary', () => {
  it('renders every kind the builder can author into non-empty html', () => {
    for (const kind of EMAIL_BLOCK_KINDS) {
      const sample = SAMPLE[kind];
      expect(sample, `no sample payload for ${kind} — add one when adding a kind`).toBeDefined();

      const out = renderEmail({
        template: { subject: 'S', blocks: [{ block: kind, id: 'b1', data: sample }] },
        locale: 'en_US',
        vars: { name: 'Ada' },
        dir: 'ltr',
      });

      // The body cell is the only part that varies; the chrome renders either
      // way, so assert on content that could only come from the block.
      const body = out.html.split('padding:32px;font-family:')[1] ?? '';
      expect(body.trim(), `${kind} rendered no html`).not.toBe('');
      expect(body, `${kind} rendered only the empty cell`).toMatch(/<(h1|h2|p|table|div|a)/);
    }
  });

  it('renders a whole canvas-authored document, in order', () => {
    const out = renderEmail({
      template: {
        subject: 'Reset your password',
        blocks: EMAIL_BLOCK_KINDS.map((kind, index) => ({
          block: kind,
          id: `${kind}-${String(index)}`,
          data: SAMPLE[kind],
        })),
      },
      locale: 'en_US',
      vars: {},
      dir: 'ltr',
    });

    expect(out.html).toContain('Reset your password');
    expect(out.html).toContain('https://example.test/reset');
    expect(out.text).toContain('Choose a new password: https://example.test/reset');
    // Heading before footer — block order is the document order.
    expect(out.html.indexOf('Reset your password')).toBeLessThan(
      out.html.indexOf('You are receiving this because'),
    );
  });

  /*
    The REAL translator, not the ICU-lite stub `email-render.test.ts` uses. That
    stub is right for snapshots — it keeps translation commits from rewriting
    them — but this assertion is about what the seed WRITES to the table in each
    of the eight compiled locales, so it has to run the same `createServerI18n`
    path `seedBuiltinEmailTemplates` runs. Overrides are omitted: compiled text
    only, since a DB override changes copy and never block structure.
  */
  it('seeds only kinds the renderer dispatches, in every compiled locale', async () => {
    for (const locale of BUILTIN_LOCALE_IDS) {
      const i18n = await createServerI18n({ locale });
      for (const template of builtinEmailTemplates(i18n.t)) {
        expect(template.blocks.length, `${template.key}/${locale} seeded no blocks`).toBeGreaterThan(0);
        for (const block of template.blocks) {
          const kind = block['block'];
          expect(
            isEmailBlockKind(kind),
            `${template.key}/${locale} seeds "${String(kind)}", which renderEmail would silently drop`,
          ).toBe(true);
        }
      }
    }
  });

  it('still skips an unknown kind rather than throwing (a stale row must not 500 a reset)', () => {
    const out = renderEmail({
      template: {
        subject: 'S',
        blocks: [
          { block: 'block-discount-codes', id: 'x', data: { rows: [] } },
          { block: 'email.text', id: 'b1', data: SAMPLE['email.text'] },
        ],
      },
      locale: 'en_US',
      vars: { name: 'Ada' },
      dir: 'ltr',
    });

    expect(out.html).toContain('here is the thing you asked for');
    expect(out.html).not.toContain('discount');
  });
});
