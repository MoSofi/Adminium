// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block that lists rows, and QR codes, as the renderer draws them: each
 * row's own variables over the message's, escaped; a QR code by `cid:` on
 * white, one image per code; no image cell for a row that names none; the
 * block's `empty` words when there are no rows, and nothing when it has
 * none; right to left; and a `.qr` met in text printed as the code.
 */
import { describe, expect, it } from 'vitest';

import { qrRefs } from '../src/email/send.js';
import { renderEmail } from '../src/email/render.js';

const rowsBlock = (data: Record<string, unknown>) => ({ block: 'email.rows', id: 'tickets', data });
const TICKETS = {
  from: { link: 'order', table: 'main.tickets', via: 'order_id' },
  row: { title: '{{row.holder_name}}', meta: '{{row.type}} · {{row.code}}', amount: '{{row.price}}', note: '{{row.pay_line}}', image: '{{row.code.qr}}' },
  empty: 'No tickets for {{order.ref}}',
};
const MIA = { 'row.holder_name': 'Mia Okada', 'row.type': 'Standard', 'row.code': 'K7QX-M2PD', 'row.code.qr': 'K7QX-M2PD', 'row.price': '$42.00', 'row.pay_line': 'Paid by card' };
const KAI = { 'row.holder_name': 'Kai Renner', 'row.type': 'Standard', 'row.code': 'R4FN-7HCW', 'row.code.qr': 'R4FN-7HCW', 'row.price': '$42.00', 'row.pay_line': '' };

const render = (blocks: unknown[], rows?: Record<string, Record<string, string>[]>, dir: 'ltr' | 'rtl' = 'ltr') =>
  renderEmail({ template: { subject: 'Your tickets', blocks }, locale: dir === 'rtl' ? 'ar_EG' : 'en_US', vars: { 'order.ref': 'WV-8815' }, dir, ...(rows === undefined ? {} : { rows }) });

describe('a block that lists rows', () => {
  it('draws each row with its own variables, a QR code by cid, the amount at the far side', () => {
    const out = render([rowsBlock(TICKETS)], { tickets: [MIA, KAI] });
    expect(out.html).toContain('Mia Okada');
    expect(out.html).toContain('Standard · K7QX-M2PD');
    expect(out.html).toContain('<img src="cid:qr-1" width="116" height="116" alt="K7QX-M2PD"');
    expect(out.html).toContain('<img src="cid:qr-2" width="116" height="116" alt="R4FN-7HCW"');
    expect(out.html).toContain('bgcolor="#ffffff"');
    expect(out.html.indexOf('Mia Okada')).toBeLessThan(out.html.indexOf('Kai Renner'));
    expect(out.text).toContain('• Mia Okada — Standard · K7QX-M2PD — $42.00\n  Paid by card');
    expect(out.text).toContain('• Kai Renner — Standard · R4FN-7HCW — $42.00');
    expect(qrRefs(out)).toEqual([
      { cid: 'qr-1', text: 'K7QX-M2PD' },
      { cid: 'qr-2', text: 'R4FN-7HCW' },
    ]);
  });

  it('draws one image for a code shown twice', () => {
    const out = render([rowsBlock(TICKETS), { block: 'email.image', id: 'door', data: { qr: '{{row.code.qr}}' } }], { tickets: [MIA, MIA] });
    expect(out.html.match(/cid:qr-1/g)).toHaveLength(2);
    expect(qrRefs(out)).toHaveLength(1);
  });

  it('leaves the image cell out of a row that names no image', () => {
    const out = render([rowsBlock({ ...TICKETS, row: { title: '{{row.holder_name}}', amount: '{{row.price}}' } })], { tickets: [MIA] });
    expect(out.html).not.toContain('<img src="cid:qr');
    expect(out.html).not.toContain('width="134"');
    expect(qrRefs(out)).toEqual([]);
  });

  it("escapes what a row holds: a name is text, never markup", () => {
    const out = render([rowsBlock(TICKETS)], { tickets: [{ ...MIA, 'row.holder_name': '<img src=x onerror=alert(1)>' }] });
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('says its empty words with no rows, and is left out without them', () => {
    expect(render([rowsBlock(TICKETS)], { tickets: [] }).text).toContain('No tickets for WV-8815');
    // A campaign, a test send and a preview read no rows.
    expect(render([rowsBlock(TICKETS)]).text).toContain('No tickets for WV-8815');
    const bare = render([{ block: 'email.heading', data: { text: 'Hi' } }, rowsBlock({ ...TICKETS, empty: undefined })]);
    expect(bare.html).not.toContain('No tickets');
    expect(bare.html.match(/padding:30px 28px 0 28px;/g) ?? []).toHaveLength(0);
  });

  it('lays a row out right to left in a right-to-left email', () => {
    const out = render([rowsBlock(TICKETS)], { tickets: [MIA] }, 'rtl');
    expect(out.html).toContain('padding-left:14px;');
    expect(out.html).toContain('text-align:right;');
    expect(out.html).toMatch(/<td align="left" valign="top" style="padding-right:10px;/);
  });

  it('prints a QR code met in text as its code, and draws one only as the whole value of an image', () => {
    const out = renderEmail({
      template: {
        subject: 'Your ticket {{ticket.code.qr}}',
        blocks: [
          { block: 'email.text', data: { text: 'Show {{ticket.code.qr}} at the door' } },
          { block: 'email.image', data: { qr: '{{ticket.code.qr}}', size: 150 } },
          { block: 'email.image', data: { qr: 'Scan {{ticket.code.qr}}' } },
          { block: 'email.image', data: { qr: '{{ticket.missing.qr}}' } },
        ],
      },
      locale: 'en_US',
      vars: { 'ticket.code.qr': 'K7QX-M2PD' },
      dir: 'ltr',
    });
    expect(out.subject).toBe('Your ticket K7QX-M2PD');
    expect(out.text).toContain('Show K7QX-M2PD at the door');
    expect(out.html.match(/<img src="cid:qr-/g)).toHaveLength(1);
    expect(out.html).toContain('width="150" height="150"');
  });
});
