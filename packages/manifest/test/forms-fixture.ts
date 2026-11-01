// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A forms add-on with all four tables, as the engine reads them: what the
 * manifest's own checks start from, and what the server's forms door
 * installs and serves forms from.
 */
type Doc = Record<string, unknown>;

export const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
export const nullable = { nullable: true };
const id = { ref: 'id', type: 'id', role: 'pk' };

/** A forms add-on with all four tables, as the engine reads them. */
export function formsAddOn(): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'forms',
    name: 'Forms & surveys',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'forms.description', fallback: 'Forms and surveys.' },
    categories: ['marketing'],
    compatibility: { minAdminiumVersion: '0.3.40' },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      forms: { forms: 'forms', answers: 'answers', invitations: 'invitations', files: 'answer_files' },
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'forms',
          columns: [
            id,
            text('title', 200),
            text('slug', 80, { unique: true }),
            { ref: 'kind', type: 'enum', enum: ['form', 'survey'] },
            { ref: 'state', type: 'enum', enum: ['draft', 'live', 'closed'], default: 'draft' },
            { ref: 'definition', type: 'json' },
            { ref: 'settings', type: 'json' },
            { ref: 'published', type: 'json', nullable: true },
            { ref: 'published_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'invitations',
          columns: [
            id,
            { ref: 'form_id', type: 'fk', references: 'forms' },
            text('email', 320),
            text('name', 200, nullable),
            text('language', 10),
            text('person_table', 64),
            text('person_key', 200),
            text('record_table', 64, nullable),
            text('record_key', 200, nullable),
            text('token_hash', 64, nullable),
            { ref: 'class', type: 'enum', enum: ['marketing', 'service'] },
            { ref: 'invited_at', type: 'timestamptz' },
            { ref: 'answered_at', type: 'timestamptz', nullable: true },
            { ref: 'expires_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'answers',
          columns: [
            id,
            { ref: 'form_id', type: 'fk', references: 'forms' },
            { ref: 'submitted_at', type: 'timestamptz' },
            text('language', 10),
            { ref: 'values', type: 'json' },
            text('email', 320, nullable),
            text('name', 200, nullable),
            text('became_table', 64, nullable),
            text('became_key', 200, nullable),
            { ref: 'invitation_id', type: 'fk', references: 'invitations', nullable: true },
            { ref: 'confirm', type: 'enum', enum: ['none', 'pending', 'confirmed', 'expired'] },
            text('consent_purpose', 20, nullable),
            text('consent_wording', undefined, nullable),
            { ref: 'consent_version', type: 'int', nullable: true },
            text('ip', 64, nullable),
            text('user_agent', 512, nullable),
            text('sent_from', undefined, nullable),
          ],
        },
        {
          ref: 'answer_files',
          columns: [
            id,
            { ref: 'answer_id', type: 'fk', references: 'answers', nullable: true },
            text('file_id', 64),
            text('question', 16),
            text('name', 255),
            { ref: 'size', type: 'bigint' },
            text('kind', 20),
            { ref: 'uploaded_at', type: 'timestamptz' },
            { ref: 'expires_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [
      {
        key: 'marketer',
        name: 'Marketer',
        permissions: ['table:@forms:read', 'table:@forms:create', 'table:@forms:update', 'table:@answers:read', 'table:@answers:delete', 'table:@invitations:read', 'table:@answer_files:read'],
      },
    ],
  };
}

