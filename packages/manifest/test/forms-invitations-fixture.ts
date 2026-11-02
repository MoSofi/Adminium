// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The forms add-on with what a survey's invitations need beside its four
 * tables: an outbox that mails each invitation (two kinds, one per class,
 * both for the Surveys purpose and both printing the survey's link), its
 * template, and a settings table with the answers' keeping time.
 */
import { formsAddOn } from './forms-fixture.js';

type Doc = Record<string, unknown>;

/** The forms add-on, mailing its invitations. */
export function formsWithInvitations(): Doc {
  const doc = formsAddOn();
  const schema = doc['requiredSchema'] as { tables: Doc[] };
  schema.tables.push(
    {
      ref: 'invitation_mails',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'kind', type: 'enum', enum: ['invite-marketing', 'invite-service'] },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        { ref: 'to_address', type: 'text', maxLength: 320, nullable: true },
        { ref: 'invitation_id', type: 'fk', references: 'invitations', nullable: true },
        { ref: 'error', type: 'text', maxLength: 200, nullable: true },
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
      ],
    },
    {
      ref: 'forms_settings',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'answers_months', type: 'int', nullable: true },
      ],
    },
  );
  (doc['addOn'] as Doc)['settingsTable'] = 'forms_settings';
  doc['outbox'] = {
    table: 'invitation_mails',
    columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
    links: { invitation: 'invitation_id' },
    recipient: { via: 'invitation_id', table: 'invitations', email: 'email', name: 'name', language: 'language' },
    kinds: { 'invite-marketing': 'forms-invite', 'invite-service': 'forms-invite' },
    classes: { 'invite-marketing': 'marketing', 'invite-service': 'service' },
    purposes: { 'invite-marketing': 'surveys', 'invite-service': 'surveys' },
    surveyLinks: ['invite-marketing', 'invite-service'],
    producers: [
      { kind: 'invite-marketing', link: 'invitation_id', onCreate: { table: 'invitations', where: { column: 'class', eq: 'marketing' } } },
      { kind: 'invite-service', link: 'invitation_id', onCreate: { table: 'invitations', where: { column: 'class', eq: 'service' } } },
    ],
  };
  doc['emailTemplates'] = [
    {
      key: 'forms-invite',
      name: 'Survey invitation',
      locales: { 'en-US': { subject: 'How did we do?', blocks: [{ block: 'email.text', data: { text: 'Hello {{recipient.name}}, tell us here: {{survey_link}}' } }] } },
    },
  ];
  return doc;
}
