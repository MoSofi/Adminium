/**
 * The bundle's README. Its whole job is to answer, before anyone opens
 * `config/`, the question this export is most likely to be misread as: "is this
 * my admin panel's source code?" It is not, it never will be, and the first
 * heading says so (BRIEF §3 / 16-milestones M10-T03).
 *
 * Not user-facing dashboard copy — this is a file written into a downloadable
 * artifact, so it is deliberately plain English and not routed through i18n
 * (t('key') has no meaning in a zip read outside the app).
 */

import type { BundleManifest } from './bundle.js';

function secretsSection(manifest: BundleManifest): string {
  if (manifest.secrets.policy === 'omitted') {
    const dropped =
      manifest.secrets.omitted.length === 0
        ? 'This instance had no secrets configured.'
        : `Dropped: ${manifest.secrets.omitted.join(', ')}.`;
    return [
      '## Secrets',
      '',
      'This bundle contains **no credentials**. Database connection strings and',
      'LLM provider keys were left out entirely, so the file is safe to store and',
      `hand around like any other config. ${dropped}`,
      '',
      'After importing, re-enter each connection\'s credentials in Studio (or with',
      '`adminium init`) before the connection will work.',
    ].join('\n');
  }

  return [
    '## Secrets — this bundle is sensitive',
    '',
    'This bundle was exported with `--include-secrets`. It carries the following',
    'still **AES-256-GCM encrypted** values:',
    '',
    ...manifest.secrets.encrypted.map((name) => `- \`${name}\``),
    '',
    'They are ciphertext, not plaintext — but they are only ciphertext. **The same',
    '`ADMINIUM_SECRET` that the exporting instance used is required to re-open',
    'them.** Import into an instance with a different `ADMINIUM_SECRET` and these',
    'values will not decrypt; you will need to re-enter them.',
    '',
    'Treat this file as you would the secret itself: anyone who obtains both it',
    'and `ADMINIUM_SECRET` has your database credentials.',
  ].join('\n');
}

/** Render the bundle README for `manifest`. */
export function renderReadme(manifest: BundleManifest): string {
  const scope =
    manifest.connectionId === null
      ? 'the whole instance'
      : `connection \`${manifest.connectionId}\``;

  return [
    '# Adminium configuration bundle',
    '',
    '## This is configuration, not source code',
    '',
    'There is no application source in this archive, and there is no generated',
    'app to compile or deploy. Adminium does not emit code: it reads',
    'configuration at runtime and renders your admin panel from it. What you have',
    'here is that configuration — pages, navigation, settings, roles and',
    'permissions, connection definitions, schema snapshots and overrides — as',
    'portable JSON, plus the manifest that says which Adminium version it came',
    'from.',
    '',
    'To run it you need the Adminium server, which is one npm package. The',
    '`package.json` beside this file pins the exact version that produced the',
    `bundle (\`adminium@${manifest.appVersion}\`). That package is the complete`,
    'install — it contains the server, the dashboard build, and the meta-store',
    'migrations.',
    '',
    '## What is in here',
    '',
    '```',
    'manifest.json      versions + counts + the secrets policy for this bundle',
    'package.json       pins the adminium version that wrote it',
    'config/            the instance configuration, one JSON file per resource',
    '  settings.json        global settings (secret keys handled per policy below)',
    '  roles.json           roles',
    '  rolePermissions.json the permission matrix',
    '  connections.json     connection definitions (credentials per policy below)',
    '  snapshots.json       the active schema snapshot per connection',
    '  overrides.json       schema overrides (remaps, LLM-applied corrections)',
    '  pages.json           pages and dashboards, nav placement included',
    '  views.json           shared saved views',
    '```',
    '',
    `Scope: ${scope}.`,
    '',
    '## Restoring it',
    '',
    '```sh',
    'npm install                    # installs the pinned adminium version',
    'export ADMINIUM_SECRET=…       # 32+ chars; the target instance\'s secret',
    'npx adminium import-zip --in <this-archive>.zip',
    'npx adminium start',
    '```',
    '',
    '`import-zip` runs the meta-store migrations first, then replays every config',
    'document forward to the version the running build understands. Add',
    '`--dry-run` to validate the bundle and print what would change without',
    'writing anything.',
    '',
    '## Version replay',
    '',
    `This bundle was written by Adminium \`${manifest.appVersion}\` at config`,
    `version \`${String(manifest.configVersion)}\`, meta schema \`${manifest.metaVersion}\`.`,
    '',
    'It imports into that version or any later one: config documents are migrated',
    'forward on the way in. It will **not** import into an older Adminium — that',
    'build would not understand documents newer than itself, and importing them',
    'would silently drop the parts it cannot read. Upgrade the target instead.',
    '',
    secretsSection(manifest),
    '',
    '## Not included',
    '',
    'Deliberately absent, because these are instance data rather than',
    'configuration — an export is meant to be a portable configuration, not a',
    'clone of your install:',
    '',
    '- users, sessions, and API keys (the target creates its own first super admin)',
    '- the audit log, jobs, and notifications',
    '- LLM run history',
    '- uploaded files',
    '- per-user preferences and per-user saved views (shared views are included)',
    '- **your database contents** — Adminium never copies the data in your source',
    '  database; it only records how to connect to it and how to display it.',
    '',
    '---',
    '',
    'Docs: https://docs.adminium.dev',
    '',
  ].join('\n');
}

/**
 * The bundle's `package.json`. Pins `adminium` exactly: a bundle that replayed
 * into a *different* build than the one it names would defeat the point of the
 * manifest carrying versions at all.
 */
export function renderPackageJson(manifest: BundleManifest): string {
  return (
    JSON.stringify(
      {
        name: 'adminium-instance',
        private: true,
        description:
          'Adminium configuration bundle — run `npx adminium import-zip --in <archive>.zip` then `npx adminium start`. Configuration only; contains no application source.',
        dependencies: { adminium: manifest.appVersion },
      },
      null,
      2,
    ) + '\n'
  );
}
