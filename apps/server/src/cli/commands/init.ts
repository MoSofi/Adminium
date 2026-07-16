/**
 * `adminium` (no args) — the interactive setup wizard.
 *
 * Mirrors the Studio connect flow (`apps/dashboard/src/studio/connect/wizardState.ts`
 * `WIZARD_STEP_IDS`: intent → source → test → tables → meta → enrich → generate)
 * and, per the M10 risk mitigation, drives it through the SAME services the
 * Studio routes call — `manager.testDsn`, `manager.connections.create`,
 * `runIntrospection`, `runGeneration`. One code path, two front doors.
 *
 * ── WHERE THIS DEPARTS FROM THE STUDIO'S STEP ORDER, AND WHY ─────────────────
 * The Studio asks about meta-store PLACEMENT at step 5, after tables. It can:
 * the Studio is already running, so a meta store already exists — its meta step
 * is about *where the store should live going forward*. The CLI has no such
 * luxury. Nothing can be persisted (not the connection row, not the snapshot the
 * tables step lists) until a meta store is open, so the wizard resolves meta
 * placement FIRST when nothing is configured. The §3.1 rule the meta step exists
 * to enforce — same-database placement against a read-only or DDL-less role is
 * refused (`META_PLACEMENT_INVALID`) — still runs at exactly the right moment:
 * `manager.enforceMetaPlacement`, right after the data-role probe, which is the
 * first instant both facts are known. The rule is honored; only the question's
 * position moves, because causality requires it.
 *
 * The `enrich` step is deliberately not prompted here: `generate-prompt` /
 * `apply-llm-response` are the CLI's LLM surface (06 §10.4) and the wizard points
 * at them rather than growing a copy-paste loop inside a readline prompt.
 */

import { GENERATE_INTENTS, type GenerateIntent } from '@adminium/engine';
import { firstRun } from '@adminium/meta';

import { readBootstrap, writeBootstrap } from '../../config/bootstrap.js';
import { runIntrospection } from '../../connections/introspect.js';
import { runGeneration } from '../../generate/run.js';
import type { ConnectionTestSummary } from '../../connections/manager.js';
import { MetaPlacementError } from '../../connections/dsn.js';
import { embeddedMetaWarning, metaEngineFromUrl, metaUrlCryptoFromSecret } from '../../meta/store.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import type { CliIo } from '../io.js';
import { createStyle } from '../io.js';
import { loadCliEnv } from '../runtime.js';

/**
 * Engines the connect flow offers — the same three as the Studio picker's
 * `SOURCE_ENGINES` (`wizardState.ts`), and the same three the v1 build ships
 * adapters for (BRIEF §3).
 */
type SourceEngine = 'postgres' | 'mysql' | 'sqlite';

const INTENT_LABELS: Readonly<Record<GenerateIntent, string>> = {
  'full-admin': 'Full admin — CRUD on everything, dashboards included',
  'read-only-analytics': 'Read-only analytics — dashboards and browsing, no writes',
  crud: 'CRUD — data entry screens, minimal dashboards',
  'support-console': 'Support console — lookup-first, focused on finding one record',
};

const DEFAULT_PORTS: Readonly<Record<SourceEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
};

/** Ask until the answer is one of `choices`; returns the chosen index. */
async function choose(
  io: CliIo,
  title: string,
  choices: readonly string[],
  defaultIndex = 0,
): Promise<number> {
  io.out('');
  io.out(title);
  choices.forEach((choice, i) => {
    io.out(`  ${String(i + 1)}) ${choice}`);
  });
  for (;;) {
    const answer = await io.ask('Choose', { default: String(defaultIndex + 1) });
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return index;
    io.err(`Enter a number between 1 and ${String(choices.length)}.`);
  }
}

/** Compose a DSN from host/port/user/password/database — the Studio's `fields` mode. */
export function composeDsn(input: {
  engine: SourceEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const auth =
    input.password === ''
      ? encodeURIComponent(input.user)
      : `${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}`;
  return `${input.engine}://${auth}@${input.host}:${String(input.port)}/${input.database}`;
}

/** Parse the tables step's answer: blank/`all` → everything, else a CSV subset. */
export function parseTableSelection(answer: string, available: readonly string[]): string[] {
  const trimmed = answer.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'all') return [...available];
  const wanted = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const byLocalName = new Map<string, string>();
  for (const id of available) byLocalName.set(id.slice(id.lastIndexOf('.') + 1), id);
  const chosen: string[] = [];
  for (const entry of wanted) {
    const match = available.includes(entry) ? entry : byLocalName.get(entry);
    if (match !== undefined && !chosen.includes(match)) chosen.push(match);
  }
  return chosen;
}

/** Table ids from a stored snapshot model. */
function tableIds(schema: unknown): string[] {
  if (schema === null || typeof schema !== 'object') return [];
  const tables = (schema as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  return tables
    .map((table) => (table as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string');
}

function describeProbe(summary: ConnectionTestSummary): string {
  const bits = [`${String(Math.round(summary.latencyMs))} ms`];
  if (summary.serverVersion !== null) bits.push(summary.serverVersion);
  if (summary.readOnly) bits.push('read-only role');
  return bits.join(' · ');
}

// ── meta placement ───────────────────────────────────────────────────────────

interface MetaChoice {
  /** `null` = keep the embedded SQLite fallback. */
  url: string | null;
  /** Persist the choice to `<dataDir>/adminium.json` (§7.2). */
  persist: boolean;
}

/**
 * Ask where the meta store lives — only when nothing already answers that
 * (env or bootstrap file). Returns the DSN to use, or null for embedded.
 */
async function askMetaPlacement(io: CliIo, dataDir: string): Promise<MetaChoice> {
  const index = await choose(
    io,
    'Where should Adminium keep its own data (users, pages, settings)?',
    [
      `Embedded SQLite in ${dataDir} — simplest, fine for a single instance`,
      'A PostgreSQL / MySQL database I provide — recommended for production',
    ],
  );
  if (index === 0) return { url: null, persist: false };

  for (;;) {
    const url = await io.ask('Meta store DSN (postgres://… or mysql://…)');
    if (url === '') {
      io.err('Enter a DSN, or re-run and pick the embedded option.');
      continue;
    }
    try {
      metaEngineFromUrl(url);
      return { url, persist: true };
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
    }
  }
}

export const initCommand: Command = {
  name: 'init',
  summary: 'Interactive setup: connect a database and generate the app',
  usage: 'adminium [init] [--port <n>] [--host <addr>]',
  describe:
    'Walks through connecting a database and generating an admin app, then\n' +
    'starts the server. This is what `npx adminium` runs with no arguments.',
  flags: {
    port: { type: 'string', short: 'p', placeholder: '<n>', describe: 'Port to listen on', defaultDescription: 'PORT or 4600' },
    host: { type: 'string', placeholder: '<addr>', describe: 'Address to bind', defaultDescription: 'HOST or 0.0.0.0' },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN (skips the meta question)' },
    name: { type: 'string', placeholder: '<name>', describe: 'Connection name', defaultDescription: 'prompted' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, initCommand.flags, initCommand.name);
    const style = createStyle(false);

    if (!io.isInteractive) {
      throw new CliError('The setup wizard needs an interactive terminal.', {
        hint: 'Non-interactive? Configure via environment and run `adminium start`.',
      });
    }

    const port = numberFlag(values.port, 'port', initCommand.name);
    const host = stringFlag(values.host);
    const dataDirFlag = stringFlag(values['data-dir']);
    const metaUrlFlag = stringFlag(values['meta-url']);

    // Fails fast and actionably when ADMINIUM_SECRET is absent — before a single
    // question, because nothing we collect could be stored without it.
    let env = loadCliEnv(deps.env, {
      ...(port === undefined ? {} : { port }),
      ...(host === undefined ? {} : { host }),
      ...(dataDirFlag === undefined ? {} : { dataDir: dataDirFlag }),
      ...(metaUrlFlag === undefined ? {} : { metaUrl: metaUrlFlag }),
    });

    io.out(style.bold('Adminium setup'));
    io.out('Connect a database, get an admin app. Ctrl-C to stop.');

    // ── Step 0 — meta placement (see the module note on ordering) ───────────
    if (env.ADMINIUM_META_URL === undefined) {
      const existing = await readBootstrap(env.ADMINIUM_DATA_DIR);
      if (existing?.metaUrl === undefined) {
        const choice = await askMetaPlacement(io, env.ADMINIUM_DATA_DIR);
        if (choice.url !== null) {
          env = loadCliEnv(deps.env, {
            ...(port === undefined ? {} : { port }),
            ...(host === undefined ? {} : { host }),
            ...(dataDirFlag === undefined ? {} : { dataDir: dataDirFlag }),
            metaUrl: choice.url,
          });
          if (choice.persist) {
            // §7.2: the meta DSN cannot live in the meta store itself, so it is
            // persisted here, AES-256-GCM-encrypted under ADMINIUM_SECRET.
            await writeBootstrap(env.ADMINIUM_DATA_DIR, {
              v: 1,
              metaUrl: metaUrlCryptoFromSecret(env.ADMINIUM_SECRET).encrypt(choice.url),
              createdAt: new Date().toISOString(),
              instanceId: crypto.randomUUID(),
            });
          }
        }
      }
    }

    const runtime = await deps.openRuntime(env, { blockLoopback: false });
    let started = false;
    try {
      if (runtime.metaStore.source === 'embedded') {
        io.err(embeddedMetaWarning(runtime.metaStore.url));
      }
      // `firstRun`, not `applyMigrations`: no migration seeds the built-in roles,
      // and without `super-admin` on disk the account this wizard tells the user
      // to create at the end cannot be created at all (see `start.ts`).
      const { appliedMigrations } = await firstRun(runtime.metaStore.meta);
      io.out(
        appliedMigrations.length === 0
          ? `Meta store ready (${runtime.metaStore.engine}).`
          : `Meta store ready (${runtime.metaStore.engine}) — ${String(appliedMigrations.length)} migration(s) applied.`,
      );

      // ── Step 1 — intent ───────────────────────────────────────────────────
      const intentIndex = await choose(
        io,
        'What is this admin panel for?',
        GENERATE_INTENTS.map((intent) => INTENT_LABELS[intent]),
      );
      const intent = GENERATE_INTENTS[intentIndex] as GenerateIntent;

      // ── Step 2 — source ───────────────────────────────────────────────────
      const dsn = await askForDsn(io);

      // ── Step 3 — test (+ the §3.1 meta-placement rule) ────────────────────
      const engine = engineOfDsn(dsn);
      io.out('');
      io.out('Testing the connection…');
      const summary = await runtime.manager.testDsn(engine, dsn);
      if (!summary.ok) {
        throw new CliError(summary.error?.message ?? 'Could not connect to that database.', {
          ...(summary.error?.hint == null ? {} : { hint: summary.error.hint }),
        });
      }
      io.out(`Connected — ${describeProbe(summary)}`);

      // 01 §3.1: same-database meta placement against a read-only or DDL-less
      // role is refused here, in the manager, not merely in a wizard UI.
      try {
        runtime.manager.enforceMetaPlacement(dsn, summary);
      } catch (error) {
        if (error instanceof MetaPlacementError) {
          throw new CliError(error.message, {
            hint: 'Point ADMINIUM_META_URL at a separate database, or grant the role write + DDL.',
            cause: error,
          });
        }
        throw error;
      }

      const name =
        stringFlag(values.name) ?? (await io.ask('Name this connection', { default: 'primary' }));

      const connection = await runtime.manager.connections.create({
        name,
        engine,
        introspectDsn: dsn,
        dataDsn: dsn,
        settings: { intent },
      });
      io.out(`Created connection ${connection.id}.`);

      // ── Step 4 — introspect + tables ──────────────────────────────────────
      io.out('');
      io.out('Reading the schema (never your rows)…');
      const introspection = await runIntrospection({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        connectionId: connection.id,
      });
      const available = tableIds(introspection.snapshot.schema);
      io.out(`Found ${String(available.length)} tables.`);
      if (introspection.proposedMasks > 0) {
        io.out(`Masked ${String(introspection.proposedMasks)} likely-PII column(s) by default.`);
      }

      const included = await askForTables(io, available);
      if (included.length !== available.length) {
        await runtime.manager.connections.update(connection.id, {
          settings: { ...connection.settings, intent, includedTables: included },
        });
        io.out(`Including ${String(included.length)} of ${String(available.length)} tables.`);
      }

      // ── Step 5 — generate ─────────────────────────────────────────────────
      io.out('');
      io.out('Generating pages…');
      const generated = await runGeneration({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        connectionId: connection.id,
        intent,
      });
      io.out(
        `Generated ${String(generated.pages.length)} page(s) across ` +
          `${String(generated.navGroups.length)} nav group(s).`,
      );
      for (const warning of generated.warnings) io.err(`note: ${warning}`);

      // ── Step 6 — boot ─────────────────────────────────────────────────────
      const server = await deps.startServer(runtime);
      started = true;
      io.out('');
      io.out(style.bold(`Adminium is running at ${server.url}`));
      io.out('Open it to create your first admin account.');
      io.out('');
      io.out('Next time, skip the wizard with: adminium start');
      io.out(`AI-enrich your schema: adminium generate-prompt --connection ${connection.id}`);
      return EXIT_OK;
    } finally {
      await io.close();
      // The server owns the meta handle once it is listening; closing the
      // runtime here would pull the store out from under it.
      if (!started) await runtime.close();
    }
  },
};

/** `postgres://…` → `postgres`. The DSN grammar is validated by `guardDsn` downstream. */
function engineOfDsn(dsn: string): SourceEngine {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(dsn)?.[1]?.toLowerCase();
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
    case 'file':
      return 'sqlite';
    default:
      throw new CliError(`Unsupported database DSN "${dsn}".`, {
        hint: 'Use postgres://…, mysql://…, or sqlite:<path>.',
      });
  }
}

/** The source step: paste a DSN, fill in fields, or point at a SQLite file. */
async function askForDsn(io: CliIo): Promise<string> {
  const mode = await choose(io, 'How do you want to connect?', [
    'Paste a connection string',
    'Enter host, port, user, password, database',
    'Point at a SQLite file',
  ]);

  if (mode === 0) {
    for (;;) {
      const dsn = await io.ask('Connection string');
      if (dsn !== '') return dsn;
      io.err('A connection string is required.');
    }
  }

  if (mode === 2) {
    for (;;) {
      const path = await io.ask('SQLite file path');
      if (path !== '') return `sqlite:${path}`;
      io.err('A file path is required.');
    }
  }

  const engineIndex = await choose(io, 'Which engine?', ['PostgreSQL', 'MySQL / MariaDB']);
  const engine: SourceEngine = engineIndex === 0 ? 'postgres' : 'mysql';
  const host = await io.ask('Host', { default: 'localhost' });
  const port = Number(
    await io.ask('Port', { default: String(DEFAULT_PORTS[engine]) }),
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`"${String(port)}" is not a valid port.`);
  }
  const user = await io.ask('User');
  const password = await io.ask('Password', { mask: true });
  const database = await io.ask('Database');
  return composeDsn({ engine, host, port, user, password, database });
}

/** The tables step. Everything is included unless the user narrows it. */
async function askForTables(io: CliIo, available: readonly string[]): Promise<string[]> {
  if (available.length === 0) return [];
  const preview = available.slice(0, 12).map((id) => id.slice(id.lastIndexOf('.') + 1));
  io.out('');
  io.out(`Tables: ${preview.join(', ')}${available.length > preview.length ? ', …' : ''}`);
  const answer = await io.ask('Include which tables? (comma-separated, or Enter for all)', {
    default: 'all',
  });
  const chosen = parseTableSelection(answer, available);
  if (chosen.length === 0) {
    io.err('No table names matched — including all of them.');
    return [...available];
  }
  return chosen;
}
