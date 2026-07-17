/**
 * Step 2 — "Your first database" (11-electron.md §6): the four source cards.
 *
 * NOTHING HERE CALLS AN ENDPOINT, and that is not an oversight — see
 * `desktopSetupState.ts`'s header. Every create/test route is behind
 * `system:connections:manage` and no user exists until step 3, so this step
 * collects a choice and the generate step performs it. The two native dialogs
 * (`openFile` for card 2) are the exception, because the preload bridge is not
 * the server and has no session to lack.
 *
 * Visual language: the source cards from `designs/Connect Database.dc.html`
 * (its three input modes become our four sources) and the option cards from
 * `designs/Onboarding.dc.html`. The comp's "Auto-generate placeholder entries"
 * toggle and its copy are kept verbatim in intent — it is the one control in
 * that comp that writes rows, and the wizard is where it belongs.
 */
import { Database, FileUp, FolderSearch, Server, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Alert,
  FormField,
  Input,
  Label,
  MonoText,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  Switch,
} from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { engineLabel, dsnPlaceholder } from '../../../studio/connect/wizardState.js';
import type { ConnectionEngine } from '../../../studio/api.js';
import {
  REMOTE_ENGINES,
  isNetworkSharePath,
  slugPreview,
  type DesktopSetupState,
  type SourceCardId,
} from '../desktopSetupState.js';

export interface SourceStepProps {
  state: DesktopSetupState;
  onPatch: (patch: Partial<DesktopSetupState>) => void;
  /** Native `.sqlite`/`.db`/`.sqlite3` picker (card 2). */
  onPickSqliteFile: () => void;
  /** The schema file for card 1's "From a schema file" sub-choice. */
  schemaFileName: string | null;
  onPickSchemaFile: (file: File) => void;
  /** Card 4 is dead without the seed script — see {@link SourceStepProps.demoAvailable}. */
  demoAvailable: boolean;
  busy: boolean;
}

function cardTitle(id: SourceCardId): string {
  switch (id) {
    case 'local':
      return t('desktop.setup.source.local.title', 'Create a new local database');
    case 'open-sqlite':
      return t('desktop.setup.source.openSqlite.title', 'Open an existing SQLite file');
    case 'remote':
      return t('desktop.setup.source.remote.title', 'Connect to a server database');
    case 'demo':
      return t('desktop.setup.source.demo.title', 'Explore the demo database');
  }
}

function cardDescription(id: SourceCardId): string {
  switch (id) {
    case 'local':
      return t(
        'desktop.setup.source.local.description',
        'Start from nothing, or from a schema file you already have. The database is created inside your data folder.',
      );
    case 'open-sqlite':
      return t(
        'desktop.setup.source.openSqlite.description',
        'Point Adminium at a .sqlite file on this computer. It is opened where it is — nothing is copied or moved.',
      );
    case 'remote':
      return t(
        'desktop.setup.source.remote.description',
        'PostgreSQL or MySQL. Requires a reachable network database; Adminium’s own tables still stay on this computer.',
      );
    case 'demo':
      return t(
        'desktop.setup.source.demo.description',
        'A ready-made team-operations database, so you can see what Adminium builds before pointing it at your own data. Delete it whenever you like.',
      );
  }
}

function cardIcon(id: SourceCardId): ReactNode {
  switch (id) {
    case 'local':
      return <Database aria-hidden />;
    case 'open-sqlite':
      return <FolderSearch aria-hidden />;
    case 'remote':
      return <Server aria-hidden />;
    case 'demo':
      return <Sparkles aria-hidden />;
  }
}

export function SourceStep({
  state,
  onPatch,
  onPickSqliteFile,
  schemaFileName,
  onPickSchemaFile,
  demoAvailable,
  busy,
}: SourceStepProps): ReactNode {
  const slug = slugPreview(state.localName);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-section text-fg">
          {t('desktop.setup.source.heading', 'What should Adminium build from?')}
        </h2>
        <p className="text-body-sm text-fg-muted">
          {t(
            'desktop.setup.source.description',
            'Adminium reads a database’s schema and generates an admin app from it. You can add more databases later.',
          )}
        </p>
      </div>

      <RadioGroup
        className="flex flex-col gap-3"
        value={state.source ?? ''}
        onValueChange={(value) => onPatch({ source: value as SourceCardId })}
        aria-label={t('desktop.setup.source.groupLabel', 'Database source')}
      >
        <RadioCard
          value="local"
          disabled={busy}
          icon={cardIcon('local')}
          title={cardTitle('local')}
          description={cardDescription('local')}
        />
        {state.source === 'local' ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4">
            <FormField
              label={t('desktop.setup.source.local.name', 'Database name')}
              required
              {...(state.localName.length > 0 && slug.length === 0
                ? {
                    error: t(
                      'desktop.setup.source.local.nameUnusable',
                      'Use at least one letter or number — the file name is built from this.',
                    ),
                  }
                : slug.length > 0
                  ? { helper: t('desktop.setup.source.local.fileHelper', 'Creates {file}', { file: `${slug}.sqlite` }) }
                  : {})}
            >
              <Input
                value={state.localName}
                disabled={busy}
                onChange={(event) => onPatch({ localName: event.target.value })}
                placeholder={t('desktop.setup.source.local.namePlaceholder', 'Operations')}
              />
            </FormField>

            <div className="flex flex-col gap-2">
              <Label>{t('desktop.setup.source.local.schemaLabel', 'Start from')}</Label>
              <SegmentedControl
                value={state.localSchema}
                onValueChange={(value) => onPatch({ localSchema: value === 'file' ? 'file' : 'blank' })}
                options={[
                  { value: 'blank', label: t('desktop.setup.source.local.blank', 'Blank') },
                  { value: 'file', label: t('desktop.setup.source.local.fromFile', 'A schema file') },
                ]}
                aria-label={t('desktop.setup.source.local.schemaLabel', 'Start from')}
              />
            </div>

            {state.localSchema === 'file' ? (
              <div className="flex flex-col gap-3">
                <FormField
                  label={t('desktop.setup.source.local.schemaFile', 'Schema file')}
                  helper={t(
                    'desktop.setup.source.local.schemaFileHelper',
                    '.sql, pg_dump, Prisma, Drizzle, TypeORM, Sequelize, schema.rb, Django or Adminium JSON. Adminium translates it to SQLite.',
                  )}
                >
                  <Input
                    type="file"
                    accept=".sql,.prisma,.ts,.js,.rb,.py,.json"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file !== undefined) onPickSchemaFile(file);
                    }}
                  />
                </FormField>
                {schemaFileName === null ? null : (
                  <MonoText className="text-body-sm text-fg-muted">{schemaFileName}</MonoText>
                )}

                {/* `designs/Connect Database.dc.html`, verbatim in intent. It is
                    offered ONLY on this sub-path because it is the only one where
                    the comp's premise holds: you imported a schema, so there are
                    tables and no rows. A blank database has nothing to seed, and
                    an existing file has its own data. */}
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Label htmlFor="desktop-setup-placeholder-rows" className="text-body font-semibold text-fg">
                      {t('desktop.setup.source.local.placeholder', 'Auto-generate placeholder entries')}
                    </Label>
                    <p id="desktop-setup-placeholder-rows-description" className="text-body-sm text-fg-muted">
                      {t(
                        'desktop.setup.source.local.placeholderHelper',
                        'You imported a schema with no rows. Seed each table with realistic sample data so your dashboards and charts render immediately.',
                      )}
                    </p>
                  </div>
                  <Switch
                    id="desktop-setup-placeholder-rows"
                    checked={state.placeholderRows}
                    disabled={busy}
                    aria-describedby="desktop-setup-placeholder-rows-description"
                    onCheckedChange={(next) => onPatch({ placeholderRows: next })}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <RadioCard
          value="open-sqlite"
          disabled={busy}
          icon={cardIcon('open-sqlite')}
          title={cardTitle('open-sqlite')}
          description={cardDescription('open-sqlite')}
        />
        {state.source === 'open-sqlite' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
            <button
              type="button"
              disabled={busy}
              onClick={onPickSqliteFile}
              className={
                'flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong ' +
                'bg-surface px-6 py-8 text-body-sm font-semibold text-fg transition-colors duration-150 ' +
                'hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
                'disabled:pointer-events-none disabled:opacity-40'
              }
            >
              <FileUp aria-hidden className="size-4" />
              {state.sqliteFile === null
                ? t('desktop.setup.source.openSqlite.browse', 'Choose a .sqlite file…')
                : t('desktop.setup.source.openSqlite.change', 'Choose a different file…')}
            </button>
            {state.sqliteFile === null ? null : (
              <MonoText className="break-all text-body-sm text-fg-muted">{state.sqliteFile}</MonoText>
            )}
            {state.sqliteFile !== null && isNetworkSharePath(state.sqliteFile) ? (
              // A WARNING, not a block — see `isNetworkSharePath`'s comment on why
              // this is the one file risk the user gets to overrule.
              <Alert
                tone="warn"
                title={t('desktop.setup.source.openSqlite.networkTitle', 'That file is on a network share')}
                body={t(
                  'desktop.setup.source.openSqlite.networkBody',
                  'SQLite locking is unreliable over network file shares, and a dropped connection mid-write can corrupt the database. A copy on this computer’s own disk is safer.',
                )}
              />
            ) : null}
          </div>
        ) : null}

        <RadioCard
          value="remote"
          disabled={busy}
          icon={cardIcon('remote')}
          title={cardTitle('remote')}
          description={cardDescription('remote')}
        />
        {state.source === 'remote' ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4">
            <Alert
              tone="info"
              title={t('desktop.setup.source.remote.networkNote', 'Requires a reachable network database')}
              body={t(
                'desktop.setup.source.remote.metaNote',
                'Adminium’s own tables — your pages, settings and sign-in — stay in the data folder on this computer either way.',
              )}
            />
            <div className="flex flex-col gap-2">
              <Label>{t('desktop.setup.source.remote.engine', 'Engine')}</Label>
              <SegmentedControl
                value={state.remoteEngine}
                onValueChange={(value) => onPatch({ remoteEngine: value as ConnectionEngine })}
                options={REMOTE_ENGINES.map((engine) => ({ value: engine, label: engineLabel(engine) }))}
                aria-label={t('desktop.setup.source.remote.engine', 'Engine')}
              />
            </div>
            <FormField label={t('desktop.setup.source.remote.name', 'Connection name')} required>
              <Input
                value={state.remoteName}
                disabled={busy}
                onChange={(event) => onPatch({ remoteName: event.target.value })}
                placeholder={t('desktop.setup.source.remote.namePlaceholder', 'Production')}
              />
            </FormField>
            <FormField
              label={t('desktop.setup.source.remote.dsn', 'Connection string')}
              required
              helper={t(
                'desktop.setup.source.remote.dsnHelper',
                'Adminium tests this when it connects. Use a read-only role if you only want dashboards.',
              )}
            >
              <Input
                value={state.remoteDsn}
                disabled={busy}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => onPatch({ remoteDsn: event.target.value })}
                placeholder={dsnPlaceholder(state.remoteEngine)}
              />
            </FormField>
          </div>
        ) : null}

        {/* §8.2's rule — never hide, always explain. A build with no seed script
            (a dev boot without `ADMINIUM_DEMO_SEED_SCRIPT`) has no demo route to
            call, and a card that 404s is worse than a card that says so. */}
        <RadioCard
          value="demo"
          disabled={busy || !demoAvailable}
          icon={cardIcon('demo')}
          title={cardTitle('demo')}
          description={
            demoAvailable
              ? cardDescription('demo')
              : t(
                  'desktop.setup.source.demo.unavailable',
                  'This build does not include the demo data, so there is nothing to load. Pick one of the options above.',
                )
          }
        />
      </RadioGroup>
    </div>
  );
}
