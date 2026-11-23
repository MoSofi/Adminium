// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of texts: a template of its own, a kind's channel, the person's
 * mobile, a text a customer is waiting for, and a public form's separate box.
 * Each needs its release, and a manifest that uses none reads as it always did.
 */
import { describe, expect, it } from 'vitest';

import { asksForYes, checkTextTemplate, codeNamesIn, isTextKind, isWaitingKind, readsCredential } from '../src/text-messages.js';
import { validateManifest } from '../src/validate.js';
import { INSTALL_FLOOR_WORD_NAMES, installFloorWords, SMS_WORDS_FLOOR, WORD_FLOORS } from '../src/words.js';

type Doc = Record<string, any>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const WORDING = { version: 1, text: { 'en-US': 'Text me about this booking.' } };

function app(): Doc {
  return {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    kind: 'app',
    key: 'clinic',
    name: 'Clinic',
    version: '1.0.0',
    categories: ['operations'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR },
    pages: [{ ref: 'visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'visits' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'patients',
          keyField: 'name',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            { ref: 'mobile', type: 'text', maxLength: 32, nullable: true },
            { ref: 'pin_code', type: 'text', maxLength: 32, nullable: true, rules: { code: { length: 8 } } },
            { ref: 'may_email', type: 'bool', nullable: true },
            { ref: 'may_text', type: 'bool', nullable: true },
          ],
        },
        {
          ref: 'visits',
          keyField: 'id',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
            { ref: 'mobile', type: 'text', maxLength: 32, nullable: true },
          ],
        },
        {
          ref: 'messages',
          keyField: 'id',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'kind', type: 'enum', enum: ['visit_mail', 'reminder_text', 'ready_text'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'] },
            { ref: 'to', type: 'text', maxLength: 200, nullable: true },
            { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
            { ref: 'visit_id', type: 'fk', references: 'visits', nullable: true },
          ],
        },
      ],
    },
    people: [{ table: 'patients', kind: 'people', email: 'email', phone: 'mobile', name: 'name' }],
    emailTemplates: [{ key: 'clinic-visit-mail', name: 'Visit', locales: { 'en-US': { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'See you.' } }] } } }],
    textTemplates: [
      { key: 'clinic-reminder-text', name: 'Visit reminder', locales: { 'en-US': { body: '{{appName}}: visit soon. Reply STOP to opt out.' } } },
      { key: 'clinic-ready-text', name: 'Ready', locales: { 'en-US': { body: '{{appName}}: ready for you.' } } },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to' },
      links: { visit: 'visit_id' },
      recipient: { via: 'patient_id', table: 'patients', email: 'email', phone: 'mobile', name: 'name' },
      kinds: { visit_mail: 'clinic-visit-mail', reminder_text: 'clinic-reminder-text', ready_text: 'clinic-ready-text' },
      channels: { reminder_text: 'sms', ready_text: 'sms' },
      classes: { visit_mail: 'service', reminder_text: 'service', ready_text: 'service' },
      waiting: ['ready_text'],
    },
    publicAccess: [
      {
        table: 'patients',
        methods: ['POST'],
        select: ['id'],
        writable: ['name', 'mobile', 'may_email', 'may_text'],
        consent: { column: 'may_email', purpose: 'newsletter', wording: { version: 1, text: { 'en-US': 'Email me news.' } } },
        textConsent: { column: 'may_text', phone: 'mobile', class: 'service', wording: WORDING },
      },
    ],
  };
}

const judged = (doc: Doc) => validateManifest(doc, { allowLocalPublisher: true });
const messages = (doc: Doc): string[] => {
  const result = judged(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const refusedWith = (change: (doc: Doc) => void, text: string) => {
  const doc = clone(app());
  change(doc);
  expect(messages(doc).join('\n')).toContain(text);
};

const SMS_WORDS = ['textTemplates', 'outbox.channels', 'outbox.recipient.phone', 'outbox.waiting', 'people.phone', 'publicAccess.textConsent'] as const;

describe('the words of texts', () => {
  it('a whole text app is valid', () => {
    expect(messages(app())).toEqual([]);
  });

  it('each word has the one floor, and the walker names it where it is written', () => {
    for (const word of SMS_WORDS) {
      expect(INSTALL_FLOOR_WORD_NAMES).toContain(word);
      expect(WORD_FLOORS[word], word).toBe(SMS_WORDS_FLOOR);
    }
    const found = installFloorWords(app());
    expect(found.filter((one) => (SMS_WORDS as readonly string[]).includes(one.word)).map((one) => one.path).sort()).toEqual(
      ['outbox.channels', 'outbox.recipient.phone', 'outbox.waiting', 'people.0.phone', 'publicAccess.0.textConsent', 'textTemplates'].sort(),
    );
    const fallback = clone(app());
    fallback['outbox'].recipient.fallback = { via: 'visit_id', email: 'mobile', phone: 'mobile' };
    expect(installFloorWords(fallback).map((one) => one.path)).toContain('outbox.recipient.fallback.phone');
  });

  it('a manifest below the floor is told which release to ask for', () => {
    const doc = clone(app());
    doc['compatibility'].minAdminiumVersion = '0.3.71';
    const said = messages(doc).join('\n');
    for (const word of SMS_WORDS) expect(said).toContain(`"${word}" is read by Adminium ${SMS_WORDS_FLOOR}`);
  });

  it('a manifest with none of them reads as before, at its old floor', () => {
    const doc = clone(app());
    delete doc['textTemplates'];
    delete doc['publicAccess'][0].textConsent;
    delete doc['people'][0].phone;
    doc['compatibility'].minAdminiumVersion = '0.3.71';
    doc['requiredSchema'].tables[2].columns[1].enum = ['visit_mail'];
    doc['outbox'] = { ...doc['outbox'], kinds: { visit_mail: 'clinic-visit-mail' }, classes: { visit_mail: 'service' } };
    delete doc['outbox'].channels;
    delete doc['outbox'].waiting;
    delete doc['outbox'].recipient.phone;
    expect(messages(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((one) => (SMS_WORDS as readonly string[]).includes(one.word))).toEqual([]);
  });

  it('reads a kind with no channel as email, and knows a waiting text', () => {
    const outbox = app()['outbox'];
    expect(isTextKind(outbox, 'visit_mail')).toBe(false);
    expect(isTextKind(outbox, 'reminder_text')).toBe(true);
    expect(isWaitingKind(outbox, 'ready_text')).toBe(true);
    expect(isWaitingKind(outbox, 'reminder_text')).toBe(false);
  });
});

describe('what a text template may say', () => {
  const body = (words: string) => (doc: Doc) => {
    doc['textTemplates'][0].locales['en-US'].body = words;
  };

  it.each(['signInLink', 'survey_link', 'reviewLink', 'stopLink', 'object_link', 'calendarGoogle', 'calendarOutlook', 'visit.ticket.qr', 'visit.code.grouped', 'patient.password', 'patient.otp'])('refuses {{%s}}', (name) => {
    refusedWith(body(`Hello {{${name}}}`), 'carries no sign-in link');
  });

  it('refuses a column the app declares as a code, whatever it is called', () => {
    refusedWith(body('Your door: {{patient.pin_code}}'), 'carries no sign-in link');
    expect(codeNamesIn('{{patient.locker}} {{patient.name}}', new Set(['locker']))).toEqual(['patient.locker']);
  });

  it.each(['Reply YES to confirm', 'Antworten Sie mit JA', 'Répondez OUI', 'Odpovězte ANO', '回复 是'])('refuses "%s"', (words) => {
    refusedWith(body(words), 'never asks for a "YES"');
  });

  it('is the one check the send path asks', () => {
    expect(checkTextTemplate('Reply YES')).toEqual({ ok: false, reason: 'asks-for-yes' });
    expect(checkTextTemplate('  ')).toEqual({ ok: false, reason: 'template-empty' });
    expect(readsCredential('postal_code')).toBe(false);
    expect(asksForYes('Reply STOP to opt out')).toBe(false);
  });

  it('refuses a broken placeholder, a row, a second key and a shared key', () => {
    refusedWith(body('Hello {{ name'), 'broken placeholder');
    refusedWith(body('Hello {{row.name}}'), 'lists no rows');
    refusedWith((doc) => doc['textTemplates'].push(clone(doc['textTemplates'][0])), 'declared twice');
    refusedWith((doc) => (doc['textTemplates'][0].key = 'clinic-visit-mail'), 'also an email template');
    refusedWith((doc) => (doc['textTemplates'][0].key = 'other-reminder'), 'starts with "clinic-"');
  });

  it('takes no subject or block: it is not an email template', () => {
    refusedWith((doc) => (doc['textTemplates'][0].locales['en-US'].subject = 'Hi'), 'subject');
  });
});

describe('a kind sent as a text', () => {
  it('names a text template, and an email kind an email template', () => {
    refusedWith((doc) => (doc['outbox'].kinds.reminder_text = 'clinic-visit-mail'), 'not one of the app\'s textTemplates');
    refusedWith((doc) => (doc['outbox'].kinds.visit_mail = 'clinic-ready-text'), 'not one of the app\'s emailTemplates');
  });

  it('needs the person\'s number, and a channel only for a kind there is', () => {
    refusedWith((doc) => delete doc['outbox'].recipient.phone, 'outbox.recipient.phone');
    refusedWith((doc) => (doc['outbox'].channels.nope = 'sms'), '"nope" is not one of the outbox\'s kinds');
  });

  it('says its class', () => {
    refusedWith((doc) => delete doc['outbox'].classes.reminder_text, 'says no class');
  });

  it('inherits nothing of a service mail: no purpose, so no stop link, and no minted link', () => {
    refusedWith((doc) => (doc['outbox'].purposes = { reminder_text: 'surveys' }), 'email stop link');
    refusedWith((doc) => (doc['outbox'].surveyLinks = ['reminder_text']), 'carries no survey link');
  });

  it('goes to the person\'s own number, with no Reply-To', () => {
    const producer = { kind: 'reminder_text', link: 'visit_id', onCreate: { table: 'visits' } };
    refusedWith((doc) => (doc['outbox'].producers = [{ ...producer, recipient: { column: 'mobile' } }]), 'own number');
    refusedWith((doc) => (doc['outbox'].producers = [{ ...producer, replyTo: { staff: 'patient_id' } }]), 'no Reply-To');
  });

  it('a waiting kind is a service text', () => {
    refusedWith((doc) => (doc['outbox'].waiting = ['visit_mail']), 'is not a text');
    refusedWith((doc) => (doc['outbox'].classes.ready_text = 'marketing'), 'nobody is waiting for an offer');
    refusedWith((doc) => (doc['outbox'].waiting = ['ready_text', 'ready_text']), 'named twice');
  });

  it('an add-on\'s outbox sends email', () => {
    const doc = clone(app());
    const refused = validateManifest({
      manifestVersion: 1,
      publisher: doc['publisher'],
      license: 'MIT',
      description: doc['description'],
      kind: 'add-on',
      key: 'kit',
      name: 'Kit',
      version: '1.0.0',
      categories: ['data'],
      compatibility: doc['compatibility'],
      addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
      requiredSchema: { prefixed: true, tables: doc['requiredSchema'].tables },
      emailTemplates: doc['emailTemplates'],
      outbox: { ...doc['outbox'], kinds: { visit_mail: 'kit-visit-mail' }, channels: { visit_mail: 'sms' }, waiting: undefined, classes: { visit_mail: 'service' } },
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.issues.map((issue) => issue.message).join('\n')).toContain('an add-on\'s outbox sends email');
  });
});

describe('a person known by phone (Q8)', () => {
  it('a people entry may name a phone and no address', () => {
    const doc = clone(app());
    delete doc['people'][0].email;
    // The outbox still names an address column, which this entry would have to name too.
    delete doc['outbox'];
    delete doc['emailTemplates'];
    delete doc['publicAccess'][0].consent;
    expect(messages(doc)).toEqual([]);
  });

  it('with neither, it is refused as before', () => {
    refusedWith((doc) => {
      delete doc['people'][0].email;
      delete doc['people'][0].phone;
    }, 'holds the address');
  });

  it('a row with a number and an empty address is a recipient: the email column may be empty', () => {
    const patients = app()['requiredSchema'].tables[0].columns as { ref: string; nullable?: boolean }[];
    expect(patients.find((column) => column.ref === 'email')?.nullable).toBe(true);
    expect(messages(app())).toEqual([]);
  });

  it('holds the phone to one column, personal, of text', () => {
    refusedWith((doc) => (doc['people'][0].phone = 'name'), 'named by its phone');
    refusedWith((doc) => (doc['outbox'].recipient.phone = 'name'), 'have that number');
    refusedWith((doc) => {
      doc['requiredSchema'].tables[0].columns[3].rules = { personal: false };
    }, 'mark it personal');
    refusedWith((doc) => {
      doc['requiredSchema'].tables[0].columns[3].type = 'int';
      delete doc['requiredSchema'].tables[0].columns[3].maxLength;
    }, 'must be a text column');
  });

  it('a company keeps its number in its details', () => {
    refusedWith((doc) => (doc['people'][0].kind = 'companies'), 'lead.phone');
  });
});

describe('a public form\'s box for texts (Q7)', () => {
  const box = (change: (entry: Doc, doc: Doc) => void) => (doc: Doc) => change(doc['publicAccess'][0], doc);
  const visitColumn = (doc: Doc, ref: string): Doc => doc['requiredSchema'].tables[0].columns.find((column: Doc) => column.ref === ref);

  it('sits beside the e-mail tick, in a column of its own', () => {
    refusedWith(box((entry) => (entry.textConsent.column = 'may_email')), 'a column of its own');
  });

  it('starts unticked', () => {
    refusedWith(box((entry) => (entry.defaults = { may_text: true })), 'starts unticked');
    refusedWith(box((entry) => (entry.writableValues = { may_text: [true] })), 'starts unticked');
    refusedWith(box((_entry, doc) => (visitColumn(doc, 'may_text')['default'] = true)), 'starts unticked');
  });

  it('a default of false is unticked', () => {
    const doc = clone(app());
    const column = visitColumn(doc, 'may_text');
    delete column['nullable'];
    column['default'] = false;
    expect(messages(doc)).toEqual([]);
  });

  it('is never required to book or buy', () => {
    refusedWith(box((entry) => (entry.requires = ['may_text'])), 'never required');
    refusedWith(box((_entry, doc) => delete visitColumn(doc, 'may_text')['nullable']), 'never required');
    refusedWith(box((_entry, doc) => (visitColumn(doc, 'may_text')['rules'] = { required: true })), 'never required');
  });

  it('is for a number the same write carries', () => {
    refusedWith(box((entry) => (entry.textConsent.phone = 'nope')), 'no column "nope"');
    refusedWith(box((entry) => (entry.writable = ['name', 'may_email', 'may_text'])), 'the number the answer is for');
    refusedWith(box((entry) => (entry.textConsent.phone = 'may_email')), 'not a text column');
  });

  it('never asks for a YES, and keeps its wording and version', () => {
    refusedWith(box((entry) => (entry.textConsent.wording.text['en-US'] = 'Reply YES to get texts')), 'never asks for a "YES"');
    refusedWith(box((entry) => delete entry.textConsent.wording), 'wording');
  });

  it('is kept for a declared person whose number erasure can find', () => {
    refusedWith((doc) => delete doc['people'][0].phone, 'people.phone');
  });
});
