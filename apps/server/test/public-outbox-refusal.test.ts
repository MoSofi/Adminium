// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A write an app's outbox refuses (a message made already sent, say) is the
 * public surface's one opaque refusal: the desk's message names the column
 * and the state, and neither is a stranger's business.
 */
import { connectionTenantConfig } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'email', type: 'text', maxLength: 254 }] },
      {
        ref: 'messages',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'kind', type: 'enum', enum: ['notice'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'held', 'sent', 'failed', 'skipped'], default: 'queued' },
          { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
          { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
          { ref: 'error', type: 'text', maxLength: 400, nullable: true },
        ],
      },
    ]),
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', sentAt: 'sent_at', error: 'error' },
      recipient: { via: 'client_id', table: 'clients', email: 'email' },
      kinds: { notice: 'studio-notice' },
    },
    emailTemplates: [
      { key: 'studio-notice', name: 'Notice', locales: { 'en-US': { subject: 'A notice', blocks: [{ block: 'email.text', data: { text: 'Hello.' } }] } } },
    ],
  };
}

describe.each(LEGS)('an outbox refusal on the public surface — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    // An operator's own door on the app's outbox table.
    const views = createPublicViews(h.meta);
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const messages = (await views.viewFor(h.connectionId))!.table(h.real('messages')).id;
    await service.saveEndpoint({
      connectionId: h.connectionId,
      ref: 'messages_door',
      origin: 'custom',
      definition: {
        path: '/messages_door',
        source: messages,
        methods: ['POST', 'BATCH'],
        select: ['id', 'kind', 'status'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['kind', 'status', 'to_address'],
      },
    });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'outbox door',
      access: [{ ref: 'messages_door', methods: ['POST', 'BATCH'] }],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    served = await servePublic(h, key.id);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('refuses a message made already sent, saying nothing of why', async () => {
    const sent = { kind: 'notice', status: 'sent', to_address: 'a@example.com' };
    const one = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/messages_door', headers: served.headers(), payload: { values: sent } });
    expect(one.statusCode, one.body).toBe(400);
    expect(one.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
    const batch = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/messages_door/batch', headers: served.headers(), payload: { rows: [{ kind: 'notice', status: 'queued' }, sent] } });
    expect(batch.statusCode, batch.body).toBe(400);
    expect(batch.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
    expect(Number((await h.rows(`select count(*) as n from ${h.real('messages')}`))[0]!['n'])).toBe(0);
    // A message made as a message starts is made.
    const fine = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/messages_door', headers: served.headers(), payload: { values: { kind: 'notice', status: 'queued' } } });
    expect(fine.statusCode, fine.body).toBe(201);
  });
});
