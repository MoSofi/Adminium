// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S CONSOLE CARDS AND ITS E-MAILS' PEOPLE: a dashboard card of a part
 * (`module`), a card's column headings in other languages (`labels`), a link
 * to one screen of the staff side (`@staff/<path>`), and an e-mail naming
 * the person a staff column names (`{{visit.rep_id.name}}`). What the check
 * accepts and refuses, the release each asks for, and what goes with a part
 * that is left out.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, withoutModules, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const text = (ref: string, maxLength = 120, more: Doc = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const link = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const count = (table: string) => ({ connectionId: 'c', kind: 'table-query', source: { name: table, type: 'table' }, shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'n' }] });
const card = (i: string, table: string, more: Doc = {}) => ({ i, widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: i, binding: count(table) }, ...more });

function app(change: (m: Doc) => void = () => undefined, floor = '0.3.28'): Doc {
  const m: Doc = {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'inbox', label: en('Inbox'), default: 'on' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', module: 'selling', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'deals', module: 'selling', columns: [id, text('name', 80), { ref: 'amount', type: 'decimal', scale: 'currency', default: 0 }] },
        { ref: 'enquiries', module: 'inbox', columns: [id, text('subject', 120)] },
        { ref: 'site_visits', module: 'selling', columns: [id, link('contact_id', 'contacts'), link('deal_id', 'deals'), text('rep_id', 36, { rules: { staff: true } }), text('purpose', 80)] },
        {
          ref: 'messages',
          module: 'selling',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['visit-confirmed'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            link('contact_id', 'contacts'),
            link('visit_id', 'site_visits'),
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    navGroups: [{ key: 'selling', label: en('Selling'), order: 1 }],
    pages: [
      {
        ref: 'crm-overview',
        template: 'page-dashboard',
        title: { key: 't.overview', fallback: 'Overview' },
        nav: { group: 'selling', icon: 'gauge', order: 1 },
        module: 'selling',
        config: {
          layout: {
            version: 1,
            toolbar: { links: [{ label: 'Approvals', href: '@staff/approvals', tone: 'primary' }, { label: 'Open the desk', href: '@staff' }] },
            items: [
              card('open-deals', 'deals', { config: { title: 'Open deals', href: '@staff/deals', binding: count('deals') } }),
              card('unclaimed', 'enquiries', { module: 'inbox' }),
              // A card over a part's table that does not say its part: it goes with the part's table all the same.
              card('enquiries-plain', 'enquiries'),
              {
                i: 'reps',
                widget: 'mini-table',
                x: 0,
                y: 3,
                w: 6,
                h: 6,
                config: { title: 'Deals', binding: { ...count('deals'), shape: 'record-list' }, columns: [{ name: 'name', label: 'Deal', labels: { 'de-DE': 'Deal', 'ar-EG': 'الصفقة' } }, { name: 'amount', label: 'Amount' }] },
              },
            ],
          },
        },
      },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { visit: 'visit_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'visit-confirmed': 'crm-visit-confirmed' },
      producers: [{ kind: 'visit-confirmed', link: 'visit_id', onCreate: { table: 'site_visits' } }],
    },
    emailTemplates: [
      {
        key: 'crm-visit-confirmed',
        name: 'Visit confirmed',
        locales: { 'en-US': { subject: 'Your visit: {{visit.purpose}}', blocks: [{ block: 'email.text', data: { text: '{{visit.rep_id.name}} will come about {{visit.purpose}}.' } }] } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
  change(m);
  return m;
}

const messages = (m: Doc): string[] => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const overview = (m: Doc) => ((m['pages'] as Doc[])[0]!['config'] as { layout: { toolbar: { links: Doc[] }; items: Doc[] } }).layout;

describe('the four words', () => {
  it('are accepted as written', () => {
    expect(messages(app())).toEqual([]);
  });

  it('each ask for the release that reads it', () => {
    const found = installFloorWords(app());
    expect(found).toContainEqual({ word: 'card.module', path: 'pages.0.config.layout.items.1.module' });
    expect(found).toContainEqual({ word: 'card.columnLabels', path: 'pages.0.config.layout.items.3.config.columns.0.labels' });
    expect(found).toContainEqual({ word: 'link.staffPath', path: 'pages.0.config.layout.toolbar.links.0.href' });
    expect(found).toContainEqual({ word: 'link.staffPath', path: 'pages.0.config.layout.items.0.config.href' });
    expect(found).toContainEqual({ word: 'outbox.staffName', path: 'emailTemplates.0' });
    // `@staff` alone has been read since the toolbar's link was.
    expect(found).not.toContainEqual({ word: 'link.staffPath', path: 'pages.0.config.layout.toolbar.links.1.href' });
    for (const word of ['card.module', 'card.columnLabels', 'link.staffPath', 'outbox.staffName'] as const) expect(WORD_FLOORS[word]).toBe('0.3.28');
    const old = messages(app(undefined, '0.3.27')).join('\n');
    for (const word of ['card.module', 'card.columnLabels', 'link.staffPath', 'outbox.staffName']) expect(old).toContain(`"${word}" is read by Adminium 0.3.28 and later`);
  });

  it('asks nothing of an e-mail that names no person, nor of a rule\'s own template', () => {
    const plain = app((m) => {
      ((m['emailTemplates'] as Doc[])[0]!['locales'] as Doc)['en-US'] = { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'About {{visit.purpose}}; {{recipient.name}}.' } }] };
    });
    expect(installFloorWords(plain).map((one) => one.word)).not.toContain('outbox.staffName');
  });
});

describe('a card of a part', () => {
  it('names one of the app\'s parts', () => {
    expect(messages(app((m) => (overview(m).items[1]!['module'] = 'jobs'))).join('\n')).toContain('pages.0.config.layout.items.1.module: "jobs" is not one of the app\'s modules');
  });

  it('goes with its part when the part is left out, as does a card over the part\'s tables; the rest is a whole manifest', () => {
    const left = withoutModules(app(), ['inbox']);
    expect(overview(left).items.map((item) => item['i'])).toEqual(['open-deals', 'reps']);
    expect(messages(left)).toEqual([]);
    // The full manifest keeps every card.
    expect(overview(app()).items).toHaveLength(4);
  });
});

describe('a link to one screen of the staff side', () => {
  it('is a path under the side, as a section entry\'s is', () => {
    for (const good of ['@staff/approvals', '@staff/settings/team', '@staff/quotes.v2/~x_y-z']) {
      expect(messages(app((m) => (overview(m).toolbar.links[0]!['href'] = good))), good).toEqual([]);
    }
  });

  it('never leaves the side', () => {
    const bad = ['@staff/', '@staff//evil.example', '@staff/../other', '@staff/./x', '@staff/.hidden', '@staff/%2e%2e/x', '@staff/approvals?next=//evil.example', '@staff/a#b', '@staff/https://evil.example', '@staff/a\\b', '@staff/approvals/'];
    for (const href of bad) {
      expect(messages(app((m) => (overview(m).toolbar.links[0]!['href'] = href))).join('\n'), href).toContain('pages.0.config.layout.toolbar.links.0.href: "@staff/" is followed by a path under the side');
      expect(messages(app((m) => ((overview(m).items[0]!['config'] as Doc)['href'] = href))).join('\n'), href).toContain('pages.0.config.layout.items.0.config.href');
    }
  });

  it('needs a staff side to open', () => {
    const none = messages(app((m) => (m['frontends'] = [{ side: 'customer', kind: 'spa', entry: 'index.html' }])));
    expect(none.join('\n')).toContain('pages.0.config.layout.toolbar.links.0.href: the app declares no staff side to open');
  });
});

describe('a list row names the person a staff column names', () => {
  const listing = (row: string) =>
    app((m) => {
      ((m['emailTemplates'] as Doc[])[0]!['locales'] as Doc)['en-US'] = {
        subject: 'Your visits',
        blocks: [{ block: 'email.rows', id: 'visits', data: { from: { link: 'visit', table: 'site_visits', via: 'deal_id', orderBy: 'id' }, row: { title: row }, empty: 'None' } }],
      };
      (m['outbox'] as Doc)['links'] = { visit: 'visit_id' };
    });
  it('has the form for a staff column, and for no other', () => {
    const asked = messages(listing('{{row.purpose}} with {{row.rep_id.name}}')).filter((line) => line.includes('row.'));
    expect(asked).toEqual([]);
    expect(messages(listing('{{row.purpose.name}}')).join('\n')).toContain('{{row.purpose.name}}: "site_visits.purpose" is a text column, which has no "name" form');
  });
});
