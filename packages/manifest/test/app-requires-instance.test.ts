// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two words only a self-made app carries: the other apps it needs on its
 * database (`apps.requires`, matched by publisher AND key), and the part that
 * is the whole deployment's (`instance`). Each has a floor, so an older
 * Adminium says "needs Adminium 0.3.49" instead of failing.
 */
import { describe, expect, it } from 'vitest';

import {
  INSTALL_FLOOR_WORD_NAMES,
  WORD_FLOORS,
  installFloorWords,
  requiredAppTables,
  validateManifest,
} from '../src/index.js';

type Doc = Record<string, unknown>;

/** A self-made dashboard over a shop's orders, with a note table of its own. */
function dashboard(over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop-desk',
    name: 'Shop desk',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A desk over the shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'total', type: 'decimal', scale: 2 }] },
        { ref: 'desk_notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }] },
      ],
    },
    pages: [{ ref: 'notes', template: 'page-crud', title: { key: 't', fallback: 'Notes' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'desk_notes' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...over,
  };
}

const POS = { publisher: 'adminium', key: 'point-of-sale', range: '>=1.2.0', tables: ['orders'] };
const issues = (m: Doc): string => {
  const result = validateManifest(m, { allowLocalPublisher: true });
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

describe('apps.requires', () => {
  it('names another app by publisher and key, a range and the tables that are its own', () => {
    const m = dashboard({ apps: { requires: [POS] } });
    expect(issues(m)).toBe('');
    const validated = validateManifest(m, { allowLocalPublisher: true });
    const apps = validated.ok && validated.manifest.kind === 'app' ? validated.manifest.apps : undefined;
    expect(requiredAppTables(apps).get('orders')?.key).toBe('point-of-sale');
    // No range: any version will do; no tables: nothing of it is this app's.
    expect(issues(dashboard({ apps: { requires: [{ publisher: 'adminium', key: 'point-of-sale' }] } }))).toBe('');
  });

  it('is a self-made app\'s only', () => {
    expect(issues(dashboard({ publisher: { id: 'adminium', name: 'Adminium' }, apps: { requires: [POS] } }))).toContain('apps: "apps" is carried only by a self-made app');
  });

  it('never names a key alone, nor a self-made app, nor the app itself, nor one app twice', () => {
    expect(issues(dashboard({ apps: { requires: [{ key: 'point-of-sale' }] } }))).toContain('apps.requires.0.publisher');
    expect(issues(dashboard({ apps: { requires: [{ ...POS, publisher: 'local' }] } }))).toContain('a self-made app cannot be required');
    expect(issues(dashboard({ apps: { requires: [{ publisher: 'adminium', key: 'shop-desk' }] } }))).toContain('an app does not require itself');
    expect(issues(dashboard({ apps: { requires: [POS, { publisher: 'acme', key: 'point-of-sale' }] } }))).toContain('"point-of-sale" is required twice');
  });

  it('keeps its range and tables to what can be read', () => {
    expect(issues(dashboard({ apps: { requires: [{ ...POS, range: 'soon' }] } }))).toContain('a semver range');
    expect(issues(dashboard({ apps: { requires: [{ ...POS, tables: ['tickets'] }] } }))).toContain('"tickets" is not one of the app\'s tables');
    expect(issues(dashboard({ apps: { requires: [POS, { publisher: 'adminium', key: 'kitchen', tables: ['orders'] }] } }))).toContain('"orders" is already "point-of-sale"\'s table');
    expect(issues(dashboard({ apps: { requires: [{ ...POS, connectionId: 'conn_1' }] } }))).toContain('Unrecognized key');
    expect(issues(dashboard({ apps: { requires: [] } }))).toContain('apps.requires');
  });
});

const INSTANCE = {
  branding: { appName: 'Fernhill', accent: 'teal', theme: 'light', logo: { file: 'instance/logo.svg', sha256: 'a'.repeat(64) } },
  languages: { enabled: ['en_US', 'de_DE'], default: 'de_DE' },
  wording: [{ locale: 'de_DE', namespace: 'nav', key: 'pages', value: 'Seiten' }],
  systemEmails: [{ key: 'user-invite', locale: 'en_US', content: { subject: 'Join Fernhill', blocks: [{ block: 'email.text', data: { text: 'Welcome.' } }] } }],
  settings: { 'assistant.name': 'Fern', 'privacy.businessName': 'Fernhill Ltd', 'privacy.noticeUrl': 'https://fernhill.example/privacy' },
};

describe('instance', () => {
  it('carries the look, the languages, changed wording, edited system emails and allow-listed settings', () => {
    expect(issues(dashboard({ instance: INSTANCE }))).toBe('');
  });

  it('is a self-made app\'s only', () => {
    expect(issues(dashboard({ publisher: { id: 'adminium', name: 'Adminium' }, instance: INSTANCE }))).toContain('"instance" is carried only by a self-made app');
  });

  it('never carries a secret setting, nor one off the allow-list', () => {
    expect(issues(dashboard({ instance: { settings: { 'email.smtp': { host: 'mail.example' } } } }))).toContain('Unrecognized key');
    expect(issues(dashboard({ instance: { settings: { 'llm.apiKey': 'not-a-real-key' } } }))).toContain('Unrecognized key');
    expect(issues(dashboard({ instance: { settings: { 'auth.allowSignup': true } } }))).toContain('Unrecognized key');
    expect(issues(dashboard({ instance: { settings: { 'privacy.noticeUrl': 'http://fernhill.example/privacy' } } }))).toContain('instance.settings.privacy.noticeUrl');
  });

  it('names a package file by path and sha256, and a system email Adminium sends', () => {
    expect(issues(dashboard({ instance: { branding: { logo: { file: '../etc/passwd', sha256: 'a'.repeat(64) } } } }))).toContain('a file of the package');
    expect(issues(dashboard({ instance: { branding: { logo: { file: 'logo.svg' } } } }))).toContain('instance.branding.logo.sha256');
    expect(issues(dashboard({ instance: { branding: { logoFileId: 'file_1' } } }))).toContain('Unrecognized key');
    expect(issues(dashboard({ instance: { systemEmails: [{ ...INSTANCE.systemEmails[0], key: 'shop-desk-welcome' }] } }))).toContain('instance.systemEmails.0.key');
  });

  it('keeps each language, word and email once, and the default among the languages on', () => {
    expect(issues(dashboard({ instance: { languages: { enabled: ['en_US'], default: 'de_DE' } } }))).toContain('"de_DE" is not one of the languages switched on');
    expect(issues(dashboard({ instance: { languages: { enabled: ['en_US', 'en_US'] } } }))).toContain('a language is named once');
    expect(issues(dashboard({ instance: { wording: [INSTANCE.wording[0], INSTANCE.wording[0]] } }))).toContain('is changed twice');
    expect(issues(dashboard({ instance: { systemEmails: [INSTANCE.systemEmails[0], INSTANCE.systemEmails[0]] } }))).toContain('is edited twice');
    expect(issues(dashboard({ instance: {} }))).toContain('an instance part carries something');
  });
});

describe('the words and their floors', () => {
  it('are listed with the release that reads them, and found where the file writes them', () => {
    for (const word of ['apps.requires', 'instance'] as const) {
      expect(INSTALL_FLOOR_WORD_NAMES).toContain(word);
      expect(WORD_FLOORS[word]).toBe('0.3.49');
    }
    expect(installFloorWords(dashboard({ apps: { requires: [POS] }, instance: INSTANCE })).filter((word) => word.word === 'apps.requires' || word.word === 'instance')).toEqual([
      { word: 'apps.requires', path: 'apps.requires' },
      { word: 'instance', path: 'instance' },
    ]);
  });

  it('refuse a file that declares an older floor', () => {
    const old = { minAdminiumVersion: '0.3.45' };
    expect(issues(dashboard({ compatibility: old, apps: { requires: [POS] } }))).toContain('0.3.49');
    expect(issues(dashboard({ compatibility: old, instance: INSTANCE }))).toContain('0.3.49');
  });
});
