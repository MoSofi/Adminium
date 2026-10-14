// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN AMOUNT OF TIME READ FROM THE APP'S SETTINGS, against the whole server on
 * SQLite, Postgres and MySQL, through an app installed by the real installer.
 *
 * "Quiet for more than `settings.nudge_quiet_days` days": a rule by the clock
 * visits the deals whose last touch is older than the number the owner keeps
 * in the settings row, read at each tick; the rule's own `amount` while the
 * setting holds no day count. A condition step reads it the same way.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const DAY = 86_400_000;
const quiet = { amount: 7, unit: 'days', setting: { table: 'settings', column: 'nudge_quiet_days' } };

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'nudge_quiet_days', type: 'int', nullable: true }] },
        { ref: 'deals', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'last_activity_at', type: 'timestamptz', nullable: true }, { ref: 'poked', type: 'int', default: 0 }] },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@crm-deals:view'] }],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'nudge-quiet',
        name: en('A quiet deal'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' }, forEach: { table: 'deals', once: false, where: [{ left: { field: 'last_activity_at' }, op: 'more_than_ago', right: quiet }] } },
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Tick' }, { id: 'n', kind: 'action', title: 'Tell', action: { kind: 'notification', to: { roles: ['manager'] }, title: en('Quiet: {{record.name}}') } }] },
      },
      {
        key: 'poke',
        name: en('A deal poked: is it quiet?'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'poked' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'Poked' },
            { id: 'c', kind: 'condition', title: 'Quiet?', condition: { left: { field: 'last_activity_at' }, op: 'more_than_ago', right: quiet } },
            { id: 'n', kind: 'action', title: 'Tell', action: { kind: 'notification', to: { roles: ['manager'] }, title: en('Poked and quiet: {{record.name}}') } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an amount read from the app's settings, on ${dialect}`, () => {
    let s: WholeServer;
    const titles = async (prefix: string): Promise<string[]> =>
      ((await s.get('mia', '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string }[] } }).data.items
        .filter((item) => item.kind === 'automation.notice' && item.title.startsWith(prefix))
        .map((item) => item.title)
        .sort();
    /** One tick of the clock: the deals the scan told of, this time. */
    const tick = async (): Promise<string[]> => {
      await s.meta.db.deleteFrom('adminium_notifications').execute();
      await s.tick();
      await s.jobs();
      return titles('Quiet: ');
    };
    const setting = (value: string) => s.rows(`UPDATE crm_settings SET nudge_quiet_days = ${value} WHERE id = 1`);

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] } });
      await s.rows('INSERT INTO crm_settings (id, nudge_quiet_days) VALUES (1, 3)');
      const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
      for (const [name, days] of [['Five', 5], ['One', 1], ['Nine', 9]] as const) expect(said(await s.make('owner', 'deals', { name, last_activity_at: ago(days) }))).toBe('ok');
      await s.jobs();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('visits the deals quiet for longer than the setting says, read at each tick', async () => {
      expect(await tick()).toEqual(['Quiet: Five', 'Quiet: Nine']);
      await setting('8');
      expect(await tick()).toEqual(['Quiet: Nine']);
      await setting('30');
      expect(await tick()).toEqual([]);
    });

    it('keeps the rule’s own amount while the setting holds no day count', async () => {
      for (const value of ['NULL', '0', '5000']) {
        await setting(value);
        // Seven days: only the deal quiet for nine.
        expect(await tick(), value).toEqual(['Quiet: Nine']);
      }
    });

    it('a condition step reads the same setting as the run reaches it', async () => {
      await setting('4');
      await s.meta.db.deleteFrom('adminium_notifications').execute();
      const keys = (await s.rows("SELECT id, name FROM crm_deals ORDER BY id")) as { id: unknown; name: string }[];
      for (const deal of keys) expect(said(await s.change('owner', 'deals', deal.id, { poked: 1 }))).toBe('ok');
      await s.jobs();
      expect(await titles('Poked and quiet: ')).toEqual(['Poked and quiet: Five', 'Poked and quiet: Nine']);
    });
  });
}
