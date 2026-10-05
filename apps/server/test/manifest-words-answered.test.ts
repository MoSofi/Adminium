// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every newer word a manifest can use has one answer on this server: it is
 * run, or a manifest that uses it is refused with the release that runs it.
 * A word with neither would install and do nothing — the silent kind of
 * wrong — so the two lists together are the manifest package's own list,
 * with no word in both.
 */
import { INSTALL_FLOOR_WORD_NAMES, RULE_EMAIL_VARS as MANIFEST_EMAIL_VARS, templatePlaceholdersOf } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { RULE_EMAIL_VARS, templatePlaceholders } from '../src/automations/actions/email.js';
import { MANIFEST_WORDS_RUN, UNBUILT_MANIFEST_WORDS } from '../src/crud/unbuilt-rules.js';

describe('the newer words of a manifest', () => {
  const refused = Object.keys(UNBUILT_MANIFEST_WORDS).sort();
  const run = [...MANIFEST_WORDS_RUN].sort();

  it('each is run or refused, and none is both', () => {
    expect([...refused, ...run].sort()).toEqual([...INSTALL_FLOOR_WORD_NAMES].sort());
    expect(refused.filter((word) => run.includes(word as never))).toEqual([]);
    expect(new Set(INSTALL_FLOOR_WORD_NAMES).size).toBe(INSTALL_FLOOR_WORD_NAMES.length);
  });

  it('a refused word names a release', () => {
    for (const [word, release] of Object.entries(UNBUILT_MANIFEST_WORDS)) expect(release, word).toMatch(/^0\.3\.(18|19|20)$/);
  });
});

describe('what an email of a shipped rule may read', () => {
  it('the manifest\'s check and the server\'s send read a template\'s placeholders the same way', () => {
    const content = {
      subject: 'Order {{ record.id }} for {{recordLabel}}',
      preheader: '{{appName}} — {{ now }}',
      blocks: [
        { type: 'text', data: { text: 'Hello {{record.buyer_name}}, {{record.id}} again and {{ record.total }}.' } },
        { type: 'rows', data: { columns: [{ value: '{{row.name}}' }, { value: '{{ row.qty }}' }], title: '{{ruleName}}' } },
        { type: 'button', data: { label: 'Open', href: 'https://example.test/o/{{record.code}}' } },
      ],
      footer: 'Sent by {{appName}}',
    };
    const fromManifest = templatePlaceholdersOf(content);
    const fromServer = templatePlaceholders(content as never);
    expect(fromManifest).toEqual(fromServer);
    expect(fromManifest).toEqual(['record.id', 'recordLabel', 'appName', 'now', 'record.buyer_name', 'record.total', 'ruleName', 'record.code']);
    // With no preheader and no footer, too.
    const bare = { subject: '{{record.id}}', blocks: [{ type: 'text', data: { text: '{{now}} {{row.x}}' } }] };
    expect(templatePlaceholdersOf(bare)).toEqual(templatePlaceholders(bare as never));
    expect(templatePlaceholdersOf(bare)).toEqual(['record.id', 'now']);
  });

  it('and agree on what every rule\'s email can read', () => {
    expect([...MANIFEST_EMAIL_VARS]).toEqual([...RULE_EMAIL_VARS]);
  });
});
