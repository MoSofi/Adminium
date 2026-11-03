// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words a "Send a survey" step is written in: a person input whose
 * fields fill the invitation, a record input that names a survey by its slug
 * and lists only live ones, a choice drawn as cards with a line under each,
 * an input's own line, and the rule record's table and key as the run's own
 * words. Each is a floor word at 0.3.41; each refusal is one broken thing of
 * a step that validates.
 */
import { addOnStepSchema } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';
import { formsWithInvitations } from './forms-invitations-fixture.js';

type Doc = Record<string, unknown>;
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Doc => Object.fromEntries(LOCALES.map((locale) => [locale, text]));

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

/** "Send a survey": the invitation row, filled from the job's contact and the survey named by its slug. */
function sendSurvey(): Doc {
  return {
    key: 'send-survey',
    name: words('Send a survey'),
    does: words('Invites a person to answer one of your surveys'),
    inputs: [
      { key: 'survey', label: words('Survey'), kind: 'record', table: 'forms', by: 'slug', where: [{ column: 'state', eq: 'live' }, { column: 'kind', eq: 'survey' }], required: true, help: words('Only live surveys are listed.') },
      { key: 'to', label: words('To'), kind: 'person', required: true },
      {
        key: 'class',
        label: words('Kind of mail'),
        kind: 'choice',
        required: true,
        options: [
          { value: 'marketing', label: words('Marketing mail'), help: words('Goes only to people who agreed to marketing mail.') },
          { value: 'service', label: words('Service mail'), help: words('Use only for mail about work you did for them.') },
        ],
      },
    ],
    writes: {
      table: 'invitations',
      values: {
        form_id: { input: 'survey' },
        email: { person: 'to', field: 'email' },
        name: { person: 'to', field: 'name' },
        language: { person: 'to', field: 'language' },
        person_table: { person: 'to', field: 'table' },
        person_key: { person: 'to', field: 'key' },
        record_table: { token: 'recordTable' },
        record_key: { token: 'recordKey' },
        class: { input: 'class' },
        invited_at: { token: 'now' },
      },
    },
  };
}

function withStep(edit: (step: Doc & { inputs: Doc[]; writes: { values: Doc } }) => void = () => undefined, floor = '0.3.41'): Doc {
  const doc = formsWithInvitations();
  // The invitee's name is kept personal, as their address is (which its name alone says).
  const invitations = (doc['requiredSchema'] as { tables: (Doc & { columns: Doc[] })[] }).tables.find((table) => table['ref'] === 'invitations')!;
  invitations.columns = invitations.columns.map((column) => (column['ref'] === 'name' ? { ...column, rules: { personal: true } } : column));
  const step = sendSurvey() as Doc & { inputs: Doc[]; writes: { values: Doc } };
  edit(step);
  (doc['addOn'] as Doc)['steps'] = [step];
  doc['compatibility'] = { minAdminiumVersion: floor };
  return doc;
}

describe('a step that sends a survey', () => {
  it('reads a person, a survey by its slug, a choice with lines, and the record\'s own table and key: it validates', () => {
    expect(issuesOf(withStep())).toEqual([]);
    const named = installFloorWords(withStep()).map((word) => word.word);
    for (const word of ['step.person', 'step.recordBy', 'step.recordWhere', 'step.help', 'step.recordTokens']) expect(named, word).toContain(word);
  });

  it('needs 0.3.41 for each of its new words', () => {
    const said = issuesOf(withStep(undefined, '0.3.40')).join('\n');
    for (const word of ['step.person', 'step.recordBy', 'step.recordWhere', 'step.help', 'step.recordTokens']) expect(said, word).toContain(`"${word}" is read by Adminium 0.3.41 and later`);
    // Each word alone is told by name: a step with only the record's tokens needs the floor too.
    const tokensOnly = withStep((step) => {
      step.inputs = [step.inputs[0]!].map((input) => ({ ...input, by: undefined, where: undefined, help: undefined }));
      step.writes.values = { form_id: { input: 'survey' }, email: { text: 'a@b.example' }, language: { text: 'en-US' }, person_table: { text: 'x' }, person_key: { text: 'x' }, class: { text: 'service' }, invited_at: { token: 'now' }, record_key: { token: 'recordKey' } };
    }, '0.3.40');
    expect(issuesOf(tokensOnly).join('\n')).toContain('"step.recordTokens" is read by Adminium 0.3.41 and later');
    expect(issuesOf(tokensOnly).join('\n')).not.toContain('step.person');
  });

  it('writes a person\'s address and name only into columns kept personal', () => {
    const unmarked = withStep();
    const table = (unmarked['requiredSchema'] as { tables: (Doc & { columns: Doc[] })[] }).tables.find((one) => one['ref'] === 'invitations')!;
    table.columns = table.columns.map((column) => (column['ref'] === 'name' ? { ...column, rules: undefined } : column));
    expect(issuesOf(unmarked)).toEqual(['addOn.steps.0.writes.values.name.field: "invitations.name" takes a person\'s name: mark the column personal']);
    const plain = withStep((step) => (step.writes.values['person_key'] = { person: 'to', field: 'email' }));
    expect(issuesOf(plain).join('\n')).toContain('addOn.steps.0.writes.values.person_key.field: "invitations.person_key" takes a person\'s email: mark the column personal');
    // Their language, company, table and key are not personal.
    expect(issuesOf(withStep((step) => (step.writes.values['person_key'] = { person: 'to', field: 'company' })))).toEqual([]);
  });

  it('reads a person\'s fields from a person input, and never a person input as a whole', () => {
    expect(issuesOf(withStep((step) => (step.writes.values['email'] = { person: 'class', field: 'email' }))).join('\n')).toContain('a person\'s field is read from one of the step\'s person inputs');
    expect(issuesOf(withStep((step) => (step.writes.values['person_key'] = { input: 'to' }))).join('\n')).toContain('a person input fills columns by its fields');
    expect(issuesOf(withStep((step) => (step.writes.values['email'] = { person: 'nobody', field: 'email' }))).join('\n')).toContain('a person\'s field is read from one of the step\'s person inputs');
    // A person input nothing reads is an input nothing reads.
    const unread = withStep((step) => {
      for (const column of ['email', 'name', 'language', 'person_table', 'person_key']) step.writes.values[column] = { text: column === 'email' ? 'a@b.example' : column === 'language' ? 'en-US' : 'x' };
    });
    expect(issuesOf(unread).join('\n')).toContain('no value of the row reads the input "to"');
  });

  it('names a row by a unique column of its table, and lists only rows with values its columns hold', () => {
    const input = (step: Doc & { inputs: Doc[] }) => step.inputs[0]!;
    expect(issuesOf(withStep((step) => (input(step)['by'] = 'title'))).join('\n')).toContain('addOn.steps.0.inputs.0.by: "forms.title" may hold a value twice: a row is named by a unique column');
    expect(issuesOf(withStep((step) => (input(step)['by'] = 'handle'))).join('\n')).toContain('addOn.steps.0.inputs.0.by: "forms" has no column "handle"');
    expect(issuesOf(withStep((step) => (input(step)['where'] = [{ column: 'status', eq: 'live' }]))).join('\n')).toContain('addOn.steps.0.inputs.0.where.0.column: "forms" has no column "status"');
    expect(issuesOf(withStep((step) => (input(step)['where'] = [{ column: 'state', eq: 'open' }]))).join('\n')).toContain('"forms.state" is one of draft, live, closed: no row holds "open"');
    expect(issuesOf(withStep((step) => (input(step)['where'] = [])))).not.toEqual([]);
    expect(issuesOf(withStep((step) => (input(step)['where'] = [1, 2, 3, 4].map(() => ({ column: 'state', eq: 'live' })))))).not.toEqual([]);
  });

  it('names rows and lists them only on a record input', () => {
    const shape = sendSurvey() as Doc & { inputs: Doc[] };
    shape.inputs[1] = { ...shape.inputs[1], by: 'slug' };
    expect(addOnStepSchema.safeParse(shape).success).toBe(false);
    shape.inputs[1] = { ...shape.inputs[1], by: undefined, where: [{ column: 'state', eq: 'live' }] };
    expect(addOnStepSchema.safeParse(shape).success).toBe(false);
    expect(addOnStepSchema.safeParse(sendSurvey()).success).toBe(true);
  });

  it('keeps its lines to 160 characters in every language', () => {
    expect(issuesOf(withStep((step) => (step.inputs[0]!['help'] = words('x'.repeat(161))))).join('\n')).toContain('addOn.steps');
    expect(issuesOf(withStep((step) => (step.inputs[0]!['help'] = { 'en-US': 'Only live surveys are listed.' })))).not.toEqual([]);
  });
});
