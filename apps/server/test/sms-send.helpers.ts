// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two text send tables, as the migration will make them, and a stub
 * provider. The stub's replies are written from the providers' documentation
 * and cannot prove the live APIs.
 *
 * No migration makes the tables yet. This body is what moves into
 * `packages/meta/src/migrations/` when one does, under the next free number.
 */
import { columnHelpers, metaTable, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

export async function makeTextSendTables(meta: MetaDb): Promise<void> {
  const db = meta.db as unknown as Kysely<unknown>;
  const c = columnHelpers(meta.dialect);

  await db.schema
    .createTable(metaTable('text_deliveries'))
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('claim_hash', c.str(64), (col) => col.notNull())
    .addColumn('message_hash', c.str(64), (col) => col.notNull())
    .addColumn('open_message_hash', c.str(64))
    .addColumn('phone_hash', c.str(64))
    .addColumn('key_version', c.int)
    .addColumn('phone_masked', c.str(32))
    .addColumn('text_class', c.str(12), (col) => col.notNull())
    .addColumn('state', c.str(20), (col) => col.notNull())
    .addColumn('reason', c.str(40))
    .addColumn('provider', c.str(16))
    .addColumn('provider_message_id', c.str(64))
    .addColumn('provider_status', c.str(32))
    .addColumn('provider_error_code', c.str(8))
    .addColumn('segments', c.int)
    .addColumn('price_amount', c.str(32))
    .addColumn('price_currency', c.str(8))
    .addColumn('estimated_segments', c.int, (col) => col.notNull())
    .addColumn('encoding', c.str(8), (col) => col.notNull())
    .addColumn('version', c.int, (col) => col.notNull())
    .addColumn('attempts', c.int, (col) => col.notNull())
    .addColumn('attempt_started_at', c.ts)
    .addColumn('attempt_account', c.str(32))
    .addColumn('may_have_gone_at', c.ts)
    .addColumn('may_have_gone_account', c.str(32))
    .addColumn('slot_day', c.str(10))
    .addColumn('stop_owed_at', c.ts)
    .addColumn('report_target', c.text)
    .addColumn('settle_owed_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  const deliveries = metaTable('text_deliveries');
  await db.schema.createIndex('ux_adminium_text_deliveries_claim').on(deliveries).column('claim_hash').unique().execute();
  await db.schema.createIndex('ux_adminium_text_deliveries_open_message').on(deliveries).column('open_message_hash').unique().execute();
  await db.schema.createIndex('ix_adminium_text_deliveries_settle').on(deliveries).column('settle_owed_at').execute();
  await db.schema.createIndex('ix_adminium_text_deliveries_message').on(deliveries).columns(['message_hash', 'state']).execute();
  await db.schema.createIndex('ix_adminium_text_deliveries_provider').on(deliveries).columns(['provider', 'provider_message_id']).execute();
  await db.schema.createIndex('ix_adminium_text_deliveries_phone').on(deliveries).columns(['phone_hash', 'key_version']).execute();
  await db.schema.createIndex('ix_adminium_text_deliveries_marker').on(deliveries).columns(['state', 'attempt_started_at']).execute();

  await db.schema
    .createTable(metaTable('text_send_days'))
    .addColumn('day', c.str(10), (col) => col.primaryKey())
    .addColumn('used', c.int, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
}

export const json = (status: number, value: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

export const twilioAccepted = (status = 'queued'): Response => json(201, { sid: `SM${'cd'.repeat(16)}`, status, num_segments: '1', price: '-0.0079', price_unit: 'USD' });
export const telnyxAccepted = (replayed = false): Response =>
  json(200, { data: { id: '40385f64-5717-4562-b3fc-2c963f66afa6', to: [{ status: 'queued' }], parts: 1, cost: { amount: '0.0040', currency: 'USD' } } }, replayed ? { 'idempotent-replayed': 'true' } : {});

export const networkError = (code: string): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });

/** What one POST does: answer, fail, or never answer (a timeout). */
export type ProviderStep = Response | Error | 'hang';

export interface ProviderPost {
  url: string;
  body: string;
  idempotencyKey: string | null;
}

/** Answers every account check, and each POST from `script` (accepted when it runs out). */
export function stubProvider(kind: 'twilio' | 'telnyx', profile: string, script: ProviderStep[] = []) {
  const posts: ProviderPost[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if ((init?.method ?? 'GET') === 'GET') {
      if (address.includes('messaging_profiles')) return json(200, { data: { id: profile, name: 'Lumen Bistro', enabled: true } });
      return json(200, { sid: /Accounts\/([^.]+)\.json/.exec(address)?.[1], friendly_name: 'Lumen Bistro', status: 'active', type: 'Full' });
    }
    posts.push({ url: address, body: typeof init?.body === 'string' ? init.body : '', idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    const step = script.shift() ?? (kind === 'twilio' ? twilioAccepted() : telnyxAccepted());
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
      });
    }
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { posts, fetchStub, script };
}
