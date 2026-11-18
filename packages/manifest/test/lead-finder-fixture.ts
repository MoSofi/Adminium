// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on that finds companies and people: its sources (three registers,
 * a people service with a paid key, the engine's website reader), the
 * contract they answer by, its two tables for what was found and its
 * settings table, as the engine reads them. What the manifest's checks of
 * `addOn.sources` and `addOn.leads` start from.
 */
type Doc = Record<string, unknown>;

const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
const nullable = { nullable: true };
const key = (): Doc => ({ ref: 'id', type: 'int', role: 'pk' });
const moment = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'timestamptz', ...more });

export const LEAD_FINDER_HOSTS = ['api.company-information.service.gov.uk', 'recherche-entreprises.api.gouv.fr', 'data.brreg.no', 'api.hunter.io'];

/** The add-on, valid as it stands. */
export function leadFinder(): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'company-finder',
    name: 'Company finder',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'company-finder.description', fallback: 'Find companies and fill in their details.' },
    categories: ['marketing'],
    compatibility: { minAdminiumVersion: '0.3.65', requires: ['outbound-http'] },
    capabilities: ['outbound-http'],
    settings: [
      { key: 'companies_house_key', type: 'string', secret: true },
      { key: 'hunter_key', type: 'string', secret: true },
      { key: 'search_note', type: 'string' },
    ],
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      provides: [{ contract: 'lead-source', version: 1, server: 'dist/server.js' }],
      connect: { kind: 'none' },
      network: { allow: [...LEAD_FINDER_HOSTS] },
      sources: [
        { id: 'companies-house', hosts: ['api.company-information.service.gov.uk'], key: 'companies_house_key', gives: ['find', 'fill'], window: { calls: 600, seconds: 300 } },
        { id: 'france', hosts: ['recherche-entreprises.api.gouv.fr'], gives: ['find', 'fill'], window: { calls: 7, seconds: 1 } },
        { id: 'norway', hosts: ['data.brreg.no'], gives: ['find', 'fill'] },
        { id: 'hunter', hosts: ['api.hunter.io'], key: 'hunter_key', gives: ['people'], paid: true },
        { id: 'website', reads: 'website', gives: ['fill'] },
      ],
      settingsTable: 'finder_settings',
      leads: { foundPeople: 'found_people', fieldSources: 'field_sources' },
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'found_people',
          columns: [
            key(),
            text('person_table', 64),
            text('person_key', 200),
            text('company_table', 64, nullable),
            text('company_key', 200, nullable),
            text('source', 32),
            moment('found_at'),
            text('purpose', 500),
            { ref: 'tell_by', type: 'date' },
            moment('told_at', nullable),
            text('outbox_id', 64, nullable),
            { ref: 'state', type: 'enum', enum: ['waiting', 'told', 'failed', 'objected'] },
            text('source_pages', undefined, nullable),
          ],
        },
        {
          ref: 'field_sources',
          columns: [key(), text('table_ref', 64), text('row_key', 200), text('column_name', 64), text('source', 32), moment('found_at'), text('value_hash', 64)],
          unique: [['table_ref', 'row_key', 'column_name']],
        },
        {
          ref: 'finder_settings',
          columns: [key(), { ref: 'people_on', type: 'bool', default: false }, { ref: 'purpose', type: 'json', nullable: true }, { ref: 'keep_years', type: 'int', default: 3 }],
        },
      ],
    },
    roles: [
      {
        key: 'finder',
        name: 'Finder',
        permissions: ['table:@found_people:read', 'table:@field_sources:read', 'table:@finder_settings:read', 'table:@finder_settings:update'],
      },
    ],
  };
}
