// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An outbox kind's consent purpose, and the kinds whose template prints a
 * survey's link: what a forms add-on's invitations are mailed with. Each
 * refusal is one broken thing of a fixture that validates.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, MAIL_PURPOSES, installFloorWords, mailPurposeOf, printsSurveyLink, validateManifest, type Manifest } from '../src/index.js';
import { formsAddOn } from './forms-fixture.js';
import { formsWithInvitations } from './forms-invitations-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const outbox = (doc: Doc) => doc['outbox'] as Doc & { producers: Doc[] };
const changed = (edit: (doc: Doc) => void): Doc => {
  const doc = formsWithInvitations();
  edit(doc);
  return doc;
};

describe('an outbox kind\'s purpose and survey link', () => {
  it('a forms add-on that mails its invitations validates, and says both words at 0.3.40', () => {
    const doc = formsWithInvitations();
    expect(issuesOf(doc)).toEqual([]);
    const words = installFloorWords(doc).map((word) => word.word);
    expect(words).toEqual(expect.arrayContaining(['outbox.purposes', 'outbox.surveyLinks']));
    expect(WORD_FLOORS['outbox.purposes']).toBe('0.3.40');
    expect(WORD_FLOORS['outbox.surveyLinks']).toBe('0.3.40');
    const result = validateManifest(doc);
    const manifest = (result.ok ? result.manifest : null) as Manifest;
    expect(mailPurposeOf(manifest, 'invite-service')).toBe('surveys');
    expect(printsSurveyLink(manifest, 'invite-service')).toBe(true);
    expect(printsSurveyLink(manifest, 'something-else')).toBe(false);
  });

  it('the purposes are the consent log\'s two', () => {
    expect(MAIL_PURPOSES).toEqual(['newsletter', 'surveys']);
    expect(issuesOf(changed((d) => (outbox(d)['purposes'] = { 'invite-service': 'offers' }))).join('\n')).toContain('purposes');
  });

  it('a purpose or a survey link names a kind the outbox sends', () => {
    expect(issuesOf(changed((d) => (outbox(d)['purposes'] = { 'invite-later': 'surveys' }))).join('\n')).toContain('"invite-later" is not one of the outbox\'s kinds');
    expect(issuesOf(changed((d) => (outbox(d)['surveyLinks'] = ['invite-service', 'invite-later']))).join('\n')).toContain('"invite-later" is not one of the outbox\'s kinds');
    expect(issuesOf(changed((d) => (outbox(d)['surveyLinks'] = ['invite-service', 'invite-service']))).join('\n')).toContain('"invite-service" is named twice');
  });

  it('a survey link is printed only by an add-on that declares forms with invitations', () => {
    const noInvitations = changed((d) => {
      ((d['addOn'] as Doc)['forms'] as Doc)['invitations'] = undefined;
    });
    expect(issuesOf(noInvitations).join('\n')).toContain('only an add-on that declares forms with invitations');
  });

  it('every producer of a kind that prints the link reads the invitations itself', () => {
    const other = changed((d) => {
      outbox(d).producers[1] = { kind: 'invite-service', link: 'invitation_id', onCreate: { table: 'answers' } };
    });
    expect(issuesOf(other).join('\n')).toContain('"invite-service" prints a survey link, so its producer reads a row of the invitations ("invitations") itself');
    const none = changed((d) => {
      outbox(d).producers = [outbox(d).producers[0]!];
    });
    expect(issuesOf(none).join('\n')).toContain('"invite-service" prints a survey link, so a producer queues it for an invitation: none does');
  });

  it('a manifest below 0.3.40 that says either word is told the floor', () => {
    const old = changed((d) => ((d['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.38'));
    const said = issuesOf(old).join('\n');
    expect(said).toContain('outbox.purposes');
    expect(said).toContain('outbox.surveyLinks');
    // The bare forms add-on says neither.
    expect(installFloorWords(formsAddOn()).map((word) => word.word)).not.toContain('outbox.purposes');
  });
});
