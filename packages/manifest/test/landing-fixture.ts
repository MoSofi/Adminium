// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A landing pages add-on with its pages and funnels tables, as the engine
 * reads them: what the manifest's own checks, and the server's seal, start
 * from.
 */
type Doc = Record<string, unknown>;

const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
const nullable = { nullable: true };
/** A fresh numbered key each time: a test that breaks one table's key breaks no other's. */
const key = (): Doc => ({ ref: 'id', type: 'int', role: 'pk' });
const moment = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'timestamptz', ...more });

/** A landing pages add-on with both tables, as the engine reads them. */
export function landingAddOn(): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'landing-pages',
    name: 'Landing pages',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'landing-pages.description', fallback: 'Pages for your offers and events.' },
    categories: ['marketing'],
    compatibility: { minAdminiumVersion: '0.3.65' },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      landing: { pages: 'pages', funnels: 'funnels' },
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'pages',
          columns: [
            key(),
            text('name', 200),
            text('slug', 80),
            { ref: 'state', type: 'enum', enum: ['draft', 'live', 'off'], default: 'draft' },
            text('language', 10),
            { ref: 'draft', type: 'json' },
            { ref: 'published', type: 'json', nullable: true },
            moment('published_at', nullable),
            moment('updated_at'),
          ],
        },
        {
          ref: 'funnels',
          columns: [key(), text('name', 200), { ref: 'steps', type: 'json' }, text('rule_id', 64, nullable)],
        },
      ],
    },
    roles: [
      {
        key: 'page-editor',
        name: 'Page editor',
        permissions: ['table:@pages:read', 'table:@pages:create', 'table:@pages:update', 'table:@pages:delete', 'table:@funnels:read', 'table:@funnels:create', 'table:@funnels:update', 'table:@funnels:delete'],
      },
    ],
  };
}
