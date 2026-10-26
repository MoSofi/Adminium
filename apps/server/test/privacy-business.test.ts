// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE BUSINESS NAME, on SQLite, Postgres and MySQL meta stores: the pay
 * page's own shop name first, then the privacy setting "Business name", then
 * the workspace's name, then the public address's host. The software's own
 * name is never the business's. The pay page's mails, the marketing footer
 * and the mail door read the same name; the marketing footer's postal
 * address is the setting, and none while it is not set.
 */
import { paymentSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { businessNameOf, postalAddressOf } from '../src/email/sender/marketing-settings.js';
import { shopFace } from '../src/payments/emails.js';
import { businessName, pickBusinessName, PAY_PAGE_SETTINGS_DOC, privacyNoticeOf, privacyNoticeReady } from '../src/privacy/business.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

describe('the order of the business name', () => {
  it('takes the pay page, then the setting, then the workspace, then the host', () => {
    const all = { payPage: 'Meridian Shop', setting: 'Meridian Workplace Ltd', workspace: 'Meridian CRM', origin: 'https://crm.meridian.example' };
    expect(pickBusinessName(all)).toBe('Meridian Shop');
    expect(pickBusinessName({ ...all, payPage: null })).toBe('Meridian Workplace Ltd');
    expect(pickBusinessName({ ...all, payPage: '  ', setting: null })).toBe('Meridian CRM');
    expect(pickBusinessName({ ...all, payPage: null, setting: null, workspace: null })).toBe('crm.meridian.example');
    expect(pickBusinessName({ payPage: null, setting: null, workspace: null, origin: null })).toBe('');
  });

  it('never takes the software’s own name', () => {
    expect(pickBusinessName({ payPage: 'Adminium', setting: null, workspace: 'Adminium', origin: 'https://crm.meridian.example' })).toBe('crm.meridian.example');
    expect(pickBusinessName({ payPage: 'Adminium', setting: 'Meridian Workplace Ltd', workspace: 'Adminium', origin: null })).toBe('Meridian Workplace Ltd');
  });

  it('reads the pay page from the document the pay page writes', () => {
    expect(PAY_PAGE_SETTINGS_DOC).toBe(PAY_PAGE_DOC);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`one business name [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    const page = (shopName: string) => paymentSettingsRepo(meta).set(PAY_PAGE_DOC, payPageSchema, { shopName, logoFileId: null, contactEmail: 'shop@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
    }, 60_000);
    afterAll(async () => {
      await handle?.destroy();
    });

    it('every reader takes the same name, in the one order', async () => {
      const settings = settingsRepo(meta);
      // Nothing named: the public address's host, never "Adminium".
      await settings.set('system.publicOrigin', 'https://crm.meridian.example');
      expect(await businessName(meta)).toBe('crm.meridian.example');
      expect(await businessNameOf(meta)).toBe('crm.meridian.example');
      expect((await shopFace(meta)).name).toBe('crm.meridian.example');

      await settings.set('branding.appName', 'Meridian CRM');
      expect(await businessNameOf(meta)).toBe('Meridian CRM');

      await settings.set('privacy.businessName', 'Meridian Workplace Ltd');
      expect(await businessName(meta)).toBe('Meridian Workplace Ltd');
      expect(await businessNameOf(meta)).toBe('Meridian Workplace Ltd');
      expect((await shopFace(meta)).name).toBe('Meridian Workplace Ltd');

      // The pay page's own name wins wherever it is read.
      await page('Meridian Shop');
      expect(await businessName(meta)).toBe('Meridian Shop');
      expect(await businessNameOf(meta)).toBe('Meridian Shop');
      expect(await shopFace(meta)).toMatchObject({ name: 'Meridian Shop', email: 'shop@meridian.example' });

      // A pay page still named after the software counts as unnamed.
      await page('Adminium');
      expect(await businessName(meta)).toBe('Meridian Workplace Ltd');
    });

    it('reads the postal address and the privacy notice as set, and none while they are not', async () => {
      const settings = settingsRepo(meta);
      expect(await postalAddressOf(meta)).toBeNull();
      await settings.set('email.postalAddress', 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom');
      expect(await postalAddressOf(meta)).toBe('Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom');
      await settings.set('email.postalAddress', null);
      expect(await postalAddressOf(meta)).toBeNull();

      await settings.set('privacy.businessName', null);
      expect(await privacyNoticeReady(meta)).toBe(false);
      await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy');
      expect(await privacyNoticeReady(meta)).toBe(false);
      await settings.set('privacy.businessName', 'Meridian Workplace Ltd');
      expect(await privacyNoticeOf(meta)).toEqual({ businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' });
      expect(await privacyNoticeReady(meta)).toBe(true);
    });
  });
}
