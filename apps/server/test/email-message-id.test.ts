// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign mail's Message-ID names its send-log row: made from the row's id
 * and the From's domain, and read back from whatever form a mail service
 * hands it in (with or without brackets, in another case). Anything else
 * names no row.
 */
import { describe, expect, it } from 'vitest';

import { campaignMessageId, campaignSendOfReport, sendIdOfMessageId } from '../src/email/message-id.js';

const ROW = 'esnd_01JB2Y7Z5Q3S8T9V0W1X2Y3Z4A';

describe('a campaign mail’s Message-ID', () => {
  it('is the row’s id at the From’s domain; a From that is not a plain host reads localhost', () => {
    expect(campaignMessageId(ROW, 'Meridian <News@Meridian.Example>')).toBe(`<${ROW}@meridian.example>`);
    expect(campaignMessageId(ROW, 'news@meridian.example')).toBe(`<${ROW}@meridian.example>`);
    expect(campaignMessageId(ROW, 'no-domain')).toBe(`<${ROW}@localhost>`);
    expect(campaignMessageId(ROW, 'news@meridian example\r\nBcc: y')).toBe(`<${ROW}@localhost>`);
  });

  it('names its row however it comes back, and nothing else names one', () => {
    expect(sendIdOfMessageId(`<${ROW}@meridian.example>`)).toBe(ROW);
    expect(sendIdOfMessageId(`${ROW.toLowerCase()}@meridian.example`)).toBe(ROW);
    expect(sendIdOfMessageId(` <${ROW}@a.b> `)).toBe(ROW);
    for (const other of [null, undefined, '', '<custom-message-ID>', '20130503192659.13651.20287@sandboxes.mailgun.org', `<${ROW}>`, `<x${ROW}@a.b>`, '<esnd_01JB2Y7Z5Q3S8T9V0W1X2Y3Z4@a.b>', '<esnd_01JB2Y7Z5Q3S8T9V0W1X2Y3ZIL@a.b>']) {
      expect(sendIdOfMessageId(other)).toBeNull();
    }
  });

  it('a mail-queue report names a row only when it is a campaign’s', () => {
    expect(campaignSendOfReport({ app: 'adminium.campaign', table: 'adminium_email_sends', pk: { id: ROW } })).toBe(ROW);
    expect(campaignSendOfReport({ app: 'crm', table: 'adminium_email_sends', pk: { id: ROW } })).toBeNull();
    expect(campaignSendOfReport({ app: 'adminium.campaign', table: 'adminium_email_sends', pk: { id: 'not-a-row' } })).toBeNull();
    expect(campaignSendOfReport(undefined)).toBeNull();
  });
});
