// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sender checks: the free-mail list, the TXT lookup (time limit, cache,
 * "nothing there" against "could not ask"), DKIM found in DNS, DMARC's policy
 * and organisational domain by the tree walk, each mail service's tracking
 * switches, and the marketing refusals, each by its code.
 */
import { describe, expect, it } from 'vitest';

import {
  createTxtLookup,
  dkimFound,
  dmarcOf,
  DnsCheckError,
  domainOfAddress,
  isFreeMail,
  marketingRefusal,
  marketingRefusals,
  relayOf,
  senderFacts,
  trackingOffHeaders,
  TrackingHeaderError,
  treeWalkNames,
  type MarketingSettings,
  type TxtResolver,
} from '../src/email/sender/index.js';

/** A resolver over a fixed zone; a name missing from it answers as DNS does (ENOTFOUND). Counts the asks. */
function zone(records: Record<string, string[][]>) {
  const asked: string[] = [];
  const resolve: TxtResolver = async (name) => {
    asked.push(name);
    const found = records[name];
    if (found === undefined) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
    return found;
  };
  return { asked, lookup: createTxtLookup({ resolve, cacheMs: 0 }) };
}

const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx';

describe('free-mail addresses', () => {
  it.each(['ana@gmail.com', 'Ana@GMAIL.com', 'x@googlemail.com', 'x@outlook.com', 'x@hotmail.co.uk', 'x@hotmail.fr', 'x@live.com.au', 'x@yahoo.co.jp', 'x@yahoo.com', 'x@icloud.com', 'x@proton.me', 'x@gmx.de', 'x@gmx.at', 'x@web.de', 'x@mail.ru', 'x@qq.com', 'x@163.com', 'x@seznam.cz', 'x@mail.dk', 'x@yandex.ru', 'x@gmail.com.'])('refuses %s', (address) => {
    expect(isFreeMail(address)).toBe(true);
  });

  it.each(['news@meridian.example', 'x@gmail.example.com', 'x@mygmail.com', 'x@outlookindia.com', 'x@yahoo.inc.example', 'x@hotmail', 'not-an-address', '@gmail.com'])('takes %s', (address) => {
    expect(isFreeMail(address)).toBe(false);
  });

  it('reads the domain of an address', () => {
    expect(domainOfAddress('ana@Meridian.Example.')).toBe('meridian.example');
    expect(domainOfAddress('nobody')).toBeNull();
    expect(domainOfAddress('ana@')).toBeNull();
  });
});

describe('the TXT lookup', () => {
  it('joins a record’s strings, and keeps an answer for a while', async () => {
    let now = 0;
    const asked: string[] = [];
    const lookup = createTxtLookup({
      resolve: async (name) => {
        asked.push(name);
        return [['v=DKIM1; k=rsa; ', 'p=abc'], ['other']];
      },
      now: () => now,
      cacheMs: 1000,
    });
    expect(await lookup('Sel._domainkey.Example.com.')).toEqual(['v=DKIM1; k=rsa; p=abc', 'other']);
    expect(await lookup('sel._domainkey.example.com')).toHaveLength(2);
    expect(asked).toEqual(['sel._domainkey.example.com']);
    now = 2000;
    await lookup('sel._domainkey.example.com');
    expect(asked).toHaveLength(2);
  });

  it('answers "nothing there" with an empty list, and throws when DNS could not be asked', async () => {
    const lookup = (code: string) => createTxtLookup({ resolve: async () => Promise.reject(Object.assign(new Error(code), { code })) });
    expect(await lookup('ENOTFOUND')('a.example')).toEqual([]);
    expect(await lookup('ENODATA')('a.example')).toEqual([]);
    await expect(lookup('ESERVFAIL')('a.example')).rejects.toMatchObject({ name: 'DnsCheckError', reason: 'failed' });
    await expect(lookup('ECONNREFUSED')('a.example')).rejects.toBeInstanceOf(DnsCheckError);
  });

  it('gives up after its time limit', async () => {
    const lookup = createTxtLookup({ resolve: () => new Promise(() => undefined), timeoutMs: 20 });
    await expect(lookup('slow.example')).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('DKIM in DNS', () => {
  it('finds the key, tells another key from none, and skips records that are not DKIM keys', async () => {
    const { lookup, asked } = zone({
      'adminium._domainkey.meridian.example': [['v=DKIM1; k=rsa; p=', `${KEY.slice(0, 20)} ${KEY.slice(20)}`]],
      'adminium._domainkey.other.example': [['v=DKIM1; k=rsa; p=SOMETHINGELSE']],
      'adminium._domainkey.ed.example': [[`v=DKIM1; k=ed25519; p=${KEY}`], [`v=spf1 p=${KEY}`]],
      'adminium._domainkey.nov.example': [[`k=rsa; p=${KEY}`]],
    });
    expect(await dkimFound(lookup, 'Meridian.example', 'adminium', KEY)).toBe('found');
    expect(asked).toEqual(['adminium._domainkey.meridian.example']);
    expect(await dkimFound(lookup, 'other.example', 'adminium', KEY)).toBe('other-key');
    expect(await dkimFound(lookup, 'ed.example', 'adminium', KEY)).toBe('not-found');
    expect(await dkimFound(lookup, 'none.example', 'adminium', KEY)).toBe('not-found');
    // `v=` is optional in a key record.
    expect(await dkimFound(lookup, 'nov.example', 'adminium', KEY)).toBe('found');
  });
});

describe('DMARC', () => {
  it('walks at most 8 names up, skipping to 7 labels for a long name', () => {
    expect(treeWalkNames('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com', 'com']);
    const long = 'a.b.c.d.e.f.g.h.i.example.com';
    expect(treeWalkNames(long)).toEqual([long, 'e.f.g.h.i.example.com', 'f.g.h.i.example.com', 'g.h.i.example.com', 'h.i.example.com', 'i.example.com', 'example.com', 'com']);
  });

  it('reads the domain’s own policy', async () => {
    const { lookup } = zone({ '_dmarc.meridian.example': [['v=DMARC1; p=quarantine; rua=mailto:d@meridian.example']] });
    const result = await dmarcOf(lookup, 'meridian.example');
    expect(result).toMatchObject({ policy: 'quarantine', recordDomain: 'meridian.example', orgDomain: 'meridian.example' });
  });

  it('gives a subdomain its parent’s sp=, then p=, and aligns domains under the organisational domain (relaxed)', async () => {
    const { lookup } = zone({ '_dmarc.meridian.example': [['v=DMARC1; p=reject; sp=none']] });
    const news = await dmarcOf(lookup, 'news.meridian.example');
    expect(news).toMatchObject({ policy: 'none', recordDomain: 'meridian.example', orgDomain: 'meridian.example' });
    expect(news.aligned('news.meridian.example', 'meridian.example')).toBe(true);
    expect(news.aligned('news.meridian.example', 'mail.meridian.example')).toBe(true);
    expect(news.aligned('news.meridian.example', 'meridian.other')).toBe(false);
    expect(news.aligned('news.meridian.example', 'evilmeridian.example')).toBe(false);
    const { lookup: noSp } = zone({ '_dmarc.meridian.example': [['v=DMARC1; p=reject']] });
    expect((await dmarcOf(noSp, 'news.meridian.example')).policy).toBe('reject');
  });

  it('has no policy without a record, with two records, or with a bad p= that asks for no reports', async () => {
    const { lookup } = zone({
      '_dmarc.two.example': [['v=DMARC1; p=reject'], ['v=DMARC1; p=none']],
      '_dmarc.bad.example': [['v=DMARC1; p=maybe']],
      '_dmarc.rua.example': [['v=DMARC1; p=maybe; rua=mailto:x@rua.example']],
      '_dmarc.spf.example': [['v=spf1 -all']],
    });
    const none = await dmarcOf(lookup, 'none.example');
    expect(none).toMatchObject({ policy: null, recordDomain: null, orgDomain: 'none.example' });
    expect(none.aligned('none.example', 'none.example')).toBe(true);
    expect(none.aligned('a.none.example', 'none.example')).toBe(true);
    expect((await dmarcOf(lookup, 'two.example')).policy).toBeNull();
    expect((await dmarcOf(lookup, 'bad.example')).policy).toBeNull();
    expect((await dmarcOf(lookup, 'rua.example')).policy).toBe('none');
    expect((await dmarcOf(lookup, 'spf.example')).policy).toBeNull();
  });

  it('finds the organisational domain by psd=, and never takes a top-level domain without psd=n', async () => {
    const { lookup } = zone({
      '_dmarc.example': [['v=DMARC1; p=reject; psd=y']],
      '_dmarc.shop.example': [['v=DMARC1; p=none']],
      '_dmarc.sub.corp.test': [['v=DMARC1; p=none; psd=n']],
      '_dmarc.corp.test': [['v=DMARC1; p=reject']],
      '_dmarc.bank': [['v=DMARC1; p=reject']],
    });
    const shop = await dmarcOf(lookup, 'a.b.shop.example');
    expect(shop.orgDomain).toBe('shop.example');
    expect(shop.policy).toBe('none');
    expect(shop.aligned('a.b.shop.example', 'other.example')).toBe(false);
    expect((await dmarcOf(lookup, 'x.sub.corp.test')).orgDomain).toBe('sub.corp.test');
    expect((await dmarcOf(lookup, 'x.corp.test')).orgDomain).toBe('corp.test');
    const bank = await dmarcOf(lookup, 'mine.bank');
    expect(bank.orgDomain).toBe('mine.bank');
    expect(bank.aligned('mine.bank', 'yours.bank')).toBe(false);
  });
});

describe('each mail service’s tracking switches', () => {
  it.each([
    ['email-smtp.eu-west-1.amazonaws.com', 'ses'],
    ['email-smtp-fips.us-east-1.amazonaws.com', 'ses'],
    ['smtp.postmarkapp.com', 'postmark'],
    ['smtp-broadcasts.postmarkapp.com', 'postmark'],
    ['smtp.mailgun.org', 'mailgun'],
    ['SMTP.EU.MAILGUN.ORG.', 'mailgun'],
    ['smtp-relay.brevo.com', 'brevo'],
    ['smtp-relay.sendinblue.com', 'brevo'],
    ['smtp.sendgrid.net', 'sendgrid'],
    ['mail.meridian.example', null],
    ['127.0.0.1', null],
    ['smtp.mailgun.org.attacker.example', null],
    ['email-smtp.eu-west-1.amazonaws.com.evil.example', null],
  ])('reads %s as %s', (host, relay) => {
    expect(relayOf(host)).toBe(relay);
  });

  it('sets each service’s documented headers, and none where there is no switch', () => {
    expect(trackingOffHeaders('mailgun')).toEqual({ 'X-Mailgun-Track': 'no', 'X-Mailgun-Track-Clicks': 'no', 'X-Mailgun-Track-Opens': 'no' });
    expect(JSON.parse(trackingOffHeaders('sendgrid')['X-SMTPAPI']!)).toEqual({
      filters: { clicktrack: { settings: { enable: 0 } }, opentrack: { settings: { enable: 0 } }, subscriptiontrack: { settings: { enable: 0 } } },
    });
    expect(trackingOffHeaders('postmark')).toEqual({ 'X-PM-TrackLinks': 'None', 'X-PM-KeepID': 'true' });
    expect(trackingOffHeaders('ses', { sesConfigurationSet: 'no-tracking' })).toEqual({ 'X-SES-CONFIGURATION-SET': 'no-tracking' });
    expect(trackingOffHeaders('ses')).toEqual({});
    expect(() => trackingOffHeaders('ses', { sesConfigurationSet: 'bad name\r\nBcc: x' })).toThrow(TrackingHeaderError);
    expect(trackingOffHeaders('brevo')).toEqual({});
    expect(trackingOffHeaders(null)).toEqual({});
  });
});

describe('marketing refusals', () => {
  const ready: MarketingSettings = { postalAddress: 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom', publicOrigin: 'https://crm.meridian.example', reachable: true };
  const facts = async (records: Record<string, string[][]>, key: { domain: string; selector: string; publicKey: string } | null = { domain: 'meridian.example', selector: 'adminium', publicKey: KEY }) =>
    senderFacts(zone(records).lookup, 'news@meridian.example', key);
  const good = { '_dmarc.meridian.example': [['v=DMARC1; p=quarantine']], 'adminium._domainkey.meridian.example': [[`v=DKIM1; k=rsa; p=${KEY}`]] };

  it('lets a sender with everything set send', async () => {
    expect(marketingRefusals('news@meridian.example', ready, await facts(good))).toEqual([]);
    expect(marketingRefusal('news@meridian.example', ready, await facts(good))).toBeNull();
  });

  it('refuses without a postal address', async () => {
    expect(marketingRefusal('news@meridian.example', { ...ready, postalAddress: null }, await facts(good))).toBe('no-postal-address');
    expect(marketingRefusal('news@meridian.example', { ...ready, postalAddress: '   ' }, await facts(good))).toBe('no-postal-address');
  });

  it('refuses a free-mail From, and asks DNS nothing about it', async () => {
    const z = zone(good);
    const free = await senderFacts(z.lookup, 'news@gmail.com', null);
    expect(z.asked).toEqual([]);
    expect(marketingRefusals('news@gmail.com', ready, free)).toEqual(['free-mail-from']);
  });

  it('refuses a domain without DMARC', async () => {
    expect(marketingRefusals('news@meridian.example', ready, await facts({ 'adminium._domainkey.meridian.example': good['adminium._domainkey.meridian.example'] }))).toEqual(['no-dmarc']);
  });

  it('refuses without DMARC alignment: no key, a key not yet in DNS, or a key for another domain', async () => {
    expect(marketingRefusal('news@meridian.example', ready, await facts(good, null))).toBe('not-aligned');
    expect(marketingRefusal('news@meridian.example', ready, await facts({ '_dmarc.meridian.example': good['_dmarc.meridian.example'] }))).toBe('not-aligned');
    const elsewhere = { ...good, 'adminium._domainkey.other.example': [[`v=DKIM1; k=rsa; p=${KEY}`]] };
    expect(marketingRefusal('news@meridian.example', ready, await facts(elsewhere, { domain: 'other.example', selector: 'adminium', publicKey: KEY }))).toBe('not-aligned');
  });

  it('says DNS could not be checked rather than guessing', async () => {
    const failing = createTxtLookup({ resolve: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ESERVFAIL' })) });
    const unchecked = await senderFacts(failing, 'news@meridian.example', { domain: 'meridian.example', selector: 'adminium', publicKey: KEY });
    expect(marketingRefusals('news@meridian.example', ready, unchecked)).toEqual(['dns-unchecked']);
  });

  it('refuses while the server has no public address, or one nobody outside can reach', async () => {
    expect(marketingRefusals('news@meridian.example', { ...ready, publicOrigin: null }, await facts(good))).toEqual(['no-public-address']);
    expect(marketingRefusals('news@meridian.example', { ...ready, reachable: false }, await facts(good))).toEqual(['no-public-address']);
  });

  it('lists every refusal that applies, in the send dialog’s order', async () => {
    const free = await senderFacts(zone({}).lookup, 'news@gmail.com', null);
    expect(marketingRefusals('news@gmail.com', { postalAddress: null, publicOrigin: null }, free)).toEqual(['no-postal-address', 'free-mail-from', 'no-public-address']);
    expect(marketingRefusals('not-an-address', ready, free)).toEqual(['free-mail-from']);
  });
});
