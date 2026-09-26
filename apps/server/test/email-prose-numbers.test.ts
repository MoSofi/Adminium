// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Numbers a sent email says, in the digits of the language it is sent in.
 *
 * An Arabic chase email read «متأخرة 47 يومًا — والمستحق ٧٤١٫٦٠ US$»: the
 * amount in the recipient's digits, the count beside it not. Adminium's prose
 * uses the locale's digits, so every count an email says — the days an
 * invoice is late, the minutes a sign-in link or a reset link works, the days
 * an invitation works, the hours before which a booking may be cancelled —
 * is written in them, in the language of the template really sent (US
 * English, when the recipient's language has none). In a language with Latin
 * digits the text reads character for character as it did.
 *
 * What stays in Latin digits on purpose: a code the reader types back, and a
 * row's own values (`{{invoice.id}}`), which templates also put in links.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, emailTemplatesRepo, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey, enqueueEmail, PASSWORD_RESET_TEMPLATE_KEY, resetEmailRuntime } from '../src/email/send.js';
import { formatTag, proseNumber } from '../src/i18n/bcp47.js';
import { valueForms } from '../src/outbox/sender.js';
import { buildAuthApp, ADMIN_EMAIL, type AuthTestApp } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';

const ARABIC = /[٠-٩]/;

describe('a number a sentence says', () => {
  it('is written in Arabic-Indic digits for ar_EG, whichever spelling the locale comes in', () => {
    expect(proseNumber(47, 'ar_EG')).toBe('٤٧');
    expect(proseNumber(47, 'ar-EG')).toBe('٤٧');
    expect(proseNumber(1440, 'ar_EG')).toBe('١٤٤٠');
    expect(proseNumber('1.50', 'ar_EG')).toBe('١٫٥٠');
    expect(proseNumber(-3, 'ar_EG')).toMatch(/٣/);
  });

  it('reads exactly as String() did in English, and a whole count so in every language with Latin digits', () => {
    for (const value of [0, 7, 20, 30, 47, 1440, 10_000, 1_000_000, 2.5, 0.25, -12]) expect(proseNumber(value, 'en_US'), String(value)).toBe(String(value));
    expect(proseNumber('24.00', 'en_US')).toBe('24.00');
    for (const locale of ['de_DE', 'fr_FR', 'cs_CZ', 'da_DK', 'zh_CN', 'zh_TW']) {
      for (const value of [0, 7, 20, 30, 47, 1440, 10_000, 1_000_000, -12]) expect(proseNumber(value, locale), `${locale} ${String(value)}`).toBe(String(value));
    }
    // A fraction takes the language's own decimal mark, as its amounts do.
    expect(proseNumber(1.5, 'de_DE')).toBe('1,5');
  });

  it('keeps text that only looks like a number exactly as it is', () => {
    for (const text of ['007', '+3', ' 4', '1.', '.5', '00.5']) {
      expect(proseNumber(text, 'en_US'), text).toBe(text);
      expect(proseNumber(text, 'ar_EG'), text).toBe(text);
    }
    expect(proseNumber('0.5', 'ar_EG')).toBe('٠٫٥');
  });

  it('counts in the text\'s own digits for a recipient who names only the language', () => {
    // CLDR's bare `ar` counts in Latin digits; the Arabic email is written for `ar-EG`.
    expect(formatTag('ar', 'ar_EG')).toBe('ar-EG');
    expect(formatTag('ar-SA', 'ar_EG')).toBe('ar-SA');
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(valueForms({ locale: formatTag('ar', 'ar_EG'), zone: 'Africa/Cairo', currency: null, now }).day('d', '2026-10-01')['d.days_since']).toBe('٤٧');
  });

  it('leaves what is not a plain number, and a tag nothing can format, as it was', () => {
    expect(proseNumber('twenty', 'ar_EG')).toBe('twenty');
    expect(proseNumber('', 'ar_EG')).toBe('');
    expect(proseNumber(null, 'ar_EG')).toBe('');
    expect(proseNumber(1e21, 'ar_EG')).toBe('1e+21');
    expect(proseNumber(20, 'not a tag!!')).toBe('20');
  });

  it('says the days an invoice is late in the digits its amount is in', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    const arabic = valueForms({ locale: 'ar_EG', zone: 'Africa/Cairo', currency: 'USD', now });
    const late = arabic.day('invoice.due_on', '2026-10-01');
    expect(late['invoice.due_on.days_since']).toBe('٤٧');
    expect(arabic.money('741.60')).toMatch(ARABIC);
    const english = valueForms({ locale: 'en_US', zone: 'Europe/London', currency: 'USD', now });
    expect(english.day('invoice.due_on', '2026-10-01')['invoice.due_on.days_since']).toBe('47');
  });
});

/** The text of every queued email. */
async function sentTexts(meta: MetaDb): Promise<string[]> {
  const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { subject: string; text: string };
    return `${envelope.subject}\n${envelope.text}`;
  });
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('relay', emailSecretKey(TEST_SECRET)), from: 'Adminium <no-reply@adminium.test>', secure: false },
    { updatedBy: null },
  );
}

describe('the counts an email is given', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    resetEmailRuntime();
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await seedBuiltinEmailTemplates(meta, Date.now());
    await configureSmtp(meta);
  });
  afterEach(async () => {
    resetEmailRuntime();
    await meta.db.destroy();
  });

  const reset = (locale: string) =>
    enqueueEmail(
      { meta, secret: TEST_SECRET },
      {
        to: 'ava@example.com',
        templateKey: PASSWORD_RESET_TEMPLATE_KEY,
        locale,
        vars: { appName: 'Adminium', name: 'Ava', email: 'ava@example.com', resetUrl: 'https://admin.test/reset/tok' },
        counts: { expiresInMinutes: 30 },
      },
    );

  it('are written in the digits of the template sent: Arabic for an Arabic one, as before for English', async () => {
    await reset('ar_EG');
    await reset('en_US');
    const [arabic, english] = await sentTexts(meta);
    expect(arabic).toContain('٣٠');
    expect(arabic).not.toMatch(/\b30\b/);
    expect(english).toContain('expires in 30 minutes');
  });

  it('are Latin in the US English sent when the recipient\'s language has no template', async () => {
    const arabicRow = await emailTemplatesRepo(meta).findByKeyLocale(PASSWORD_RESET_TEMPLATE_KEY, 'ar_EG');
    await meta.db.deleteFrom('adminium_email_templates').where('id', '=', arabicRow!.id).execute();
    await reset('ar_EG');
    const [sent] = await sentTexts(meta);
    expect(sent).toContain('expires in 30 minutes');
    expect(sent).not.toMatch(ARABIC);
  });
});

describe('the password reset a person asks for', () => {
  let fixture: AuthTestApp | undefined;
  afterEach(async () => {
    resetEmailRuntime();
    await fixture?.destroy();
    fixture = undefined;
  });

  it('says how long it works in the workspace language\'s digits, and in English as it always did', async () => {
    for (const [locale, expected] of [
      ['ar_EG', /[٠-٩]+/],
      ['en_US', /expires in \d+ minutes/],
    ] as const) {
      fixture = await buildAuthApp();
      await seedBuiltinEmailTemplates(fixture.meta, Date.now());
      await configureSmtp(fixture.meta);
      await settingsRepo(fixture.meta).set('locale.default', locale, { updatedBy: null });
      const res = await fixture.app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email: ADMIN_EMAIL } });
      expect(res.statusCode).toBe(200);
      const [sent] = await sentTexts(fixture.meta);
      expect(sent, locale).toMatch(expected);
      if (locale === 'ar_EG') expect(sent).not.toMatch(/\b\d{2}\b/);
      resetEmailRuntime();
      await fixture.destroy();
      fixture = undefined;
    }
  });
});
