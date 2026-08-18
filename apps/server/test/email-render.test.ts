// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email renderer + built-in template seed (10-T18).
 *
 * WHY THE SNAPSHOTS RUN THROUGH A STUB TRANSLATOR. 10-T18 asks for
 * `password-reset` snapshotted in `en_US`, `de_DE` and `ar_EG`, and what those
 * three pin is LAYOUT: the `lang`/`dir` attributes, the alignment flip, and
 * the block structure the built-in actually declares. Feeding them the live
 * translator would make every future translation commit rewrite three
 * snapshots for reasons that have nothing to do with rendering, so the
 * snapshots use a deterministic ICU-lite stub over the built-ins' OWN
 * `defaultValue` copy — the real block structure, pinned text. The live
 * `createServerI18n` path is asserted separately, and behaviourally, by the
 * override test below.
 */
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  emailTemplatesRepo,
  firstRun,
  initMetaDb,
  translationsRepo,
  type MetaDb,
} from '@adminium/meta';
import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';

import {
  BUILTIN_EMAIL_TEMPLATE_KEYS,
  BUILTIN_EMAIL_TEMPLATE_VARS,
  builtinEmailTemplates,
  resolveEmailTemplate,
  seedBuiltinEmailTemplates,
  type BuiltinEmailTemplate,
} from '../src/email/builtins.js';
import { renderEmail } from '../src/email/render.js';
import {
  NOTIFICATION_EMAIL_TEMPLATE_KEY,
  PASSWORD_RESET_TEMPLATE_KEY,
  USER_INVITE_TEMPLATE_KEY,
} from '../src/email/send.js';

const RESET_URL = 'https://admin.example.com/reset?token=abc123&x=1';

/**
 * ICU-lite: return the call's `defaultValue` with `{arg}` filled from the same
 * options bag, which is exactly what intl-messageformat does for the
 * plain-argument messages the built-ins use. Anything richer (plural/select)
 * would be a second parser, and the built-ins deliberately contain none.
 */
function stubT(key: string, opts?: Record<string, unknown>): string {
  const source = typeof opts?.['defaultValue'] === 'string' ? (opts['defaultValue'] as string) : key;
  return source.replaceAll(/\{(\w+)\}/g, (whole, name: string) => {
    const value = opts?.[name];
    return typeof value === 'string' ? value : whole;
  });
}

function builtins(): BuiltinEmailTemplate[] {
  return builtinEmailTemplates(stubT as never);
}

function builtin(key: string): BuiltinEmailTemplate {
  const found = builtins().find((tpl) => tpl.key === key);
  if (found === undefined) throw new Error(`no built-in template ${key}`);
  return found;
}

const RESET_VARS = {
  appName: 'Adminium',
  name: 'Ava Reyes',
  email: 'ava@example.com',
  resetUrl: RESET_URL,
  expiresInMinutes: '30',
};

async function makeMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);
  return meta;
}

describe('renderEmail — password-reset snapshots (10-T18)', () => {
  it.each([
    ['en_US', 'ltr'],
    ['de_DE', 'ltr'],
    ['ar_EG', 'rtl'],
  ] as const)('renders password-reset for %s', (locale, dir) => {
    const rendered = renderEmail({
      template: builtin('password-reset'),
      locale,
      vars: RESET_VARS,
      dir,
    });
    expect(rendered).toMatchSnapshot();
  });
});

describe('renderEmail — direction', () => {
  it('flips the wrapper and every block for RTL', () => {
    const rtl = renderEmail({
      template: builtin('password-reset'),
      locale: 'ar_EG',
      vars: RESET_VARS,
      dir: 'rtl',
    });
    expect(rtl.html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(rtl.html).toContain('text-align:right;');
    expect(rtl.html).not.toContain('text-align:left;');

    const ltr = renderEmail({
      template: builtin('password-reset'),
      locale: 'en_US',
      vars: RESET_VARS,
      dir: 'ltr',
    });
    expect(ltr.html).toContain('<html lang="en-US" dir="ltr">');
    expect(ltr.html).toContain('text-align:left;');
    expect(ltr.html).not.toContain('text-align:right;');
  });
});

describe('renderEmail — interpolation', () => {
  it('HTML-escapes interpolated values and leaves the text part raw', () => {
    const rendered = renderEmail({
      template: {
        subject: 'Hello {{name}}',
        blocks: [{ block: 'email.text', data: { text: 'Signed, {{name}}' } }],
      },
      locale: 'en_US',
      vars: { name: '<img src=x onerror="alert(1)">' },
      dir: 'ltr',
    });
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(rendered.text).toContain('Signed, <img src=x onerror="alert(1)">');
  });

  it('escapes literal template text too, without double-escaping the entities', () => {
    const rendered = renderEmail({
      template: { subject: 's', blocks: [{ block: 'email.text', data: { text: 'a < b & {{v}}' } }] },
      locale: 'en_US',
      vars: { v: 'c > d' },
      dir: 'ltr',
    });
    expect(rendered.html).toContain('a &lt; b &amp; c &gt; d');
    expect(rendered.html).not.toContain('&amp;lt;');
  });

  it('re-emits an unresolved placeholder verbatim rather than blanking it', () => {
    const rendered = renderEmail({
      template: { subject: 's', blocks: [{ block: 'email.text', data: { text: 'go: {{missing}}' } }] },
      locale: 'en_US',
      vars: {},
      dir: 'ltr',
    });
    expect(rendered.html).toContain('go: {{missing}}');
    expect(rendered.text).toContain('go: {{missing}}');
  });

  it('strips CR/LF from the subject (header injection)', () => {
    const rendered = renderEmail({
      template: { subject: 'Reset {{name}}', blocks: [] },
      locale: 'en_US',
      vars: { name: 'Ava\r\nBcc: attacker@example.com' },
      dir: 'ltr',
    });
    expect(rendered.subject).toBe('Reset Ava Bcc: attacker@example.com');
    expect(rendered.subject).not.toContain('\n');
  });
});

describe('renderEmail — unknown blocks', () => {
  it('skips unrecognised block kinds instead of throwing', () => {
    const render = (): ReturnType<typeof renderEmail> =>
      renderEmail({
        template: {
          subject: 's',
          blocks: [
            { block: 'block-line-items', data: { rows: [] } },
            { block: 'email.future-kind', data: { text: 'from a newer build' } },
            'not even an object',
            null,
            { noBlockField: true },
            { block: 'email.text', data: { text: 'survivor' } },
          ],
        },
        locale: 'en_US',
        vars: {},
        dir: 'ltr',
      });
    expect(render).not.toThrow();
    const rendered = render();
    expect(rendered.text.trim()).toBe('survivor');
    expect(rendered.html).not.toContain('from a newer build');
  });

  it('skips a block whose required data is missing', () => {
    const rendered = renderEmail({
      template: {
        subject: 's',
        blocks: [
          { block: 'email.button', data: { label: 'No url here' } },
          { block: 'email.heading', data: {} },
        ],
      },
      locale: 'en_US',
      vars: {},
      dir: 'ltr',
    });
    expect(rendered.text).toBe('');
    expect(rendered.html).not.toContain('No url here');
  });
});

describe('renderEmail — links', () => {
  it('puts the URL in the text part, not only inside an href', () => {
    const rendered = renderEmail({
      template: builtin('password-reset'),
      locale: 'en_US',
      vars: RESET_VARS,
      dir: 'ltr',
    });
    expect(rendered.text).toContain(`Choose a new password: ${RESET_URL}`);
    // The footer repeats it for clients that render HTML but strip buttons.
    expect(rendered.text.match(/https:\/\/admin\.example\.com/g)?.length).toBe(2);
    expect(rendered.html).toContain(`href="${RESET_URL.replaceAll('&', '&amp;')}"`);
  });

  it('neutralises a non-http scheme in the href but keeps it in the text', () => {
    const rendered = renderEmail({
      template: {
        subject: 's',
        blocks: [{ block: 'email.button', data: { label: 'Go', url: '{{url}}' } }],
      },
      locale: 'en_US',
      vars: { url: 'javascript:alert(1)' },
      dir: 'ltr',
    });
    expect(rendered.html).toContain('href="#"');
    expect(rendered.html).not.toContain('javascript:');
    expect(rendered.text).toContain('Go: javascript:alert(1)');
  });
});

describe('seedBuiltinEmailTemplates', () => {
  it('seeds every built-in for every compiled locale, marked as a built-in copy', async () => {
    const meta = await makeMeta();
    try {
      expect(await emailTemplatesRepo(meta).list()).toHaveLength(0);
      await seedBuiltinEmailTemplates(meta, 1_000);
      const rows = await emailTemplatesRepo(meta).list();
      expect(rows).toHaveLength(BUILTIN_EMAIL_TEMPLATE_KEYS.length * BUILTIN_LOCALE_IDS.length);
      expect(rows.every((row) => row.isBuiltinCopy)).toBe(true);
      expect(rows.every((row) => row.enabled)).toBe(true);
      expect(rows.every((row) => row.updatedBy === null)).toBe(true);

      // The stored row keeps the render-time placeholders, not a baked value.
      const reset = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US');
      expect(JSON.stringify(reset?.blocks)).toContain('{{resetUrl}}');
      expect(JSON.stringify(reset?.blocks)).toContain('{{expiresInMinutes}}');
      expect(reset?.subject).toBe('Reset your {{appName}} password');
    } finally {
      await meta.db.destroy();
    }
  });

  it('is idempotent — a second boot rewrites nothing', async () => {
    const meta = await makeMeta();
    try {
      await seedBuiltinEmailTemplates(meta, 1_000);
      await seedBuiltinEmailTemplates(meta, 2_000);
      const rows = await emailTemplatesRepo(meta).list();
      expect(rows).toHaveLength(BUILTIN_EMAIL_TEMPLATE_KEYS.length * BUILTIN_LOCALE_IDS.length);
      expect(rows.every((row) => row.updatedAt === 1_000)).toBe(true);
    } finally {
      await meta.db.destroy();
    }
  });

  it('never overwrites a row an admin has edited', async () => {
    const meta = await makeMeta();
    try {
      await emailTemplatesRepo(meta).upsert(
        'password-reset',
        'en_US',
        {
          name: 'Our reset mail',
          subject: 'Hand-written subject',
          blocks: [{ block: 'email.text', data: { text: 'ours' } }],
          enabled: false,
          isBuiltinCopy: false,
          updatedBy: null, // FK to adminium_users; `isBuiltinCopy: false` is the human marker
        },
        500,
      );
      await seedBuiltinEmailTemplates(meta, 1_000);
      const row = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US');
      expect(row?.subject).toBe('Hand-written subject');
      expect(row?.enabled).toBe(false);
      expect(row?.isBuiltinCopy).toBe(false);
      expect(row?.updatedAt).toBe(500);
    } finally {
      await meta.db.destroy();
    }
  });

  it('refreshes a stale built-in copy so re-translations reach existing installs', async () => {
    const meta = await makeMeta();
    try {
      await emailTemplatesRepo(meta).upsert(
        'password-reset',
        'en_US',
        {
          name: 'Password reset',
          subject: 'Stale wording from an older build',
          blocks: [],
          enabled: true,
          isBuiltinCopy: true,
          updatedBy: null,
        },
        500,
      );
      await seedBuiltinEmailTemplates(meta, 1_000);
      const row = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US');
      expect(row?.subject).toBe('Reset your {{appName}} password');
      expect(row?.updatedAt).toBe(1_000);
    } finally {
      await meta.db.destroy();
    }
  });

  it('resolves copy through the recipient locale, runtime overrides included', async () => {
    const meta = await makeMeta();
    try {
      await translationsRepo(meta).upsert({
        locale: 'de_DE',
        namespace: 'common',
        key: 'email.passwordReset.subject',
        value: 'Passwort zurücksetzen',
      });
      await seedBuiltinEmailTemplates(meta, 1_000);

      const de = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'de_DE');
      expect(de?.subject).toBe('Passwort zurücksetzen');
      // Untouched locales keep the built-in wording.
      const en = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US');
      expect(en?.subject).toBe('Reset your {{appName}} password');
    } finally {
      await meta.db.destroy();
    }
  });
});

describe('resolveEmailTemplate', () => {
  it('falls back to en_US for a locale with no row', async () => {
    const meta = await makeMeta();
    try {
      await seedBuiltinEmailTemplates(meta, 1_000);
      const row = await resolveEmailTemplate(meta, 'password-reset', 'pt_BR');
      expect(row?.locale).toBe('en_US');
    } finally {
      await meta.db.destroy();
    }
  });

  it('returns null for a disabled row rather than falling back past the opt-out', async () => {
    const meta = await makeMeta();
    try {
      await seedBuiltinEmailTemplates(meta, 1_000);
      const current = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'de_DE');
      await emailTemplatesRepo(meta).upsert('password-reset', 'de_DE', {
        name: current?.name ?? 'x',
        subject: current?.subject ?? 'x',
        blocks: current?.blocks ?? [],
        enabled: false,
        isBuiltinCopy: false,
        updatedBy: null, // FK to adminium_users; `isBuiltinCopy: false` is the human marker
      });
      expect(await resolveEmailTemplate(meta, 'password-reset', 'de_DE')).toBeNull();
    } finally {
      await meta.db.destroy();
    }
  });

  it('renders a seeded row end to end', async () => {
    const meta = await makeMeta();
    try {
      await seedBuiltinEmailTemplates(meta, 1_000);
      const row = await resolveEmailTemplate(meta, 'user-invite', 'en_US');
      expect(row).not.toBeNull();
      const rendered = renderEmail({
        template: { subject: row?.subject ?? '', blocks: row?.blocks ?? [] },
        locale: 'en_US',
        vars: {
          appName: 'Northline',
          name: 'Ava Reyes',
          email: 'ava@example.com',
          inviterName: 'Dana Whitfield',
          activationUrl: RESET_URL,
          expiresInDays: '7',
        },
        dir: 'ltr',
      });
      expect(rendered.subject).toBe('You have been invited to Northline');
      expect(rendered.text).toContain(RESET_URL);
      // The invitation names its sender: an invite from nobody reads as spam,
      // which is the one thing a stranger's first email from us must not do.
      expect(rendered.text).toContain('Dana Whitfield');
      expect(rendered.text).not.toContain('{{');
    } finally {
      await meta.db.destroy();
    }
  });
});

describe('built-in coverage', () => {
  /**
   * The enqueue sites name their template by constant; this module seeds by
   * key. A key on one side and not the other is invisible at compile time and
   * shows up in production as `enqueueEmail` returning null and logging
   * "email template not found" — i.e. a dead flow, which is the exact class of
   * bug this whole track exists to remove.
   */
  it('seeds a template for every key the send layer can name', () => {
    expect([...BUILTIN_EMAIL_TEMPLATE_KEYS].sort()).toEqual(
      [PASSWORD_RESET_TEMPLATE_KEY, USER_INVITE_TEMPLATE_KEY, NOTIFICATION_EMAIL_TEMPLATE_KEY].sort(),
    );
    expect(builtins().map((tpl) => tpl.key).sort()).toEqual([...BUILTIN_EMAIL_TEMPLATE_KEYS].sort());
  });

  it('declares every var its own copy interpolates', () => {
    for (const tpl of builtins()) {
      const key = tpl.key as keyof typeof BUILTIN_EMAIL_TEMPLATE_VARS;
      const declared = new Set(BUILTIN_EMAIL_TEMPLATE_VARS[key]);
      const used = new Set(
        [...`${tpl.subject}${JSON.stringify(tpl.blocks)}`.matchAll(/\{\{(\w+)\}\}/g)].map(
          (match) => match[1] ?? '',
        ),
      );
      for (const name of used) expect(declared).toContain(name);
    }
  });

  it('drops the optional notification blocks when their vars resolve empty', () => {
    const rendered = renderEmail({
      template: builtin('notification'),
      locale: 'en_US',
      vars: {
        appName: 'Adminium',
        name: 'Ava Reyes',
        title: 'Export ready',
        body: '',
        actionUrl: '',
      },
      dir: 'ltr',
    });
    expect(rendered.subject).toBe('Export ready');
    expect(rendered.html).toContain('Export ready');
    expect(rendered.html).not.toContain('<a href=');
    expect(rendered.text).not.toContain('Open Adminium');
  });
});
